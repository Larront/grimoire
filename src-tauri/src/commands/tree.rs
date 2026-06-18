use crate::commands::links::rewrite_backlinks_on_rename_on_conn;
use crate::db::models::{Map, Note};
use crate::db::schema::maps;
use crate::db::schema::notes::dsl::*; // used in get_file_tree (Task 2) + delete_folder (Task 3)
use crate::ledger::AppLedger;
use diesel::prelude::*;
use diesel::sql_query;                // used in rename_folder (Task 4)
use diesel::sql_types::Text;          // used in rename_folder (Task 4)
use diesel::SqliteConnection;         // used in delete_folder_inner + rename_folder_inner (Tasks 3–4)
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use tauri::State;                     // used in Tauri command wrappers (Tasks 2–4)

#[derive(Serialize, specta::Type, Debug)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub note_id: Option<i32>,
    pub map_id: Option<i32>,
    pub children: Vec<FileNode>,
}

/// Pure recursive tree builder — no Tauri State, fully unit-testable.
/// When called with `relative_path = ""` (the ledger root), the returned root node has
/// `path = ""` — it is a container, not a ledger-addressable path. Callers should
/// iterate `root.children`, not use `root.path` as a Tauri command argument.
pub fn build_file_tree(
    dir_path: &Path,
    relative_path: &str,
    note_map: &HashMap<String, i32>,
    map_map: &HashMap<String, (i32, String)>,
) -> FileNode {
    let name = dir_path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();

    let mut dirs: Vec<FileNode> = Vec::new();
    let mut files: Vec<FileNode> = Vec::new();

    if let Ok(entries) = fs::read_dir(dir_path) {
        for entry in entries.flatten() {
            let entry_name = entry.file_name().to_string_lossy().into_owned();

            // Skip hidden entries — this also hides the `.grimoire/` metadata
            // folder where the app stores its DB, templates, pasted images,
            // audio, search index, and thumbnails. Users can name everything
            // else whatever they want.
            if entry_name.starts_with('.') {
                continue;
            }

            let entry_path = entry.path();
            let child_rel = if relative_path.is_empty() {
                entry_name.clone()
            } else {
                format!("{}/{}", relative_path, entry_name)
            };

            if entry_path.is_dir() {
                dirs.push(build_file_tree(&entry_path, &child_rel, note_map, map_map));
            } else if entry_name.ends_with(".md") {
                let stem = entry_name.strip_suffix(".md").unwrap_or(&entry_name).to_string();
                let note_id = note_map.get(&child_rel).copied();
                files.push(FileNode {
                    name: stem,
                    path: child_rel,
                    is_dir: false,
                    note_id,
                    map_id: None,
                    children: Vec::new(),
                });
            } else {
                let lower = entry_name.to_lowercase();
                if lower.ends_with(".png") || lower.ends_with(".jpg")
                    || lower.ends_with(".jpeg") || lower.ends_with(".webp")
                {
                    if let Some((mid, map_title)) = map_map.get(&child_rel) {
                        files.push(FileNode {
                            name: map_title.clone(),
                            path: child_rel,
                            is_dir: false,
                            note_id: None,
                            map_id: Some(*mid),
                            children: Vec::new(),
                        });
                    }
                    // Non-map image files: silently skip
                }
            }
        }
    }

    dirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    let mut children = dirs;
    children.extend(files);

    FileNode {
        name,
        path: relative_path.to_string(),
        is_dir: true,
        note_id: None,
        map_id: None,
        children,
    }
}

#[tauri::command]
#[specta::specta]
pub fn get_file_tree(ledger: State<AppLedger>) -> Result<FileNode, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let ledger_path = state.path.clone().ok_or("No ledger open")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;

    // Build note map — acquire mutex once; do not call get_notes as a sub-command
    // (double-locking AppLedger's Mutex would deadlock).
    let note_list = notes.load::<Note>(conn).map_err(|e| e.to_string())?;
    let note_map: HashMap<String, i32> = note_list
        .into_iter()
        .map(|n| (n.path, n.id))
        .collect();

    let map_list = maps::table.load::<Map>(conn).map_err(|e| e.to_string())?;
    let map_map: HashMap<String, (i32, String)> = map_list
        .into_iter()
        .filter_map(|m| m.image_path.map(|ip| (ip, (m.id, m.title))))
        .collect();

    Ok(build_file_tree(&ledger_path, "", &note_map, &map_map))
}

