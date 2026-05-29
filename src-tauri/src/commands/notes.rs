use crate::commands::frontmatter;
use crate::commands::links::rewrite_backlinks_on_rename_on_conn;
use crate::commands::tags::upsert_note_tags;
use crate::note_index;
use crate::db::models::{Map, NewNote, Note, Scene};
use crate::db::schema::{maps, notes::dsl::*, scenes};
use crate::ledger::AppLedger;
use diesel::prelude::*;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

pub use crate::search::{NoteSearchResult, SearchAllResult};

/// Validates that `relative` resolves to a path inside `ledger_root`.
/// Use for reading/deleting existing files — the file must exist for canonicalize().
/// Both sides are canonicalized so the starts_with check works correctly on Windows
/// (where canonicalize returns \\?\ extended-length paths).
fn validate_path(ledger_root: &Path, relative: &str) -> Result<PathBuf, String> {
    let canonical_root = ledger_root
        .canonicalize()
        .map_err(|e| format!("Invalid ledger root: {e}"))?;
    let joined = ledger_root.join(relative);
    let canonical = joined
        .canonicalize()
        .map_err(|e| format!("Invalid path: {e}"))?;
    if !canonical.starts_with(&canonical_root) {
        return Err("Path escapes ledger root".to_string());
    }
    Ok(canonical)
}

/// Validates that the PARENT of `relative` resolves inside `ledger_root`.
/// Use for creating/writing new files — the file itself may not exist yet.
/// Both sides are canonicalized so the starts_with check works correctly on Windows.
pub(crate) fn validate_parent_path(ledger_root: &Path, relative: &str) -> Result<PathBuf, String> {
    let canonical_root = ledger_root
        .canonicalize()
        .map_err(|e| format!("Invalid ledger root: {e}"))?;
    let joined = ledger_root.join(relative);
    let parent = joined.parent().ok_or("Cannot determine parent directory")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|e| format!("Invalid parent path: {e}"))?;
    if !canonical_parent.starts_with(&canonical_root) {
        return Err("Path escapes ledger root".to_string());
    }
    Ok(joined) // parent is validated; return the full (not yet existing) file path
}

pub(crate) fn resolve_note_filename(base_title: &str, parent_dir: &std::path::Path) -> (String, std::path::PathBuf) {
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
pub fn get_notes(ledger: State<AppLedger>) -> Result<Vec<Note>, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    notes.load::<Note>(conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_note(
    note_title: String,
    note_path: String,
    note_parent_path: Option<String>,
    ledger: State<AppLedger>,
) -> Result<Note, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let ledger_path = state.path.clone().ok_or("No ledger open")?;

    // Determine the parent directory and resolve any filename conflicts
    // validate_parent_path creates the parent dir and canonicalizes it to guard against traversal
    let initial_full_path = validate_parent_path(&ledger_path, &note_path)?;
    let parent_dir = initial_full_path
        .parent()
        .ok_or("Cannot determine parent directory")?;

    let (resolved_title, full_path) = resolve_note_filename(&note_title, parent_dir);

    // Convert the resolved absolute path back to a ledger-relative forward-slash path
    let resolved_path = full_path
        .strip_prefix(&ledger_path)
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .replace('\\', "/");

    fs::write(&full_path, "").map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().to_rfc3339();
    let new_note = NewNote {
        path: &resolved_path,
        title: &resolved_title,
        parent_path: note_parent_path.as_deref(),
        modified_at: &now,
    };

    // Field-split so conn (mut) and search_index (ref) can be borrowed simultaneously.
    let state_ref = &mut *state;
    let conn = state_ref.connection.as_mut().ok_or("No ledger open")?;
    let index = state_ref.search_index.as_ref();

    let created: Note = diesel::insert_into(notes)
        .values(&new_note)
        .returning(Note::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())?;

    note_index::reconcile(conn, index, &created, "", None)?;

    Ok(created)
}

#[tauri::command]
pub fn create_note_from_template(
    template_path: String,
    note_parent_path: Option<String>,
    ledger: State<AppLedger>,
) -> Result<Note, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let ledger_path = state.path.clone().ok_or("No ledger open")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;

    let content = crate::commands::templates::read_template_content(&ledger_path, &template_path)?;

    let note_path = match &note_parent_path {
        Some(parent) => format!("{}/Untitled.md", parent.trim_end_matches('/')),
        None => "Untitled.md".to_string(),
    };

    let initial_full_path = validate_parent_path(&ledger_path, &note_path)?;
    let parent_dir = initial_full_path
        .parent()
        .ok_or("Cannot determine parent directory")?;

    let (resolved_title, full_path) = resolve_note_filename("Untitled", parent_dir);

    let resolved_path = full_path
        .strip_prefix(&ledger_path)
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .replace('\\', "/");

    fs::write(&full_path, &content).map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().to_rfc3339();
    let new_note = NewNote {
        path: &resolved_path,
        title: &resolved_title,
        parent_path: note_parent_path.as_deref(),
        modified_at: &now,
    };

    let created: Note = diesel::insert_into(notes)
        .values(&new_note)
        .returning(Note::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())?;

    if let Some(index) = &state.search_index {
        let _ = crate::search::index_note(index, &created, &content, &[]);
    }

    Ok(created)
}

