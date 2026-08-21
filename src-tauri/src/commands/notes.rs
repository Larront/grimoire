use crate::commands::frontmatter;
use crate::note_index;
use crate::note_mutation;
use crate::db::models::{Map, NewNote, Note, Scene};
use crate::db::schema::{maps, notes::dsl::*, scenes};
use crate::ledger::{ledger_path, with_open_ledger, AppLedger, OpenLedger};
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
#[specta::specta]
pub fn get_notes(ledger: State<AppLedger>) -> Result<Vec<Note>, String> {
    with_open_ledger(&ledger, |l| {
        notes.load::<Note>(l.conn).map_err(|e| e.to_string())
    })
}

#[tauri::command]
#[specta::specta]
pub fn create_note(
    note_title: String,
    note_path: String,
    note_parent_path: Option<String>,
    ledger: State<AppLedger>,
) -> Result<Note, String> {
    with_open_ledger(&ledger, |l| {
        create_note_inner(l, &note_title, &note_path, note_parent_path.as_deref())
    })
}

fn create_note_inner(
    l: OpenLedger,
    note_title: &str,
    note_path: &str,
    note_parent_path: Option<&str>,
) -> Result<Note, String> {
    let OpenLedger { path: ledger_path, conn, index } = l;

    // Determine the parent directory and resolve any filename conflicts
    // validate_parent_path creates the parent dir and canonicalizes it to guard against traversal
    let initial_full_path = validate_parent_path(ledger_path, note_path)?;
    let parent_dir = initial_full_path
        .parent()
        .ok_or("Cannot determine parent directory")?;

    let (resolved_title, full_path) = resolve_note_filename(note_title, parent_dir);

    // Convert the resolved absolute path back to a ledger-relative forward-slash path
    let resolved_path = full_path
        .strip_prefix(ledger_path)
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .replace('\\', "/");

    let now = chrono::Utc::now().to_rfc3339();
    let new_note = NewNote {
        path: &resolved_path,
        title: &resolved_title,
        parent_path: note_parent_path,
        modified_at: &now,
    };

    let created: Note = diesel::insert_into(notes)
        .values(&new_note)
        .returning(Note::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())?;

    note_mutation::create(conn, index, &full_path, &created, "")?;

    Ok(created)
}

#[tauri::command]
#[specta::specta]
pub fn create_note_from_template(
    template_path: String,
    note_parent_path: Option<String>,
    ledger: State<AppLedger>,
) -> Result<Note, String> {
    with_open_ledger(&ledger, |l| {
        create_note_from_template_inner(l, &template_path, note_parent_path.as_deref())
    })
}

fn create_note_from_template_inner(
    l: OpenLedger,
    template_path: &str,
    note_parent_path: Option<&str>,
) -> Result<Note, String> {
    let OpenLedger { path: ledger_path, conn, index } = l;

    let content = crate::commands::templates::read_template_content(ledger_path, template_path)?;

    let note_path = match &note_parent_path {
        Some(parent) => format!("{}/Untitled.md", parent.trim_end_matches('/')),
        None => "Untitled.md".to_string(),
    };

    let initial_full_path = validate_parent_path(ledger_path, &note_path)?;
    let parent_dir = initial_full_path
        .parent()
        .ok_or("Cannot determine parent directory")?;

    let (resolved_title, full_path) = resolve_note_filename("Untitled", parent_dir);

    let resolved_path = full_path
        .strip_prefix(ledger_path)
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .replace('\\', "/");

    let now = chrono::Utc::now().to_rfc3339();
    let new_note = NewNote {
        path: &resolved_path,
        title: &resolved_title,
        parent_path: note_parent_path,
        modified_at: &now,
    };

    let created: Note = diesel::insert_into(notes)
        .values(&new_note)
        .returning(Note::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())?;

    note_mutation::create(conn, index, &full_path, &created, &content)?;

    Ok(created)
}

/// Read a note's content for index reconciliation. A missing file reconciles as
/// empty (there is genuinely no content on disk); any other failure (file locked
/// by a sync tool, permissions) propagates so the derived indexes are never
/// silently rebuilt from blank content.
fn read_note_for_reconcile(full_path: &Path) -> Result<String, String> {
    match std::fs::read_to_string(full_path) {
        Ok(content) => Ok(content),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("Failed to read '{}': {}", full_path.display(), e)),
    }
}

