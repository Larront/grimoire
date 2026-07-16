//! note_mutation — the write-and-reconcile envelope every non-rename note write
//! routes through.
//!
//! Saving a note to disk is always the same recipe: write the bytes through the
//! [`crate::note_write`] Write Chokepoint (so the Ledger Watcher can recognise
//! the app's own echo) and then reconcile the four Derived Indexes against the
//! new content via [`crate::note_index`]. Before this module that recipe was
//! hand-copied across `notes.rs`, `links.rs`, and `tags.rs`, and the copies
//! drifted — most visibly the bulk retag path wrote with raw `fs::write`,
//! bypassing echo suppression.
//!
//! This module owns the envelope; it depends on `note_write` and `note_index`
//! and deliberately does **not** teach `note_index` to write note bytes. Path
//! resolution and the canonical `notes` row insert/update stay in the command —
//! only the write+reconcile step lives here.
//!
//! Functions are free functions taking the already-field-split
//! `(conn, index, ledger_path, …)`, matching `note_index`'s style, so a command
//! splits its `LedgerState` borrow once and passes the refs in.
//!
//! `rename` (path change + backlink rewrite) and `delete` (a removal, not a
//! write) are deliberately **not** here — see the parent spec (#131).

use crate::db::models::Note;
use crate::note_index::{self, ReconcileManyItem};
use crate::note_write::write_note_file;
use diesel::SqliteConnection;
use std::path::{Path, PathBuf};

/// Write `content` to `full_path` through the Write Chokepoint, then reconcile
/// all four Derived Indexes against it.
///
/// Takes **no `prev_path`**: only `rename` changes a note's path, so every
/// commit writes to the note's current path and the reconcile never re-keys.
/// Used by content save, tag write, and alias write.
pub fn commit(
    conn: &mut SqliteConnection,
    index: Option<&tantivy::Index>,
    ledger_path: &Path,
    full_path: &Path,
    note: &Note,
    content: &str,
) -> Result<(), String> {
    write_note_file(full_path, content.as_bytes())?;
    let outcome = note_index::reconcile(conn, index, note, content, None)?;
    note_index::mark_stale_if_needed(&outcome, ledger_path);
    Ok(())
}

/// Like [`commit`], but for a save whose note may have no `notes` row.
///
/// The content and tag save commands look their note up by path and can come
/// back empty (a `.md` file with no tracked entity). When `note` is `Some`,
/// this is exactly [`commit`]; when `None`, the bytes are still persisted
/// through the Write Chokepoint — there is a file to write — but there is
/// nothing to reconcile against. Keeping the fallback here means the
/// "every note write goes through the chokepoint" rule lives in the module
/// that owns the envelope, not copied into each command.
pub fn commit_or_write(
    conn: &mut SqliteConnection,
    index: Option<&tantivy::Index>,
    ledger_path: &Path,
    full_path: &Path,
    note: Option<&Note>,
    content: &str,
) -> Result<(), String> {
    match note {
        Some(note) => commit(conn, index, ledger_path, full_path, note, content),
        None => write_note_file(full_path, content.as_bytes()),
    }
}

/// Write a brand-new note's initial content and reconcile it.
///
/// The same envelope as [`commit`] — a new note is just a commit whose prior
/// derived-index rows happen to be empty — but named for its call site so
/// `create_note` / `create_note_from_template` read clearly. `content` is empty
/// for a blank note or the template body for a template note; the command has
/// already resolved the path and inserted the `notes` row.
pub fn create(
    conn: &mut SqliteConnection,
    index: Option<&tantivy::Index>,
    ledger_path: &Path,
    full_path: &Path,
    note: &Note,
    content: &str,
) -> Result<(), String> {
    commit(conn, index, ledger_path, full_path, note, content)
}

/// One note in a [`commit_many`] batch: the bytes to write and the row to
/// reconcile them against.
pub struct CommitItem {
    pub full_path: PathBuf,
    pub note: Note,
    pub content: String,
}

