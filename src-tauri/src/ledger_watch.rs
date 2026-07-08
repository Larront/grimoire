//! The backend file watcher that keeps the ledger live-synced with on-disk
//! `.md` edits made outside the app (ADR-0013).
//!
//! A recursive `notify` watcher, rooted at the open ledger, reports filesystem
//! events; the debouncer coalesces atomic-save churn over a short window. It
//! keeps the `notes` table, the [`crate::note_index`] Derived Index set, and the
//! Files tree in sync with external **create / modify / delete / rename** of
//! `.md` files:
//!
//! - `<ledger>/.grimoire/` (SQLite/Tantivy/media) and every other dot-segment is
//!   excluded, matching the traversal convention used elsewhere, so the app's own
//!   internal writes never generate work.
//! - The app's *own* `.md` writes are dropped via the content-hash registry in
//!   [`crate::note_write`]: on each event we re-read the file and ask whether its
//!   bytes are one we just wrote. A match is our echo; a differing hash is a
//!   genuine external edit.
//! - Each event path is classified by whether it still exists on disk. A path
//!   that exists is an **upsert**: a note with an existing `notes` row reconciles
//!   its derived indexes (emit `note:content-changed` `{path}`); a note with no
//!   row is a create — insert the row, reconcile, and emit `ledger:tree-changed`.
//!   A path that is gone is a **remove**: drop the `notes` row and its derived
//!   indexes and emit `note:removed` `{path}`.
//! - A rename/move surfaces either as a native `notify` rename (whose `from` and
//!   `to` paths are processed independently) or as a delete+create pair; both
//!   resolve to remove-old + create-new here, so the tree follows the file to its
//!   new location. Following a rename *while the note is open* is a later slice.
//!
//! When a single coalesced batch touches more than [`BULK_REBUILD_THRESHOLD`]
//! distinct notes — a `git checkout`, a cloud-sync settling, a vault-wide
//! find-replace — reconciling each file individually would issue that many
//! Tantivy commits and frontend events. Above the threshold the batch instead
//! falls back to the same idempotent disk→DB sync + full derived-index rebuild
//! `open_ledger` runs ([`rebuild_all`]) and emits one coarse `ledger:rebuilt`
//! event the frontend refetches wholesale on.
//!
//! The watcher handle lives in its own managed [`LedgerWatcher`] state rather
//! than on `LedgerState`: the event handler locks `AppLedger`, so keeping the
//! debouncer out of that same mutex avoids any lock-ordering hazard. Replacing
//! the handle drops the previous debouncer, and its `Drop` only *signals* its
//! thread to stop (it does not join), so tearing a watcher down never blocks.

use crate::ledger::AppLedger;
use crate::commands::import::{parent_path_from, title_from_path};
use crate::db::models::{NewNote, Note};
use diesel::prelude::*;
use diesel::SqliteConnection;
use notify_debouncer_full::notify::{EventKind, RecursiveMode};
use notify_debouncer_full::{
    new_debouncer, notify::RecommendedWatcher, DebounceEventResult, Debouncer, RecommendedCache,
};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// Debounce window. Long enough to collapse an atomic save's write/rename churn
/// into one event, short enough that a live edit still feels immediate.
const DEBOUNCE_MS: u64 = 150;

/// Above this many distinct external `.md` changes in one debounced batch, the
/// per-file path (one Tantivy commit + one frontend event apiece) is abandoned
/// for a single [`rebuild_all`] + one coarse `ledger:rebuilt` event — the bulk-op
/// fallback (ADR-0013). Tune both the window and this threshold here.
const BULK_REBUILD_THRESHOLD: usize = 50;

type LedgerDebouncer = Debouncer<RecommendedWatcher, RecommendedCache>;

/// Managed state holding the single active ledger watcher (or none). Dropping
/// the debouncer stops it, so ledger switch/close is just a `None` assignment.
#[derive(Default)]
pub struct LedgerWatcher(pub Mutex<Option<LedgerDebouncer>>);

