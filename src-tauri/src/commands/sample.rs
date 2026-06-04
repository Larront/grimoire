use crate::db::models::{NewMap, NewPin};
use crate::db::schema::{maps, notes, pin_categories, pins};
use diesel::prelude::*;
use std::path::Path;
use tauri::{AppHandle, Manager};

/// Recursively copies src into dst, creating dst if it does not exist.
/// If dst already exists it is removed first (reset-to-pristine semantics).
pub fn copy_dir_tree(src: &Path, dst: &Path) -> Result<(), String> {
    if dst.exists() {
        std::fs::remove_dir_all(dst)
            .map_err(|e| format!("Failed to remove existing sandbox: {}", e))?;
    }
    std::fs::create_dir_all(dst)
        .map_err(|e| format!("Failed to create sandbox directory: {}", e))?;
    for entry in std::fs::read_dir(src)
        .map_err(|e| format!("Failed to read source directory {:?}: {}", src, e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_tree(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)
                .map_err(|e| format!("Failed to copy {:?}: {}", src_path, e))?;
        }
    }
    Ok(())
}

/// Seeds the Ashfen Region map, its default pin categories, and three pins into the
/// already-open connection. Idempotent: skips if any map rows already exist.
/// Must be called after `seed_default_categories` and `reconcile_notes_with_disk`
/// so that pin_categories and notes rows are present for ID lookups.
pub fn seed_sample_world_maps(conn: &mut SqliteConnection) -> Result<(), String> {
    let map_count: i64 = maps::table
        .count()
        .get_result(conn)
        .map_err(|e| e.to_string())?;
    if map_count > 0 {
        return Ok(());
    }

    let map: crate::db::models::Map = diesel::insert_into(maps::table)
        .values(&NewMap {
            title: "Ashfen Region",
            image_path: Some("maps/ashfen-region.png"),
            image_width: Some(256),
            image_height: Some(192),
        })
        .returning(crate::db::models::Map::as_returning())
        .get_result(conn)
        .map_err(|e| format!("Failed to insert sample map: {}", e))?;

    // Resolve global category IDs seeded by seed_default_categories.
    let ruin_id: Option<i32> = pin_categories::table
        .filter(
            pin_categories::name
                .eq("Ruin")
                .and(pin_categories::map_id.is_null()),
        )
        .select(pin_categories::id)
        .first(conn)
        .optional()
        .map_err(|e| e.to_string())?;

    let town_id: Option<i32> = pin_categories::table
        .filter(
            pin_categories::name
                .eq("Town")
                .and(pin_categories::map_id.is_null()),
        )
        .select(pin_categories::id)
        .first(conn)
        .optional()
        .map_err(|e| e.to_string())?;

    let poi_id: Option<i32> = pin_categories::table
        .filter(
            pin_categories::name
                .eq("Point of Interest")
                .and(pin_categories::map_id.is_null()),
        )
        .select(pin_categories::id)
        .first(conn)
        .optional()
        .map_err(|e| e.to_string())?;

    // Resolve note IDs for linked pins.
    let keep_id: Option<i32> = notes::table
        .filter(notes::path.eq("Locations/The Ember Keep.md"))
        .select(notes::id)
        .first(conn)
        .optional()
        .map_err(|e| e.to_string())?;

    let thornhaven_id: Option<i32> = notes::table
        .filter(notes::path.eq("Locations/Thornhaven Village.md"))
        .select(notes::id)
        .first(conn)
        .optional()
        .map_err(|e| e.to_string())?;

    let mira_id: Option<i32> = notes::table
        .filter(notes::path.eq("Characters/Mira Ashvale.md"))
        .select(notes::id)
        .first(conn)
        .optional()
        .map_err(|e| e.to_string())?;

    let pin_data = [
        (
            0.63_f32,
            0.68_f32,
            "The Ember Keep",
            ruin_id,
            keep_id,
        ),
        (
            0.28_f32,
            0.22_f32,
            "Thornhaven Village",
            town_id,
            thornhaven_id,
        ),
        (
            0.60_f32,
            0.55_f32,
            "Mira's Camp",
            poi_id,
            mira_id,
        ),
    ];

    for (x, y, title, category_id, note_id) in &pin_data {
        diesel::insert_into(pins::table)
            .values(&NewPin {
                map_id: map.id,
                x: *x,
                y: *y,
                title,
                description: None,
                category_id: *category_id,
                note_id: *note_id,
            })
            .execute(conn)
            .map_err(|e| format!("Failed to insert pin '{}': {}", title, e))?;
    }

    Ok(())
}

