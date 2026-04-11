use crate::db::models::{Map, Note};
use crate::db::schema::maps;
use crate::db::schema::notes::dsl::*; // used in get_file_tree (Task 2) + delete_folder (Task 3)
use crate::vault::AppVault;
use diesel::prelude::*;
use diesel::sql_query;                // used in rename_folder (Task 4)
use diesel::sql_types::Text;          // used in rename_folder (Task 4)
use diesel::SqliteConnection;         // used in delete_folder_inner + rename_folder_inner (Tasks 3–4)
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use tauri::State;                     // used in Tauri command wrappers (Tasks 2–4)

#[derive(Serialize, Debug)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub note_id: Option<i32>,
    pub map_id: Option<i32>,
    pub children: Vec<FileNode>,
}

/// Pure recursive tree builder — no Tauri State, fully unit-testable.
/// When called with `relative_path = ""` (the vault root), the returned root node has
/// `path = ""` — it is a container, not a vault-addressable path. Callers should
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

            // Skip hidden entries
            if entry_name.starts_with('.') {
                continue;
            }

            // Skip vault meta folders at the root level only
            if relative_path.is_empty()
                && (entry_name == "audio" || entry_name == "images")
            {
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
pub fn get_file_tree(vault: State<AppVault>) -> Result<FileNode, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let vault_path = state.path.clone().ok_or("No vault open")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;

    // Build note map — acquire mutex once; do not call get_notes as a sub-command
    // (double-locking AppVault's Mutex would deadlock).
    let note_list = notes.load::<Note>(conn).map_err(|e| e.to_string())?;
    let note_map: HashMap<String, i32> = note_list
        .into_iter()
        .map(|n| (n.path, n.id))
        .collect();

    let map_list = maps::table.load::<Map>(conn).map_err(|e| e.to_string())?;
    let map_map: HashMap<String, (i32, String)> = map_list
        .into_iter()
        .map(|m| (m.image_path, (m.id, m.title)))
        .collect();

    Ok(build_file_tree(&vault_path, "", &note_map, &map_map))
}

// ── create_folder ──────────────────────────────────────────────────────────

pub fn create_folder_inner(vault_path: &Path, folder_path: &str) -> Result<(), String> {
    fs::create_dir_all(vault_path.join(folder_path))
        .map_err(|e| format!("create_dir_all: {}", e))
}

#[tauri::command]
pub fn create_folder(folder_path: String, vault: State<AppVault>) -> Result<(), String> {
    let state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let vault_path = state.path.as_ref().ok_or("No vault open")?.clone();
    drop(state); // release lock before filesystem op
    create_folder_inner(&vault_path, &folder_path)
}

// ── delete_folder ──────────────────────────────────────────────────────────

pub fn delete_folder_inner(
    vault_path: &Path,
    folder_path: &str,
    conn: &mut SqliteConnection,
) -> Result<(), String> {
    // Delete files first — if this succeeds and the DB step fails, the user
    // sees stale tree entries (recoverable). Reverse order (ghost notes in DB
    // after files are gone) is worse.
    fs::remove_dir_all(vault_path.join(folder_path))
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
pub fn delete_folder(folder_path: String, vault: State<AppVault>) -> Result<(), String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let vault_path = state.path.clone().ok_or("No vault open")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    delete_folder_inner(&vault_path, &folder_path, conn)
}

// ── rename_folder ──────────────────────────────────────────────────────────