/// Payload for the `note:content-changed` event: the ledger-relative path of the
/// note whose `.md` file changed on disk.
#[derive(Clone, serde::Serialize)]
struct NoteContentChanged {
    path: String,
}

/// Payload for the `note:removed` event: the ledger-relative path of the note
/// whose `.md` file was deleted or moved away on disk.
#[derive(Clone, serde::Serialize)]
struct NoteRemoved {
    path: String,
}

/// Start (or re-root) the ledger watcher on `ledger_path`, replacing any watcher
/// from a previously-open ledger. Best-effort: a watcher that can't be built or
/// rooted is logged and skipped — live-sync degrades, the app keeps working.
pub fn start(app: &AppHandle, ledger_path: &Path) {
    // Canonicalize the root once so event paths (which we also canonicalize) can
    // be stripped to a ledger-relative path and compared against the open ledger.
    let canonical_root = match std::fs::canonicalize(ledger_path) {
        Ok(p) => p,
        Err(e) => {
            log::warn!(
                "[ledger_watch] cannot canonicalize ledger root {}: {e}; watcher not started",
                ledger_path.display()
            );
            return;
        }
    };

    let handler_app = app.clone();
    let handler_root = canonical_root.clone();
    let debouncer = new_debouncer(
        Duration::from_millis(DEBOUNCE_MS),
        None,
        move |result: DebounceEventResult| {
            let events = match result {
                Ok(events) => events,
                Err(errors) => {
                    for e in errors {
                        log::warn!("[ledger_watch] watch error: {e:?}");
                    }
                    return;
                }
            };
            // A debounced batch can carry several events per path; classify each
            // touched path at most once. Classifying up front (existence check,
            // content read, echo suppression) is also what lets us count *genuine*
            // external changes — the app's own bulk writes, e.g. a rename's
            // backlink rewrites, are dropped here and never trip the threshold.
            let mut seen: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
            let mut changes: Vec<Change> = Vec::new();
            for event in &events {
                // Access (open/read) events never change content — ignore them.
                if matches!(event.kind, EventKind::Access(_)) {
                    continue;
                }
                for path in &event.paths {
                    if seen.insert(path.clone()) {
                        if let Some(change) = classify(&handler_root, path) {
                            changes.push(change);
                        }
                    }
                }
            }

            if changes.is_empty() {
                return;
            }
            if is_bulk_batch(changes.len()) {
                log::info!(
                    "[ledger_watch] {} external changes >= threshold {}; full rebuild",
                    changes.len(),
                    BULK_REBUILD_THRESHOLD
                );
                rebuild_all(&handler_app, &handler_root);
            } else {
                for change in changes {
                    apply(&handler_app, &handler_root, change);
                }
            }
        },
    );

    let mut debouncer = match debouncer {
        Ok(d) => d,
        Err(e) => {
            log::error!("[ledger_watch] failed to create watcher: {e}");
            return;
        }
    };

    if let Err(e) = debouncer.watch(&canonical_root, RecursiveMode::Recursive) {
        log::error!(
            "[ledger_watch] failed to watch {}: {e}",
            canonical_root.display()
        );
        return;
    }

    // Replacing the slot drops the previous debouncer (stops the old watcher).
    match app.state::<LedgerWatcher>().0.lock() {
        Ok(mut slot) => {
            *slot = Some(debouncer);
            log::info!("[ledger_watch] watching {}", canonical_root.display());
        }
        Err(_) => log::error!("[ledger_watch] watcher state poisoned; watcher not stored"),
    }
}

/// Stop the ledger watcher, if any. Dropping the debouncer signals its thread to
/// stop; it does not block.
pub fn stop(app: &AppHandle) {
    match app.state::<LedgerWatcher>().0.lock() {
        Ok(mut slot) => *slot = None,
        Err(_) => log::error!("[ledger_watch] watcher state poisoned; watcher not stopped"),
    }
}

/// A classified external change to a single `.md` path, with all disk I/O
/// (existence check, content read, echo-suppression) already done — so the
/// ledger lock is only ever held around DB work, never a filesystem read.
enum Change {
    /// The file exists on disk: a create (no `notes` row yet) or a modify.
    Upsert { rel_path: String, content: String },
    /// The file is gone: a delete or the source half of a move.
    Remove { rel_path: String },
}

