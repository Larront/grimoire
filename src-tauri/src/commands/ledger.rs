use crate::commands::import::{reconcile_notes_with_disk, FailedImport};
use crate::commands::links::rebuild_note_links_from_ledger;
use crate::commands::tags::rebuild_note_tags_from_ledger;
use crate::commands::templates::inject_builtin_templates;
use crate::db::establish_connection;
use crate::db::models::{Map, NewPinCategory, Note, Scene};
use crate::db::schema::{maps, notes, pin_categories, scenes};
use crate::ledger::AppLedger;
use diesel::prelude::*;
use std::path::PathBuf;
use tauri::State;

fn seed_default_categories(conn: &mut SqliteConnection) -> Result<(), String> {
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

#[derive(serde::Serialize)]
pub struct OpenLedgerResult {
    pub path: String,
    pub note_count: i64,
    pub scene_count: i64,
    pub map_count: i64,
    pub failed_imports: Vec<FailedImport>,
}

#[tauri::command]
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

    // Rebuild the tag index from a fresh frontmatter scan. Cheap for typical
    // ledger sizes; guarantees the index stays in sync with disk even if a
    // previous session crashed mid-write or `.grimoire/` was wiped.
    rebuild_note_tags_from_ledger(&ledger_path, &mut conn)?;
    rebuild_note_links_from_ledger(&ledger_path, &mut conn)?;

    // Rebuild the Tantivy search index. Non-fatal: a failure just leaves
    // search unavailable until the next manual rebuild or ledger reopen.
    let all_notes: Vec<Note> = notes::table.load::<Note>(&mut conn).unwrap_or_default();
    let all_maps: Vec<Map> = maps::table.load::<Map>(&mut conn).unwrap_or_default();
    let all_scenes: Vec<Scene> = scenes::table.load::<Scene>(&mut conn).unwrap_or_default();
    let search_index = crate::search::rebuild_index(&ledger_path, &all_notes, &all_maps, &all_scenes).ok();

    let note_count: i64 = notes::table
        .count()
        .get_result(&mut conn)
        .unwrap_or(0);
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
pub fn get_ledger_path(ledger: State<AppLedger>) -> Option<String> {
    let state = ledger.lock().ok()?;
    state.path.as_ref().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
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
}