#[tauri::command]
pub fn update_note(note: Note, ledger: State<AppLedger>) -> Result<Note, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let ledger_path = state.path.clone().ok_or("No ledger open")?;

    // Field-split so conn (mut) and search_index (ref) can be borrowed simultaneously.
    let state_ref = &mut *state;
    let conn = state_ref.connection.as_mut().ok_or("No ledger open")?;
    let index = state_ref.search_index.as_ref();

    // Fetch the current record to detect path changes
    let old_note: Note = notes.find(note.id).first(conn).map_err(|e| e.to_string())?;

    // Rename file on disk if the path changed
    if old_note.path != note.path {
        let old_full = validate_path(&ledger_path, &old_note.path)?;
        let new_full = validate_parent_path(&ledger_path, &note.path)?;
        if new_full.exists() {
            return Err(format!("A file already exists at '{}'", note.path));
        }
        if old_full.exists() {
            fs::rename(&old_full, &new_full).map_err(|e| e.to_string())?;
        }
        // note_tags re-key handled inside reconcile via prev_path
    }

    let updated: Note = diesel::update(notes.find(note.id))
        .set(&note)
        .returning(Note::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())?;

    let raw_content = std::fs::read_to_string(ledger_path.join(&updated.path))
        .unwrap_or_default();

    note_index::reconcile(conn, index, &updated, &raw_content, Some(&old_note.path))?;

    Ok(updated)
}

#[derive(Serialize)]
pub struct RenameNoteResult {
    pub note: Note,
    pub updated_count: usize,
}

/// Like `update_note` but also rewrites all wikilinks that reference the old
/// path in every other note in the ledger.  Returns the count of notes whose
/// files were actually rewritten so the frontend can show a toast.
#[tauri::command]
pub fn rename_note(note: Note, ledger: State<AppLedger>) -> Result<RenameNoteResult, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let ledger_path = state.path.clone().ok_or("No ledger open")?;

    // Field-split so conn (mut) and search_index (ref) can be borrowed simultaneously.
    let state_ref = &mut *state;
    let conn = state_ref.connection.as_mut().ok_or("No ledger open")?;
    let index = state_ref.search_index.as_ref();

    let old_note: Note = notes.find(note.id).first(conn).map_err(|e| e.to_string())?;

    let mut updated_count = 0usize;

    if old_note.path != note.path {
        let old_full = validate_path(&ledger_path, &old_note.path)?;
        let new_full = validate_parent_path(&ledger_path, &note.path)?;
        if new_full.exists() {
            return Err(format!("A file already exists at '{}'", note.path));
        }
        if old_full.exists() {
            fs::rename(&old_full, &new_full).map_err(|e| e.to_string())?;
        }
        // note_tags re-key handled inside reconcile via prev_path
        updated_count =
            rewrite_backlinks_on_rename_on_conn(&ledger_path, conn, &old_note.path, &note.path)?;
    }

    let updated: Note = diesel::update(notes.find(note.id))
        .set(&note)
        .returning(Note::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())?;

    let raw_content = std::fs::read_to_string(ledger_path.join(&updated.path)).unwrap_or_default();

    note_index::reconcile(conn, index, &updated, &raw_content, Some(&old_note.path))?;

    Ok(RenameNoteResult {
        note: updated,
        updated_count,
    })
}

#[tauri::command]
pub fn delete_note(note_id: i32, ledger: State<AppLedger>) -> Result<usize, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let ledger_path = state.path.clone().ok_or("No ledger open")?;

    let state_ref = &mut *state;
    let conn = state_ref.connection.as_mut().ok_or("No ledger open")?;
    let index = state_ref.search_index.as_ref();

    let note: Note = notes.find(note_id).first(conn).map_err(|e| e.to_string())?;
    let full_path = validate_path(&ledger_path, &note.path)?;
    if full_path.exists() {
        fs::remove_file(&full_path).map_err(|e| e.to_string())?;
    }

    note_index::remove(conn, index, note_id, &note.path)?;

    let deleted = diesel::delete(notes.find(note_id))
        .execute(conn)
        .map_err(|e| e.to_string())?;

    Ok(deleted)
}

