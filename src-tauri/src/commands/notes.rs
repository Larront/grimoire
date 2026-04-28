use crate::db::models::{NewNote, Note};
use crate::db::schema::notes::dsl::*;
use crate::vault::AppVault;
use diesel::prelude::*;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

/// Validates that `relative` resolves to a path inside `vault_root`.
/// Use for reading/deleting existing files — the file must exist for canonicalize().
/// Both sides are canonicalized so the starts_with check works correctly on Windows
/// (where canonicalize returns \\?\ extended-length paths).
fn validate_path(vault_root: &Path, relative: &str) -> Result<PathBuf, String> {
    let canonical_root = vault_root
        .canonicalize()
        .map_err(|e| format!("Invalid vault root: {e}"))?;
    let joined = vault_root.join(relative);
    let canonical = joined
        .canonicalize()
        .map_err(|e| format!("Invalid path: {e}"))?;
    if !canonical.starts_with(&canonical_root) {
        return Err("Path escapes vault root".to_string());
    }
    Ok(canonical)
}

/// Validates that the PARENT of `relative` resolves inside `vault_root`.
/// Use for creating/writing new files — the file itself may not exist yet.
/// Both sides are canonicalized so the starts_with check works correctly on Windows.
fn validate_parent_path(vault_root: &Path, relative: &str) -> Result<PathBuf, String> {
    let canonical_root = vault_root
        .canonicalize()
        .map_err(|e| format!("Invalid vault root: {e}"))?;
    let joined = vault_root.join(relative);
    let parent = joined.parent().ok_or("Cannot determine parent directory")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|e| format!("Invalid parent path: {e}"))?;
    if !canonical_parent.starts_with(&canonical_root) {
        return Err("Path escapes vault root".to_string());
    }
    Ok(joined) // parent is validated; return the full (not yet existing) file path
}

fn resolve_note_filename(base_title: &str, parent_dir: &std::path::Path) -> (String, std::path::PathBuf) {
    let mut resolved_title = base_title.to_string();
    let mut counter = 2u32;
    loop {
        let filename = format!("{}.md", resolved_title);
        let full_path = parent_dir.join(&filename);
        if !full_path.exists() {
            return (resolved_title, full_path);
        }
        resolved_title = format!("{} {}", base_title, counter);
        counter += 1;
    }
}

