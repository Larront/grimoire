// Disk-to-DB reconciliation for the notes table.
//
// Called once at open_ledger time. Walks the on-disk tree and brings the
// `notes` table into agreement with what is actually present on disk.
// Must run before rebuild_note_tags_from_ledger / rebuild_note_links_from_ledger
// so those passes see fully-populated notes rows.

use crate::db::models::NewNote;
use crate::db::schema::notes::dsl as n;
use diesel::prelude::*;
use diesel::SqliteConnection;
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::Path;

#[derive(Serialize, specta::Type, Debug)]
pub struct FailedImport {
    pub path: String,
    pub reason: String,
}

#[derive(Serialize, specta::Type, Debug)]
pub struct ImportReport {
    pub failed: Vec<FailedImport>,
}

/// Walk `ledger_path`, sync the `notes` table to match disk, and return
/// any per-file soft failures. Does not abort on individual file errors.
pub fn reconcile_notes_with_disk(
    ledger_path: &Path,
    conn: &mut SqliteConnection,
) -> Result<ImportReport, String> {
    let mut failed: Vec<FailedImport> = Vec::new();
    let mut disk_files: Vec<(String, String)> = Vec::new();

    collect_md_files(ledger_path, "", &mut disk_files, &mut failed);

    let existing_paths: Vec<String> = n::notes
        .select(n::path)
        .load::<String>(conn)
        .map_err(|e| e.to_string())?;

    let existing_set: HashSet<String> = existing_paths.into_iter().collect();
    let disk_set: HashSet<String> = disk_files.iter().map(|(p, _)| p.clone()).collect();

    let to_delete: Vec<String> = existing_set
        .iter()
        .filter(|p| !disk_set.contains(*p))
        .cloned()
        .collect();

    let to_insert: Vec<(String, String)> = disk_files
        .into_iter()
        .filter(|(p, _)| !existing_set.contains(p))
        .collect();

    conn.transaction::<_, diesel::result::Error, _>(|c| {
        for batch in to_delete.chunks(100) {
            let paths: Vec<&str> = batch.iter().map(|s| s.as_str()).collect();
            diesel::delete(n::notes.filter(n::path.eq_any(paths))).execute(c)?;
        }

        for (rel_path, mtime) in &to_insert {
            let title = title_from_path(rel_path);
            let parent = parent_path_from(rel_path);
            let new_note = NewNote {
                path: rel_path,
                title: &title,
                parent_path: parent.as_deref(),
                modified_at: mtime,
            };
            diesel::insert_into(n::notes).values(&new_note).execute(c)?;
        }

        Ok(())
    })
    .map_err(|e| e.to_string())?;

    Ok(ImportReport { failed })
}

fn collect_md_files(
    dir: &Path,
    relative: &str,
    out: &mut Vec<(String, String)>,
    failed: &mut Vec<FailedImport>,
) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let entry_path = entry.path();
        let child_rel = if relative.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", relative, name)
        };
        if entry_path.is_dir() {
            collect_md_files(&entry_path, &child_rel, out, failed);
        } else if name.ends_with(".md") {
            match fs::metadata(&entry_path) {
                Ok(meta) => {
                    let mtime = meta
                        .modified()
                        .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339())
                        .unwrap_or_else(|_| chrono::Utc::now().to_rfc3339());
                    out.push((child_rel, mtime));
                }
                Err(e) => {
                    failed.push(FailedImport {
                        path: child_rel,
                        reason: e.to_string(),
                    });
                }
            }
        }
    }
}

/// Count `.pdf` files in the ledger tree. PDFs are loose, path-addressed files
/// with no DB row (ADR-0011), so they aren't in the `notes` table — this walk is
/// how they get folded into the note count shown on the welcome screen. Mirrors
/// `collect_md_files`'s dotfile-skipping traversal, so `.grimoire/audio` and other
/// hidden dirs are excluded.
pub fn count_pdf_files(dir: &Path) -> usize {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return 0,
    };
    let mut count = 0;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            count += count_pdf_files(&path);
        } else if name.to_lowercase().ends_with(".pdf") {
            count += 1;
        }
    }
    count
}

/// Derive a note's display title from its ledger-relative path: the filename
/// stem. Shared with the ledger watcher, which inserts rows for notes created
/// on disk outside the app (ADR-0013).
pub(crate) fn title_from_path(rel_path: &str) -> String {
    rel_path
        .rsplit('/')
        .next()
        .unwrap_or(rel_path)
        .trim_end_matches(".md")
        .to_string()
}

