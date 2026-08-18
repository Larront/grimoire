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
//! `(conn, index, …)`, matching `note_index`'s style, so a command splits its
//! `LedgerState` borrow once and passes the refs in.
//!
//! `rename` (path change + backlink rewrite) lives here too: it is the one
//! implementation shared by the in-app rename and the Ledger Watcher's external
//! move, so the two can never diverge in how they treat backlinks. `delete` (a
//! removal, not a write) is deliberately **not** here — see the parent spec
//! (#131).
//!
//! `relocate_folder` is the set form of that rename, and the one place where
//! this module touches something other than note bytes: a folder move is one
//! `fs::rename` of a directory, so the moment the files arrive is a step in the
//! envelope's own ordering rather than a precondition a caller can satisfy
//! first (#206).

use crate::db::models::Note;
use crate::db::schema::notes::dsl as nd;
use crate::note_index::{self, ReconcileManyItem};
use crate::note_write::write_note_file;
use diesel::prelude::*;
use diesel::SqliteConnection;
use std::collections::HashMap;
use std::fs;
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
    full_path: &Path,
    note: &Note,
    content: &str,
) -> Result<(), String> {
    write_note_file(full_path, content.as_bytes())?;
    note_index::reconcile(conn, index, note, content, None)?;
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
    full_path: &Path,
    note: Option<&Note>,
    content: &str,
) -> Result<(), String> {
    match note {
        Some(note) => commit(conn, index, full_path, note, content),
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
    full_path: &Path,
    note: &Note,
    content: &str,
) -> Result<(), String> {
    commit(conn, index, full_path, note, content)
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

    note_index::reconcile_many(conn, index, &reconcile_items)?;
    Ok(())
}

/// Write and reconcile an already-computed set of backlink rewrites (the
/// plan-to-commit half of phase B): map each `(source, rewritten content)` to a
/// [`CommitItem`] and issue one batched [`commit_many`], returning how many
/// source files were rewritten.
///
/// Shared by [`rename`]'s phase B and the on-demand `apply_backlink_rewrite`
/// command so the mechanics live in one place. Takes the rewrites already
/// collected (via `links::collect_backlink_rewrites_on_conn`) rather than
/// collecting itself: `rename` must collect once — before phase A re-keys the
/// row — and reuse the same plan for its deferred branch, while the command
/// recomputes the plan fresh at apply time.
///
/// A third caller arrived with Scene's format change (#185): a scene rename brings
/// the copy of its name held in every referencing note along with it
/// (`crate::scene_fence`). Its rewrites are not wikilinks, but they are the same
/// thing structurally — a plan of `(note, rewritten content)` pairs — and routing
/// them here is what keeps "only the editor writes note bytes" true in the shape it
/// already had, rather than adding a second writer beside this one.
pub fn commit_backlink_rewrites(
    conn: &mut SqliteConnection,
    index: Option<&tantivy::Index>,
    ledger_path: &Path,
    rewrites: Vec<(Note, String)>,
) -> Result<usize, String> {
    let count = rewrites.len();
    let items: Vec<CommitItem> = rewrites
        .into_iter()
        .map(|(note, content)| CommitItem {
            full_path: ledger_path.join(&note.path),
            note,
            content,
        })
        .collect();
    commit_many(conn, index, items)?;
    Ok(count)
}

/// What phase B did to the notes that linked to the renamed note.
///
/// `Deferred`'s source list is the plan the external-move prompt consumes: the
/// Ledger Watcher reads its length to decide whether to offer a heal, and the
/// `apply_backlink_rewrite` command later recomputes and applies it.
pub enum RenamedBacklinks {
    /// `rewrite_backlinks` was true: phase B ran and rewrote this many source
    /// notes' `[[old path]]` wikilinks (only those whose text actually changed).
    Rewritten(usize),
    /// `rewrite_backlinks` was false: phase B was skipped. These are the
    /// ledger-relative paths of the source notes that still link to the old
    /// path — the plan a caller can offer to apply later (the external-move
    /// prompt). Empty when nothing linked to the old path.
    Deferred(Vec<String>),
}

/// The outcome of a [`rename`]: the re-keyed note row and the disposition of the
/// backlink sources that pointed at it.
pub struct Renamed {
    pub note: Note,
    pub backlinks: RenamedBacklinks,
}

/// Move a note from `old_path` to `new_note.path`, keeping every derived index
/// consistent. The single rename implementation shared by the in-app rename and
/// the Ledger Watcher's external move.
///
/// The note's file must already be at its new location on disk (the in-app
/// command has run `fs::rename`; an external move moved it) and `content` is the
/// note's current content there.
///
/// - **Phase A (always):** re-key the moved note's own row — its `path`, `title`,
///   and `parent_path` follow the file — then reconcile it, passing `old_path`
///   as `prev_path` so the old path's `note_tags` rows are cleared. This is the
///   single place the re-key rule is applied.
/// - **Phase B (`rewrite_backlinks` only):** rewrite every other note's
///   `[[old path]]` wikilinks to the new path and reconcile those sources
///   through [`commit_many`]. When `rewrite_backlinks` is false, phase B is
///   skipped and the affected sources are returned as a
///   [`RenamedBacklinks::Deferred`] plan instead.
///
/// Phase B (or the plan computation) runs **before** phase A re-keys the row, so
/// the backlink resolver still sees the pre-rename state.
pub fn rename(
    conn: &mut SqliteConnection,
    index: Option<&tantivy::Index>,
    ledger_path: &Path,
    old_path: &str,
    new_note: &Note,
    content: &str,
    rewrite_backlinks: bool,
) -> Result<Renamed, String> {
    // Compute the affected sources while the moved note's row still holds
    // `old_path`: the backlink resolver's stem-ownership check resolves against
    // the pre-rename state. Then either apply the rewrites (phase B) or just
    // report the sources as a deferred plan.
    let rewrites = crate::commands::links::collect_backlink_rewrites_on_conn(
        ledger_path,
        conn,
        old_path,
        &new_note.path,
    )?;
    let backlinks = if rewrite_backlinks {
        let count = commit_backlink_rewrites(conn, index, ledger_path, rewrites)?;
        RenamedBacklinks::Rewritten(count)
    } else {
        RenamedBacklinks::Deferred(rewrites.into_iter().map(|(note, _)| note.path).collect())
    };

    // Phase A: re-key exactly the three columns a move changes (using `.eq` so a
    // move to the ledger root correctly nulls `parent_path`), then reconcile the
    // moved note with `prev_path = old_path`.
    let persisted: Note = diesel::update(nd::notes.find(new_note.id))
        .set((
            nd::path.eq(&new_note.path),
            nd::title.eq(&new_note.title),
            nd::parent_path.eq(new_note.parent_path.as_deref()),
        ))
        .returning(Note::as_returning())
        .get_result(conn)
        .map_err(|e| e.to_string())?;

    note_index::reconcile(conn, index, &persisted, content, Some(old_path))?;

    Ok(Renamed {
        note: persisted,
        backlinks,
    })
}

/// Carry a folder from `old_path` to `new_path` with every note under it — the
/// set form of [`rename`], and the one place a folder relocation's ordering is
/// written down.
///
/// It cannot be composed out of [`rename`] calls: that verb's precondition is
/// that the file has already arrived at its new location, and here they all
/// arrive at once, in a single `fs::rename` of the directory. So the move itself
/// happens *inside* this function — between the collect and the write, which is
/// the whole reason the verb exists:
///
/// 1. Read every descendant row and compute where it lands. Every new path is
///    computed here and nowhere else, and a destination another note already
///    holds is refused now, while refusing still costs nothing.
/// 2. Collect the wikilink rewrites the move implies, while every source file is
///    still readable at the path its row names. Computed, not written.
/// 3. `fs::rename` the directory — one atomic operation on one volume, and the
///    only fallible step left once the paths agree. There is deliberately no
///    transaction around this: it could not cover the filesystem half, so it
///    cannot deliver the guarantee that would justify being the only transaction
///    in the write path.
/// 4. Write the rewritten sources through the Write Chokepoint, re-key the moved
///    rows, and reconcile the whole set in one batch — `prev_path` on each moved
///    note is what clears its old path's `note_tags`.
///
/// Steps 1 and 2 write nothing, so a relocation that cannot be completed leaves
/// disk and database exactly as they were.
///
/// Callers resolve **and refuse** their destination first — a folder name a
/// sibling already holds, a move into the folder's own descendant — because
/// those refusals are about the folder, not its notes. `old_path == new_path` is
/// a no-op here rather than a caller's obligation. Returns the number of notes
/// whose wikilinks were rewritten, for the "N notes updated" toast.
pub fn relocate_folder(
    conn: &mut SqliteConnection,
    index: Option<&tantivy::Index>,
    ledger_path: &Path,
    old_path: &str,
    new_path: &str,
) -> Result<usize, String> {
    // Nothing was asked for: a rename to the name it already has, or a move into
    // the folder it already sits in. Leaving the filesystem alone is the whole
    // job — `fs::rename` of a directory onto itself is not portable.
    if old_path == new_path {
        return Ok(0);
    }

    let old_prefix = format!("{old_path}/");
    let new_prefix = format!("{new_path}/");

    // 1. Every descendant and where it lands. The `starts_with` is not
    //    belt-and-braces: `LIKE` matches case-insensitively over ASCII and reads
    //    `_` as a wildcard, so a sibling `session-notes` arrives here when
    //    `session_notes` was asked for — and cutting a fixed prefix off a path
    //    that never carried it corrupts the path.
    let like_pattern = format!("{old_prefix}%");
    let moves: Vec<(Note, String)> = nd::notes
        .filter(nd::path.like(&like_pattern))
        .load::<Note>(conn)
        .map_err(|e| format!("query descendants: {e}"))?
        .into_iter()
        .filter(|note| note.path.starts_with(&old_prefix))
        .map(|note| {
            let landing = format!("{new_prefix}{}", &note.path[old_prefix.len()..]);
            (note, landing)
        })
        .collect();

    // A path another note already holds would fail the `notes.path` unique index
    // partway through step 4, with the directory already moved.
    let destinations: Vec<&String> = moves.iter().map(|(_, landing)| landing).collect();
    let taken: Vec<String> = nd::notes
        .filter(nd::path.eq_any(&destinations))
        .select(nd::path)
        .load(conn)
        .map_err(|e| format!("check destinations: {e}"))?;
    if let Some(occupied) = taken.first() {
        return Err(format!("ERR_PATH_TAKEN: A note already exists at {occupied}"));
    }

    // 2. What the move does to other notes' links. One pass over the whole set,
    //    not one per moved note: a note linking to two notes in this folder must
    //    end up with both rewrites, and a second pass would read its file back
    //    before the first was written.
    let renames: Vec<(String, String)> = moves
        .iter()
        .map(|(note, landing)| (note.path.clone(), landing.clone()))
        .collect();
    let rewrites =
        crate::commands::links::collect_backlink_rewrites_for_moves(ledger_path, conn, &renames)?;
    let rewritten_count = rewrites.len();
    let mut rewritten: HashMap<i32, (Note, String)> = rewrites
        .into_iter()
        .map(|(note, content)| (note.id, (note, content)))
        .collect();

    // 3. The move. Individual files travel with the directory — no per-file
    //    renames are needed, and none would be correct.
    fs::rename(ledger_path.join(old_path), ledger_path.join(new_path))
        .map_err(|e| format!("rename dir: {e}"))?;

    // 4. Re-key each moved row and pair it with its content: the rewritten text
    //    when this note's own links pointed into the folder, otherwise what is
    //    now at its new location.
    let mut items: Vec<ReconcileManyItem> = Vec::with_capacity(moves.len() + rewritten.len());
    for (note, landing) in moves {
        let full_path = ledger_path.join(&landing);
        let content = match rewritten.remove(&note.id) {
            Some((_, new_content)) => {
                write_note_file(&full_path, new_content.as_bytes())?;
                new_content
            }
            None => fs::read_to_string(&full_path).unwrap_or_default(),
        };

        // A descendant's parent is always a folder inside the one that moved, so
        // it follows from the landing path — the direct children whose
        // `parent_path` is the folder itself are not a separate case here.
        let parent = landing.rsplit_once('/').map(|(above, _)| above.to_string());
        let persisted: Note = diesel::update(nd::notes.find(note.id))
            .set((
                nd::path.eq(&landing),
                nd::parent_path.eq(parent.as_deref()),
            ))
            .returning(Note::as_returning())
            .get_result(conn)
            .map_err(|e| format!("re-key '{landing}': {e}"))?;

        items.push(ReconcileManyItem {
            note: persisted,
            content,
            prev_path: Some(note.path),
        });
    }

    // The rewritten sources that stayed where they were.
    for (note, content) in rewritten.into_values() {
        write_note_file(&ledger_path.join(&note.path), content.as_bytes())?;
        items.push(ReconcileManyItem {
            note,
            content,
            prev_path: None,
        });
    }

    note_index::reconcile_many(conn, index, &items)?;

    Ok(rewritten_count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::Note;
    use crate::db::schema::note_aliases::dsl as na;
    use crate::db::schema::note_links::dsl as nl;
    use crate::db::schema::note_tags::dsl as nt;
    use diesel::connection::SimpleConnection;
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
        create(&mut conn, Some(&index), &full_path, &note, content).unwrap();

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
        create(&mut conn, None, &full_path, &note, "").unwrap();

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
            &full_path,
            &note,
            "---\ntags: [old]\n---\n[[old.md]].",
        )
        .unwrap();

        // Second state fully replaces the first.
        let new_content = "---\ntags: [new]\naliases: [Fresh]\n---\n[[new.md]].";
        commit(&mut conn, Some(&index), &full_path, &note, new_content).unwrap();

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

    /// With no index open there is nothing to write the Search document to, and
    /// that must not cost the GM the save. The miss goes to the log (#205) and the
    /// bytes reach disk, which is the half of the commit that cannot be rebuilt.
    #[test]
    fn commit_without_an_index_still_writes_the_note() {
        let dir = TempDir::new().unwrap();
        std::fs::create_dir_all(dir.path().join(".grimoire")).unwrap();
        let mut conn = test_conn();
        let note = make_note(1, "ash.md");
        insert_note(&mut conn, &note);

        let full_path = dir.path().join("ash.md");
        commit(&mut conn, None, &full_path, &note, "body").unwrap();

        assert_eq!(std::fs::read_to_string(&full_path).unwrap(), "body");
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
        commit_or_write(&mut conn, None, &full_path, Some(&note), content).unwrap();

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
        commit_or_write(&mut conn, None, &full_path, None, content).unwrap();

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
        commit_many(&mut conn, Some(&index), items).unwrap();

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
        let mut conn = test_conn();
        commit_many(&mut conn, None, vec![]).unwrap();
        assert!(nt::note_tags.load::<(String, String)>(&mut conn).unwrap().is_empty());
    }

    // ── rename ────────────────────────────────────────────────────────────────

    /// Seed a moved note (row + file + derived indexes) and a source note whose
    /// body links to it, returning `(index, moved, source)`. The moved note has a
    /// tag so we can prove the phase-A re-key clears the old path's `note_tags`.
    fn seed_rename_fixture(
        conn: &mut SqliteConnection,
        dir: &Path,
    ) -> (tantivy::Index, Note, Note) {
        let index = crate::search::rebuild_index(dir, &[], &[], &[]).unwrap();
        let moved = make_note(1, "Aldric.md");
        let source = make_note(2, "Story.md");
        insert_note(conn, &moved);
        insert_note(conn, &source);

        // The moved note carries a tag (proves the re-key) and its own outbound
        // link (proves reconcile re-derives it at the new path).
        create(
            conn,
            Some(&index),
            &dir.join("Aldric.md"),
            &moved,
            "---\ntags: [npc]\n---\nAldric of the Keep.",
        )
        .unwrap();
        // The source note links to the moved note by full path.
        create(
            conn,
            Some(&index),
            &dir.join("Story.md"),
            &source,
            "The tale of [[Aldric.md]] begins.",
        )
        .unwrap();

        (index, moved, source)
    }

    /// The target row for a rename: same id, new path/title, parent unchanged.
    fn rename_target(moved: &Note, new_path: &str, new_title: &str) -> Note {
        Note {
            path: new_path.to_string(),
            title: new_title.to_string(),
            ..moved.clone()
        }
    }

    #[test]
    fn rename_with_rewrite_true_rewrites_backlinks_and_reports_the_count() {
        let dir = TempDir::new().unwrap();
        let mut conn = test_conn();
        let (index, moved, _source) = seed_rename_fixture(&mut conn, dir.path());

        // Move the moved note's file on disk, as its caller would.
        std::fs::rename(dir.path().join("Aldric.md"), dir.path().join("Aldric 2.md")).unwrap();
        let target = rename_target(&moved, "Aldric 2.md", "Aldric 2");

        let result = rename(
            &mut conn,
            Some(&index),
            dir.path(),
            "Aldric.md",
            &target,
            "---\ntags: [npc]\n---\nAldric of the Keep.",
            true,
        )
        .unwrap();

        // Phase B ran: the one source was rewritten.
        match result.backlinks {
            RenamedBacklinks::Rewritten(n) => assert_eq!(n, 1),
            RenamedBacklinks::Deferred(_) => panic!("expected phase B to run"),
        }
        // The source file on disk now points at the new path...
        assert_eq!(
            std::fs::read_to_string(dir.path().join("Story.md")).unwrap(),
            "The tale of [[Aldric 2.md]] begins."
        );
        // ...and its outbound link row was reconciled to match.
        let links: Vec<String> =
            nl::note_links.select(nl::target_path).load(&mut conn).unwrap();
        assert_eq!(links, vec!["Aldric 2.md"]);
    }

    #[test]
    fn rename_with_rewrite_false_leaves_backlinks_and_returns_the_plan() {
        let dir = TempDir::new().unwrap();
        let mut conn = test_conn();
        let (index, moved, _source) = seed_rename_fixture(&mut conn, dir.path());

        std::fs::rename(dir.path().join("Aldric.md"), dir.path().join("Aldric 2.md")).unwrap();
        let target = rename_target(&moved, "Aldric 2.md", "Aldric 2");

        let result = rename(
            &mut conn,
            Some(&index),
            dir.path(),
            "Aldric.md",
            &target,
            "---\ntags: [npc]\n---\nAldric of the Keep.",
            false,
        )
        .unwrap();

        // Phase B was skipped: the plan lists the affected source, untouched.
        match result.backlinks {
            RenamedBacklinks::Deferred(sources) => assert_eq!(sources, vec!["Story.md"]),
            RenamedBacklinks::Rewritten(_) => panic!("phase B must not run when the bool is false"),
        }
        // The source file is byte-for-byte unchanged — nothing was rewritten.
        assert_eq!(
            std::fs::read_to_string(dir.path().join("Story.md")).unwrap(),
            "The tale of [[Aldric.md]] begins."
        );
        let links: Vec<String> =
            nl::note_links.select(nl::target_path).load(&mut conn).unwrap();
        assert_eq!(links, vec!["Aldric.md"], "the source's link row must be untouched");
    }

    #[test]
    fn rename_always_rekeys_the_moved_note_regardless_of_the_bool() {
        // Phase A runs in both modes: re-key the row and its path-keyed tags.
        for rewrite in [true, false] {
            let dir = TempDir::new().unwrap();
            let mut conn = test_conn();
            let (index, moved, _source) = seed_rename_fixture(&mut conn, dir.path());

            std::fs::rename(dir.path().join("Aldric.md"), dir.path().join("Aldric 2.md")).unwrap();
            let target = rename_target(&moved, "Aldric 2.md", "Aldric 2");

            let result = rename(
                &mut conn,
                Some(&index),
                dir.path(),
                "Aldric.md",
                &target,
                "---\ntags: [npc]\n---\nAldric of the Keep.",
                rewrite,
            )
            .unwrap();

            // The returned row is re-keyed to the new path/title.
            assert_eq!(result.note.path, "Aldric 2.md");
            assert_eq!(result.note.title, "Aldric 2");
            // The row in the DB followed.
            let row: Note = nd::notes.find(1).first(&mut conn).unwrap();
            assert_eq!(row.path, "Aldric 2.md");
            // note_tags are path-keyed: the old path's row was cleared and re-keyed.
            let tag_paths: Vec<String> =
                nt::note_tags.select(nt::note_path).load(&mut conn).unwrap();
            assert_eq!(
                tag_paths, vec!["Aldric 2.md"],
                "phase A must re-key note_tags (rewrite_backlinks = {rewrite})"
            );
        }
    }

    #[test]
    fn rename_to_the_ledger_root_nulls_parent_path() {
        let dir = TempDir::new().unwrap();
        let mut conn = test_conn();
        let index = crate::search::rebuild_index(dir.path(), &[], &[], &[]).unwrap();

        // A note that lives in a subfolder, with parent_path stored non-null.
        std::fs::create_dir_all(dir.path().join("People")).unwrap();
        let mut moved = make_note(1, "People/Aldric.md");
        moved.parent_path = Some("People".to_string());
        conn.batch_execute(
            "INSERT INTO notes (id, path, title, parent_path) \
             VALUES (1, 'People/Aldric.md', 'Aldric', 'People')",
        )
        .unwrap();
        create(&mut conn, Some(&index), &dir.path().join("People/Aldric.md"), &moved, "body")
            .unwrap();
        // Precondition: the row really does start non-null.
        let before: Note = nd::notes.find(1).first(&mut conn).unwrap();
        assert_eq!(before.parent_path, Some("People".to_string()));

        // Move it to the ledger root — parent_path must become NULL, not stay "People".
        std::fs::rename(dir.path().join("People/Aldric.md"), dir.path().join("Aldric.md")).unwrap();
        let target = Note {
            path: "Aldric.md".to_string(),
            title: "Aldric".to_string(),
            parent_path: None,
            ..moved.clone()
        };
        let result =
            rename(&mut conn, Some(&index), dir.path(), "People/Aldric.md", &target, "body", false)
                .unwrap();

        assert_eq!(result.note.parent_path, None);
        let row: Note = nd::notes.find(1).first(&mut conn).unwrap();
        assert_eq!(row.parent_path, None, "a move to root must null parent_path");
    }

    // ── relocate_folder ───────────────────────────────────────────────────────

    #[test]
    fn relocate_folder_carries_its_notes_and_the_links_that_reach_them() {
        let dir = TempDir::new().unwrap();
        let mut conn = test_conn();
        let index = crate::search::rebuild_index(dir.path(), &[], &[], &[]).unwrap();
        fs::create_dir_all(dir.path().join("creatures")).unwrap();

        let dragon = make_note(1, "creatures/dragon.md");
        let wyvern = make_note(2, "creatures/wyvern.md");
        let story = make_note(3, "Story.md");
        for note in [&dragon, &wyvern, &story] {
            insert_note(&mut conn, note);
        }
        // The dragon carries a tag (so the re-key is provable) and links to a
        // neighbour that moves with it.
        create(
            &mut conn,
            Some(&index),
            &dir.path().join("creatures/dragon.md"),
            &dragon,
            "---\ntags: [beast]\n---\nSee [[creatures/wyvern.md]].",
        )
        .unwrap();
        create(
            &mut conn,
            Some(&index),
            &dir.path().join("creatures/wyvern.md"),
            &wyvern,
            "A wyvern.",
        )
        .unwrap();
        // One note outside the folder holding a link to *both* moved notes: the
        // case a pass per moved note gets wrong, because the second pass would
        // read this file back before the first pass's rewrite was written.
        create(
            &mut conn,
            Some(&index),
            &dir.path().join("Story.md"),
            &story,
            "Both [[creatures/dragon.md]] and [[creatures/wyvern.md]].",
        )
        .unwrap();

        let rewritten =
            relocate_folder(&mut conn, Some(&index), dir.path(), "creatures", "beasts").unwrap();

        assert_eq!(
            rewritten, 2,
            "the outside note, and the moved note that linked to its neighbour",
        );
        assert_eq!(
            fs::read_to_string(dir.path().join("Story.md")).unwrap(),
            "Both [[beasts/dragon.md]] and [[beasts/wyvern.md]].",
            "both links in one file follow the move",
        );
        assert_eq!(
            fs::read_to_string(dir.path().join("beasts/dragon.md")).unwrap(),
            "---\ntags: [beast]\n---\nSee [[beasts/wyvern.md]].",
            "a moved note that is also a link source is written at where it landed",
        );
        assert!(!dir.path().join("creatures").exists());

        let rows: Vec<(String, Option<String>)> = nd::notes
            .filter(nd::id.ne(3))
            .select((nd::path, nd::parent_path))
            .order(nd::id)
            .load(&mut conn)
            .unwrap();
        assert_eq!(
            rows,
            vec![
                ("beasts/dragon.md".to_string(), Some("beasts".to_string())),
                ("beasts/wyvern.md".to_string(), Some("beasts".to_string())),
            ],
        );

        let tag_paths: Vec<String> = nt::note_tags.select(nt::note_path).load(&mut conn).unwrap();
        assert_eq!(
            tag_paths,
            vec!["beasts/dragon.md"],
            "the old path's note_tags are cleared by prev_path",
        );

        let mut targets: Vec<String> = nl::note_links
            .select(nl::target_path)
            .load(&mut conn)
            .unwrap();
        targets.sort();
        assert_eq!(
            targets,
            vec![
                "beasts/dragon.md",
                "beasts/wyvern.md",
                "beasts/wyvern.md",
            ],
            "every link row is re-derived from the rewritten text",
        );
    }

    #[test]
    fn relocate_folder_refuses_a_destination_a_note_holds_before_moving_anything() {
        let dir = TempDir::new().unwrap();
        let mut conn = test_conn();
        fs::create_dir_all(dir.path().join("creatures")).unwrap();
        fs::create_dir_all(dir.path().join("beasts")).unwrap();

        let moving = make_note(1, "creatures/dragon.md");
        let sitting = make_note(2, "beasts/dragon.md");
        for note in [&moving, &sitting] {
            insert_note(&mut conn, note);
            create(&mut conn, None, &dir.path().join(&note.path), note, "Body.").unwrap();
        }

        let err = relocate_folder(&mut conn, None, dir.path(), "creatures", "beasts")
            .expect_err("a landing path another note already holds is refused");
        assert!(err.starts_with("ERR_PATH_TAKEN"), "got: {err}");

        assert!(
            dir.path().join("creatures/dragon.md").is_file(),
            "the refusal lands before the directory moves",
        );
        let row: Note = nd::notes.find(1).first(&mut conn).unwrap();
        assert_eq!(row.path, "creatures/dragon.md", "and before any row is re-keyed");
    }
}