pub fn rename_folder_inner(
    vault_path: &Path,
    old_path: &str,
    new_path: &str,
    conn: &mut SqliteConnection,
) -> Result<(), String> {
    // 1. Rename directory on disk. Individual .md files move atomically with
    //    the folder — no per-file renames are needed.
    fs::rename(vault_path.join(old_path), vault_path.join(new_path))
        .map_err(|e| format!("rename dir: {}", e))?;

    let old_prefix = format!("{}/", old_path);
    let new_prefix = format!("{}/", new_path);
    let like_pattern = format!("{}%", old_prefix);

    // 2. Update `path` for all descendant notes.
    sql_query("UPDATE notes SET path = REPLACE(path, ?, ?) WHERE path LIKE ?")
        .bind::<Text, _>(&old_prefix)
        .bind::<Text, _>(&new_prefix)
        .bind::<Text, _>(&like_pattern)
        .execute(conn)
        .map_err(|e| format!("update paths: {}", e))?;

    // 3a. Update `parent_path` — exact match (direct children: parent_path = old_path).
    //     These rows' parent_path is "creatures" (no slash), not matched by LIKE "creatures/%",
    //     so must be handled separately.
    sql_query("UPDATE notes SET parent_path = ? WHERE parent_path = ?")
        .bind::<Text, _>(new_path)
        .bind::<Text, _>(old_path)
        .execute(conn)
        .map_err(|e| format!("update parent exact: {}", e))?;

    // 3b. Update `parent_path` — prefix match (deeper nesting: parent_path LIKE old_path/%).
    sql_query(
        "UPDATE notes SET parent_path = REPLACE(parent_path, ?, ?) WHERE parent_path LIKE ?",
    )
    .bind::<Text, _>(&old_prefix)
    .bind::<Text, _>(&new_prefix)
    .bind::<Text, _>(&like_pattern)
    .execute(conn)
    .map_err(|e| format!("update parent prefix: {}", e))?;

    // Update image_path for maps inside the renamed folder
    sql_query("UPDATE maps SET image_path = REPLACE(image_path, ?, ?) WHERE image_path LIKE ?")
        .bind::<Text, _>(&old_prefix)
        .bind::<Text, _>(&new_prefix)
        .bind::<Text, _>(&like_pattern)
        .execute(conn)
        .map_err(|e| format!("update map paths: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn rename_folder(
    old_path: String,
    new_path: String,
    vault: State<AppVault>,
) -> Result<(), String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let vault_path = state.path.clone().ok_or("No vault open")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    rename_folder_inner(&vault_path, &old_path, &new_path, conn)
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
    fn empty_vault_has_no_children() {
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
            fs::write(p.join("vault.db"), "").unwrap();
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
            "CREATE TABLE notes (
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
                image_path TEXT NOT NULL,
                image_width INTEGER NOT NULL DEFAULT 0,
                image_height INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                modified_at TEXT NOT NULL DEFAULT (datetime('now'))
            );"
        ).expect("failed to create schema");
        conn
    }

    fn insert_note(conn: &mut SqliteConnection, note_path: &str, note_parent: Option<&str>) {
        conn.batch_execute(&format!(
            "INSERT INTO notes (path, title, parent_path) VALUES ('{}', 'Test', {});",
            note_path,
            note_parent
                .map(|p| format!("'{}'", p))
                .unwrap_or_else(|| "NULL".to_string())
        ))
        .unwrap();
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
        insert_note(&mut conn, "creatures/dragon.md", Some("creatures"));

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
        insert_note(&mut conn, "creatures/dragon.md", Some("creatures"));
        insert_note(&mut conn, "top-level.md", None);

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

        rename_folder_inner(dir.path(), "creatures", "beasts", &mut conn).unwrap();

        assert!(!dir.path().join("creatures").exists());
        assert!(dir.path().join("beasts").is_dir());
    }

    #[test]
    fn rename_folder_updates_note_paths_in_db() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join("creatures")).unwrap();
        fs::write(dir.path().join("creatures").join("dragon.md"), "").unwrap();

        let mut conn = test_conn();
        insert_note(&mut conn, "creatures/dragon.md", Some("creatures"));

        rename_folder_inner(dir.path(), "creatures", "beasts", &mut conn).unwrap();

        let updated: Vec<Note> = notes.load::<Note>(&mut conn).unwrap();
        assert_eq!(updated[0].path, "beasts/dragon.md");
    }

    #[test]
    fn rename_folder_updates_direct_parent_path() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join("creatures")).unwrap();
        fs::write(dir.path().join("creatures").join("dragon.md"), "").unwrap();

        let mut conn = test_conn();
        insert_note(&mut conn, "creatures/dragon.md", Some("creatures"));

        rename_folder_inner(dir.path(), "creatures", "beasts", &mut conn).unwrap();

        let updated: Vec<Note> = notes.load::<Note>(&mut conn).unwrap();
        assert_eq!(updated[0].parent_path.as_deref(), Some("beasts"));
    }

    #[test]
    fn rename_folder_updates_nested_parent_paths() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join("creatures/dragons")).unwrap();
        fs::write(dir.path().join("creatures/dragons").join("wyvern.md"), "").unwrap();

        let mut conn = test_conn();
        insert_note(&mut conn, "creatures/dragons/wyvern.md", Some("creatures/dragons"));

        rename_folder_inner(dir.path(), "creatures", "beasts", &mut conn).unwrap();

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
        insert_note(&mut conn, "top-level.md", None);

        rename_folder_inner(dir.path(), "creatures", "beasts", &mut conn).unwrap();

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

        rename_folder_inner(dir.path(), "regions", "territories", &mut conn).unwrap();

        let updated: Vec<Map> = maps::table.load::<Map>(&mut conn).unwrap();
        assert_eq!(updated[0].image_path, "territories/northlands.jpg");
    }
}