/// What the frontend must be told after a change is applied.
enum Notify {
    /// An existing note's content changed — the open editor can live-reload.
    ContentChanged(String),
    /// A new note appeared — refetch the Files tree / notes store.
    TreeChanged,
    /// A note was removed — refetch and drop it from the tree.
    Removed(String),
    /// Nothing observable happened (echo already handled, or a no-op remove).
    Nothing,
}

/// Whether a coalesced batch of `n` distinct genuine external changes is a bulk
/// op that should fall back to a single [`rebuild_all`] instead of `n` per-file
/// reconciles. The one place the threshold decision is made.
fn is_bulk_batch(n: usize) -> bool {
    n >= BULK_REBUILD_THRESHOLD
}

/// Classify an event path into an intended [`Change`], performing every
/// filesystem read up front. Returns `None` when the path is out of scope (not a
/// surfaced `.md` note, under a dot-segment, or our own write echo).
fn classify(canonical_root: &Path, event_path: &Path) -> Option<Change> {
    match std::fs::canonicalize(event_path) {
        // The file exists — create or modify.
        Ok(canonical) => {
            let rel_path = relative_md(canonical_root, &canonical)?;
            let bytes = std::fs::read(&canonical).ok()?;
            // The app's own write? Consume the record and stop — no self-triggered
            // reload or re-index loop.
            if crate::note_write::is_recent_write(&canonical, &bytes) {
                return None;
            }
            Some(Change::Upsert {
                rel_path,
                content: String::from_utf8_lossy(&bytes).into_owned(),
            })
        }
        // The file is gone — delete or the `from` half of a move. Its own path
        // can't be canonicalized, so resolve it via the (still-present) parent.
        Err(_) => Some(Change::Remove {
            rel_path: missing_relative_md(canonical_root, event_path)?,
        }),
    }
}

/// Apply a classified [`Change`] under the ledger lock, then emit the matching
/// frontend event. The lock is released before emitting so a frontend listener
/// that turns around and calls a command can't contend with this handler.
fn apply(app: &AppHandle, canonical_root: &Path, change: Change) {
    let ledger = app.state::<AppLedger>();
    let mut guard = match ledger.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    let Some(ledger_path) = guard.path.clone() else {
        return; // no ledger open
    };
    // The ledger may have switched between the event firing and now; only act
    // when the open ledger is still the one this watcher was rooted at.
    if std::fs::canonicalize(&ledger_path).ok().as_deref() != Some(canonical_root) {
        return;
    }

    let notify = {
        let state_ref = &mut *guard;
        let Some(conn) = state_ref.connection.as_mut() else {
            return;
        };
        let index = state_ref.search_index.as_ref();
        match change {
            Change::Upsert { rel_path, content } => {
                match upsert_external_note(conn, index, &ledger_path, &rel_path, &content) {
                    Ok(Upserted::Modified) => Notify::ContentChanged(rel_path),
                    Ok(Upserted::Created) => Notify::TreeChanged,
                    Err(e) => {
                        log::warn!("[ledger_watch] upsert failed for {rel_path}: {e}");
                        Notify::Nothing
                    }
                }
            }
            Change::Remove { rel_path } => {
                match remove_external_note(conn, index, &ledger_path, &rel_path) {
                    Ok(true) => Notify::Removed(rel_path),
                    Ok(false) => Notify::Nothing,
                    Err(e) => {
                        log::warn!("[ledger_watch] remove failed for {rel_path}: {e}");
                        Notify::Nothing
                    }
                }
            }
        }
    };
    drop(guard);

    match notify {
        Notify::ContentChanged(path) => {
            if let Err(e) = app.emit("note:content-changed", NoteContentChanged { path }) {
                log::warn!("[ledger_watch] failed to emit note:content-changed: {e}");
            }
        }
        Notify::TreeChanged => {
            if let Err(e) = app.emit("ledger:tree-changed", ()) {
                log::warn!("[ledger_watch] failed to emit ledger:tree-changed: {e}");
            }
        }
        Notify::Removed(path) => {
            if let Err(e) = app.emit("note:removed", NoteRemoved { path }) {
                log::warn!("[ledger_watch] failed to emit note:removed: {e}");
            }
        }
        Notify::Nothing => {}
    }
}