#[tauri::command]
pub fn read_note_content(note_path: String, ledger: State<AppLedger>) -> Result<String, String> {
    let state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let ledger_path = state.path.as_ref().ok_or("No ledger open")?.clone();
    let full_path = validate_path(&ledger_path, &note_path)?;
    fs::read_to_string(&full_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_note_content(
    note_path: String,
    content: String,
    ledger: State<AppLedger>,
) -> Result<(), String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let ledger_path = state.path.as_ref().ok_or("No ledger open")?.clone();
    let full_path = validate_parent_path(&ledger_path, &note_path)?;
    fs::write(&full_path, &content).map_err(|e| e.to_string())?;

    // Borrow connection and search_index as separate fields of *state so the
    // borrow checker allows both to be live when calling reconcile.
    let state_ref = &mut *state;
    let conn = state_ref.connection.as_mut().ok_or("No ledger open")?;
    let index = state_ref.search_index.as_ref();

    let maybe_note = notes
        .filter(path.eq(&note_path))
        .first::<Note>(conn)
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(ref note) = maybe_note {
        note_index::reconcile(conn, index, note, &content, Some(&note_path))?;
    }

    Ok(())
}

#[tauri::command]
pub fn read_note_tags(note_path: String, ledger: State<AppLedger>) -> Result<Vec<String>, String> {
    let state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let ledger_path = state.path.as_ref().ok_or("No ledger open")?.clone();
    let full_path = validate_path(&ledger_path, &note_path)?;
    let content = fs::read_to_string(&full_path).map_err(|e| e.to_string())?;
    Ok(frontmatter::read_tags(&content))
}

#[tauri::command]
pub fn write_note_tags(
    note_path: String,
    tags: Vec<String>,
    ledger: State<AppLedger>,
) -> Result<(), String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let ledger_path = state.path.as_ref().ok_or("No ledger open")?.clone();
    let full_path = validate_path(&ledger_path, &note_path)?;
    let content = fs::read_to_string(&full_path).map_err(|e| e.to_string())?;
    let new_content = frontmatter::apply_tags(&content, &tags);
    fs::write(&full_path, &new_content).map_err(|e| e.to_string())?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
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
pub fn search_notes(query: String, ledger: State<AppLedger>) -> Result<Vec<NoteSearchResult>, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let ledger_path = state.path.as_ref().ok_or("No ledger open")?.clone();

    let tantivy_results = match state.search_index.as_ref() {
        Some(index) => crate::search::search_notes_in_index(index, &ledger_path, &query, 10)?,
        None => vec![],
    };

    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    let alias_results = crate::commands::links::search_notes_by_alias_on_conn(conn, &query)?;

    let mut seen: std::collections::HashSet<i32> = tantivy_results.iter().map(|r| r.id).collect();
    let mut merged = tantivy_results;
    for r in alias_results {
        if seen.insert(r.id) {
            merged.push(r);
        }
    }
    merged.truncate(10);
    Ok(merged)
}

#[tauri::command]
pub fn search_all(query: String, ledger: State<AppLedger>) -> Result<SearchAllResult, String> {
    use crate::db::schema::note_tags::dsl as nt;
    use crate::search::{parse_tag_filters, strip_tag_tokens, TagFacet};

    let active_tag_filters = parse_tag_filters(&query);
    let free_text = strip_tag_tokens(&query);
    let free_text_lower = free_text.to_lowercase();

    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let ledger_path = state.path.as_ref().ok_or("No ledger open")?.clone();

    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    let all_tag_rows: Vec<String> = nt::note_tags
        .select(nt::tag)
        .load::<String>(conn)
        .map_err(|e| e.to_string())?;

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

    match &state.search_index {
        Some(index) => {
            let mut result = crate::search::search_all_in_index(index, &ledger_path, &query, 10)?;
            result.tags = tag_facets;
            Ok(result)
        }
        None => Ok(SearchAllResult { notes: vec![], maps: vec![], scenes: vec![], tags: tag_facets }),
    }
}

#[tauri::command]
pub fn rebuild_search_index(ledger: State<AppLedger>) -> Result<(), String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let ledger_path = state.path.clone().ok_or("No ledger open")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;
    let all_notes: Vec<Note> = notes.load::<Note>(conn).map_err(|e| e.to_string())?;
    let all_maps: Vec<Map> = maps::table.load::<Map>(conn).map_err(|e| e.to_string())?;
    let all_scenes: Vec<Scene> = scenes::table.load::<Scene>(conn).map_err(|e| e.to_string())?;
    let index = crate::search::rebuild_index(&ledger_path, &all_notes, &all_maps, &all_scenes)?;
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
pub fn get_note_by_path(note_path: String, ledger: State<AppLedger>) -> Result<Option<NotePathResult>, String> {
    let mut state = ledger.lock().map_err(|_| "Ledger lock poisoned")?;
    let ledger_path = state.path.clone().ok_or("No ledger open")?;
    let conn = state.connection.as_mut().ok_or("No ledger open")?;

    // Notes store ledger-relative paths in the DB (e.g. "Characters/Aldric.md").
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
            let full_path = validate_path(&ledger_path, &note_path)?;
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