// ── create_folder ──────────────────────────────────────────────────────────

pub fn create_folder_inner(ledger_path: &Path, folder_path: &str) -> Result<(), String> {
    fs::create_dir_all(ledger_path.join(folder_path))
        .map_err(|e| format!("create_dir_all: {}", e))
}

#[tauri::command]
#[specta::specta]
pub fn create_folder(folder_path: String, ledger: State<AppLedger>) -> Result<(), String> {
    let state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let ledger_path = state.path.as_ref().ok_or("No ledger open")?.clone();
    drop(state); // release lock before filesystem op
    create_folder_inner(&ledger_path, &folder_path)
}

// ── delete_folder ──────────────────────────────────────────────────────────

pub fn delete_folder_inner(
    ledger_path: &Path,
    folder_path: &str,
    conn: &mut SqliteConnection,
) -> Result<(), String> {
    // Delete files first — if this succeeds and the DB step fails, the user
    // sees stale tree entries (recoverable). Reverse order (ghost notes in DB
    // after files are gone) is worse.
    fs::remove_dir_all(ledger_path.join(folder_path))
        .map_err(|e| format!("remove_dir_all: {}", e))?;

    let like_pattern = format!("{}/%" , folder_path);
    diesel::delete(notes.filter(path.like(&like_pattern)))
        .execute(conn)
        .map_err(|e| format!("db delete: {}", e))?;

    // Remove maps whose image lives within the deleted folder
    let map_like = format!("{}/%" , folder_path);
    diesel::delete(maps::table.filter(maps::image_path.like(&map_like)))
        .execute(conn)
        .map_err(|e| format!("db delete maps: {}", e))?;

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn delete_folder(folder_path: String, ledger: State<AppLedger>) -> Result<(), String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let ledger_path = state.path.clone().ok_or("No ledger open")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    delete_folder_inner(&ledger_path, &folder_path, conn)
}

// ── rename_folder ──────────────────────────────────────────────────────────