/// The bulk-op fallback (ADR-0013): a coalesced batch exceeded
/// [`BULK_REBUILD_THRESHOLD`], so rather than reconcile each file (one Tantivy
/// commit apiece) rerun the same two steps `open_ledger` does — bring the `notes`
/// table into agreement with disk (creates/deletes), then rebuild every derived
/// index in one walk — swap in the fresh search index, and emit one coarse
/// `ledger:rebuilt` event. The lock is released before emitting so a frontend
/// listener that turns around and calls a command can't contend with this handler.
fn rebuild_all(app: &AppHandle, canonical_root: &Path) {
    let ledger = app.state::<AppLedger>();
    let mut guard = match ledger.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    let Some(ledger_path) = guard.path.clone() else {
        return; // no ledger open
    };
    // The ledger may have switched between the batch firing and now; only act
    // when the open ledger is still the one this watcher was rooted at.
    if std::fs::canonicalize(&ledger_path).ok().as_deref() != Some(canonical_root) {
        return;
    }

    let rebuilt = {
        let state_ref = &mut *guard;
        let Some(conn) = state_ref.connection.as_mut() else {
            return;
        };
        // Bring the notes table into agreement with disk before the rebuild pass
        // so it sees fully-populated rows — mirrors open_ledger's ordering.
        if let Err(e) = crate::commands::import::reconcile_notes_with_disk(&ledger_path, conn) {
            log::warn!("[ledger_watch] bulk notes reconcile failed: {e}");
            return;
        }
        let maps = crate::db::schema::maps::table
            .load::<crate::db::models::Map>(conn)
            .unwrap_or_default();
        let scenes = crate::db::schema::scenes::table
            .load::<crate::db::models::Scene>(conn)
            .unwrap_or_default();
        match crate::note_index::rebuild_all_from_ledger(&ledger_path, conn, &maps, &scenes) {
            Ok(index) => {
                // A successful rebuild clears any persisted stale marker; a failed
                // Search rebuild (Ok(None)) leaves it so the next launch retries.
                crate::note_index::clear_stale_marker_if_rebuilt(&ledger_path, index.is_some());
                index
            }
            Err(e) => {
                log::warn!("[ledger_watch] bulk rebuild failed: {e}");
                return;
            }
        }
    };
    // `rebuild_all_from_ledger` returns a brand-new Tantivy index handle; swap it
    // in so later per-file reconciles write to the rebuilt index, not a stale one.
    guard.search_index = rebuilt;
    drop(guard);

    if let Err(e) = app.emit("ledger:rebuilt", ()) {
        log::warn!("[ledger_watch] failed to emit ledger:rebuilt: {e}");
    }
}

/// Convert a canonical absolute event path to a ledger-relative, forward-slash
/// note path — or `None` if it escapes the ledger, lives under any dot-segment
/// (e.g. `.grimoire/`), or isn't a `.md` file.
fn relative_md(canonical_root: &Path, canonical_path: &Path) -> Option<String> {
    let rel = canonical_path.strip_prefix(canonical_root).ok()?;
    for component in rel.components() {
        if let Component::Normal(name) = component {
            if name.to_string_lossy().starts_with('.') {
                return None;
            }
        }
    }
    let rel_str = rel.to_string_lossy().replace('\\', "/");
    if !rel_str.ends_with(".md") {
        return None;
    }
    Some(rel_str)
}

/// Ledger-relative `.md` path for an event path that no longer exists on disk (a
/// delete or a move's `from` side), so `canonicalize` on the path itself fails.
/// Canonicalizes the still-present parent directory and rejoins the file name so
/// the same prefix-strip + filtering as [`relative_md`] applies. `None` if the
/// parent is gone too, or the result is out of scope.
fn missing_relative_md(canonical_root: &Path, event_path: &Path) -> Option<String> {
    let parent = event_path.parent()?;
    let file_name = event_path.file_name()?;
    let canonical_parent = std::fs::canonicalize(parent).ok()?;
    relative_md(canonical_root, &canonical_parent.join(file_name))
}