/// Derive a note's `parent_path` (its containing folder) from its
/// ledger-relative path, or `None` for a root-level note. Shared with the
/// ledger watcher (ADR-0013).
pub(crate) fn parent_path_from(rel_path: &str) -> Option<String> {
    let slash = rel_path.rfind('/')?;
    Some(rel_path[..slash].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use diesel::connection::SimpleConnection;
    use diesel::Connection;
    use std::fs;
    use tempfile::TempDir;

    const SCHEMA_SQL: &str = "
        PRAGMA foreign_keys = ON;
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
        CREATE TABLE note_aliases (
            note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
            alias TEXT NOT NULL,
            PRIMARY KEY (note_id, alias)
        );
        CREATE TABLE note_links (
            source_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
            target_path TEXT NOT NULL,
            PRIMARY KEY (source_id, target_path)
        );
        CREATE TABLE maps (
            id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
            title TEXT NOT NULL DEFAULT 'Untitled',
            image_path TEXT,
            image_width INTEGER,
            image_height INTEGER,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            modified_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE pin_categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
            map_id INTEGER REFERENCES maps(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            icon TEXT NOT NULL DEFAULT 'map-pin',
            color TEXT NOT NULL DEFAULT '#888888',
            shape TEXT NOT NULL DEFAULT 'circle'
        );
        CREATE TABLE pins (
            id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
            map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
            x REAL NOT NULL,
            y REAL NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            category_id INTEGER REFERENCES pin_categories(id) ON DELETE SET NULL,
            note_id INTEGER REFERENCES notes(id) ON DELETE SET NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    ";

    fn test_conn() -> SqliteConnection {
        let mut conn =
            SqliteConnection::establish(":memory:").expect("failed to open in-memory db");
        conn.batch_execute(SCHEMA_SQL).expect("create tables");
        conn
    }

    fn note_paths(conn: &mut SqliteConnection) -> Vec<String> {
        let mut paths: Vec<String> = n::notes.select(n::path).load::<String>(conn).unwrap();
        paths.sort();
        paths
    }

    #[derive(diesel::QueryableByName)]
    struct CountRow {
        #[diesel(sql_type = diesel::sql_types::BigInt)]
        count: i64,
    }

    fn count_rows(conn: &mut SqliteConnection, table: &str) -> i64 {
        diesel::sql_query(format!("SELECT COUNT(*) as count FROM {table}"))
            .load::<CountRow>(conn)
            .unwrap()
            .into_iter()
            .next()
            .map(|r| r.count)
            .unwrap_or(0)
    }

    #[derive(diesel::QueryableByName)]
    struct NullableIntRow {
        #[diesel(sql_type = diesel::sql_types::Nullable<diesel::sql_types::Integer>)]
        val: Option<i32>,
    }

    #[test]
    fn empty_folder_yields_no_rows() {
        let dir = TempDir::new().unwrap();
        let mut conn = test_conn();
        let report = reconcile_notes_with_disk(dir.path(), &mut conn).unwrap();
        assert!(report.failed.is_empty());
        assert!(note_paths(&mut conn).is_empty());
    }

    #[test]
    fn populated_folder_inserts_notes() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("Dragon.md"), "# Dragon").unwrap();
        fs::create_dir(dir.path().join("Bestiary")).unwrap();
        fs::write(dir.path().join("Bestiary").join("Goblin.md"), "").unwrap();

        let mut conn = test_conn();
        let report = reconcile_notes_with_disk(dir.path(), &mut conn).unwrap();
        assert!(report.failed.is_empty());
        let paths = note_paths(&mut conn);
        assert_eq!(paths.len(), 2);
        assert!(paths.contains(&"Dragon.md".to_string()));
        assert!(paths.contains(&"Bestiary/Goblin.md".to_string()));
    }

    #[test]
    fn idempotent_reopen_no_churn() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("Note.md"), "").unwrap();
        let mut conn = test_conn();
        reconcile_notes_with_disk(dir.path(), &mut conn).unwrap();
        let before = note_paths(&mut conn);

        reconcile_notes_with_disk(dir.path(), &mut conn).unwrap();
        let after = note_paths(&mut conn);
        assert_eq!(before, after);
    }

    #[test]
    fn filename_stem_used_as_title() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("My Note.md"), "no frontmatter").unwrap();
        let mut conn = test_conn();
        reconcile_notes_with_disk(dir.path(), &mut conn).unwrap();

        let title: String = n::notes.select(n::title).first(&mut conn).unwrap();
        assert_eq!(title, "My Note");
    }

    #[test]
    fn nested_parent_path_is_correct() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join("Bestiary").join("Dragons")).unwrap();
        fs::write(
            dir.path().join("Bestiary").join("Dragons").join("Red.md"),
            "",
        )
        .unwrap();

        let mut conn = test_conn();
        reconcile_notes_with_disk(dir.path(), &mut conn).unwrap();

        let parent: Option<String> = n::notes.select(n::parent_path).first(&mut conn).unwrap();
        assert_eq!(parent, Some("Bestiary/Dragons".to_string()));
    }

    #[test]
    fn root_note_has_no_parent_path() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("Root.md"), "").unwrap();
        let mut conn = test_conn();
        reconcile_notes_with_disk(dir.path(), &mut conn).unwrap();

        let parent: Option<String> = n::notes.select(n::parent_path).first(&mut conn).unwrap();
        assert_eq!(parent, None);
    }

    #[test]
    fn dot_dirs_are_skipped() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join(".grimoire")).unwrap();
        fs::write(dir.path().join(".grimoire").join("hidden.md"), "").unwrap();
        fs::write(dir.path().join("visible.md"), "").unwrap();

        let mut conn = test_conn();
        reconcile_notes_with_disk(dir.path(), &mut conn).unwrap();

        let paths = note_paths(&mut conn);
        assert_eq!(paths, vec!["visible.md".to_string()]);
    }

    #[test]
    fn orphan_row_deleted_on_reconcile() {
        let dir = TempDir::new().unwrap();
        let note_path = dir.path().join("Orphan.md");
        fs::write(&note_path, "").unwrap();

        let mut conn = test_conn();
        reconcile_notes_with_disk(dir.path(), &mut conn).unwrap();
        assert_eq!(note_paths(&mut conn).len(), 1);

        fs::remove_file(&note_path).unwrap();
        reconcile_notes_with_disk(dir.path(), &mut conn).unwrap();
        assert!(note_paths(&mut conn).is_empty());
    }

    #[test]
    fn orphan_deletion_cascades_note_links() {
        let dir = TempDir::new().unwrap();
        let note_path = dir.path().join("A.md");
        fs::write(&note_path, "").unwrap();

        let mut conn = test_conn();
        reconcile_notes_with_disk(dir.path(), &mut conn).unwrap();

        // Insert a link row referencing the note
        let note_id: i32 = n::notes.select(n::id).first(&mut conn).unwrap();
        conn.batch_execute(&format!(
            "INSERT INTO note_links (source_id, target_path) VALUES ({note_id}, 'B.md')"
        ))
        .unwrap();
        assert_eq!(count_rows(&mut conn, "note_links"), 1);

        fs::remove_file(&note_path).unwrap();
        reconcile_notes_with_disk(dir.path(), &mut conn).unwrap();

        assert_eq!(count_rows(&mut conn, "note_links"), 0);
    }

    #[test]
    fn orphan_deletion_sets_pin_note_id_null() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("A.md"), "").unwrap();

        let mut conn = test_conn();
        reconcile_notes_with_disk(dir.path(), &mut conn).unwrap();

        let note_id: i32 = n::notes.select(n::id).first(&mut conn).unwrap();
        conn.batch_execute(&format!(
            "INSERT INTO maps (id, title) VALUES (1, 'M');
             INSERT INTO pins (id, map_id, x, y, title, note_id)
             VALUES (1, 1, 0.0, 0.0, 'P', {note_id});"
        ))
        .unwrap();

        fs::remove_file(dir.path().join("A.md")).unwrap();
        reconcile_notes_with_disk(dir.path(), &mut conn).unwrap();

        let pin_note_id = diesel::sql_query("SELECT note_id as val FROM pins WHERE id = 1")
            .load::<NullableIntRow>(&mut conn)
            .unwrap()
            .into_iter()
            .next()
            .and_then(|r| r.val);
        assert_eq!(pin_note_id, None);
    }

    #[test]
    fn soft_failure_fields_are_populated() {
        let report = ImportReport {
            failed: vec![FailedImport {
                path: "bad.md".to_string(),
                reason: "permission denied".to_string(),
            }],
        };
        assert_eq!(report.failed.len(), 1);
        assert_eq!(report.failed[0].path, "bad.md");
        assert!(report.failed[0].reason.contains("permission denied"));
    }

    #[test]
    fn modified_at_is_rfc3339() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("Note.md"), "").unwrap();
        let mut conn = test_conn();
        reconcile_notes_with_disk(dir.path(), &mut conn).unwrap();

        let modified_at: String = n::notes.select(n::modified_at).first(&mut conn).unwrap();
        assert!(
            modified_at.contains('T'),
            "modified_at not RFC3339: {modified_at}"
        );
    }

    #[test]
    fn count_pdf_files_recurses_skips_dotdirs_and_is_case_insensitive() {
        let dir = TempDir::new().unwrap();
        // Top-level PDFs, mixed case.
        fs::write(dir.path().join("Manual.pdf"), "").unwrap();
        fs::write(dir.path().join("Errata.PDF"), "").unwrap();
        // Nested PDF in a real subfolder — must be counted.
        let sub = dir.path().join("lore");
        fs::create_dir(&sub).unwrap();
        fs::write(sub.join("Backstory.pdf"), "").unwrap();
        // Non-PDFs and hidden dirs (e.g. .grimoire/audio) — must be ignored.
        fs::write(dir.path().join("Session.md"), "").unwrap();
        let hidden = dir.path().join(".grimoire").join("audio");
        fs::create_dir_all(&hidden).unwrap();
        fs::write(hidden.join("theme.pdf"), "").unwrap();

        assert_eq!(count_pdf_files(dir.path()), 3);
    }

    #[test]
    fn count_pdf_files_missing_dir_is_zero() {
        let dir = TempDir::new().unwrap();
        assert_eq!(count_pdf_files(&dir.path().join("nope")), 0);
    }
}