/// Copies the bundled sample-world resource tree to a writable sandbox at
/// `app_data_dir/sample-world/`, wipes any prior sandbox, pre-seeds the
/// database with the sample map and pins, and returns the sandbox path.
/// The frontend follows up with `open_ledger` (which rebuilds derived indexes)
/// and skips `add_recent_ledger` to keep the sample ephemeral.
#[tauri::command]
#[specta::specta]
pub fn explore_sample_ledger(app: AppHandle) -> Result<String, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to resolve resource directory: {}", e))?;
    let sample_src = resource_dir.join("sample-world");

    if !sample_src.exists() {
        return Err(format!(
            "Bundled sample-world not found at {:?}",
            sample_src
        ));
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
    let sample_dst = app_data_dir.join("sample-world");

    copy_dir_tree(&sample_src, &sample_dst)?;

    // Pre-seed the DB so that the map and pins are present when the frontend's
    // subsequent open_ledger call runs (which only rebuilds derived indexes and
    // would never insert map rows on its own).
    let mut conn = crate::db::establish_connection(&sample_dst)?;
    crate::commands::ledger::seed_default_categories(&mut conn)?;
    crate::commands::import::reconcile_notes_with_disk(&sample_dst, &mut conn)?;
    seed_sample_world_maps(&mut conn)?;

    Ok(sample_dst.to_string_lossy().to_string())
}