/// True when an existing file at `new_full` is the rename source itself — the
/// case-only-rename hit on case-insensitive filesystems (Windows/macOS), where
/// `exists()` matches the old file. A different file at the new path (possible
/// on case-sensitive filesystems even for a case-only rename) is a collision.
fn is_same_file(old_full: &Path, new_full: &Path) -> bool {
    match (old_full.canonicalize(), new_full.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

#[derive(Serialize, specta::Type)]
pub struct RenameNoteResult {
    pub note: Note,
    #[specta(type = i32)]
    pub updated_count: usize,
}

/// Rename a note (change its filename/path). Always re-keys the moved note's own
/// row and derived indexes; when `rewrite_backlinks` is true it also rewrites
/// every `[[old path]]` wikilink in every other note and returns the count of
/// files rewritten so the frontend can toast "N notes updated". When false it
/// leaves those backlinks as-is (the "Rename only" choice).
///
/// Replaces the former `update_note` + `rename_note` pair: the frontend's
/// yes/no-links choice is now the `rewrite_backlinks` boolean. Both share the
/// one `note_mutation::rename` implementation with the Ledger Watcher's external
/// move, so in-app and external renames can never diverge.
#[tauri::command]
#[specta::specta]
pub fn rename_note(
    note: Note,
    rewrite_backlinks: bool,
    ledger: State<AppLedger>,
) -> Result<RenameNoteResult, String> {
    with_open_ledger(&ledger, |l| rename_note_inner(l, &note, rewrite_backlinks))
}

fn rename_note_inner(
    l: OpenLedger,
    note: &Note,
    rewrite_backlinks: bool,
) -> Result<RenameNoteResult, String> {
    let OpenLedger { path: ledger_path, conn, index } = l;

    let old_note: Note = notes.find(note.id).first(conn).map_err(|e| e.to_string())?;

    // Move the file on disk (the app half of the rename), then run the shared
    // rename envelope for the row re-key, reconcile, and backlinks. The frontend
    // only calls this on an actual filename change; the guard keeps a no-op
    // path from renaming a file onto itself.
    let old_full = validate_path(ledger_path, &old_note.path)?;
    let new_full = validate_parent_path(ledger_path, &note.path)?;
    if new_full.exists() && !is_same_file(&old_full, &new_full) {
        return Err(format!("ERR_NAME_TAKEN: A file already exists at '{}'", note.path));
    }
    if old_note.path != note.path && old_full.exists() {
        fs::rename(&old_full, &new_full).map_err(|e| e.to_string())?;
    }

    let raw_content = read_note_for_reconcile(&ledger_path.join(&note.path))?;
    let renamed = note_mutation::rename(
        conn,
        index,
        ledger_path,
        &old_note.path,
        note,
        &raw_content,
        rewrite_backlinks,
    )?;

    let updated_count = match renamed.backlinks {
        note_mutation::RenamedBacklinks::Rewritten(n) => n,
        note_mutation::RenamedBacklinks::Deferred(_) => 0,
    };
    Ok(RenameNoteResult {
        note: renamed.note,
        updated_count,
    })
}

/// Heal the inbound wikilinks left broken by an *external* move of `from_path`
/// → `to_path` — the *Update* action on the external-move prompt (issue #135).
///
/// The moved note's own row was already re-keyed by the Ledger Watcher's phase-A
/// pass when the move was detected; this performs **phase B** on demand: rewrite
/// every other note's `[[old path]]` wikilinks to the new path and reconcile
/// those sources through the [`note_mutation`] envelope (so the rewrites are
/// echo-suppressed like every other write).
///
/// The affected set is **recomputed here** from the current ledger, not trusted
/// from the count the toast displayed: the ledger may have changed while the
/// prompt sat on screen, so a stale count can never cause the wrong notes to be
/// edited. Returns the number of notes whose files were actually rewritten.
#[tauri::command]
#[specta::specta]
pub fn apply_backlink_rewrite(
    from_path: String,
    to_path: String,
    ledger: State<AppLedger>,
) -> Result<u32, String> {
    with_open_ledger(&ledger, |l| {
        let rewrites = crate::commands::links::collect_backlink_rewrites_on_conn(
            l.path,
            l.conn,
            &from_path,
            &to_path,
        )?;
        let count = note_mutation::commit_backlink_rewrites(l.conn, l.index, l.path, rewrites)?;
        Ok(count as u32)
    })
}

#[tauri::command]
#[specta::specta]
pub fn delete_note(note_id: i32, ledger: State<AppLedger>) -> Result<u32, String> {
    with_open_ledger(&ledger, |l| delete_note_inner(l, note_id))
}

fn delete_note_inner(l: OpenLedger, note_id: i32) -> Result<u32, String> {
    let OpenLedger { path: ledger_path, conn, index } = l;

    let note: Note = notes.find(note_id).first(conn).map_err(|e| e.to_string())?;
    let full_path = validate_path(ledger_path, &note.path)?;
    if full_path.exists() {
        fs::remove_file(&full_path).map_err(|e| e.to_string())?;
    }

    note_index::remove(conn, index, note_id, &note.path)?;

    let deleted = diesel::delete(notes.find(note_id))
        .execute(conn)
        .map_err(|e| e.to_string())?;

    Ok(deleted as u32)
}

#[tauri::command]
#[specta::specta]
pub fn read_note_content(note_path: String, ledger: State<AppLedger>) -> Result<String, String> {
    let ledger_path = ledger_path(&ledger)?;
    let full_path = validate_path(&ledger_path, &note_path)?;
    fs::read_to_string(&full_path).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn write_note_content(
    note_path: String,
    content: String,
    ledger: State<AppLedger>,
) -> Result<(), String> {
    with_open_ledger(&ledger, |l| write_note_content_inner(l, &note_path, &content))
}

fn write_note_content_inner(
    l: OpenLedger,
    note_path: &str,
    content: &str,
) -> Result<(), String> {
    let OpenLedger { path: ledger_path, conn, index } = l;
    let full_path = validate_parent_path(ledger_path, note_path)?;

    // `content` is the note's *body* — the editor is handed a buffer with the
    // frontmatter already split off, so writing it as-is would erase the block
    // on every autosave (tags, aliases, and the foreign keys the portability
    // contract promises to keep). Restore it from the file as it stands now.
    let content = frontmatter::body_save_content(&full_path, content);

    let maybe_note = notes
        .filter(path.eq(note_path))
        .first::<Note>(conn)
        .optional()
        .map_err(|e| e.to_string())?;
    note_mutation::commit_or_write(conn, index, &full_path, maybe_note.as_ref(), &content)?;

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn read_note_tags(note_path: String, ledger: State<AppLedger>) -> Result<Vec<String>, String> {
    let ledger_path = ledger_path(&ledger)?;
    let full_path = validate_path(&ledger_path, &note_path)?;
    let content = fs::read_to_string(&full_path).map_err(|e| e.to_string())?;
    Ok(frontmatter::read_tags(&content))
}

#[tauri::command]
#[specta::specta]
pub fn write_note_tags(
    note_path: String,
    tags: Vec<String>,
    ledger: State<AppLedger>,
) -> Result<(), String> {
    with_open_ledger(&ledger, |l| write_note_tags_inner(l, &note_path, &tags))
}

fn write_note_tags_inner(
    l: OpenLedger,
    note_path: &str,
    tags: &[String],
) -> Result<(), String> {
    let OpenLedger { path: ledger_path, conn, index } = l;
    let full_path = validate_path(ledger_path, note_path)?;
    let content = fs::read_to_string(&full_path).map_err(|e| e.to_string())?;
    let new_content = frontmatter::apply_tags(&content, tags);

    let maybe_note = notes
        .filter(path.eq(note_path))
        .first::<Note>(conn)
        .optional()
        .map_err(|e| e.to_string())?;
    note_mutation::commit_or_write(conn, index, &full_path, maybe_note.as_ref(), &new_content)?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn search_notes(query: String, ledger: State<AppLedger>) -> Result<Vec<NoteSearchResult>, String> {
    with_open_ledger(&ledger, |l| {
        let tantivy_results = match l.index {
            Some(index) => crate::search::search_notes_in_index(index, l.path, &query, 10)?,
            None => vec![],
        };

        let alias_results =
            crate::commands::links::search_notes_by_alias_on_conn(l.conn, &query)?;

        let mut seen: std::collections::HashSet<i32> =
            tantivy_results.iter().map(|r| r.id).collect();
        let mut merged = tantivy_results;
        for r in alias_results {
            if seen.insert(r.id) {
                merged.push(r);
            }
        }
        merged.truncate(10);
        Ok(merged)
    })
}

#[tauri::command]
#[specta::specta]
pub fn search_all(query: String, ledger: State<AppLedger>) -> Result<SearchAllResult, String> {
    use crate::db::schema::note_tags::dsl as nt;
    use crate::search::{parse_tag_filters, strip_tag_tokens, TagFacet};

    let active_tag_filters = parse_tag_filters(&query);
    let free_text = strip_tag_tokens(&query);
    let free_text_lower = free_text.to_lowercase();

    with_open_ledger(&ledger, |l| {
        let all_tag_rows: Vec<String> = nt::note_tags
            .select(nt::tag)
            .load::<String>(l.conn)
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

        match l.index {
            Some(index) => {
                let mut result = crate::search::search_all_in_index(index, l.path, &query, 10)?;
                result.tags = tag_facets;
                Ok(result)
            }
            None => Ok(SearchAllResult { notes: vec![], maps: vec![], scenes: vec![], tags: tag_facets }),
        }
    })
}

#[tauri::command]
#[specta::specta]
pub fn rebuild_search_index(ledger: State<AppLedger>) -> Result<(), String> {
    // Takes the guard itself rather than going through `with_open_ledger`: it
    // *replaces* the search index on the state, which an `OpenLedger` only borrows.
    let mut state = ledger.lock().map_err(|_| crate::ledger::ERR_LOCK_POISONED)?;
    let l = state.open()?;
    let all_notes: Vec<Note> = notes.load::<Note>(l.conn).map_err(|e| e.to_string())?;
    let all_maps: Vec<Map> = maps::table.load::<Map>(l.conn).map_err(|e| e.to_string())?;
    let all_scenes: Vec<Scene> = scenes::table.load::<Scene>(l.conn).map_err(|e| e.to_string())?;
    let index = crate::search::rebuild_index(l.path, &all_notes, &all_maps, &all_scenes)?;
    state.search_index = Some(index);
    Ok(())
}

#[derive(Serialize, specta::Type, Debug)]
pub struct NotePathResult {
    pub id: i32,
    pub title: String,
    pub content: String,
}

#[tauri::command]
#[specta::specta]
pub fn get_note_by_path(note_path: String, ledger: State<AppLedger>) -> Result<Option<NotePathResult>, String> {
    with_open_ledger(&ledger, |l| {
        // Notes store ledger-relative paths in the DB (e.g. "Characters/Aldric.md").
        // Content is read from disk, not stored in the DB.
        let result = notes
            .filter(path.eq(&note_path))
            .select((id, title))
            .first::<(i32, String)>(l.conn)
            .optional()
            .map_err(|e| e.to_string())?;

        match result {
            None => Ok(None),
            Some((note_id, note_title)) => {
                let full_path = validate_path(l.path, &note_path)?;
                let content = std::fs::read_to_string(&full_path).map_err(|e| e.to_string())?;
                Ok(Some(NotePathResult {
                    id: note_id,
                    title: note_title,
                    content,
                }))
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::establish_connection;
    use crate::ledger::OpenLedger;
    use std::fs;

    /// A ledger on disk with a database beside it, and the `OpenLedger` a command
    /// would have been handed. Nothing here needs `State<AppLedger>` — which is the
    /// point of the resolved struct: the guards below are reachable from a test.
    fn open_ledger_fixture() -> (tempfile::TempDir, SqliteConnection) {
        let dir = tempfile::tempdir().unwrap();
        let conn = establish_connection(dir.path()).expect("migrated database");
        (dir, conn)
    }

    fn seed_note(conn: &mut SqliteConnection, note_path: &str, note_title: &str) -> Note {
        let now = chrono::Utc::now().to_rfc3339();
        diesel::insert_into(notes)
            .values(&NewNote {
                path: note_path,
                title: note_title,
                parent_path: None,
                modified_at: &now,
            })
            .returning(Note::as_returning())
            .get_result(conn)
            .expect("insert note")
    }

    #[test]
    fn renaming_onto_an_existing_file_is_refused_with_err_name_taken() {
        let (dir, mut conn) = open_ledger_fixture();
        fs::write(dir.path().join("Aldric.md"), "# Aldric").unwrap();
        fs::write(dir.path().join("Brenna.md"), "# Brenna").unwrap();
        let mut note = seed_note(&mut conn, "Aldric.md", "Aldric");
        note.path = "Brenna.md".to_string();

        let err = rename_note_inner(
            OpenLedger { path: dir.path(), conn: &mut conn, index: None },
            &note,
            true,
        )
        .err()
        .unwrap();

        assert!(
            err.starts_with("ERR_NAME_TAKEN:"),
            "expected the taken-name code, got: {err}"
        );
        // The refusal happens before anything moves: both files are still there.
        assert!(dir.path().join("Aldric.md").exists());
        assert_eq!(
            fs::read_to_string(dir.path().join("Brenna.md")).unwrap(),
            "# Brenna",
            "the note that already held the name was not overwritten"
        );
    }

    #[test]
    fn renaming_to_a_free_name_moves_the_file_and_re_keys_the_row() {
        let (dir, mut conn) = open_ledger_fixture();
        fs::write(dir.path().join("Aldric.md"), "# Aldric").unwrap();
        let mut note = seed_note(&mut conn, "Aldric.md", "Aldric");
        note.path = "Aldric the Grey.md".to_string();
        note.title = "Aldric the Grey".to_string();

        let result = rename_note_inner(
            OpenLedger { path: dir.path(), conn: &mut conn, index: None },
            &note,
            true,
        )
        .expect("rename");

        assert_eq!(result.note.path, "Aldric the Grey.md");
        assert!(!dir.path().join("Aldric.md").exists());
        assert_eq!(
            fs::read_to_string(dir.path().join("Aldric the Grey.md")).unwrap(),
            "# Aldric"
        );
    }

    #[test]
    fn a_case_only_rename_is_not_a_collision_with_itself() {
        // On Windows and macOS `exists()` on the new path matches the *old* file, so
        // the collision guard has to recognise the rename source as itself.
        let (dir, mut conn) = open_ledger_fixture();
        fs::write(dir.path().join("aldric.md"), "# Aldric").unwrap();
        let mut note = seed_note(&mut conn, "aldric.md", "aldric");
        note.path = "Aldric.md".to_string();
        note.title = "Aldric".to_string();

        let result = rename_note_inner(
            OpenLedger { path: dir.path(), conn: &mut conn, index: None },
            &note,
            true,
        )
        .expect("case-only rename");

        assert_eq!(result.note.path, "Aldric.md");
    }

    #[test]
    fn test_no_conflict() {
        let dir = tempfile::tempdir().unwrap();
        let (resolved_title, full_path) = resolve_note_filename("My Note", dir.path());
        assert_eq!(resolved_title, "My Note");
        assert_eq!(full_path, dir.path().join("My Note.md"));
    }

    #[test]
    fn test_one_conflict() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("Untitled.md"), "").unwrap();
        let (resolved_title, full_path) = resolve_note_filename("Untitled", dir.path());
        assert_eq!(resolved_title, "Untitled 2");
        assert_eq!(full_path, dir.path().join("Untitled 2.md"));
    }

    #[test]
    fn test_multiple_conflicts() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("Untitled.md"), "").unwrap();
        fs::write(dir.path().join("Untitled 2.md"), "").unwrap();
        let (resolved_title, full_path) = resolve_note_filename("Untitled", dir.path());
        assert_eq!(resolved_title, "Untitled 3");
        assert_eq!(full_path, dir.path().join("Untitled 3.md"));
    }
}