/// Bulk write-and-reconcile: write every item's content through the Write
/// Chokepoint, then issue a single batched `reconcile_many` (one SQLite
/// transaction, one Tantivy commit).
///
/// This is the retag fix: the ledger-wide tag rewrite now writes through the
/// chokepoint like every other write, so the Ledger Watcher recognises the
/// app's own bulk writes as echoes instead of re-reading them as external
/// edits. Like `commit`, every write is to the note's current path — no
/// `prev_path`.
pub fn commit_many(
    conn: &mut SqliteConnection,
    index: Option<&tantivy::Index>,
    ledger_path: &Path,
    items: Vec<CommitItem>,
) -> Result<(), String> {
    for item in &items {
        write_note_file(&item.full_path, item.content.as_bytes())?;
    }

    let reconcile_items: Vec<ReconcileManyItem> = items
        .into_iter()
        .map(|item| ReconcileManyItem {
            note: item.note,
            content: item.content,
            prev_path: None,
        })
        .collect();

    let outcome = note_index::reconcile_many(conn, index, &reconcile_items)?;
    note_index::mark_stale_if_needed(&outcome, ledger_path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::Note;
    use crate::db::schema::note_aliases::dsl as na;
    use crate::db::schema::note_links::dsl as nl;
    use crate::db::schema::note_tags::dsl as nt;
    use diesel::connection::SimpleConnection;
    use diesel::prelude::*;
    use diesel::Connection;
    use tempfile::TempDir;

    // Same integration-style harness as note_index's suite: a real temp SQLite
    // connection and a real temp Tantivy index, driving the module interface.
    fn test_conn() -> SqliteConnection {
        let mut conn = SqliteConnection::establish(":memory:").expect("in-memory db");
        conn.batch_execute(
            "PRAGMA foreign_keys = ON;
            CREATE TABLE notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                path TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                icon TEXT,
                cover_image TEXT,
                parent_path TEXT,
                archived INTEGER NOT NULL DEFAULT 0,
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
            );",
        )
        .expect("create tables");
        conn
    }

    fn make_note(id: i32, path: &str) -> Note {
        Note {
            id,
            path: path.to_string(),
            title: "Test Note".to_string(),
            icon: None,
            cover_image: None,
            parent_path: None,
            archived: false,
            modified_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    fn insert_note(conn: &mut SqliteConnection, note: &Note) {
        conn.batch_execute(&format!(
            "INSERT INTO notes (id, path, title) VALUES ({}, '{}', '{}')",
            note.id, note.path, note.title
        ))
        .unwrap();
    }

    // ── create ────────────────────────────────────────────────────────────────

    #[test]
    fn create_writes_bytes_through_the_chokepoint_and_reconciles() {
        let dir = TempDir::new().unwrap();
        let index = crate::search::rebuild_index(dir.path(), &[], &[], &[]).unwrap();
        let mut conn = test_conn();
        let note = make_note(1, "ash.md");
        insert_note(&mut conn, &note);

        let full_path = dir.path().join("ash.md");
        let content = "---\ntags: [npc]\naliases: [Ash]\n---\nSee [[dragon.md]].";
        create(&mut conn, Some(&index), dir.path(), &full_path, &note, content).unwrap();

        // Bytes landed on disk...
        assert_eq!(std::fs::read_to_string(&full_path).unwrap(), content);
        // ...and were recorded by the Write Chokepoint (this is the echo the
        // Ledger Watcher suppresses). `is_recent_write` consumes the record.
        assert!(
            crate::note_write::is_recent_write(&full_path, content.as_bytes()),
            "create must write through the chokepoint so the watcher can suppress the echo"
        );

        // The four Derived Indexes agree with content.
        assert_eq!(
            nt::note_tags.select(nt::tag).load::<String>(&mut conn).unwrap(),
            vec!["npc"]
        );
        assert_eq!(
            na::note_aliases.select(na::alias).load::<String>(&mut conn).unwrap(),
            vec!["Ash"]
        );
        assert_eq!(
            nl::note_links.select(nl::target_path).load::<String>(&mut conn).unwrap(),
            vec!["dragon.md"]
        );
        let hits =
            crate::search::search_notes_in_index(&index, dir.path(), "tag:npc", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, 1);
    }

    #[test]
    fn create_with_empty_content_writes_empty_file_and_no_facets() {
        let dir = TempDir::new().unwrap();
        let mut conn = test_conn();
        let note = make_note(1, "blank.md");
        insert_note(&mut conn, &note);

        let full_path = dir.path().join("blank.md");
        create(&mut conn, None, dir.path(), &full_path, &note, "").unwrap();

        assert_eq!(std::fs::read_to_string(&full_path).unwrap(), "");
        assert!(nt::note_tags.load::<(String, String)>(&mut conn).unwrap().is_empty());
        assert!(nl::note_links.load::<(i32, String)>(&mut conn).unwrap().is_empty());
    }

    // ── commit ──────────────────────────────────────────────────────────────

    #[test]
    fn commit_rewrites_file_and_refreshes_all_indexes() {
        let dir = TempDir::new().unwrap();
        let index = crate::search::rebuild_index(dir.path(), &[], &[], &[]).unwrap();
        let mut conn = test_conn();
        let note = make_note(1, "ash.md");
        insert_note(&mut conn, &note);

        let full_path = dir.path().join("ash.md");

        // First state.
        commit(
            &mut conn,
            Some(&index),
            dir.path(),
            &full_path,
            &note,
            "---\ntags: [old]\n---\n[[old.md]].",
        )
        .unwrap();

        // Second state fully replaces the first.
        let new_content = "---\ntags: [new]\naliases: [Fresh]\n---\n[[new.md]].";
        commit(&mut conn, Some(&index), dir.path(), &full_path, &note, new_content).unwrap();

        assert_eq!(std::fs::read_to_string(&full_path).unwrap(), new_content);
        assert!(
            crate::note_write::is_recent_write(&full_path, new_content.as_bytes()),
            "commit must write through the chokepoint"
        );

        assert_eq!(
            nt::note_tags.select(nt::tag).load::<String>(&mut conn).unwrap(),
            vec!["new"]
        );
        assert_eq!(
            nl::note_links.select(nl::target_path).load::<String>(&mut conn).unwrap(),
            vec!["new.md"]
        );
        assert_eq!(
            na::note_aliases.select(na::alias).load::<String>(&mut conn).unwrap(),
            vec!["Fresh"]
        );
    }

    #[test]
    fn commit_marks_search_stale_when_no_index_available() {
        let dir = TempDir::new().unwrap();
        std::fs::create_dir_all(dir.path().join(".grimoire")).unwrap();
        let mut conn = test_conn();
        let note = make_note(1, "ash.md");
        insert_note(&mut conn, &note);

        let full_path = dir.path().join("ash.md");
        // No index → reconcile reports search_stale → commit must persist the marker.
        commit(&mut conn, None, dir.path(), &full_path, &note, "body").unwrap();

        assert!(
            note_index::stale_marker_path(dir.path()).exists(),
            "commit must persist the stale marker when the Tantivy write is skipped"
        );
    }

    // ── commit_or_write (save path that may lack a notes row) ─────────────────

    #[test]
    fn commit_or_write_with_note_reconciles_like_commit() {
        let dir = TempDir::new().unwrap();
        let mut conn = test_conn();
        let note = make_note(1, "ash.md");
        insert_note(&mut conn, &note);

        let full_path = dir.path().join("ash.md");
        let content = "---\ntags: [npc]\n---\nBody.";
        commit_or_write(&mut conn, None, dir.path(), &full_path, Some(&note), content).unwrap();

        assert_eq!(std::fs::read_to_string(&full_path).unwrap(), content);
        assert_eq!(
            nt::note_tags.select(nt::tag).load::<String>(&mut conn).unwrap(),
            vec!["npc"]
        );
    }

    #[test]
    fn commit_or_write_without_note_still_writes_through_the_chokepoint() {
        let dir = TempDir::new().unwrap();
        let mut conn = test_conn();

        // No notes row for this path — the bytes must still land on disk and be
        // echo-suppressed, but nothing is reconciled.
        let full_path = dir.path().join("untracked.md");
        let content = "---\ntags: [npc]\n---\nBody.";
        commit_or_write(&mut conn, None, dir.path(), &full_path, None, content).unwrap();

        assert_eq!(std::fs::read_to_string(&full_path).unwrap(), content);
        assert!(
            crate::note_write::is_recent_write(&full_path, content.as_bytes()),
            "the no-row fallback must still route through the Write Chokepoint"
        );
        assert!(
            nt::note_tags.load::<(String, String)>(&mut conn).unwrap().is_empty(),
            "no notes row means nothing to reconcile"
        );
    }

    // ── commit_many (the retag path) ──────────────────────────────────────────

    #[test]
    fn commit_many_writes_every_file_through_the_chokepoint() {
        let dir = TempDir::new().unwrap();
        let index = crate::search::rebuild_index(dir.path(), &[], &[], &[]).unwrap();
        let mut conn = test_conn();
        let note1 = make_note(1, "a.md");
        let note2 = make_note(2, "b.md");
        insert_note(&mut conn, &note1);
        insert_note(&mut conn, &note2);

        let path1 = dir.path().join("a.md");
        let path2 = dir.path().join("b.md");
        let content1 = "---\ntags: [monster]\n---\nBody A.";
        let content2 = "---\ntags: [monster]\n---\nBody B.";

        let items = vec![
            CommitItem { full_path: path1.clone(), note: note1, content: content1.to_string() },
            CommitItem { full_path: path2.clone(), note: note2, content: content2.to_string() },
        ];
        commit_many(&mut conn, Some(&index), dir.path(), items).unwrap();

        // Both files written, and both echo-suppressed — this is the retag fix:
        // a ledger-wide retag must not be re-read by the watcher as external edits.
        assert_eq!(std::fs::read_to_string(&path1).unwrap(), content1);
        assert_eq!(std::fs::read_to_string(&path2).unwrap(), content2);
        assert!(
            crate::note_write::is_recent_write(&path1, content1.as_bytes()),
            "bulk write must be echo-suppressed"
        );
        assert!(
            crate::note_write::is_recent_write(&path2, content2.as_bytes()),
            "bulk write must be echo-suppressed"
        );

        // note_tags agree with content for both.
        let tags: Vec<(String, String)> = {
            let mut r: Vec<(String, String)> = nt::note_tags.load(&mut conn).unwrap();
            r.sort();
            r
        };
        assert_eq!(
            tags,
            vec![
                ("a.md".to_string(), "monster".to_string()),
                ("b.md".to_string(), "monster".to_string()),
            ]
        );
    }

    #[test]
    fn commit_many_empty_batch_is_a_noop() {
        let dir = TempDir::new().unwrap();
        let mut conn = test_conn();
        commit_many(&mut conn, None, dir.path(), vec![]).unwrap();
        assert!(nt::note_tags.load::<(String, String)>(&mut conn).unwrap().is_empty());
    }
}