/// Copies the current (possibly-edited) sandbox at `app_data_dir/sample-world/` to
/// `parent/name/` and returns the destination path. The frontend follows up with the
/// vanilla `open_ledger` path (which records recents and persists prefs) and clears `isSample`.
#[tauri::command]
#[specta::specta]
pub fn adopt_sample_ledger(parent: String, name: String, app: AppHandle) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
    let sandbox = app_data_dir.join("sample-world");

    if !sandbox.exists() {
        return Err("No sample sandbox found to adopt — explore the sample first.".to_string());
    }

    let dest = Path::new(&parent).join(&name);
    copy_dir_tree(&sandbox, &dest)?;

    Ok(dest.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::import::reconcile_notes_with_disk;
    use crate::commands::ledger::seed_default_categories;
    use crate::db::establish_connection;
    use crate::db::schema::{maps, note_links, notes, scenes};
    use diesel::prelude::*;
    use std::fs;
    use tempfile::tempdir;

    // ── copy_dir_tree ─────────────────────────────────────────────────────────

    #[test]
    fn copy_dir_tree_copies_nested_tree() {
        let src = tempdir().unwrap();
        let dst_parent = tempdir().unwrap();
        let dst = dst_parent.path().join("output");

        fs::create_dir(src.path().join("subdir")).unwrap();
        fs::write(src.path().join("root.md"), "# Root").unwrap();
        fs::write(src.path().join("subdir").join("child.md"), "# Child").unwrap();

        copy_dir_tree(src.path(), &dst).unwrap();

        assert!(dst.join("root.md").exists());
        assert!(dst.join("subdir").join("child.md").exists());
        assert_eq!(fs::read_to_string(dst.join("root.md")).unwrap(), "# Root");
        assert_eq!(
            fs::read_to_string(dst.join("subdir").join("child.md")).unwrap(),
            "# Child"
        );
    }

    #[test]
    fn copy_dir_tree_replaces_existing_destination() {
        let src = tempdir().unwrap();
        let dst_parent = tempdir().unwrap();
        let dst = dst_parent.path().join("output");

        fs::write(src.path().join("first.md"), "First").unwrap();
        copy_dir_tree(src.path(), &dst).unwrap();
        assert!(dst.join("first.md").exists());

        // Change src: remove first.md, add second.md
        fs::remove_file(src.path().join("first.md")).unwrap();
        fs::write(src.path().join("second.md"), "Second").unwrap();
        copy_dir_tree(src.path(), &dst).unwrap();

        assert!(!dst.join("first.md").exists(), "old file must be gone after re-copy");
        assert!(dst.join("second.md").exists());
        assert_eq!(
            fs::read_to_string(dst.join("second.md")).unwrap(),
            "Second"
        );
    }

    // ── sample world integrity ────────────────────────────────────────────────

    /// Full pipeline test: copy the bundled sample-world fixture into a
    /// tempdir, run the same setup sequence used by explore_sample_ledger +
    /// open_ledger, and assert that the authored content is internally
    /// consistent (correct counts, real links, stub, alias, Timeline fence).
    #[test]
    fn sample_world_integrity() {
        let sample_src =
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("sample-world");
        assert!(
            sample_src.exists(),
            "sample-world fixture not found at {:?}",
            sample_src
        );

        // Copy fixture to a writable tempdir.
        let tmp = tempdir().unwrap();
        copy_dir_tree(&sample_src, tmp.path()).unwrap();

        // Establish DB + run the open_ledger initialisation pipeline.
        let mut conn = establish_connection(tmp.path()).unwrap();
        seed_default_categories(&mut conn).unwrap();
        let import_report = reconcile_notes_with_disk(tmp.path(), &mut conn).unwrap();

        assert!(
            import_report.failed.is_empty(),
            "expected no import failures, got: {:?}",
            import_report.failed
        );

        seed_sample_world_maps(&mut conn).unwrap();

        // Rebuild derived indexes (tags, links, aliases, search).
        let all_maps: Vec<crate::db::models::Map> =
            maps::table.load(&mut conn).unwrap_or_default();
        let all_scenes: Vec<crate::db::models::Scene> =
            scenes::table.load(&mut conn).unwrap_or_default();
        crate::note_index::rebuild_all_from_ledger(
            tmp.path(),
            &mut conn,
            &all_maps,
            &all_scenes,
        )
        .unwrap();

        // ── Note count ───────────────────────────────────────────────────────
        let note_count: i64 = notes::table.count().get_result(&mut conn).unwrap();
        assert_eq!(
            note_count, 10,
            "expected exactly 10 notes, got {note_count}"
        );

        // ── Scene count ──────────────────────────────────────────────────────
        let scene_count: i64 = scenes::table.count().get_result(&mut conn).unwrap();
        assert_eq!(scene_count, 0, "expected 0 scenes (audio not yet authored)");

        // ── Map count ────────────────────────────────────────────────────────
        let map_count: i64 = maps::table.count().get_result(&mut conn).unwrap();
        assert_eq!(map_count, 1, "expected exactly 1 map (Ashfen Region)");

        // ── Pin count ────────────────────────────────────────────────────────
        let pin_count: i64 = crate::db::schema::pins::table
            .count()
            .get_result(&mut conn)
            .unwrap();
        assert_eq!(pin_count, 3, "expected 3 pins on the Ashfen Region map");

        // ── All pins are linked to real notes ────────────────────────────────
        let unlinked_pins: i64 = crate::db::schema::pins::table
            .filter(crate::db::schema::pins::note_id.is_null())
            .count()
            .get_result(&mut conn)
            .unwrap();
        assert_eq!(unlinked_pins, 0, "all 3 pins must link to notes");

        // ── Stub: The Order of Embers is referenced but not written ──────────
        let stub_links: i64 = note_links::table
            .filter(note_links::target_path.eq("The Order of Embers"))
            .count()
            .get_result(&mut conn)
            .unwrap();
        assert!(
            stub_links >= 1,
            "expected ≥1 link to 'The Order of Embers' stub"
        );

        let stub_note_exists: i64 = notes::table
            .filter(notes::path.eq("The Order of Embers"))
            .count()
            .get_result(&mut conn)
            .unwrap();
        assert_eq!(
            stub_note_exists, 0,
            "'The Order of Embers' must not exist as a real note"
        );

        // ── Alias: Mira Ashvale has alias 'Mira' ─────────────────────────────
        let mira_alias_count: i64 = diesel::dsl::sql::<diesel::sql_types::BigInt>(
            "SELECT COUNT(*) FROM note_aliases \
             WHERE lower(alias) = 'mira' \
             AND note_id = (SELECT id FROM notes WHERE path = 'Characters/Mira Ashvale.md')",
        )
        .get_result(&mut conn)
        .unwrap();
        assert_eq!(
            mira_alias_count, 1,
            "Mira Ashvale must have alias 'Mira' in note_aliases"
        );

        // ── Alias link: at least one note links to 'Mira' via alias ──────────
        let alias_link_count: i64 = note_links::table
            .filter(note_links::target_path.eq("Mira"))
            .count()
            .get_result(&mut conn)
            .unwrap();
        assert!(
            alias_link_count >= 1,
            "expected ≥1 wikilink with target_path='Mira' (alias-resolved link)"
        );

        // ── Timeline: The Ashfen Chronicle contains a timeline fence ─────────
        let chronicle_path = tmp.path().join("The Ashfen Chronicle.md");
        let chronicle_content = fs::read_to_string(&chronicle_path).unwrap_or_default();
        assert!(
            chronicle_content.contains("```timeline"),
            "The Ashfen Chronicle must contain a ```timeline fence"
        );

        // ── Session log: Session 1 has no timeline fence ─────────────────────
        let session_path = tmp
            .path()
            .join("Sessions")
            .join("Session 1 \u{2014} The Arrival.md");
        let session_content = fs::read_to_string(&session_path).unwrap_or_default();
        assert!(
            !session_content.contains("```timeline"),
            "Session 1 must not contain a timeline fence"
        );

        // ── Wikilinks produce real edges (not all stubs) ──────────────────────
        let keep_note_id: Option<i32> = notes::table
            .filter(notes::path.eq("Locations/The Ember Keep.md"))
            .select(notes::id)
            .first(&mut conn)
            .optional()
            .unwrap();
        assert!(
            keep_note_id.is_some(),
            "'Locations/The Ember Keep.md' must exist as a note"
        );

        let incoming_links_to_keep: i64 = note_links::table
            .filter(
                note_links::target_path.eq("Locations/The Ember Keep.md"),
            )
            .count()
            .get_result(&mut conn)
            .unwrap();
        assert!(
            incoming_links_to_keep >= 3,
            "The Ember Keep must have ≥3 backlinks, got {incoming_links_to_keep}"
        );
    }
}