pub fn rename_folder_inner(
    ledger_path: &Path,
    old_path: &str,
    new_path: &str,
    conn: &mut SqliteConnection,
    index: Option<&tantivy::Index>,
) -> Result<usize, String> {
    let old_prefix = format!("{}/", old_path);
    let new_prefix = format!("{}/", new_path);
    let like_pattern = format!("{}%", old_prefix);

    // 1. Collect descendant note paths before touching disk so we can compute
    //    (old_path, new_path) pairs for the link rewrite step below.
    let descendant_paths: Vec<String> = notes
        .filter(path.like(&like_pattern))
        .select(path)
        .load(conn)
        .map_err(|e| format!("query descendants: {}", e))?;

    // 2. Rewrite full-path wikilinks pointing at each moved note BEFORE the
    //    filesystem rename so that source files are still readable at their DB
    //    paths. Bare-stem links are left untouched by rewrite_backlinks_on_rename_on_conn
    //    (stem doesn't change on a folder move, so owns_stem is always false).
    let mut all_backlink_rewrites: Vec<crate::note_index::ReconcileManyItem> = Vec::new();
    for old_note_path in &descendant_paths {
        let new_note_path = old_note_path.replacen(&old_prefix, &new_prefix, 1);
        let rewrites =
            rewrite_backlinks_on_rename_on_conn(ledger_path, conn, old_note_path, &new_note_path)?;
        for (note, content) in rewrites {
            all_backlink_rewrites.push(crate::note_index::ReconcileManyItem {
                note,
                content,
                prev_path: None,
            });
        }
    }
    let updated_count = all_backlink_rewrites.len();

    // 3. Rename directory on disk. Individual .md files move atomically with
    //    the folder — no per-file renames are needed.
    fs::rename(ledger_path.join(old_path), ledger_path.join(new_path))
        .map_err(|e| format!("rename dir: {}", e))?;

    // 4. Update `path` for all descendant notes.
    sql_query("UPDATE notes SET path = REPLACE(path, ?, ?) WHERE path LIKE ?")
        .bind::<Text, _>(&old_prefix)
        .bind::<Text, _>(&new_prefix)
        .bind::<Text, _>(&like_pattern)
        .execute(conn)
        .map_err(|e| format!("update paths: {}", e))?;

    // 5a. Update `parent_path` — exact match (direct children: parent_path = old_path).
    //     These rows' parent_path is "creatures" (no slash), not matched by LIKE "creatures/%",
    //     so must be handled separately.
    sql_query("UPDATE notes SET parent_path = ? WHERE parent_path = ?")
        .bind::<Text, _>(new_path)
        .bind::<Text, _>(old_path)
        .execute(conn)
        .map_err(|e| format!("update parent exact: {}", e))?;

    // 5b. Update `parent_path` — prefix match (deeper nesting: parent_path LIKE old_path/%).
    sql_query(
        "UPDATE notes SET parent_path = REPLACE(parent_path, ?, ?) WHERE parent_path LIKE ?",
    )
    .bind::<Text, _>(&old_prefix)
    .bind::<Text, _>(&new_prefix)
    .bind::<Text, _>(&like_pattern)
    .execute(conn)
    .map_err(|e| format!("update parent prefix: {}", e))?;

    // 6. Update image_path for maps inside the renamed folder.
    sql_query("UPDATE maps SET image_path = REPLACE(image_path, ?, ?) WHERE image_path LIKE ?")
        .bind::<Text, _>(&old_prefix)
        .bind::<Text, _>(&new_prefix)
        .bind::<Text, _>(&like_pattern)
        .execute(conn)
        .map_err(|e| format!("update map paths: {}", e))?;

    // 7. Load moved notes (now at new paths) and build reconcile items so their
    //    note_tags are re-keyed and Tantivy is updated. prev_path triggers the
    //    old-path note_tags clear in write_facets.
    let mut moved_items: Vec<crate::note_index::ReconcileManyItem> =
        Vec::with_capacity(descendant_paths.len());
    for old_note_path in &descendant_paths {
        let new_note_path = old_note_path.replacen(&old_prefix, &new_prefix, 1);
        let note: Note = notes
            .filter(path.eq(&new_note_path))
            .first(conn)
            .map_err(|e| format!("load moved note '{new_note_path}': {e}"))?;
        let content = fs::read_to_string(ledger_path.join(&new_note_path))
            .unwrap_or_default();
        moved_items.push(crate::note_index::ReconcileManyItem {
            note,
            content,
            prev_path: Some(old_note_path.clone()),
        });
    }

    // 8. Route all index writes through reconcile_many — one atomic SQLite tx,
    //    one Tantivy commit for backlink sources + moved notes.
    let mut all_items = all_backlink_rewrites;
    all_items.extend(moved_items);
    if !all_items.is_empty() {
        let outcome = crate::note_index::reconcile_many(conn, index, &all_items)?;
        crate::note_index::mark_stale_if_needed(&outcome, ledger_path);
    }

    Ok(updated_count)
}