/// Whether an upsert created a new note row or reconciled an existing one.
pub(crate) enum Upserted {
    Created,
    Modified,
}

/// Apply an external create-or-modify of `rel_path` from its on-disk `content`.
/// A note that already has a `notes` row reconciles its derived indexes in place
/// ([`Upserted::Modified`]); a note with no row is inserted with a title/parent
/// derived from its path, then reconciled ([`Upserted::Created`]).
pub(crate) fn upsert_external_note(
    conn: &mut SqliteConnection,
    index: Option<&tantivy::Index>,
    ledger_path: &Path,
    rel_path: &str,
    content: &str,
) -> Result<Upserted, String> {
    use crate::db::schema::notes::dsl as n;

    let maybe_note = n::notes
        .filter(n::path.eq(rel_path))
        .first::<Note>(conn)
        .optional()
        .map_err(|e| e.to_string())?;

    match maybe_note {
        Some(note) => {
            // prev_path == path: same-path reconcile, no re-key (matches write_note_content).
            let outcome = crate::note_index::reconcile(conn, index, &note, content, Some(rel_path))?;
            crate::note_index::mark_stale_if_needed(&outcome, ledger_path);
            Ok(Upserted::Modified)
        }
        None => {
            let now = chrono::Utc::now().to_rfc3339();
            let title = title_from_path(rel_path);
            let parent = parent_path_from(rel_path);
            let new_note = NewNote {
                path: rel_path,
                title: &title,
                parent_path: parent.as_deref(),
                modified_at: &now,
            };
            let created: Note = diesel::insert_into(n::notes)
                .values(&new_note)
                .returning(Note::as_returning())
                .get_result(conn)
                .map_err(|e| e.to_string())?;
            let outcome = crate::note_index::reconcile(conn, index, &created, content, None)?;
            crate::note_index::mark_stale_if_needed(&outcome, ledger_path);
            Ok(Upserted::Created)
        }
    }
}

