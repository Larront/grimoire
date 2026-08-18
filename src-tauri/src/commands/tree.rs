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
            } else if entry_name.to_lowercase().ends_with(".pdf") {
                // PDFs are path-addressed, not entities (ADR-0011): a plain
                // FileNode with no id. The frontend detects the `.pdf` extension
                // from `path` and renders the BookOpen glyph + opens a "pdf" tab.
                let stem = &entry_name[..entry_name.len() - ".pdf".len()];
                files.push(FileNode {
                    name: stem.to_string(),
                    path: child_rel,
                    is_dir: false,
                    note_id: None,
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
    index: Option<&tantivy::Index>,
) -> Result<(), String> {
    // Delete files first — if this succeeds and the DB step fails, the user
    // sees stale tree entries (recoverable). Reverse order (ghost notes in DB
    // after files are gone) is worse.
    fs::remove_dir_all(ledger_path.join(folder_path))
        .map_err(|e| format!("remove_dir_all: {}", e))?;

    let prefix = format!("{}/", folder_path);
    let like_pattern = format!("{}%", prefix);

    // `LIKE` is the coarse filter, never the answer: SQLite matches it
    // case-insensitively over ASCII and reads `_` as "any one character", so
    // deleting `session_notes` also selects a sibling `session-notes` whose files
    // are still on disk. Rows are chosen by an exact prefix here and then deleted
    // by id, so what is destroyed is only ever what was inspected.
    let doomed_notes: Vec<Note> = notes
        .filter(path.like(&like_pattern))
        .load::<Note>(conn)
        .map_err(|e| format!("query folder notes: {}", e))?
        .into_iter()
        .filter(|n| n.path.starts_with(&prefix))
        .collect();

    let doomed_maps: Vec<Map> = maps::table
        .filter(maps::image_path.like(&like_pattern))
        .load::<Map>(conn)
        .map_err(|e| format!("query folder maps: {}", e))?
        .into_iter()
        .filter(|m| {
            m.image_path
                .as_deref()
                .is_some_and(|p| p.starts_with(&prefix))
        })
        .collect();

    // Dropping the rows does not take the Derived Index with them. Two of the four
    // follow by cascade; `note_tags` is keyed by path with no foreign key, and the
    // Search Index is not SQLite at all, so both survive their notes and keep
    // answering `search_all` until the ledger is reopened. The Ledger Watcher cannot
    // heal it either — it looks the row up, finds it already gone, and reports
    // `Notify::Nothing`. Maps carry a Search Index document of their own, on the
    // same terms.
    //
    // These clears must run while the rows still exist, so they are provably not
    // leaning on the cascade.
    let note_keys: Vec<(i32, String)> = doomed_notes
        .iter()
        .map(|n| (n.id, n.path.clone()))
        .collect();
    let reconcile = crate::note_index::remove_many(conn, index, &note_keys);

    let map_ids: Vec<i32> = doomed_maps.iter().map(|m| m.id).collect();
    // An empty folder holds no maps, so it must not report a miss it did not have.
    if !map_ids.is_empty() {
        let what = format!("removal of {} map(s)", map_ids.len());
        crate::search::best_effort(index, &what, |idx| {
            crate::search::remove_maps_batch(idx, &map_ids)
        });
    }

    // The rows go regardless of how the reconcile fared. Returning early here would
    // leave the ledger in the state the ordering at the top of this function exists
    // to avoid: the files gone from disk and every row still standing.
    diesel::delete(notes.filter(id.eq_any(doomed_notes.iter().map(|n| n.id))))
        .execute(conn)
        .map_err(|e| format!("db delete: {}", e))?;

    diesel::delete(maps::table.filter(maps::id.eq_any(&map_ids)))
        .execute(conn)
        .map_err(|e| format!("db delete maps: {}", e))?;

    // Only now is the reconcile's own failure — a SQLite error clearing the derived
    // rows, never a Search Index miss, which `best_effort` has already swallowed and
    // logged — allowed to end the command. Held until here for the reason above.
    reconcile?;

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn delete_folder(folder_path: String, ledger: State<AppLedger>) -> Result<(), String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let ledger_path = state.path.clone().ok_or("No ledger open")?;
    let state_ref = &mut *state;
    let conn = state_ref.connection.as_mut().ok_or("No ledger open")?;
    let index = state_ref.search_index.as_ref();
    delete_folder_inner(&ledger_path, &folder_path, conn, index)
}

// ── rename_folder / move_folder ─────────────────────────────────────────────

/// The parent folder holding `folder_path`, and the folder's own name. The parent
/// is `""` for a folder sitting at the ledger root.
fn split_folder_path(folder_path: &str) -> (&str, &str) {
    match folder_path.rsplit_once('/') {
        Some((parent, name)) => (parent, name),
        None => ("", folder_path),
    }
}

/// Compose a ledger-relative path for `name` inside `parent` — the one place the
/// root's empty parent is special-cased, so no caller grows a leading slash.
fn join_in_folder(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{}/{}", parent, name)
    }
}

/// Where a folder rename lands: `old_path`'s own parent, with `new_name` as the
/// leaf. Same contract as `rename_pdf_inner` (`media.rs`) — the caller sends the
/// bare name the tree shows, and the parent is derived here rather than composed
/// by the frontend, so no call site can turn a rename into a move (#162).
///
/// The refusals are what keep it a rename: a name carrying a separator (or `.` /
/// `..`) could redirect it anywhere in the ledger, and a name a sibling already
/// holds would replace that sibling — which `fs::rename` will do silently on
/// Windows when the sibling folder is empty. A case-only rename is *not* a
/// collision: on a case-insensitive filesystem the destination resolves to the
/// source folder itself.
fn resolve_renamed_folder_path(
    ledger_path: &Path,
    old_path: &str,
    new_name: &str,
) -> Result<String, String> {
    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err("ERR_EMPTY_NAME: A folder needs a name".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("ERR_BAD_NAME: A folder name cannot contain a path separator".to_string());
    }
    if trimmed == "." || trimmed == ".." {
        return Err(format!("ERR_BAD_NAME: '{}' is not a folder name", trimmed));
    }

    let (parent, _) = split_folder_path(old_path);
    let new_path = join_in_folder(parent, trimmed);
    refuse_taken_folder_path(ledger_path, old_path, &new_path)?;
    Ok(new_path)
}

/// Refuse a destination another entry already holds. A case-only rename is *not*
/// a collision: on a case-insensitive filesystem the destination resolves to the
/// source folder itself.
fn refuse_taken_folder_path(
    ledger_path: &Path,
    old_path: &str,
    new_path: &str,
) -> Result<(), String> {
    let src = ledger_path.join(old_path);
    let dest = ledger_path.join(new_path);
    if dest.exists() {
        let same_folder = match (src.canonicalize(), dest.canonicalize()) {
            (Ok(s), Ok(d)) => s == d,
            _ => false,
        };
        if !same_folder {
            let (_, name) = split_folder_path(new_path);
            return Err(format!(
                "ERR_NAME_TAKEN: A folder named {} already exists here",
                name
            ));
        }
    }
    Ok(())
}

/// Where a folder move lands: `dest_folder` (`""` = the ledger root), keeping the
/// folder's own name. The mirror of [`resolve_renamed_folder_path`] — a rename
/// changes the leaf and keeps the parent, a move changes the parent and keeps the
/// leaf — so between them the GM can reach any path without either verb being
/// able to do the other's job by accident.
///
/// The refusals here are the ones a move can hit and a rename cannot: a folder
/// cannot be dropped into itself or into its own descendant (the filesystem would
/// be asked to swallow a directory whole), and a drop onto the parent it already
/// sits in is not an error but nothing at all — [`relocate_folder_inner`] returns
/// early for it.
fn resolve_moved_folder_path(
    ledger_path: &Path,
    old_path: &str,
    dest_folder: &str,
) -> Result<String, String> {
    if dest_folder == old_path {
        return Err("ERR_MOVE_INTO_SELF: A folder cannot be moved into itself".to_string());
    }
    if dest_folder.starts_with(&format!("{}/", old_path)) {
        return Err(
            "ERR_MOVE_INTO_SELF: A folder cannot be moved into a folder it contains".to_string(),
        );
    }
    let (_, name) = split_folder_path(old_path);
    let new_path = join_in_folder(dest_folder, name);
    refuse_taken_folder_path(ledger_path, old_path, &new_path)?;
    Ok(new_path)
}

/// Rename a folder, keeping it where it is. `old_path` is ledger-relative;
/// `new_name` is the bare folder name (see [`resolve_renamed_folder_path`]).
/// Returns the number of notes whose links were rewritten.
pub fn rename_folder_inner(
    ledger_path: &Path,
    old_path: &str,
    new_name: &str,
    conn: &mut SqliteConnection,
    index: Option<&tantivy::Index>,
) -> Result<usize, String> {
    let new_path = resolve_renamed_folder_path(ledger_path, old_path, new_name)?;
    relocate_folder_inner(ledger_path, old_path, &new_path, conn, index)
}

/// Move a folder into `dest_folder` (`""` = the ledger root), keeping its name —
/// the folder half of a [[Tree Move]]. Returns the number of notes whose links
/// were rewritten.
pub fn move_folder_inner(
    ledger_path: &Path,
    old_path: &str,
    dest_folder: &str,
    conn: &mut SqliteConnection,
    index: Option<&tantivy::Index>,
) -> Result<usize, String> {
    let new_path = resolve_moved_folder_path(ledger_path, old_path, dest_folder)?;
    relocate_folder_inner(ledger_path, old_path, &new_path, conn, index)
}

/// Re-key `table.column` from `old_prefix` onto `new_prefix`, for the rows whose
/// value actually starts with `old_prefix`. `table` and `column` are interpolated
/// into the statement and so must stay literals — the one call site in
/// [`relocate_folder_inner`] is the only one, and it takes no GM input.
///
/// The rewrite is anchored to the *leading* prefix, the same form and for the same
/// reason as [`crate::commands::pdf_scene_links::rewrite_pdf_path_prefix`]: a blanket
/// `REPLACE` rewrites every occurrence, so a folder whose name repeats inside its own
/// subtree (`a/a/world.jpg`) has its interior segment rewritten too and the row lands
/// at `b/b/world.jpg`, where the file is at `b/a/world.jpg`.
///
/// The `SUBSTR(col, 1, ?) = ?` guard is what makes that anchoring safe. `LIKE` is
/// case-insensitive over ASCII and reads `_` as a single-character wildcard, so
/// `LIKE 'session_notes/%'` also matches a sibling folder `session-notes` — and
/// cutting a fixed number of characters off a path that never carried the prefix
/// corrupts it. The blanket `REPLACE` this form replaced was self-limiting (no
/// literal match, no change); a positional rewrite has to say so itself.
fn rekey_leading_prefix(
    conn: &mut SqliteConnection,
    table: &str,
    column: &str,
    old_prefix: &str,
    new_prefix: &str,
) -> QueryResult<usize> {
    let like_pattern = format!("{}%", old_prefix);
    // SQLite SUBSTR is 1-based and counts characters; +1 starts just past the
    // matched prefix, so `chars().count()` is the length that lines up with it.
    let prefix_len = old_prefix.chars().count() as i32;
    sql_query(format!(
        "UPDATE {table} SET {column} = ? || SUBSTR({column}, ?) \
         WHERE {column} LIKE ? AND SUBSTR({column}, 1, ?) = ?"
    ))
    .bind::<Text, _>(new_prefix)
    .bind::<diesel::sql_types::Integer, _>(prefix_len + 1)
    .bind::<Text, _>(&like_pattern)
    .bind::<diesel::sql_types::Integer, _>(prefix_len)
    .bind::<Text, _>(old_prefix)
    .execute(conn)
}

/// Carry a folder from `old_path` to `new_path` along with everything keyed by a
/// path underneath it. Returns the number of notes whose links were rewritten,
/// for the "N notes updated" toast.
///
/// The notes are [`crate::note_mutation::relocate_folder`]'s: their rows, their
/// files, the wikilinks pointing into them, and the directory move itself, in the
/// order the Write-and-Reconcile Envelope states once for every set-shaped
/// write. What is left here is the two path-keyed things that are not notes and
/// so have no envelope to join — map images and PDF Scene-links, both of which
/// travelled with the directory and would otherwise be orphaned.
///
/// A rename and a move both land here — they differ only in which half of the
/// destination path their caller changed — so the re-keying story is written
/// once. Callers resolve *and refuse* their destination first.
pub fn relocate_folder_inner(
    ledger_path: &Path,
    old_path: &str,
    new_path: &str,
    conn: &mut SqliteConnection,
    index: Option<&tantivy::Index>,
) -> Result<usize, String> {
    let updated_count =
        crate::note_mutation::relocate_folder(conn, index, ledger_path, old_path, new_path)?;

    let old_prefix = format!("{}/", old_path);
    let new_prefix = format!("{}/", new_path);

    rekey_leading_prefix(conn, "maps", "image_path", &old_prefix, &new_prefix)
        .map_err(|e| format!("update map paths: {}", e))?;

    // PDFs are path-addressed (ADR-0011), so the atomic dir rename above has
    // already relocated them on disk; their Scene-links must follow.
    crate::commands::pdf_scene_links::rewrite_pdf_path_prefix(conn, &old_prefix, &new_prefix)
        .map_err(|e| format!("update pdf scene-link paths: {}", e))?;

    Ok(updated_count)
}

#[tauri::command]
#[specta::specta]
pub fn rename_folder(
    old_path: String,
    new_name: String,
    ledger: State<AppLedger>,
) -> Result<i32, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let ledger_path = state.path.clone().ok_or("No ledger open")?;
    let state_ref = &mut *state;
    let conn = state_ref.connection.as_mut().ok_or("No ledger open")?;
    let index = state_ref.search_index.as_ref();
    // Cast the internal usize count to i32 at the command seam: specta forbids
    // BigInt-style types in exported bindings, and link counts are always small.
    rename_folder_inner(&ledger_path, &old_path, &new_name, conn, index).map(|n| n as i32)
}