#[tauri::command]
#[specta::specta]
pub fn rename_folder(
    old_path: String,
    new_path: String,
    ledger: State<AppLedger>,
) -> Result<i32, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let ledger_path = state.path.clone().ok_or("No ledger open")?;
    let state_ref = &mut *state;
    let conn = state_ref.connection.as_mut().ok_or("No ledger open")?;
    let index = state_ref.search_index.as_ref();
    // Cast the internal usize count to i32 at the command seam: specta forbids
    // BigInt-style types in exported bindings, and link counts are always small.
    rename_folder_inner(&ledger_path, &old_path, &new_path, conn, index).map(|n| n as i32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use tempfile::TempDir;

    fn make_tree(setup: impl Fn(&Path)) -> (TempDir, FileNode) {
        let dir = TempDir::new().unwrap();
        setup(dir.path());
        let tree = build_file_tree(dir.path(), "", &HashMap::new(), &HashMap::new());
        (dir, tree)
    }

    #[test]
    fn empty_ledger_has_no_children() {
        let (_dir, tree) = make_tree(|_| {});
        assert!(tree.children.is_empty());
    }

    #[test]
    fn md_files_appear_as_note_nodes() {
        let (_dir, tree) = make_tree(|p| {
            fs::write(p.join("dragon.md"), "# Dragon").unwrap();
        });
        assert_eq!(tree.children.len(), 1);
        let node = &tree.children[0];
        assert_eq!(node.name, "dragon");
        assert!(!node.is_dir);
        assert_eq!(node.path, "dragon.md");
    }

    #[test]
    fn non_md_and_hidden_files_are_skipped() {
        let (_dir, tree) = make_tree(|p| {
            fs::write(p.join("ledger.db"), "").unwrap();
            fs::write(p.join(".hidden"), "").unwrap();
            fs::write(p.join("image.png"), "").unwrap();
        });
        assert!(tree.children.is_empty());
    }

    #[test]
    fn folders_appear_before_files_alphabetically() {
        let (_dir, tree) = make_tree(|p| {
            fs::write(p.join("aardvark.md"), "").unwrap();
            fs::create_dir(p.join("beasts")).unwrap();
            fs::write(p.join("zebra.md"), "").unwrap();
        });
        assert_eq!(tree.children.len(), 3);
        assert!(tree.children[0].is_dir, "first child should be the folder");
        assert_eq!(tree.children[0].name, "beasts");
        assert_eq!(tree.children[1].name, "aardvark");
        assert_eq!(tree.children[2].name, "zebra");
    }

    #[test]
    fn note_id_is_populated_from_map() {
        let note_map: HashMap<String, i32> =
            [("dragon.md".to_string(), 42)].into_iter().collect();
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("dragon.md"), "# Dragon").unwrap();
        let tree = build_file_tree(dir.path(), "", &note_map, &HashMap::new());
        assert_eq!(tree.children[0].note_id, Some(42));
    }

    #[test]
    fn nested_folders_build_correct_relative_paths() {
        let (_dir, tree) = make_tree(|p| {
            fs::create_dir(p.join("creatures")).unwrap();
            fs::write(p.join("creatures").join("dragon.md"), "").unwrap();
        });
        let folder = &tree.children[0];
        assert_eq!(folder.path, "creatures");
        let note = &folder.children[0];
        assert_eq!(note.path, "creatures/dragon.md");
    }

    #[test]
    fn map_image_appears_with_map_id_and_title() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("world.jpg"), "").unwrap();
        let note_map: HashMap<String, i32> = HashMap::new();
        let map_map: HashMap<String, (i32, String)> =
            [("world.jpg".to_string(), (7, "The Known World".to_string()))]
                .into_iter()
                .collect();
        let tree = build_file_tree(dir.path(), "", &note_map, &map_map);
        assert_eq!(tree.children.len(), 1);
        let node = &tree.children[0];
        assert_eq!(node.map_id, Some(7));
        assert_eq!(node.name, "The Known World");
        assert!(!node.is_dir);
    }

    #[test]
    fn non_map_image_is_hidden() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("photo.png"), "").unwrap();
        let tree = build_file_tree(dir.path(), "", &HashMap::new(), &HashMap::new());
        assert!(tree.children.is_empty());
    }

    // ── test helpers ─────────────────────────────────────────────────────

    use diesel::Connection;
    use diesel::connection::SimpleConnection;
    // SqliteConnection is already in scope via `use super::*`

    fn test_conn() -> SqliteConnection {
        let mut conn = SqliteConnection::establish(":memory:")
            .expect("failed to open in-memory db");
        conn.batch_execute(
            "PRAGMA foreign_keys = ON;
            CREATE TABLE notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                path TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL DEFAULT 'Untitled',
                icon TEXT,
                cover_image TEXT,
                parent_path TEXT,
                archived INTEGER NOT NULL DEFAULT 0,
                modified_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE maps (
                id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                title TEXT NOT NULL,
                image_path TEXT,
                image_width INTEGER,
                image_height INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                modified_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE note_links (
                source_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
                target_path TEXT NOT NULL,
                PRIMARY KEY (source_id, target_path)
            );
            CREATE TABLE note_aliases (
                note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
                alias TEXT NOT NULL,
                PRIMARY KEY (note_id, alias)
            );
            CREATE TABLE note_tags (
                note_path TEXT NOT NULL,
                tag TEXT NOT NULL,
                PRIMARY KEY (note_path, tag)
            );"
        ).expect("failed to create schema");
        conn
    }

    fn insert_note(conn: &mut SqliteConnection, note_id: i32, note_path: &str, note_parent: Option<&str>) {
        conn.batch_execute(&format!(
            "INSERT INTO notes (id, path, title, parent_path) VALUES ({}, '{}', 'Test', {});",
            note_id,
            note_path,
            note_parent
                .map(|p| format!("'{}'", p))
                .unwrap_or_else(|| "NULL".to_string())
        ))
        .unwrap();
    }

    fn insert_note_link(conn: &mut SqliteConnection, source_id: i32, target_path: &str) {
        conn.batch_execute(&format!(
            "INSERT OR IGNORE INTO note_links (source_id, target_path) VALUES ({}, '{}');",
            source_id, target_path
        ))
        .unwrap();
    }

    #[derive(diesel::QueryableByName)]
    struct CountRow {
        #[diesel(sql_type = diesel::sql_types::BigInt)]
        cnt: i64,
    }

    /// Count note_links rows whose target_path satisfies the given SQL predicate
    /// (e.g. `"target_path = 'beasts/dragon.md'"` or `"target_path LIKE 'creatures/%'"`).
    fn count_links_where(conn: &mut SqliteConnection, predicate: &str) -> i64 {
        diesel::sql_query(format!(
            "SELECT COUNT(*) as cnt FROM note_links WHERE {}",
            predicate
        ))
        .load::<CountRow>(conn)
        .unwrap()
        .into_iter()
        .next()
        .map(|r| r.cnt)
        .unwrap_or(0)
    }

    fn insert_map(conn: &mut SqliteConnection, map_image_path: &str, map_title: &str) {
        conn.batch_execute(&format!(
            "INSERT INTO maps (title, image_path, image_width, image_height) VALUES ('{}', '{}', 100, 100);",
            map_title, map_image_path
        ))
        .unwrap();
    }

    // ── create_folder tests ───────────────────────────────────────────────

    #[test]
    fn create_folder_creates_directory() {
        let dir = TempDir::new().unwrap();
        create_folder_inner(dir.path(), "creatures/dragons").unwrap();
        assert!(dir.path().join("creatures/dragons").is_dir());
    }

    #[test]
    fn create_folder_is_idempotent() {
        let dir = TempDir::new().unwrap();
        create_folder_inner(dir.path(), "creatures").unwrap();
        // create_dir_all does not error if the directory already exists
        assert!(create_folder_inner(dir.path(), "creatures").is_ok());
    }

    // ── delete_folder tests ───────────────────────────────────────────────

    #[test]
    fn delete_folder_removes_directory_and_db_rows() {
        let dir = TempDir::new().unwrap();
        let folder = dir.path().join("creatures");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("dragon.md"), "").unwrap();

        let mut conn = test_conn();
        insert_note(&mut conn, 1, "creatures/dragon.md", Some("creatures"));

        delete_folder_inner(dir.path(), "creatures", &mut conn).unwrap();

        assert!(!folder.exists());
        let remaining: Vec<Note> = notes.load::<Note>(&mut conn).unwrap();
        assert!(remaining.is_empty());
    }

    #[test]
    fn delete_folder_only_removes_notes_with_matching_prefix() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join("creatures")).unwrap();
        fs::write(dir.path().join("creatures").join("dragon.md"), "").unwrap();
        fs::write(dir.path().join("top-level.md"), "").unwrap();

        let mut conn = test_conn();
        insert_note(&mut conn, 1, "creatures/dragon.md", Some("creatures"));
        insert_note(&mut conn, 2, "top-level.md", None);

        delete_folder_inner(dir.path(), "creatures", &mut conn).unwrap();

        let remaining: Vec<Note> = notes.load::<Note>(&mut conn).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].path, "top-level.md");
    }

    #[test]
    fn delete_folder_removes_maps_with_matching_prefix() {
        let dir = TempDir::new().unwrap();
        let folder = dir.path().join("maps-folder");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("world.jpg"), "").unwrap();

        let mut conn = test_conn();
        insert_map(&mut conn, "maps-folder/world.jpg", "World Map");

        delete_folder_inner(dir.path(), "maps-folder", &mut conn).unwrap();

        assert!(!folder.exists());
        let remaining: Vec<Map> = maps::table.load::<Map>(&mut conn).unwrap();
        assert!(remaining.is_empty());
    }

    // ── rename_folder tests ───────────────────────────────────────────────

    #[test]
    fn rename_folder_moves_directory_on_disk() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join("creatures")).unwrap();
        let mut conn = test_conn();

        rename_folder_inner(dir.path(), "creatures", "beasts", &mut conn, None).unwrap();

        assert!(!dir.path().join("creatures").exists());
        assert!(dir.path().join("beasts").is_dir());
    }

    #[test]
    fn rename_folder_updates_note_paths_in_db() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join("creatures")).unwrap();
        fs::write(dir.path().join("creatures").join("dragon.md"), "").unwrap();

        let mut conn = test_conn();
        insert_note(&mut conn, 1, "creatures/dragon.md", Some("creatures"));

        rename_folder_inner(dir.path(), "creatures", "beasts", &mut conn, None).unwrap();

        let updated: Vec<Note> = notes.load::<Note>(&mut conn).unwrap();
        assert_eq!(updated[0].path, "beasts/dragon.md");
    }

    #[test]
    fn rename_folder_updates_direct_parent_path() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join("creatures")).unwrap();
        fs::write(dir.path().join("creatures").join("dragon.md"), "").unwrap();

        let mut conn = test_conn();
        insert_note(&mut conn, 1, "creatures/dragon.md", Some("creatures"));

        rename_folder_inner(dir.path(), "creatures", "beasts", &mut conn, None).unwrap();

        let updated: Vec<Note> = notes.load::<Note>(&mut conn).unwrap();
        assert_eq!(updated[0].parent_path.as_deref(), Some("beasts"));
    }

    #[test]
    fn rename_folder_updates_nested_parent_paths() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join("creatures/dragons")).unwrap();
        fs::write(dir.path().join("creatures/dragons").join("wyvern.md"), "").unwrap();

        let mut conn = test_conn();
        insert_note(&mut conn, 1, "creatures/dragons/wyvern.md", Some("creatures/dragons"));

        rename_folder_inner(dir.path(), "creatures", "beasts", &mut conn, None).unwrap();

        let updated: Vec<Note> = notes.load::<Note>(&mut conn).unwrap();
        assert_eq!(updated[0].path, "beasts/dragons/wyvern.md");
        assert_eq!(updated[0].parent_path.as_deref(), Some("beasts/dragons"));
    }

    #[test]
    fn rename_folder_does_not_touch_unrelated_notes() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join("creatures")).unwrap();
        fs::write(dir.path().join("top-level.md"), "").unwrap();

        let mut conn = test_conn();
        insert_note(&mut conn, 1, "top-level.md", None);

        rename_folder_inner(dir.path(), "creatures", "beasts", &mut conn, None).unwrap();

        let updated: Vec<Note> = notes.load::<Note>(&mut conn).unwrap();
        assert_eq!(updated[0].path, "top-level.md");
        assert!(updated[0].parent_path.is_none());
    }

    #[test]
    fn rename_folder_updates_map_image_paths_in_db() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join("regions")).unwrap();
        fs::write(dir.path().join("regions").join("northlands.jpg"), "").unwrap();

        let mut conn = test_conn();
        insert_map(&mut conn, "regions/northlands.jpg", "Northlands");

        rename_folder_inner(dir.path(), "regions", "territories", &mut conn, None).unwrap();

        let updated: Vec<Map> = maps::table.load::<Map>(&mut conn).unwrap();
        assert_eq!(updated[0].image_path.as_deref(), Some("territories/northlands.jpg"));
    }

    // ── rename_folder link rewrite tests ─────────────────────────────────────

    #[test]
    fn rename_folder_rewrites_full_path_wikilinks() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join("creatures")).unwrap();
        fs::write(dir.path().join("creatures").join("dragon.md"), "").unwrap();
        // source note outside the folder has a full-path link into it
        fs::write(dir.path().join("index.md"), "See [[creatures/dragon.md]].").unwrap();

        let mut conn = test_conn();
        insert_note(&mut conn, 1, "creatures/dragon.md", Some("creatures"));
        insert_note(&mut conn, 2, "index.md", None);
        insert_note_link(&mut conn, 2, "creatures/dragon.md");

        let count = rename_folder_inner(dir.path(), "creatures", "beasts", &mut conn, None).unwrap();

        assert_eq!(count, 1, "one note should be rewritten");
        let updated = fs::read_to_string(dir.path().join("index.md")).unwrap();
        assert_eq!(updated, "See [[beasts/dragon.md]].");

        // note_links row must point to the new path, not the old one
        let new_count = count_links_where(&mut conn, "target_path = 'beasts/dragon.md'");
        assert_eq!(new_count, 1, "link row must point to new path");

        let old_count = count_links_where(&mut conn, "target_path = 'creatures/dragon.md'");
        assert_eq!(old_count, 0, "stale link row must not remain");
    }

    #[test]
    fn rename_folder_rewrites_no_ext_wikilinks() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join("creatures")).unwrap();
        fs::write(dir.path().join("creatures").join("dragon.md"), "").unwrap();
        fs::write(dir.path().join("index.md"), "See [[creatures/dragon]].").unwrap();

        let mut conn = test_conn();
        insert_note(&mut conn, 1, "creatures/dragon.md", Some("creatures"));
        insert_note(&mut conn, 2, "index.md", None);
        insert_note_link(&mut conn, 2, "creatures/dragon");

        rename_folder_inner(dir.path(), "creatures", "beasts", &mut conn, None).unwrap();

        let updated = fs::read_to_string(dir.path().join("index.md")).unwrap();
        assert_eq!(updated, "See [[beasts/dragon]].");
    }

    #[test]
    fn rename_folder_leaves_bare_stem_links_alone() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join("creatures")).unwrap();
        fs::write(dir.path().join("creatures").join("dragon.md"), "").unwrap();
        // bare-stem link: must not be touched
        fs::write(dir.path().join("index.md"), "See [[dragon]].").unwrap();

        let mut conn = test_conn();
        insert_note(&mut conn, 1, "creatures/dragon.md", Some("creatures"));
        insert_note(&mut conn, 2, "index.md", None);
        insert_note_link(&mut conn, 2, "dragon");

        let count = rename_folder_inner(dir.path(), "creatures", "beasts", &mut conn, None).unwrap();

        assert_eq!(count, 0, "bare-stem link must not be rewritten");
        let content = fs::read_to_string(dir.path().join("index.md")).unwrap();
        assert_eq!(content, "See [[dragon]].");
    }

    #[test]
    fn rename_folder_rewrites_links_to_nested_descendants() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join("creatures/dragons")).unwrap();
        fs::write(dir.path().join("creatures/dragons").join("wyvern.md"), "").unwrap();
        fs::write(
            dir.path().join("index.md"),
            "See [[creatures/dragons/wyvern.md]] and [[creatures/dragons/wyvern]].",
        )
        .unwrap();

        let mut conn = test_conn();
        insert_note(&mut conn, 1, "creatures/dragons/wyvern.md", Some("creatures/dragons"));
        insert_note(&mut conn, 2, "index.md", None);
        insert_note_link(&mut conn, 2, "creatures/dragons/wyvern.md");
        insert_note_link(&mut conn, 2, "creatures/dragons/wyvern");

        rename_folder_inner(dir.path(), "creatures", "beasts", &mut conn, None).unwrap();

        let updated = fs::read_to_string(dir.path().join("index.md")).unwrap();
        assert_eq!(
            updated,
            "See [[beasts/dragons/wyvern.md]] and [[beasts/dragons/wyvern]]."
        );
    }

    #[test]
    fn rename_folder_no_stale_note_links_rows_remain() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join("creatures")).unwrap();
        fs::write(dir.path().join("creatures").join("dragon.md"), "").unwrap();
        fs::write(dir.path().join("creatures").join("wyvern.md"), "").unwrap();
        fs::write(
            dir.path().join("index.md"),
            "[[creatures/dragon.md]] and [[creatures/wyvern.md]]",
        )
        .unwrap();

        let mut conn = test_conn();
        insert_note(&mut conn, 1, "creatures/dragon.md", Some("creatures"));
        insert_note(&mut conn, 2, "creatures/wyvern.md", Some("creatures"));
        insert_note(&mut conn, 3, "index.md", None);
        insert_note_link(&mut conn, 3, "creatures/dragon.md");
        insert_note_link(&mut conn, 3, "creatures/wyvern.md");

        rename_folder_inner(dir.path(), "creatures", "beasts", &mut conn, None).unwrap();

        // All old-path link rows must be gone
        let stale_count = count_links_where(&mut conn, "target_path LIKE 'creatures/%'");
        assert_eq!(stale_count, 0, "no stale rows pointing to old folder path");
    }
}
