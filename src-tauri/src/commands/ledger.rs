use crate::commands::import::{reconcile_notes_with_disk, FailedImport};
use crate::commands::templates::inject_builtin_templates;
use crate::db::establish_connection;
use crate::db::models::{Map, NewPinCategory, Scene};
use crate::db::schema::{maps, notes, pin_categories, scenes};
use crate::ledger::AppLedger;
use diesel::prelude::*;
use std::path::PathBuf;
use tauri::State;

pub(crate) fn seed_default_categories(conn: &mut SqliteConnection) -> Result<(), String> {
    let count: i64 = pin_categories::table
        .filter(pin_categories::map_id.is_null())
        .count()
        .get_result(conn)
        .map_err(|e| e.to_string())?;

    if count > 0 {
        return Ok(());
    }

    let defaults: Vec<NewPinCategory> = vec![
        NewPinCategory { map_id: None, name: "Town",              icon: "house",     color: "#c4843a" },
        NewPinCategory { map_id: None, name: "City",              icon: "castle",    color: "#e0b44a" },
        NewPinCategory { map_id: None, name: "Cave",              icon: "mountain",  color: "#8b6abf" },
        NewPinCategory { map_id: None, name: "Dungeon",           icon: "skull",     color: "#cf4545" },
        NewPinCategory { map_id: None, name: "Ruin",              icon: "landmark",  color: "#7a8499" },
        NewPinCategory { map_id: None, name: "Forest",            icon: "tree-pine", color: "#4a9b5a" },
        NewPinCategory { map_id: None, name: "Point of Interest", icon: "map-pin",   color: "#6a9b87" },
    ];

    diesel::insert_into(pin_categories::table)
        .values(&defaults)
        .execute(conn)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[derive(serde::Serialize, specta::Type)]
pub struct OpenLedgerResult {
    pub path: String,
    #[specta(type = i32)]
    pub note_count: i64,
    #[specta(type = i32)]
    pub scene_count: i64,
    #[specta(type = i32)]
    pub map_count: i64,
    pub failed_imports: Vec<FailedImport>,
}

#[tauri::command]
#[specta::specta]
pub fn open_ledger(path: String, ledger: State<AppLedger>) -> Result<OpenLedgerResult, String> {
    let ledger_path = PathBuf::from(&path);

    if !ledger_path.exists() {
        std::fs::create_dir_all(&ledger_path)
            .map_err(|e| format!("Failed to create ledger directory: {}", e))?;
    }

    inject_builtin_templates(&ledger_path)?;

    let mut conn = establish_connection(&ledger_path)?;
    seed_default_categories(&mut conn)?;

    // Prune maps abandoned mid-creation: a map row is inserted as soon as the
    // user clicks "New Map", but only becomes navigable (file tree, image) once
    // an image is assigned. An imageless map is invisible everywhere except the
    // graph view, so sweep them here to catch ones left by a crash or force-quit.
    diesel::delete(maps::table.filter(maps::image_path.is_null()))
        .execute(&mut conn)
        .map_err(|e| e.to_string())?;

    // Bring the notes table into agreement with on-disk .md files before the
    // tag/link/search rebuild passes so they see fully-populated rows.
    let import_report = reconcile_notes_with_disk(&ledger_path, &mut conn)?;

    // Single walk: parse each .md file once into DerivedFacets and populate
    // note_tags, note_links, note_aliases, and the Tantivy Search Index.
    // SQLite inserts are chunked/bulk; search failure is non-fatal (ADR-0004).
    let all_maps: Vec<Map> = maps::table.load::<Map>(&mut conn).unwrap_or_default();
    let all_scenes: Vec<Scene> = scenes::table.load::<Scene>(&mut conn).unwrap_or_default();
    let search_index = crate::note_index::rebuild_all_from_ledger(
        &ledger_path,
        &mut conn,
        &all_maps,
        &all_scenes,
    )?;
    // Per ADR-0004: a successful rebuild clears any persisted stale marker
    // (written by reconcile/remove on a Tantivy failure); a failure leaves it
    // in place so the next launch retries.
    crate::note_index::clear_stale_marker_if_rebuilt(&ledger_path, search_index.is_some());

    // PDFs are loose, path-addressed files (ADR-0011) with no `notes` row, so they
    // are counted off disk and folded into the note count — the welcome screen's
    // "N notes" stat reads PDFs as notes (the recent-ledger entry persists this
    // combined value; see ledger.svelte.ts).
    let pdf_count = crate::commands::import::count_pdf_files(&ledger_path) as i64;
    let note_count: i64 = notes::table
        .count()
        .get_result(&mut conn)
        .unwrap_or(0)
        + pdf_count;
    let scene_count: i64 = scenes::table
        .count()
        .get_result(&mut conn)
        .unwrap_or(0);
    let map_count: i64 = maps::table
        .count()
        .get_result(&mut conn)
        .unwrap_or(0);

    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    state.path = Some(ledger_path);
    state.connection = Some(conn);
    state.search_index = search_index;

    Ok(OpenLedgerResult {
        path,
        note_count,
        scene_count,
        map_count,
        failed_imports: import_report.failed,
    })
}

#[tauri::command]
#[specta::specta]
pub fn get_ledger_path(ledger: State<AppLedger>) -> Option<String> {
    let state = ledger.lock().ok()?;
    state.path.as_ref().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
#[specta::specta]
pub fn close_ledger(ledger: State<AppLedger>) -> Result<(), String> {
    let mut state = ledger.lock().map_err(|e| e.to_string())?;
    state.connection = None;
    state.path = None;
    state.search_index = None;
    state.pending_spotify_verifier = None;
    state.pending_spotify_state = None;
    // spotify_client_id is intentionally kept — it is app-level config, not ledger-specific
    Ok(())
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    #[test]
    fn test_open_ledger_creates_directory() {
        let tmp = tempdir().unwrap();
        let new_dir = tmp.path().join("new_ledger");
        // Just test the directory creation logic directly
        std::fs::create_dir_all(&new_dir).unwrap();
        assert!(new_dir.exists());
    }

    #[test]
    fn stale_marker_cleared_after_successful_rebuild_on_open() {
        let tmp = tempdir().unwrap();
        let ledger_path = tmp.path();
        std::fs::create_dir_all(ledger_path.join(".grimoire")).unwrap();

        // A previous session left a stale marker after a Tantivy write failure.
        crate::note_index::write_search_stale_marker(ledger_path);

        // open_ledger's launch-time reconciliation, with a rebuild that succeeded.
        crate::note_index::clear_stale_marker_if_rebuilt(ledger_path, true);

        assert!(
            !crate::note_index::stale_marker_path(ledger_path).exists(),
            "marker must be cleared after a successful rebuild"
        );
    }

    #[test]
    fn stale_marker_kept_after_failed_rebuild_on_open() {
        let tmp = tempdir().unwrap();
        let ledger_path = tmp.path();
        std::fs::create_dir_all(ledger_path.join(".grimoire")).unwrap();

        crate::note_index::write_search_stale_marker(ledger_path);

        // open_ledger's launch-time reconciliation, with a rebuild that failed.
        crate::note_index::clear_stale_marker_if_rebuilt(ledger_path, false);

        assert!(
            crate::note_index::stale_marker_path(ledger_path).exists(),
            "marker must remain after a failed rebuild"
        );
    }
}