/// Apply an external delete/move-away of `rel_path`: clear the note's derived
/// indexes (while the row still exists, mirroring `delete_note`) and delete the
/// `notes` row. Returns `Ok(true)` when a row existed and was removed (emit
/// `note:removed`), `Ok(false)` when there was no row (nothing to do).
pub(crate) fn remove_external_note(
    conn: &mut SqliteConnection,
    index: Option<&tantivy::Index>,
    ledger_path: &Path,
    rel_path: &str,
) -> Result<bool, String> {
    use crate::db::schema::notes::dsl as n;

    let maybe_note = n::notes
        .filter(n::path.eq(rel_path))
        .first::<Note>(conn)
        .optional()
        .map_err(|e| e.to_string())?;

    let Some(note) = maybe_note else {
        return Ok(false);
    };

    let outcome = crate::note_index::remove(conn, index, note.id, &note.path)?;
    crate::note_index::mark_stale_if_needed(&outcome, ledger_path);

    diesel::delete(n::notes.find(note.id))
        .execute(conn)
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::note_aliases::dsl as na;
    use crate::db::schema::note_links::dsl as nl;
    use crate::db::schema::note_tags::dsl as nt;
    use diesel::connection::SimpleConnection;
    use diesel::Connection;
    use tempfile::TempDir;

    // ── is_bulk_batch ──────────────────────────────────────────────────────────

    #[test]
    fn small_batches_reconcile_per_file() {
        assert!(!is_bulk_batch(0));
        assert!(!is_bulk_batch(1));
        assert!(!is_bulk_batch(BULK_REBUILD_THRESHOLD - 1));
    }

    #[test]
    fn batches_at_or_over_threshold_are_bulk() {
        assert!(is_bulk_batch(BULK_REBUILD_THRESHOLD));
        assert!(is_bulk_batch(BULK_REBUILD_THRESHOLD + 1));
        assert!(is_bulk_batch(500));
    }

    // ── relative_md ────────────────────────────────────────────────────────────

    #[test]
    fn relative_md_accepts_a_plain_md_note() {
        let root = PathBuf::from("/ledger");
        let path = PathBuf::from("/ledger/Characters/Aldric.md");
        assert_eq!(
            relative_md(&root, &path),
            Some("Characters/Aldric.md".to_string())
        );
    }

    #[test]
    fn relative_md_rejects_grimoire_subtree() {
        let root = PathBuf::from("/ledger");
        let path = PathBuf::from("/ledger/.grimoire/ledger.db");
        assert_eq!(relative_md(&root, &path), None);
    }

    #[test]
    fn relative_md_rejects_any_dot_segment() {
        let root = PathBuf::from("/ledger");
        let path = PathBuf::from("/ledger/.obsidian/workspace.json");
        assert_eq!(relative_md(&root, &path), None);
        // ...even a .md file hidden under a dot dir.
        let hidden_md = PathBuf::from("/ledger/.trash/Note.md");
        assert_eq!(relative_md(&root, &hidden_md), None);
    }

    #[test]
    fn relative_md_rejects_non_md_files() {
        let root = PathBuf::from("/ledger");
        assert_eq!(relative_md(&root, &PathBuf::from("/ledger/map.png")), None);
        assert_eq!(relative_md(&root, &PathBuf::from("/ledger/manual.pdf")), None);
    }

    #[test]
    fn relative_md_rejects_paths_outside_root() {
        let root = PathBuf::from("/ledger");
        assert_eq!(
            relative_md(&root, &PathBuf::from("/elsewhere/Note.md")),
            None
        );
    }

    // ── missing_relative_md ────────────────────────────────────────────────────

    #[test]
    fn missing_relative_md_resolves_a_deleted_note_via_its_parent() {
        // The parent dir must exist for canonicalize(parent) to succeed.
        let root = TempDir::new().unwrap();
        std::fs::create_dir(root.path().join("Characters")).unwrap();
        let canonical_root = std::fs::canonicalize(root.path()).unwrap();
        // The note file itself is already gone (deleted) — only the path remains.
        let deleted = root.path().join("Characters").join("Aldric.md");
        assert_eq!(
            missing_relative_md(&canonical_root, &deleted),
            Some("Characters/Aldric.md".to_string())
        );
    }

    #[test]
    fn missing_relative_md_rejects_non_md_and_dot_segments() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir(root.path().join(".grimoire")).unwrap();
        let canonical_root = std::fs::canonicalize(root.path()).unwrap();

        let png = root.path().join("map.png");
        assert_eq!(missing_relative_md(&canonical_root, &png), None);

        let hidden = root.path().join(".grimoire").join("ledger.db");
        assert_eq!(missing_relative_md(&canonical_root, &hidden), None);
    }

    // ── upsert_external_note / remove_external_note ────────────────────────────

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

    fn insert_note(conn: &mut SqliteConnection, id: i32, path: &str) {
        conn.batch_execute(&format!(
            "INSERT INTO notes (id, path, title) VALUES ({id}, '{path}', 'Test')"
        ))
        .unwrap();
    }

    use crate::db::schema::notes::dsl as n;

    #[test]
    fn upsert_of_existing_note_reconciles_indexes_and_reports_modified() {
        let dir = TempDir::new().unwrap();
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "Ash.md");

        // An external editor rewrote the file with a new tag and wikilink.
        let content = "---\ntags: [npc]\n---\nSee [[Dragon.md]].";
        let result = upsert_external_note(&mut conn, None, dir.path(), "Ash.md", content).unwrap();
        assert!(
            matches!(result, Upserted::Modified),
            "an existing note must reconcile in place, not create a new row"
        );

        let tags: Vec<String> = nt::note_tags.select(nt::tag).load(&mut conn).unwrap();
        assert_eq!(tags, vec!["npc"]);
        let links: Vec<String> = nl::note_links.select(nl::target_path).load(&mut conn).unwrap();
        assert_eq!(links, vec!["Dragon.md"]);
    }

    #[test]
    fn upsert_of_new_path_inserts_a_note_row_and_reconciles_indexes() {
        let dir = TempDir::new().unwrap();
        let mut conn = test_conn();
        // No notes row for this path — a file created on disk outside the app.
        let content = "---\ntags: [creature]\naliases: [Drake]\n---\nSee [[Lair.md]].";
        let result =
            upsert_external_note(&mut conn, None, dir.path(), "Bestiary/Dragon.md", content)
                .unwrap();
        assert!(
            matches!(result, Upserted::Created),
            "a path with no row must insert one"
        );

        // Row inserted with title/parent derived from the path.
        let row: Note = n::notes
            .filter(n::path.eq("Bestiary/Dragon.md"))
            .first(&mut conn)
            .unwrap();
        assert_eq!(row.title, "Dragon");
        assert_eq!(row.parent_path, Some("Bestiary".to_string()));

        // Derived indexes reconciled from the new file's content.
        let tags: Vec<String> = nt::note_tags.select(nt::tag).load(&mut conn).unwrap();
        assert_eq!(tags, vec!["creature"]);
        let links: Vec<String> = nl::note_links.select(nl::target_path).load(&mut conn).unwrap();
        assert_eq!(links, vec!["Lair.md"]);
        let aliases: Vec<String> = na::note_aliases.select(na::alias).load(&mut conn).unwrap();
        assert_eq!(aliases, vec!["Drake"]);
    }

    #[test]
    fn upsert_replaces_prior_derived_rows_on_repeat() {
        let dir = TempDir::new().unwrap();
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "Ash.md");

        upsert_external_note(&mut conn, None, dir.path(), "Ash.md", "---\ntags: [old]\n---\n[[Old.md]].")
            .unwrap();
        upsert_external_note(&mut conn, None, dir.path(), "Ash.md", "---\ntags: [new]\n---\n[[New.md]].")
            .unwrap();

        let tags: Vec<String> = nt::note_tags.select(nt::tag).load(&mut conn).unwrap();
        assert_eq!(tags, vec!["new"], "stale tags must be replaced, not accumulated");
        let links: Vec<String> = nl::note_links.select(nl::target_path).load(&mut conn).unwrap();
        assert_eq!(links, vec!["New.md"]);
    }

    #[test]
    fn remove_of_existing_note_drops_row_and_indexes_and_reports_removed() {
        let dir = TempDir::new().unwrap();
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "Ash.md");
        // Populate derived indexes so we can prove they're cleared.
        upsert_external_note(
            &mut conn,
            None,
            dir.path(),
            "Ash.md",
            "---\ntags: [npc]\naliases: [The Ash]\n---\nSee [[Dragon.md]].",
        )
        .unwrap();

        let removed = remove_external_note(&mut conn, None, dir.path(), "Ash.md").unwrap();
        assert!(removed, "an existing note must be removed and reported");

        let rows: Vec<String> = n::notes.select(n::path).load(&mut conn).unwrap();
        assert!(rows.is_empty(), "notes row must be deleted");
        let tags: Vec<String> = nt::note_tags.select(nt::tag).load(&mut conn).unwrap();
        assert!(tags.is_empty(), "note_tags must be cleared");
        let links: Vec<String> = nl::note_links.select(nl::target_path).load(&mut conn).unwrap();
        assert!(links.is_empty(), "note_links must be cleared");
        let aliases: Vec<String> = na::note_aliases.select(na::alias).load(&mut conn).unwrap();
        assert!(aliases.is_empty(), "note_aliases must be cleared");
    }

    #[test]
    fn remove_of_unknown_path_is_a_noop() {
        let dir = TempDir::new().unwrap();
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "Kept.md");

        let removed = remove_external_note(&mut conn, None, dir.path(), "Ghost.md").unwrap();
        assert!(!removed, "a path with no row reports nothing removed");

        // The unrelated row must survive.
        let rows: Vec<String> = n::notes.select(n::path).load(&mut conn).unwrap();
        assert_eq!(rows, vec!["Kept.md"]);
    }
}
