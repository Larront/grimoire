use crate::commands::frontmatter;
use crate::commands::tags::upsert_note_tags;
use crate::db::models::{Map, NewNote, Note, Scene};
use crate::db::schema::{maps, notes::dsl::*, scenes};
use crate::vault::AppVault;
use diesel::prelude::*;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

pub use crate::search::{NoteSearchResult, SearchAllResult};

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
    note_path: String,
    note_parent_path: Option<String>,
    vault: State<AppVault>,
) -> Result<Note, String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let vault_path = state.path.clone().ok_or("No vault open")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;

    // Determine the parent directory and resolve any filename conflicts
    // validate_parent_path creates the parent dir and canonicalizes it to guard against traversal
    let initial_full_path = validate_parent_path(&vault_path, &note_path)?;
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

    let created: Note = diesel::insert_into(notes)
        .values(&new_note)
        .returning(Note::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())?;

    if let Some(index) = &state.search_index {
        let _ = crate::search::index_note(index, &created, "", &[]);
    }

    Ok(created)
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
        // Re-key tag-index rows to the new path (folder rename has its own bulk handler).
        diesel::sql_query("UPDATE note_tags SET note_path = ? WHERE note_path = ?")
            .bind::<diesel::sql_types::Text, _>(&note.path)
            .bind::<diesel::sql_types::Text, _>(&old_note.path)
            .execute(conn)
            .map_err(|e| e.to_string())?;
    }

    let updated: Note = diesel::update(notes.find(note.id))
        .set(&note)
        .returning(Note::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())?;

    let raw_content = std::fs::read_to_string(vault_path.join(&updated.path))
        .unwrap_or_default();
    let body_text = crate::search::extract_plain_text(&raw_content);
    let tags = frontmatter::read_tags(&raw_content);

    if let Some(index) = &state.search_index {
        let _ = crate::search::index_note(index, &updated, &body_text, &tags);
    }

    Ok(updated)
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

    upsert_note_tags(conn, &note.path, &[])?;

    let deleted = diesel::delete(notes.find(note_id))
        .execute(conn)
        .map_err(|e| e.to_string())?;

    if let Some(index) = &state.search_index {
        let _ = crate::search::remove_note(index, note_id);
    }

    Ok(deleted)
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
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let vault_path = state.path.as_ref().ok_or("No vault open")?.clone();
    let full_path = validate_parent_path(&vault_path, &note_path)?;
    fs::write(&full_path, &content).map_err(|e| e.to_string())?;

    // Re-index with updated body text
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    let maybe_note = notes
        .filter(path.eq(&note_path))
        .first::<Note>(conn)
        .optional()
        .map_err(|e| e.to_string())?;
    if let (Some(note), Some(index)) = (maybe_note, state.search_index.as_ref()) {
        let body_text = crate::search::extract_plain_text(&content);
        let tags = frontmatter::read_tags(&content);
        let _ = crate::search::index_note(index, &note, &body_text, &tags);
    }

    Ok(())
}

#[tauri::command]
pub fn read_note_tags(note_path: String, vault: State<AppVault>) -> Result<Vec<String>, String> {
    let state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let vault_path = state.path.as_ref().ok_or("No vault open")?.clone();
    let full_path = validate_path(&vault_path, &note_path)?;
    let content = fs::read_to_string(&full_path).map_err(|e| e.to_string())?;
    Ok(frontmatter::read_tags(&content))
}

#[tauri::command]
pub fn write_note_tags(
    note_path: String,
    tags: Vec<String>,
    vault: State<AppVault>,
) -> Result<(), String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let vault_path = state.path.as_ref().ok_or("No vault open")?.clone();
    let full_path = validate_path(&vault_path, &note_path)?;
    let content = fs::read_to_string(&full_path).map_err(|e| e.to_string())?;
    let new_content = frontmatter::apply_tags(&content, &tags);
    fs::write(&full_path, &new_content).map_err(|e| e.to_string())?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    upsert_note_tags(conn, &note_path, &tags)?;
    // Re-index in Tantivy so tag: filters reflect the updated tags immediately
    let maybe_note = notes
        .filter(path.eq(&note_path))
        .first::<Note>(conn)
        .optional()
        .map_err(|e| e.to_string())?;
    if let (Some(note), Some(index)) = (maybe_note, state.search_index.as_ref()) {
        let body_text = crate::search::extract_plain_text(&new_content);
        let _ = crate::search::index_note(index, &note, &body_text, &tags);
    }
    Ok(())
}

#[tauri::command]
pub fn search_notes(query: String, vault: State<AppVault>) -> Result<Vec<NoteSearchResult>, String> {
    let state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let vault_path = state.path.as_ref().ok_or("No vault open")?.clone();
    match &state.search_index {
        Some(index) => crate::search::search_notes_in_index(index, &vault_path, &query, 10),
        None => Ok(vec![]),
    }
}

#[tauri::command]
pub fn search_all(query: String, vault: State<AppVault>) -> Result<SearchAllResult, String> {
    use crate::db::schema::note_tags::dsl as nt;
    use crate::search::{parse_tag_filters, strip_tag_tokens, TagFacet};

    let active_tag_filters = parse_tag_filters(&query);
    let free_text = strip_tag_tokens(&query);
    let free_text_lower = free_text.to_lowercase();

    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let vault_path = state.path.as_ref().ok_or("No vault open")?.clone();

    // Collect tag facets from SQLite note_tags
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    let all_tag_rows: Vec<String> = nt::note_tags
        .select(nt::tag)
        .load::<String>(conn)
        .map_err(|e| e.to_string())?;

    // Count occurrences per lowercase tag, filter by free-text prefix, exclude active filters
    let mut counts: std::collections::HashMap<String, (String, usize)> = std::collections::HashMap::new();
    for tag in &all_tag_rows {
        let lower = tag.to_lowercase();
        if free_text_lower.is_empty() || lower.contains(&free_text_lower) {
            let entry = counts.entry(lower.clone()).or_insert_with(|| (tag.clone(), 0));
            entry.1 += 1;
        }
    }
    let mut tag_facets: Vec<TagFacet> = counts
        .into_iter()
        .filter(|(lower, _)| !active_tag_filters.iter().any(|f| f == lower.as_str()))
        .map(|(_, (name, cnt))| TagFacet { name, note_count: cnt })
        .collect();
    tag_facets.sort_by(|a, b| b.note_count.cmp(&a.note_count).then(a.name.cmp(&b.name)));
    tag_facets.truncate(5);

    // Tantivy search
    match &state.search_index {
        Some(index) => {
            let mut result = crate::search::search_all_in_index(index, &vault_path, &query, 10)?;
            result.tags = tag_facets;
            Ok(result)
        }
        None => Ok(SearchAllResult { notes: vec![], maps: vec![], scenes: vec![], tags: tag_facets }),
    }
}

#[tauri::command]
pub fn rebuild_search_index(vault: State<AppVault>) -> Result<(), String> {
    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    let vault_path = state.path.clone().ok_or("No vault open")?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    let all_notes: Vec<Note> = notes.load::<Note>(conn).map_err(|e| e.to_string())?;
    let all_maps: Vec<Map> = maps::table.load::<Map>(conn).map_err(|e| e.to_string())?;
    let all_scenes: Vec<Scene> = scenes::table.load::<Scene>(conn).map_err(|e| e.to_string())?;
    let index = crate::search::rebuild_index(&vault_path, &all_notes, &all_maps, &all_scenes)?;
    state.search_index = Some(index);
    Ok(())
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
