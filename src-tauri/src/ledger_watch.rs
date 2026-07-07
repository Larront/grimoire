//! The backend file watcher that keeps the ledger live-synced with on-disk
//! `.md` edits made outside the app (ADR-0013).
//!
//! A recursive `notify` watcher, rooted at the open ledger, reports filesystem
//! events; the debouncer coalesces atomic-save churn over a short window. This
//! first slice handles **external modifies of existing notes only**:
//!
//! - `<ledger>/.grimoire/` (SQLite/Tantivy/media) and every other dot-segment is
//!   excluded, matching the traversal convention used elsewhere, so the app's own
//!   internal writes never generate work.
//! - The app's *own* `.md` writes are dropped via the content-hash registry in
//!   [`crate::note_write`]: on each event we re-read the file and ask whether its
//!   bytes are one we just wrote. A match is our echo; a differing hash is a
//!   genuine external edit.
//! - A genuine external modify of a note that has a `notes` row reconciles that
//!   note's derived indexes and emits `note:content-changed` `{path}` so the
//!   frontend can live-reload a clean editor buffer.
//!
//! Create / delete / rename and the bulk-op fallback are later slices: a create
//! has no `notes` row (skipped here), and a delete leaves nothing on disk to
//! re-read (skipped here).
//!
//! The watcher handle lives in its own managed [`LedgerWatcher`] state rather
//! than on `LedgerState`: the event handler locks `AppLedger`, so keeping the
//! debouncer out of that same mutex avoids any lock-ordering hazard. Replacing
//! the handle drops the previous debouncer, and its `Drop` only *signals* its
//! thread to stop (it does not join), so tearing a watcher down never blocks.

use crate::ledger::AppLedger;
use crate::db::models::Note;
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
            // A debounced batch can carry several events per path; reconcile each
            // touched path at most once.
            let mut seen: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
            for event in &events {
                // Access (open/read) events never change content — ignore them.
                if matches!(event.kind, EventKind::Access(_)) {
                    continue;
                }
                for path in &event.paths {
                    if seen.insert(path.clone()) {
                        process_path(&handler_app, &handler_root, path);
                    }
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

/// Handle one filesystem path from a debounced batch: filter to genuine external
/// `.md` modifies inside the open ledger, then reconcile and notify the frontend.
fn process_path(app: &AppHandle, canonical_root: &Path, event_path: &Path) {
    // A path that can't be canonicalized no longer exists (deleted/moved) — out
    // of scope for this slice.
    let Ok(canonical) = std::fs::canonicalize(event_path) else {
        return;
    };
    let Some(rel_path) = relative_md(canonical_root, &canonical) else {
        return;
    };
    let Ok(bytes) = std::fs::read(&canonical) else {
        return;
    };
    // The app's own write? Consume the record and stop — no self-triggered
    // reload or re-index loop.
    if crate::note_write::is_recent_write(&canonical, &bytes) {
        return;
    }
    let content = String::from_utf8_lossy(&bytes).into_owned();

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

    let result = {
        let state_ref = &mut *guard;
        let Some(conn) = state_ref.connection.as_mut() else {
            return;
        };
        let index = state_ref.search_index.as_ref();
        reconcile_external_change(conn, index, &ledger_path, &rel_path, &content)
    };
    // Release the ledger lock before emitting so a frontend listener that turns
    // around and calls a command can't contend with this handler.
    drop(guard);

    match result {
        Ok(true) => {
            if let Err(e) = app.emit("note:content-changed", NoteContentChanged { path: rel_path })
            {
                log::warn!("[ledger_watch] failed to emit note:content-changed: {e}");
            }
        }
        // No `notes` row (a brand-new file) — out of scope for this slice.
        Ok(false) => {}
        Err(e) => log::warn!("[ledger_watch] reconcile failed for {rel_path}: {e}"),
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

/// Reconcile a single note's derived indexes from `content` after an external
/// edit. Returns `Ok(true)` when a `notes` row exists and was reconciled (the
/// caller should emit `note:content-changed`), `Ok(false)` when there is no row
/// for `rel_path` (a create — out of scope here).
pub(crate) fn reconcile_external_change(
    conn: &mut SqliteConnection,
    index: Option<&tantivy::Index>,
    ledger_path: &Path,
    rel_path: &str,
    content: &str,
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

    // prev_path == path: same-path reconcile, no re-key (matches write_note_content).
    let outcome = crate::note_index::reconcile(conn, index, &note, content, Some(rel_path))?;
    crate::note_index::mark_stale_if_needed(&outcome, ledger_path);
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::note_links::dsl as nl;
    use crate::db::schema::note_tags::dsl as nt;
    use diesel::connection::SimpleConnection;
    use diesel::Connection;
    use tempfile::TempDir;

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

    // ── reconcile_external_change ──────────────────────────────────────────────

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

    #[test]
    fn external_change_reconciles_indexes_and_reports_reconciled() {
        let dir = TempDir::new().unwrap();
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "Ash.md");

        // An external editor rewrote the file with a new tag and wikilink.
        let content = "---\ntags: [npc]\n---\nSee [[Dragon.md]].";
        let reconciled =
            reconcile_external_change(&mut conn, None, dir.path(), "Ash.md", content).unwrap();
        assert!(reconciled, "an existing note must reconcile and be reported");

        let tags: Vec<String> = nt::note_tags.select(nt::tag).load(&mut conn).unwrap();
        assert_eq!(tags, vec!["npc"]);
        let links: Vec<String> = nl::note_links.select(nl::target_path).load(&mut conn).unwrap();
        assert_eq!(links, vec!["Dragon.md"]);
    }

    #[test]
    fn external_change_to_unknown_path_is_a_noop() {
        let dir = TempDir::new().unwrap();
        let mut conn = test_conn();
        // No notes row for this path — a freshly created file (out of scope).
        let reconciled = reconcile_external_change(
            &mut conn,
            None,
            dir.path(),
            "BrandNew.md",
            "---\ntags: [x]\n---\n",
        )
        .unwrap();
        assert!(!reconciled, "a path with no notes row must not reconcile");

        let tags: Vec<String> = nt::note_tags.select(nt::tag).load(&mut conn).unwrap();
        assert!(tags.is_empty(), "no indexes written for an unknown note");
    }

    #[test]
    fn external_change_replaces_prior_derived_rows() {
        let dir = TempDir::new().unwrap();
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "Ash.md");

        reconcile_external_change(&mut conn, None, dir.path(), "Ash.md", "---\ntags: [old]\n---\n[[Old.md]].")
            .unwrap();
        reconcile_external_change(&mut conn, None, dir.path(), "Ash.md", "---\ntags: [new]\n---\n[[New.md]].")
            .unwrap();

        let tags: Vec<String> = nt::note_tags.select(nt::tag).load(&mut conn).unwrap();
        assert_eq!(tags, vec!["new"], "stale tags must be replaced, not accumulated");
        let links: Vec<String> = nl::note_links.select(nl::target_path).load(&mut conn).unwrap();
        assert_eq!(links, vec!["New.md"]);
    }
}