#[tauri::command]
pub fn get_notes(vault: State<AppVault>) -> Result<Vec<Note>, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    notes.load::<Note>(conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_note(
    note_title: String,
    _note_path: String,
    note_parent_path: Option<String>,
    vault: State<AppVault>,
) -> Result<Note, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let vault_path = state.path.clone().ok_or("No vault open")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;

    // Determine the parent directory and resolve any filename conflicts
    // validate_parent_path creates the parent dir and canonicalizes it to guard against traversal
    let initial_full_path = validate_parent_path(&vault_path, &_note_path)?;
    let parent_dir = initial_full_path
        .parent()
        .ok_or("Cannot determine parent directory")?;

    let (resolved_title, full_path) = resolve_note_filename(&note_title, parent_dir);

    // Convert the resolved absolute path back to a vault-relative forward-slash path
    let resolved_path = full_path
        .strip_prefix(&vault_path)
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .replace('\\', "/");

    fs::write(&full_path, "").map_err(|e| e.to_string())?;

    let new_note = NewNote {
        path: &resolved_path,
        title: &resolved_title,
        parent_path: note_parent_path.as_deref(),
    };

    diesel::insert_into(notes)
        .values(&new_note)
        .returning(Note::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_note(note: Note, vault: State<AppVault>) -> Result<Note, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let vault_path = state.path.clone().ok_or("No vault open")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;

    // Fetch the current record to detect path changes
    let old_note: Note = notes.find(note.id).first(conn).map_err(|e| e.to_string())?;

    // Rename file on disk if the path changed
    if old_note.path != note.path {
        let old_full = validate_path(&vault_path, &old_note.path)?;
        let new_full = validate_parent_path(&vault_path, &note.path)?;
        if new_full.exists() {
            return Err(format!("A file already exists at '{}'", note.path));
        }
        if old_full.exists() {
            fs::rename(&old_full, &new_full).map_err(|e| e.to_string())?;
        }
    }

    diesel::update(notes.find(note.id))
        .set(&note)
        .returning(Note::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_note(note_id: i32, vault: State<AppVault>) -> Result<usize, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let vault_path = state.path.clone().ok_or("No vault open")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;

    let note: Note = notes.find(note_id).first(conn).map_err(|e| e.to_string())?;
    let full_path = validate_path(&vault_path, &note.path)?;
    if full_path.exists() {
        fs::remove_file(&full_path).map_err(|e| e.to_string())?;
    }

    diesel::delete(notes.find(note_id))
        .execute(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_note_content(note_path: String, vault: State<AppVault>) -> Result<String, String> {
    let state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let vault_path = state.path.as_ref().ok_or("No vault open")?.clone();
    let full_path = validate_path(&vault_path, &note_path)?;
    fs::read_to_string(&full_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_note_content(
    note_path: String,
    content: String,
    vault: State<AppVault>,
) -> Result<(), String> {
    let state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let vault_path = state.path.as_ref().ok_or("No vault open")?.clone();
    let full_path = validate_parent_path(&vault_path, &note_path)?;
    fs::write(&full_path, content).map_err(|e| e.to_string())
}

#[derive(Serialize, Debug)]
pub struct NoteSearchResult {
    pub id: i32,
    pub title: String,
    pub path: String,
}

#[tauri::command]
pub fn search_notes(query: String, vault: State<AppVault>) -> Result<Vec<NoteSearchResult>, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    let pattern = format!("%{}%", query);
    notes
        .filter(title.like(&pattern).or(path.like(&pattern)))
        .order(title.asc())
        .limit(10)
        .select((id, title, path))
        .load::<(i32, String, String)>(conn)
        .map(|rows| {
            rows.into_iter()
                .map(|(note_id, note_title, note_path)| NoteSearchResult {
                    id: note_id,
                    title: note_title,
                    path: note_path,
                })
                .collect()
        })
        .map_err(|e| e.to_string())
}

#[derive(Serialize, Debug)]
pub struct NotePathResult {
    pub id: i32,
    pub title: String,
    pub content: String,
}

#[tauri::command]
pub fn get_note_by_path(note_path: String, vault: State<AppVault>) -> Result<Option<NotePathResult>, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let vault_path = state.path.clone().ok_or("No vault open")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;

    // Notes store vault-relative paths in the DB (e.g. "Characters/Aldric.md").
    // Content is read from disk, not stored in the DB.
    let result = notes
        .filter(path.eq(&note_path))
        .select((id, title))
        .first::<(i32, String)>(conn)
        .optional()
        .map_err(|e| e.to_string())?;

    match result {
        None => Ok(None),
        Some((note_id, note_title)) => {
            let full_path = validate_path(&vault_path, &note_path)?;
            let content = std::fs::read_to_string(&full_path).map_err(|e| e.to_string())?;
            Ok(Some(NotePathResult {
                id: note_id,
                title: note_title,
                content,
            }))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::resolve_note_filename;
    use std::fs;

    #[test]
    fn test_no_conflict() {
        let dir = tempfile::tempdir().unwrap();
        let (title, path) = resolve_note_filename("My Note", dir.path());
        assert_eq!(title, "My Note");
        assert_eq!(path, dir.path().join("My Note.md"));
    }

    #[test]
    fn test_one_conflict() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("Untitled.md"), "").unwrap();
        let (title, path) = resolve_note_filename("Untitled", dir.path());
        assert_eq!(title, "Untitled 2");
        assert_eq!(path, dir.path().join("Untitled 2.md"));
    }

    #[test]
    fn test_multiple_conflicts() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("Untitled.md"), "").unwrap();
        fs::write(dir.path().join("Untitled 2.md"), "").unwrap();
        let (title, path) = resolve_note_filename("Untitled", dir.path());
        assert_eq!(title, "Untitled 3");
        assert_eq!(path, dir.path().join("Untitled 3.md"));
    }
}