#[tauri::command]
#[specta::specta]
pub fn move_folder(
    old_path: String,
    dest_folder: String,
    ledger: State<AppLedger>,
) -> Result<i32, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let ledger_path = state.path.clone().ok_or("No ledger open")?;
    let state_ref = &mut *state;
    let conn = state_ref.connection.as_mut().ok_or("No ledger open")?;
    let index = state_ref.search_index.as_ref();
    move_folder_inner(&ledger_path, &old_path, &dest_folder, conn, index).map(|n| n as i32)
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

    #[test]
    fn pdf_files_appear_as_nodes_with_stem_name_and_no_ids() {
        let (_dir, tree) = make_tree(|p| {
            fs::write(p.join("Players Handbook.pdf"), "%PDF-1.4").unwrap();
        });
        assert_eq!(tree.children.len(), 1);
        let node = &tree.children[0];
        assert_eq!(node.name, "Players Handbook");
        assert_eq!(node.path, "Players Handbook.pdf");
        assert!(!node.is_dir);
        assert_eq!(node.note_id, None);
        assert_eq!(node.map_id, None);
    }

    #[test]
    fn pdf_extension_match_is_case_insensitive() {
        let (_dir, tree) = make_tree(|p| {
            fs::write(p.join("Manual.PDF"), "%PDF-1.4").unwrap();
        });
        assert_eq!(tree.children.len(), 1);
        assert_eq!(tree.children[0].path, "Manual.PDF");
        assert_eq!(tree.children[0].name, "Manual");
    }

    #[test]
    fn nested_pdf_builds_correct_relative_path() {
        let (_dir, tree) = make_tree(|p| {
            fs::create_dir(p.join("rulebooks")).unwrap();
            fs::write(p.join("rulebooks").join("DMG.pdf"), "%PDF-1.4").unwrap();
        });
        let folder = &tree.children[0];
        assert_eq!(folder.path, "rulebooks");
        assert_eq!(folder.children[0].path, "rulebooks/DMG.pdf");
    }

    #[test]
    fn non_allowlisted_files_are_hidden() {
        let (_dir, tree) = make_tree(|p| {
            fs::write(p.join("notes.txt"), "").unwrap();
            fs::write(p.join("manual.docx"), "").unwrap();
            fs::write(p.join("archive.zip"), "").unwrap();
        });
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
            );
            CREATE TABLE scenes (
                id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                name TEXT NOT NULL
            );
            CREATE TABLE pdf_scene_links (
                id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                pdf_path TEXT NOT NULL,
                page INTEGER NOT NULL,
                start_offset INTEGER NOT NULL,
                end_offset INTEGER NOT NULL,
                quote TEXT NOT NULL,
                scene_id INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
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

    fn insert_note_tag(conn: &mut SqliteConnection, note_path: &str, tag: &str) {
        conn.batch_execute(&format!(
            "INSERT OR IGNORE INTO note_tags (note_path, tag) VALUES ('{}', '{}');",
            note_path, tag
        ))
        .unwrap();
    }

    /// Every path still carrying a tag row, sorted — `note_tags` has no foreign
    /// key, so this is what survives a `notes` delete unless something clears it.
    fn note_tag_paths(conn: &mut SqliteConnection) -> Vec<String> {
        #[derive(diesel::QueryableByName)]
        struct PathRow {
            #[diesel(sql_type = diesel::sql_types::Text)]
            note_path: String,
        }
        diesel::sql_query("SELECT note_path FROM note_tags ORDER BY note_path")
            .load::<PathRow>(conn)
            .unwrap()
            .into_iter()
            .map(|r| r.note_path)
            .collect()
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

    fn insert_pdf_scene_link(conn: &mut SqliteConnection, pdf_path: &str) {
        conn.batch_execute(
            "INSERT OR IGNORE INTO scenes (id, name) VALUES (1, 'Tavern');",
        )
        .unwrap();
        conn.batch_execute(&format!(
            "INSERT INTO pdf_scene_links (pdf_path, page, start_offset, end_offset, quote, scene_id) \
             VALUES ('{}', 1, 0, 5, 'Hello', 1);",
            pdf_path
        ))
        .unwrap();
    }

    fn pdf_link_paths(conn: &mut SqliteConnection) -> Vec<String> {
        #[derive(diesel::QueryableByName)]
        struct PathRow {
            #[diesel(sql_type = diesel::sql_types::Text)]
            pdf_path: String,
        }
        diesel::sql_query("SELECT pdf_path FROM pdf_scene_links ORDER BY pdf_path")
            .load::<PathRow>(conn)
            .unwrap()
            .into_iter()
            .map(|r| r.pdf_path)
            .collect()
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

        delete_folder_inner(dir.path(), "creatures", &mut conn, None).unwrap();

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

        delete_folder_inner(dir.path(), "creatures", &mut conn, None).unwrap();

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

        delete_folder_inner(dir.path(), "maps-folder", &mut conn, None).unwrap();

        assert!(!folder.exists());
        let remaining: Vec<Map> = maps::table.load::<Map>(&mut conn).unwrap();
        assert!(remaining.is_empty());
    }

    /// The `notes` row going away does not take the Derived Index with it: of the
    /// four indexes only two cascade, and `note_tags` (keyed by path, no foreign
    /// key) is one of the two that do not. Without an explicit clear the deleted
    /// folder's tags keep arriving as facets from `search_all`.
    #[test]
    fn delete_folder_clears_derived_index_rows_for_its_notes() {
        let dir = TempDir::new().unwrap();
        let folder = dir.path().join("creatures");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("dragon.md"), "---\ntags: [beast]\n---\n").unwrap();
        fs::write(dir.path().join("top-level.md"), "").unwrap();

        let mut conn = test_conn();
        insert_note(&mut conn, 1, "creatures/dragon.md", Some("creatures"));
        insert_note(&mut conn, 2, "top-level.md", None);
        insert_note_tag(&mut conn, "creatures/dragon.md", "beast");
        insert_note_tag(&mut conn, "top-level.md", "keep-me");

        delete_folder_inner(dir.path(), "creatures", &mut conn, None).unwrap();

        // The deleted folder's tags are gone; the bystander's survive.
        assert_eq!(note_tag_paths(&mut conn), vec!["top-level.md".to_string()]);
    }

    /// A map carries a Search Index document of its own, so a folder holding a map
    /// image has to reconcile the index too — the note path is not the only one.
    /// The empty schema makes that removal fail, and the point of the test is what
    /// happens next: the rows still go. A search write is best-effort and healed by
    /// the rebuild at the next open (#205), so letting it strand the delete
    /// half-done would be the far worse outcome.
    #[test]
    fn a_failed_map_index_removal_does_not_strand_the_folder_delete() {
        let dir = TempDir::new().unwrap();
        let folder = dir.path().join("maps-folder");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("world.jpg"), "").unwrap();

        let mut conn = test_conn();
        insert_map(&mut conn, "maps-folder/world.jpg", "World Map");

        let bad_index =
            tantivy::Index::create_in_ram(tantivy::schema::Schema::builder().build());
        delete_folder_inner(dir.path(), "maps-folder", &mut conn, Some(&bad_index)).unwrap();

        let remaining: i64 = maps::table.count().get_result(&mut conn).unwrap();
        assert_eq!(remaining, 0, "the map row must go even when its index write failed");
        assert!(!folder.exists(), "the folder must go even when its index write failed");
    }

    /// SQLite's `LIKE` is case-insensitive over ASCII and reads `_` as "any one
    /// character", so `path LIKE 'session_notes/%'` also matches a sibling folder
    /// called `session-notes`. Selecting rows to destroy with it alone would take
    /// the sibling's rows with them, and the sibling's files are still on disk.
    #[test]
    fn delete_folder_leaves_a_sibling_the_like_pattern_matches_alone() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join("session_notes")).unwrap();
        fs::create_dir(dir.path().join("session-notes")).unwrap();
        fs::write(dir.path().join("session_notes/a.md"), "").unwrap();
        fs::write(dir.path().join("session-notes/b.md"), "").unwrap();

        let mut conn = test_conn();
        insert_note(&mut conn, 1, "session_notes/a.md", Some("session_notes"));
        insert_note(&mut conn, 2, "session-notes/b.md", Some("session-notes"));
        insert_note_tag(&mut conn, "session-notes/b.md", "keep-me");
        insert_map(&mut conn, "session-notes/world.jpg", "World Map");

        delete_folder_inner(dir.path(), "session_notes", &mut conn, None).unwrap();

        let remaining: Vec<Note> = notes.load::<Note>(&mut conn).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].path, "session-notes/b.md");
        assert_eq!(note_tag_paths(&mut conn), vec!["session-notes/b.md".to_string()]);
        let maps_left: Vec<Map> = maps::table.load::<Map>(&mut conn).unwrap();
        assert_eq!(maps_left.len(), 1, "the sibling's map must survive");
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
    fn rename_folder_rewrites_pdf_scene_link_paths() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join("creatures/lair")).unwrap();
        fs::write(dir.path().join("creatures/dragon.pdf"), "%PDF-1.4").unwrap();
        fs::write(dir.path().join("creatures/lair/map.pdf"), "%PDF-1.4").unwrap();

        let mut conn = test_conn();
        insert_pdf_scene_link(&mut conn, "creatures/dragon.pdf");
        insert_pdf_scene_link(&mut conn, "creatures/lair/map.pdf");

        rename_folder_inner(dir.path(), "creatures", "beasts", &mut conn, None).unwrap();

        // Both PDFs moved with the folder on disk; their Scene-links follow.
        assert_eq!(
            pdf_link_paths(&mut conn),
            vec!["beasts/dragon.pdf", "beasts/lair/map.pdf"],
            "Scene-links re-key to the moved folder so they are not orphaned",
        );
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

    // ── rename_folder name contract tests ────────────────────────────────────

    #[test]
    fn rename_folder_keeps_a_subfolder_under_its_parent() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join("creatures/dragons")).unwrap();
        fs::write(dir.path().join("creatures/dragons/wyvern.md"), "").unwrap();

        let mut conn = test_conn();
        insert_note(&mut conn, 1, "creatures/dragons/wyvern.md", Some("creatures/dragons"));

        rename_folder_inner(dir.path(), "creatures/dragons", "wyrms", &mut conn, None).unwrap();

        assert!(
            dir.path().join("creatures/wyrms").is_dir(),
            "a renamed subfolder stays beside its siblings",
        );
        assert!(!dir.path().join("wyrms").exists(), "and does not land at the ledger root");
        let updated: Vec<Note> = notes.load::<Note>(&mut conn).unwrap();
        assert_eq!(updated[0].path, "creatures/wyrms/wyvern.md");
        assert_eq!(updated[0].parent_path.as_deref(), Some("creatures/wyrms"));
    }

    #[test]
    fn rename_folder_rejects_a_name_holding_a_path_separator() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join("creatures")).unwrap();
        let mut conn = test_conn();

        for name in ["regions/coast", "regions\\coast", "..", "."] {
            let err = rename_folder_inner(dir.path(), "creatures", name, &mut conn, None)
                .expect_err("a name that could redirect the rename is refused");
            assert!(err.starts_with("ERR_BAD_NAME"), "got: {err}");
        }
        assert!(dir.path().join("creatures").is_dir(), "the folder is left where it was");
    }

    #[test]
    fn rename_folder_rejects_an_empty_name() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join("creatures")).unwrap();
        let mut conn = test_conn();

        let err = rename_folder_inner(dir.path(), "creatures", "   ", &mut conn, None)
            .expect_err("a blank name is refused");
        assert!(err.starts_with("ERR_EMPTY_NAME"), "got: {err}");
        assert!(dir.path().join("creatures").is_dir());
    }

    #[test]
    fn rename_folder_allows_a_case_only_rename() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join("Creatures")).unwrap();
        let mut conn = test_conn();

        rename_folder_inner(dir.path(), "Creatures", "creatures", &mut conn, None)
            .expect("a folder may be renamed to a different casing of its own name");
    }

    #[test]
    fn rename_folder_rejects_a_name_a_sibling_already_holds_before_writing_anything() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join("creatures")).unwrap();
        fs::create_dir(dir.path().join("beasts")).unwrap();
        fs::write(dir.path().join("creatures/dragon.md"), "").unwrap();
        fs::write(dir.path().join("index.md"), "See [[creatures/dragon.md]].").unwrap();

        let mut conn = test_conn();
        insert_note(&mut conn, 1, "creatures/dragon.md", Some("creatures"));
        insert_note(&mut conn, 2, "index.md", None);
        insert_note_link(&mut conn, 2, "creatures/dragon.md");

        let err = rename_folder_inner(dir.path(), "creatures", "beasts", &mut conn, None)
            .expect_err("renaming onto a taken name is refused");
        assert!(err.starts_with("ERR_NAME_TAKEN"), "got: {err}");

        // The refusal lands before the backlink rewrite, so the links still point
        // at the folder that is still there.
        assert_eq!(
            fs::read_to_string(dir.path().join("index.md")).unwrap(),
            "See [[creatures/dragon.md]].",
            "a refused rename rewrites nothing",
        );
        assert!(dir.path().join("creatures/dragon.md").is_file());
    }

    // ── move_folder tests (#163) ─────────────────────────────────────────────

    #[test]
    fn move_folder_carries_the_folder_and_its_notes_to_the_destination() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join("dragons")).unwrap();
        fs::create_dir(dir.path().join("creatures")).unwrap();
        fs::write(dir.path().join("dragons/wyvern.md"), "").unwrap();

        let mut conn = test_conn();
        insert_note(&mut conn, 1, "dragons/wyvern.md", Some("dragons"));

        move_folder_inner(dir.path(), "dragons", "creatures", &mut conn, None).unwrap();

        assert!(dir.path().join("creatures/dragons/wyvern.md").is_file());
        assert!(!dir.path().join("dragons").exists());
        let updated: Vec<Note> = notes.load::<Note>(&mut conn).unwrap();
        assert_eq!(updated[0].path, "creatures/dragons/wyvern.md");
        assert_eq!(
            updated[0].parent_path.as_deref(),
            Some("creatures/dragons"),
            "a moved folder's notes are re-parented to where it landed",
        );
    }

    #[test]
    fn move_folder_to_the_ledger_root_takes_an_empty_destination() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join("creatures/dragons")).unwrap();
        fs::write(dir.path().join("creatures/dragons/wyvern.md"), "").unwrap();

        let mut conn = test_conn();
        insert_note(
            &mut conn,
            1,
            "creatures/dragons/wyvern.md",
            Some("creatures/dragons"),
        );

        move_folder_inner(dir.path(), "creatures/dragons", "", &mut conn, None).unwrap();

        assert!(dir.path().join("dragons/wyvern.md").is_file());
        let updated: Vec<Note> = notes.load::<Note>(&mut conn).unwrap();
        assert_eq!(updated[0].path, "dragons/wyvern.md");
        assert_eq!(updated[0].parent_path.as_deref(), Some("dragons"));
    }

    #[test]
    fn move_folder_rewrites_full_path_wikilinks_to_the_new_location() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join("dragons")).unwrap();
        fs::create_dir(dir.path().join("creatures")).unwrap();
        fs::write(dir.path().join("dragons/wyvern.md"), "").unwrap();
        fs::write(dir.path().join("index.md"), "See [[dragons/wyvern.md]].").unwrap();

        let mut conn = test_conn();
        insert_note(&mut conn, 1, "dragons/wyvern.md", Some("dragons"));
        insert_note(&mut conn, 2, "index.md", None);
        insert_note_link(&mut conn, 2, "dragons/wyvern.md");

        let count = move_folder_inner(dir.path(), "dragons", "creatures", &mut conn, None).unwrap();

        assert_eq!(count, 1, "the one note holding a full-path link is counted");
        assert_eq!(
            fs::read_to_string(dir.path().join("index.md")).unwrap(),
            "See [[creatures/dragons/wyvern.md]].",
        );
    }

    #[test]
    fn move_folder_refuses_to_swallow_itself() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join("creatures/dragons")).unwrap();
        let mut conn = test_conn();

        for dest in ["creatures", "creatures/dragons"] {
            let err = move_folder_inner(dir.path(), "creatures", dest, &mut conn, None)
                .expect_err("a folder cannot be moved into itself or its own descendant");
            assert!(err.starts_with("ERR_MOVE_INTO_SELF"), "got: {err}");
        }
        assert!(dir.path().join("creatures/dragons").is_dir(), "nothing moved");
    }

    #[test]
    fn move_folder_onto_the_parent_it_already_sits_in_does_nothing() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join("creatures/dragons")).unwrap();
        fs::write(dir.path().join("creatures/dragons/wyvern.md"), "").unwrap();

        let mut conn = test_conn();
        insert_note(
            &mut conn,
            1,
            "creatures/dragons/wyvern.md",
            Some("creatures/dragons"),
        );

        let count =
            move_folder_inner(dir.path(), "creatures/dragons", "creatures", &mut conn, None)
                .expect("a drop onto the current parent is a no-op, not a failure");

        assert_eq!(count, 0);
        assert!(dir.path().join("creatures/dragons/wyvern.md").is_file());
        let updated: Vec<Note> = notes.load::<Note>(&mut conn).unwrap();
        assert_eq!(updated[0].path, "creatures/dragons/wyvern.md");
    }

    #[test]
    fn move_folder_refuses_a_destination_holding_that_name_before_writing_anything() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join("dragons")).unwrap();
        fs::create_dir_all(dir.path().join("creatures/dragons")).unwrap();
        fs::write(dir.path().join("dragons/wyvern.md"), "").unwrap();
        fs::write(dir.path().join("index.md"), "See [[dragons/wyvern.md]].").unwrap();

        let mut conn = test_conn();
        insert_note(&mut conn, 1, "dragons/wyvern.md", Some("dragons"));
        insert_note(&mut conn, 2, "index.md", None);
        insert_note_link(&mut conn, 2, "dragons/wyvern.md");

        let err = move_folder_inner(dir.path(), "dragons", "creatures", &mut conn, None)
            .expect_err("the destination already holds a folder of that name");
        assert!(err.starts_with("ERR_NAME_TAKEN"), "got: {err}");
        assert_eq!(
            fs::read_to_string(dir.path().join("index.md")).unwrap(),
            "See [[dragons/wyvern.md]].",
            "a refused move rewrites nothing",
        );
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

    // ── prefix re-keying ──────────────────────────────────────────────────
    //
    // A folder whose name repeats inside its own subtree is where a blanket
    // REPLACE goes wrong and only the *leading* prefix is right: renaming `a` to
    // `b` makes `a/a/x.md` into `b/a/x.md`, not `b/b/x.md`. Notes are re-keyed
    // one at a time inside the envelope now, so there is only one computation
    // left to be right; the map rows below still cross the seam these tests
    // guard, where a path is computed by SQL and read back by Rust.

    #[test]
    fn rename_folder_re_keys_a_repeated_name_by_leading_prefix_only() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join("a/a")).unwrap();
        fs::write(dir.path().join("a/a/x.md"), "").unwrap();

        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a/a/x.md", Some("a/a"));

        rename_folder_inner(dir.path(), "a", "b", &mut conn, None).unwrap();

        let row: Note = notes.first::<Note>(&mut conn).unwrap();
        assert_eq!(row.path, "b/a/x.md");
        assert_eq!(row.parent_path.as_deref(), Some("b/a"));
    }

    /// `parent_path` needs one more level of nesting than `path` does before a
    /// repeated folder name can be got wrong, so it is worth its own case: the
    /// envelope derives a moved note's parent from where the note landed, which
    /// is the same computation the path itself got.
    #[test]
    fn rename_folder_re_keys_a_deeper_repeated_parent_path_by_prefix_only() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join("a/a/a")).unwrap();
        fs::write(dir.path().join("a/a/a/y.md"), "").unwrap();

        let mut conn = test_conn();
        insert_note(&mut conn, 1, "a/a/a/y.md", Some("a/a/a"));

        rename_folder_inner(dir.path(), "a", "b", &mut conn, None).unwrap();

        let row: Note = notes.first::<Note>(&mut conn).unwrap();
        assert_eq!(row.path, "b/a/a/y.md");
        assert_eq!(row.parent_path.as_deref(), Some("b/a/a"));
    }

    /// The mirror of the delete case: `LIKE` alone selects the sibling too, and a
    /// prefix rewrite anchored by length would then cut the same number of
    /// characters off a path that never carried the prefix — turning
    /// `session-notes/b.md` into `archive/b.md` while the file stays where it is.
    /// The old blanket `REPLACE` was self-limiting here (no literal match, no
    /// change), so the guard has to be explicit now that the rewrite is positional.
    #[test]
    fn rename_folder_leaves_a_sibling_the_like_pattern_matches_alone() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join("session_notes")).unwrap();
        fs::create_dir(dir.path().join("session-notes")).unwrap();
        fs::write(dir.path().join("session_notes/a.md"), "").unwrap();
        fs::write(dir.path().join("session-notes/b.md"), "").unwrap();

        let mut conn = test_conn();
        insert_note(&mut conn, 1, "session_notes/a.md", Some("session_notes"));
        insert_note(&mut conn, 2, "session-notes/b.md", Some("session-notes"));
        insert_map(&mut conn, "session-notes/world.jpg", "World Map");

        rename_folder_inner(dir.path(), "session_notes", "archive", &mut conn, None).unwrap();

        let mut paths: Vec<String> = notes.select(path).load(&mut conn).unwrap();
        paths.sort();
        assert_eq!(paths, vec!["archive/a.md", "session-notes/b.md"]);

        let row: Map = maps::table.first::<Map>(&mut conn).unwrap();
        assert_eq!(row.image_path.as_deref(), Some("session-notes/world.jpg"));
    }

    #[test]
    fn rename_folder_re_keys_a_repeated_name_in_a_map_image_path_by_prefix_only() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join("a/a")).unwrap();
        fs::write(dir.path().join("a/a/world.jpg"), "").unwrap();

        let mut conn = test_conn();
        insert_map(&mut conn, "a/a/world.jpg", "World Map");

        rename_folder_inner(dir.path(), "a", "b", &mut conn, None).unwrap();

        let row: Map = maps::table.first::<Map>(&mut conn).unwrap();
        assert_eq!(row.image_path.as_deref(), Some("b/a/world.jpg"));
    }
}
