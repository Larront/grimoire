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
//! - A gone path that is not a note is a **folder removal** (usually — see
//!   [`Change::FolderRemoved`]). Windows reports a folder deleted with its
//!   contents, or sent to the Recycle Bin, as that one path and nothing for the
//!   notes inside, so their rows are dropped on the folder's word (emit
//!   `note:removed` for each) and the Files tree is told to refetch (emit
//!   `ledger:tree-changed`) even when the folder held nothing — the tree walks
//!   the disk, so without that event an empty folder's row outlives the folder.
//! - A folder that **arrives** (a create, never a mere modify — a folder is
//!   touched whenever anything inside it changes) is walked during
//!   classification, since the OS reports the folder and not what it holds;
//!   each note in it without a row gets one, and the tree refetches. A folder
//!   **moved** — a native rename, or a removal and an arrival of a folder with
//!   the same name in one batch — re-keys its notes' rows in place through
//!   [`crate::note_mutation::relocated_folder`], the same re-key the in-app
//!   folder move runs, so they keep their ids; inbound wikilinks are left as the
//!   external tool left them, as on the bulk path.
//! - A rename/move is correlated into a single [`Change::Moved`]: a native
//!   `notify` rename (both endpoints in one event) directly, or a delete+create
//!   pair whose created content matches bytes the app recently wrote to the
//!   deleted path (the content-hash correlation, via the write chokepoint
//!   registry). A move re-keys the existing `notes` row *in place* so it keeps
//!   its id and an open editor pane follows the file to its new location without
//!   losing the session (emit `note:moved` `{from, to}`). An uncorrelated move
//!   degrades to remove-old + create-new — the delete banner plus a new tree file.
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
use notify_debouncer_full::notify::event::{ModifyKind, RenameMode};
use notify_debouncer_full::notify::{Event, EventKind, RecursiveMode};
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
///
/// The canonical root is kept beside the debouncer so [`require_unwatched`] can
/// answer *which* vault is being watched, not merely whether one is.
#[derive(Default)]
pub struct LedgerWatcher(pub Mutex<Option<(PathBuf, LedgerDebouncer)>>);

/// Proof that no watcher is live over a given vault, and therefore that bulk
/// rewrites of that vault's `.md` files cannot come back as external edits.
///
/// This is the mirror of `format_version::FormatCleared`, and it exists for the
/// same reason (issue #217). That token makes *"you may not open a ledger without
/// passing the format gate"* something the compiler asks about; this one does the
/// same for the obligation pointing the other way — **you may not rewrite a
/// vault's notes underneath a running watcher**. Before it, that invariant lived
/// in a comment at one call site in `commands/ledger.rs`, and the code it guarded
/// was in a different file.
///
/// Unlike `FormatCleared` it is not only legibility: [`require_unwatched`]
/// genuinely checks, and refuses rather than minting when a watcher is live.
#[must_use]
#[derive(Debug)]
pub struct VaultUnwatched(());

/// Ask whether `ledger_path` is free of a live watcher, and hand back the proof
/// when it is.
///
/// Path-aware on purpose: a [[Format Migration]] is reached from a *refused* open,
/// and the ledger the GM was looking at before that refusal may still be open with
/// its own watcher running. That watcher has nothing to do with the vault being
/// migrated, and refusing the migration over it would be a guard that fires on the
/// ordinary case.
///
/// A vault whose path cannot be canonicalized, or a poisoned watcher slot, is
/// refused: neither can be shown to be unwatched, and this is the direction the
/// guard has to fail in.
pub fn require_unwatched(app: &AppHandle, ledger_path: &Path) -> Result<VaultUnwatched, String> {
    let canonical = std::fs::canonicalize(ledger_path).map_err(|e| {
        format!(
            "Cannot tell whether {} is being watched: {e}",
            ledger_path.display()
        )
    })?;

    let watched = app
        .state::<LedgerWatcher>()
        .0
        .lock()
        .map_err(|_| "Cannot tell whether the vault is being watched: watcher state poisoned")
        .map(|slot| slot.as_ref().map(|(root, _)| root.clone()))?;

    unwatched_verdict(watched.as_deref(), &canonical)
}

/// The comparison, as a pure function. Split from [`require_unwatched`] the same
/// way `format_version::act` is split from its gate, and for the same reason: both
/// branches are exercisable without arranging a Tauri app to hold a watcher.
///
/// `watched` is the canonical root of the live watcher, if there is one; `target`
/// is the canonical root of the vault about to be rewritten.
fn unwatched_verdict(watched: Option<&Path>, target: &Path) -> Result<VaultUnwatched, String> {
    match watched {
        Some(root) if root == target => Err(format!(
            "Refusing to rewrite {} while its watcher is running",
            target.display()
        )),
        _ => Ok(VaultUnwatched(())),
    }
}

/// The proof, for a test that is not arranging a Tauri app to obtain it honestly.
#[cfg(test)]
pub(crate) fn unwatched_for_test() -> VaultUnwatched {
    VaultUnwatched(())
}

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

/// Payload for the `note:moved` event: the note's old and new ledger-relative
/// paths after an external rename/move was correlated as a single file (ADR-0013
/// point 6). The frontend follows the open pane to `to` rather than treating the
/// change as a delete.
#[derive(Clone, serde::Serialize)]
struct NoteMoved {
    from: String,
    to: String,
}

/// Payload for the `note:external-move-links-stale` event: after an external
/// move re-keyed the moved note's row (phase A only), this many *other* notes
/// still hold `[[old path]]` wikilinks that now point nowhere. Emitted only when
/// `count > 0`, so the frontend's heal prompt fires only when there is something
/// to offer; the count is display-only (the `apply_backlink_rewrite` command
/// recomputes the real set at apply time). See ADR-0014.
#[derive(Clone, serde::Serialize)]
struct NoteExternalMoveLinksStale {
    from: String,
    to: String,
    count: u32,
}

/// Tell open notes that Grimoire itself rewrote their files — another note's links,
/// healed. The watcher drops the app's own writes as echoes, so without this a note
/// open beside the change kept the old text, and its next save put the old links back.
/// The same event an outside edit raises, so the pane's answer is the same: a clean
/// buffer reloads, an unsaved one is never overwritten.
pub fn announce_rewritten(app: &AppHandle, paths: &[String]) {
    for path in paths {
        if let Err(e) = app.emit("note:content-changed", NoteContentChanged { path: path.clone() }) {
            log::warn!("[ledger_watch] failed to emit note:content-changed: {e}");
        }
    }
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
            let changes = classify_batch(&handler_root, events.iter().map(|e| &e.event));

            // Pair any residual delete+create (a move surfaced as two separate
            // events, not a native rename) when the created file's content matches
            // bytes the app recently wrote to the deleted path — the content-hash
            // correlation of ADR-0013 point 6, via the write chokepoint registry.
            let changes = correlate_moves(changes, |from_rel, content| {
                crate::note_write::is_recent_write(
                    &handler_root.join(from_rel),
                    content.as_bytes(),
                )
            });

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
                apply(&handler_app, &handler_root, changes);
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
            log::info!("[ledger_watch] watching {}", canonical_root.display());
            *slot = Some((canonical_root, debouncer));
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
    /// A file moved from `from_rel` to `to_rel` — a native rename event or a
    /// delete+create pair correlated by content hash. `content` is the on-disk
    /// content at the new path (read once during classification).
    Moved {
        from_rel: String,
        to_rel: String,
        content: String,
    },
    /// A path that is gone and is not a note: almost always a folder, removed
    /// with whatever it held. Any notes rows under it go, and the tree refetches
    /// regardless. A gone file that simply is not a note (a PDF, a map image, a
    /// `.txt`) lands here too, which costs one tree refetch and finds no rows —
    /// and is what lets a PDF deleted on disk leave the tree as well.
    FolderRemoved { rel_path: String },
    /// A folder arrived — created, copied or moved in, restored from the Recycle
    /// Bin. The OS reports the folder and not what it holds, so `notes` is every
    /// in-scope `.md` under it with its content, walked during classification.
    FolderArrived {
        rel_path: String,
        notes: Vec<(String, String)>,
    },
    /// A folder moved from `from_rel` to `to_rel` — a native rename, or a removal
    /// and an arrival of a folder with the same name in one batch. `notes` is
    /// what is under `to_rel` now, as for [`Change::FolderArrived`].
    FolderMoved {
        from_rel: String,
        to_rel: String,
        notes: Vec<(String, String)>,
    },
}

/// What the frontend must be told after a change is applied.
enum Notify {
    /// An existing note's content changed — the open editor can live-reload.
    ContentChanged(String),
    /// A new note appeared — refetch the Files tree / notes store.
    TreeChanged,
    /// A note was removed — refetch and drop it from the tree.
    Removed(String),
    /// A note's file moved — the open pane follows it to the new path
    /// (`note:moved`). `stale_backlinks` is how many other notes still link to
    /// the old path (phase A leaves their wikilink text untouched); when > 0 an
    /// additional `note:external-move-links-stale` event offers to heal them.
    Moved {
        from: String,
        to: String,
        stale_backlinks: usize,
    },
    /// A folder went, arrived or moved, and the tree's shape changed with it.
    /// `removed` are the notes whose rows went with it (often none): each gets
    /// its own `note:removed`, so a pane holding one raises the deleted banner;
    /// then one `ledger:tree-changed`, so the folder rows follow the disk even
    /// when the folder is empty. A note re-keyed by a folder move needs no event
    /// of its own: it kept its id, and the refetch carries it to its new path.
    Reshaped { removed: Vec<String> },
    /// Nothing observable happened (echo already handled, or a no-op remove).
    Nothing,
}

/// Classify one debounced batch of raw events into intended [`Change`]s, every
/// filesystem read done up front.
///
/// A batch can carry several events per path; each touched path is classified
/// at most once. Classifying up front (existence check, content read, echo
/// suppression) is also what lets the caller count *genuine* external changes —
/// the app's own bulk writes, e.g. a rename's backlink rewrites, are dropped here
/// and never trip the threshold.
fn classify_batch<'a>(canonical_root: &Path, events: impl IntoIterator<Item = &'a Event>) -> Vec<Change> {
    let mut seen: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
    let mut changes: Vec<Change> = Vec::new();
    for event in events {
        // Access (open/read) events never change content — ignore them.
        if matches!(event.kind, EventKind::Access(_)) {
            continue;
        }
        // A native rename the debouncer has already paired carries both
        // endpoints in one event (`from`, `to`). Correlate it directly so
        // an open pane follows the move instead of seeing a delete. If
        // correlation fails (an endpoint out of scope — e.g. a note
        // renamed to a non-`.md` name, or moved into `.grimoire/`), fall
        // through to the per-path pass so it still surfaces as the lone
        // remove or create it really is.
        if matches!(event.kind, EventKind::Modify(ModifyKind::Name(RenameMode::Both)))
            && event.paths.len() == 2
        {
            let paired = classify_rename(canonical_root, &event.paths[0], &event.paths[1])
                .or_else(|| classify_folder_rename(canonical_root, &event.paths[0], &event.paths[1]));
            if let Some(change) = paired {
                // Mark both endpoints seen so the per-path pass never
                // reclassifies them (as a stray delete or create).
                seen.insert(event.paths[0].clone());
                seen.insert(event.paths[1].clone());
                changes.push(change);
                continue;
            }
        }
        // Only a create or a rename can bring a folder into being. A folder is
        // also touched whenever something inside it changes, and that is not
        // the folder arriving: the change reports itself on its own path. Not
        // marked seen, so a create of the same folder later in the batch counts.
        //
        // The same goes the other way: only a remove or a rename takes a folder
        // away. Windows sends a folder's "modified" in a batch of its own just
        // ahead of the rename that moves it, when the old name is already gone;
        // read as a removal, it dropped the rows the rename was about to re-key.
        // A gone `.md` path keeps its old treatment — any event on it is its
        // removal — since the folder rule is not what decides a note's.
        let arrived = matches!(event.kind, EventKind::Create(_) | EventKind::Modify(ModifyKind::Name(_)));
        let departed = matches!(event.kind, EventKind::Remove(_) | EventKind::Modify(ModifyKind::Name(_)));
        for path in &event.paths {
            let is_dir = path.is_dir();
            if is_dir && !arrived {
                continue;
            }
            let is_md = path.extension().is_some_and(|ext| ext == "md");
            if !is_dir && !is_md && !departed && !path.exists() {
                continue;
            }
            if seen.insert(path.clone()) {
                let change = if is_dir {
                    classify_folder_arrival(canonical_root, path)
                } else {
                    classify(canonical_root, path)
                };
                changes.extend(change);
            }
        }
    }
    changes
}

/// Classify a folder that has just appeared into a [`Change::FolderArrived`],
/// walking it for its notes. `None` when it is out of scope.
fn classify_folder_arrival(canonical_root: &Path, folder: &Path) -> Option<Change> {
    let canonical = std::fs::canonicalize(folder).ok()?;
    Some(Change::FolderArrived {
        rel_path: relative_in_scope(canonical_root, &canonical)?,
        notes: notes_under(canonical_root, &canonical),
    })
}

/// Classify a native rename whose `to` is a folder into a [`Change::FolderMoved`].
/// `None` — so the caller degrades to classifying each endpoint on its own — when
/// `to` is not a folder or either side is out of scope (a folder moved into
/// `.trash/` is a removal, one moved out of it an arrival).
fn classify_folder_rename(canonical_root: &Path, from: &Path, to: &Path) -> Option<Change> {
    if !to.is_dir() {
        return None;
    }
    let to_canonical = std::fs::canonicalize(to).ok()?;
    Some(Change::FolderMoved {
        from_rel: missing_relative(canonical_root, from)?,
        to_rel: relative_in_scope(canonical_root, &to_canonical)?,
        notes: notes_under(canonical_root, &to_canonical),
    })
}

/// Every in-scope `.md` note under `canonical_dir`, with its content, as
/// ledger-relative paths. Dot-entries are skipped as the Files tree skips them.
///
/// Reads are not echo-checked: the registry records a write so its *own* event
/// can be dropped, and consuming a record here would turn that event into an
/// external edit. A folder's notes only ever get rows they lack, so reading one
/// the app just wrote does nothing.
fn notes_under(canonical_root: &Path, canonical_dir: &Path) -> Vec<(String, String)> {
    let mut notes = Vec::new();
    let mut pending = vec![canonical_dir.to_path_buf()];
    while let Some(dir) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy().starts_with('.') {
                continue;
            }
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
            } else if let Some(rel) = relative_md(canonical_root, &path) {
                if let Ok(bytes) = std::fs::read(&path) {
                    notes.push((rel, String::from_utf8_lossy(&bytes).into_owned()));
                }
            }
        }
    }
    notes.sort();
    notes
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
        // The path is gone — a deleted note, the `from` half of a move, or a
        // whole folder. It can't be canonicalized itself, so it is resolved via
        // the nearest ancestor that is still there.
        Err(_) => {
            let rel_path = missing_relative(canonical_root, event_path)?;
            if rel_path.ends_with(".md") {
                Some(Change::Remove { rel_path })
            } else {
                Some(Change::FolderRemoved { rel_path })
            }
        }
    }
}

/// Classify a native rename event's `from`/`to` pair into a [`Change::Moved`].
/// The `to` file exists (read + echo-checked like any upsert); the `from` file
/// is gone (resolved via its parent, like a remove). Returns `None` — so the
/// caller degrades to classifying each endpoint on its own — when either side is
/// out of scope, the `to` bytes are our own write echo, or the `to` can't be
/// read. A rename where only one endpoint is an in-scope `.md` file (e.g. a note
/// moved into `.grimoire/`, or a non-note renamed to `.md`) also degrades, so it
/// surfaces correctly as a lone remove or create.
fn classify_rename(canonical_root: &Path, from: &Path, to: &Path) -> Option<Change> {
    let to_canonical = std::fs::canonicalize(to).ok()?;
    let to_rel = relative_md(canonical_root, &to_canonical)?;
    let from_rel = missing_relative_md(canonical_root, from)?;
    let bytes = std::fs::read(&to_canonical).ok()?;
    if crate::note_write::is_recent_write(&to_canonical, &bytes) {
        return None;
    }
    Some(Change::Moved {
        from_rel,
        to_rel,
        content: String::from_utf8_lossy(&bytes).into_owned(),
    })
}

/// Pair residual delete+create changes into [`Change::Moved`] when the created
/// file's content matches bytes recently written to the deleted path (the
/// content-hash correlation of ADR-0013 point 6, used when a move surfaced as two
/// separate events rather than a native rename). `content_matches(from_rel,
/// content)` is the correlation oracle — in production it consults the write
/// chokepoint's recent-write registry; a match consumes that record.
///
/// Greedy first-match pairing is sufficient: a genuine move produces exactly one
/// unmatched remove and one unmatched create in the same batch, and any batch big
/// enough to hold ambiguous pairs is a bulk op that took the full-rebuild path
/// before reaching here.
fn correlate_moves(
    changes: Vec<Change>,
    content_matches: impl Fn(&str, &str) -> bool,
) -> Vec<Change> {
    // Split off the deleted paths; everything else passes through in order.
    let mut removed: Vec<String> = Vec::new();
    let mut removed_folders: Vec<String> = Vec::new();
    let mut rest: Vec<Change> = Vec::new();
    for change in changes {
        match change {
            Change::Remove { rel_path } => removed.push(rel_path),
            Change::FolderRemoved { rel_path } => removed_folders.push(rel_path),
            other => rest.push(other),
        }
    }

    let mut out: Vec<Change> = Vec::with_capacity(rest.len() + removed.len() + removed_folders.len());
    let mut arrivals: Vec<Change> = Vec::new();
    for change in rest {
        // A folder dragged into another in Explorer is not a paired rename but a
        // removal and an arrival. The same name going and coming in one batch is
        // the evidence; content can't be, as nothing inside it was reported. A
        // folder deleted and recreated where it was is not a move, and pairing it
        // with itself would keep the rows of notes that went with the first.
        if let Change::FolderArrived { rel_path, notes } = change {
            let pos = removed_folders
                .iter()
                .position(|from| from != &rel_path && leaf(from) == leaf(&rel_path));
            match pos {
                Some(pos) => arrivals.push(Change::FolderMoved {
                    from_rel: removed_folders.remove(pos),
                    to_rel: rel_path,
                    notes,
                }),
                None => arrivals.push(Change::FolderArrived { rel_path, notes }),
            }
            continue;
        }
        if let Change::Upsert { rel_path, content } = &change {
            if let Some(pos) = removed.iter().position(|from| content_matches(from, content)) {
                let from_rel = removed.remove(pos);
                out.push(Change::Moved {
                    from_rel,
                    to_rel: rel_path.clone(),
                    content: content.clone(),
                });
                continue;
            }
        }
        out.push(change);
    }
    // Deletes that never paired stay as removes.
    out.extend(removed.into_iter().map(|rel_path| Change::Remove { rel_path }));
    // Folders that never paired stay as removals, applied before any arrival: a
    // folder deleted and recreated in one batch has to lose its old rows before
    // the new one's notes are looked for.
    let mut folders: Vec<Change> = removed_folders
        .into_iter()
        .map(|rel_path| Change::FolderRemoved { rel_path })
        .collect();
    folders.extend(arrivals);
    folders.extend(out);
    folders
}

/// The last segment of a ledger-relative path — a folder's own name.
fn leaf(rel_path: &str) -> &str {
    rel_path.rsplit('/').next().unwrap_or(rel_path)
}

/// Apply a batch of classified [`Change`]s under one hold of the ledger lock,
/// then emit the matching frontend events. The lock is released before emitting
/// so a frontend listener that turns around and calls a command can't contend
/// with this handler.
fn apply(app: &AppHandle, canonical_root: &Path, changes: Vec<Change>) {
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

    let notifies: Vec<Notify> = {
        // A watcher event that lands mid-close has nothing to reconcile.
        let Ok(crate::ledger::OpenLedger { conn, index, .. }) = guard.open() else {
            return;
        };
        changes
            .into_iter()
            .map(|change| reconcile_change(conn, index, &ledger_path, change))
            .collect()
    };
    drop(guard);

    for (name, payload) in batch_emissions(notifies) {
        if let Err(e) = app.emit(name, payload) {
            log::warn!("[ledger_watch] failed to emit {name}: {e}");
        }
    }
}

/// Bring the `notes` table and the [[Derived Index]] into agreement with one
/// classified [`Change`], and say what the frontend must be told. All of
/// [`apply`] but the lock and the emit, so a test can drive it on a bare
/// connection.
fn reconcile_change(
    conn: &mut SqliteConnection,
    index: Option<&tantivy::Index>,
    ledger_path: &Path,
    change: Change,
) -> Notify {
    match change {
        Change::Upsert { rel_path, content } => {
            match upsert_external_note(conn, index, &rel_path, &content) {
                Ok(Upserted::Modified) => Notify::ContentChanged(rel_path),
                Ok(Upserted::Created) => Notify::TreeChanged,
                Err(e) => {
                    log::warn!("[ledger_watch] upsert failed for {rel_path}: {e}");
                    Notify::Nothing
                }
            }
        }
        Change::Remove { rel_path } => match remove_external_note(conn, index, &rel_path) {
            Ok(true) => Notify::Removed(rel_path),
            Ok(false) => Notify::Nothing,
            Err(e) => {
                log::warn!("[ledger_watch] remove failed for {rel_path}: {e}");
                Notify::Nothing
            }
        },
        Change::Moved { from_rel, to_rel, content } => {
            match move_external_note(conn, index, ledger_path, &from_rel, &to_rel, &content) {
                // Re-keyed an existing row: the note keeps its id, so an open
                // pane follows the move seamlessly. `stale_backlinks` rides
                // along so the emit step can offer to heal them.
                Ok(Moved::Rekeyed { stale_backlinks }) => Notify::Moved {
                    from: from_rel,
                    to: to_rel,
                    stale_backlinks,
                },
                // No row for the old path — nothing to follow; the new file is
                // just a create. Insert it and let the tree pick it up.
                Ok(Moved::NoRow) => match upsert_external_note(conn, index, &to_rel, &content) {
                    Ok(_) => Notify::TreeChanged,
                    Err(e) => {
                        log::warn!("[ledger_watch] move-create failed for {to_rel}: {e}");
                        Notify::Nothing
                    }
                },
                Err(e) => {
                    log::warn!("[ledger_watch] move failed {from_rel} -> {to_rel}: {e}");
                    Notify::Nothing
                }
            }
        }
        Change::FolderRemoved { rel_path } => {
            // The folder is gone whatever happened to its rows, so the tree is
            // told either way: a failure here must not leave its row standing.
            let removed = remove_external_folder(conn, index, &rel_path).unwrap_or_else(|e| {
                log::warn!("[ledger_watch] folder remove failed for {rel_path}: {e}");
                Vec::new()
            });
            Notify::Reshaped { removed }
        }
        // As with a removal, the folder is there whatever its rows make of it.
        Change::FolderArrived { rel_path, notes } => {
            if let Err(e) = adopt_notes(conn, index, &notes) {
                log::warn!("[ledger_watch] folder arrival failed for {rel_path}: {e}");
            }
            Notify::Reshaped { removed: Vec::new() }
        }
        Change::FolderMoved { from_rel, to_rel, notes } => {
            let contents: std::collections::HashMap<&str, &str> =
                notes.iter().map(|(path, content)| (path.as_str(), content.as_str())).collect();
            let removed = crate::note_mutation::relocated_folder(conn, index, &from_rel, &to_rel, |landing| {
                contents.get(landing).map(|content| content.to_string())
            })
            .unwrap_or_else(|e| {
                log::warn!("[ledger_watch] folder move failed {from_rel} -> {to_rel}: {e}");
                Vec::new()
            });
            // Anything under the folder that had no row before the move — or the
            // app's own move, whose rows were re-keyed before this ran — is
            // adopted, so every note now under `to_rel` has one.
            if let Err(e) = adopt_notes(conn, index, &notes) {
                log::warn!("[ledger_watch] folder move-adopt failed for {to_rel}: {e}");
            }
            Notify::Reshaped { removed }
        }
    }
}

/// Give a row to each of `notes` that lacks one, and reconcile the new rows in
/// one batch — a folder of a few hundred notes is one Tantivy commit, not a few
/// hundred. Notes that already have a row are left as they are: nothing here
/// says their content changed, and their own events would.
fn adopt_notes(
    conn: &mut SqliteConnection,
    index: Option<&tantivy::Index>,
    notes: &[(String, String)],
) -> Result<(), String> {
    use crate::db::schema::notes::dsl as n;

    let paths: Vec<&str> = notes.iter().map(|(path, _)| path.as_str()).collect();
    let known: std::collections::HashSet<String> = n::notes
        .filter(n::path.eq_any(&paths))
        .select(n::path)
        .load::<String>(conn)
        .map_err(|e| e.to_string())?
        .into_iter()
        .collect();

    let now = chrono::Utc::now().to_rfc3339();
    let mut items = Vec::new();
    for (rel_path, content) in notes.iter().filter(|(path, _)| !known.contains(path)) {
        let title = title_from_path(rel_path);
        let parent = parent_path_from(rel_path);
        let created: Note = diesel::insert_into(n::notes)
            .values(&NewNote {
                path: rel_path,
                title: &title,
                parent_path: parent.as_deref(),
                modified_at: &now,
            })
            .returning(Note::as_returning())
            .get_result(conn)
            .map_err(|e| e.to_string())?;
        items.push(crate::note_index::ReconcileManyItem {
            note: created,
            content: content.clone(),
            prev_path: None,
        });
    }
    crate::note_index::reconcile_many(conn, index, &items)
}

/// The frontend events a whole batch stands for. `ledger:tree-changed` carries
/// nothing and makes the tree refetch wholesale, so however many changes in the
/// batch implied it — `mkdir -p A/B` is two — it is sent once, last, after every
/// other event.
fn batch_emissions(notifies: Vec<Notify>) -> Vec<(&'static str, serde_json::Value)> {
    let (tree_changed, mut out): (Vec<_>, Vec<_>) = notifies
        .into_iter()
        .flat_map(emissions)
        .partition(|(name, _)| *name == "ledger:tree-changed");
    out.extend(tree_changed.into_iter().take(1));
    out
}

/// The frontend events a [`Notify`] stands for, in the order they are emitted —
/// the watcher's half of the contract `src/lib/ledger/events.ts` spells out.
fn emissions(notify: Notify) -> Vec<(&'static str, serde_json::Value)> {
    // Every payload is a plain derive(Serialize) struct; this cannot fail.
    fn json(payload: impl serde::Serialize) -> serde_json::Value {
        serde_json::to_value(payload).unwrap_or_default()
    }
    let tree_changed = ("ledger:tree-changed", serde_json::Value::Null);

    match notify {
        Notify::ContentChanged(path) => {
            vec![("note:content-changed", json(NoteContentChanged { path }))]
        }
        Notify::TreeChanged => vec![tree_changed],
        Notify::Removed(path) => vec![("note:removed", json(NoteRemoved { path }))],
        Notify::Moved { from, to, stale_backlinks } => {
            // The existing move event — the open pane follows the file. Untouched
            // by the heal prompt so its refetch listener keeps working as before.
            let mut out = vec![(
                "note:moved",
                json(NoteMoved { from: from.clone(), to: to.clone() }),
            )];
            // Only when other notes still link to the old path do we offer to heal
            // them — the prompt subscriber fires only when there's something to do.
            if stale_backlinks > 0 {
                out.push((
                    "note:external-move-links-stale",
                    json(NoteExternalMoveLinksStale { from, to, count: stale_backlinks as u32 }),
                ));
            }
            out
        }
        Notify::Reshaped { removed } => removed
            .into_iter()
            .map(|path| ("note:removed", json(NoteRemoved { path })))
            .chain(std::iter::once(tree_changed))
            .collect(),
        Notify::Nothing => Vec::new(),
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

    let (rebuilt, unlinked_pins, arrived) = {
        let Ok(crate::ledger::OpenLedger { conn, .. }) = guard.open() else {
            return;
        };
        // Bring the notes table into agreement with disk before the rebuild pass
        // so it sees fully-populated rows — mirrors open_ledger's ordering.
        //
        // The repair is delete-and-reinsert, so a folder reorganised outside
        // Grimoire costs the re-created notes their identity and unlinks the pins
        // that held it (#224). This is the *second* way into that repair — the
        // same one the open path runs, reached mid-session — and it was the
        // sibling silence: an open at least ends with a screen the GM is looking
        // at, whereas here their map simply stops working under them.
        let (unlinked_pins, arrived) =
            match crate::commands::import::reconcile_notes_with_disk(&ledger_path, conn) {
                Ok(report) => (report.unlinked_pins, report.arrived),
                Err(e) => {
                    log::warn!("[ledger_watch] bulk notes reconcile failed: {e}");
                    return;
                }
            };
        let maps = crate::db::schema::maps::table
            .load::<crate::db::models::Map>(conn)
            .unwrap_or_default();
        let scenes = crate::db::schema::scenes::table
            .load::<crate::db::models::Scene>(conn)
            .unwrap_or_default();
        match crate::note_index::rebuild_all_from_ledger(&ledger_path, conn, &maps, &scenes) {
            Ok(index) => (index, unlinked_pins, arrived),
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

    // Separate from `ledger:rebuilt` rather than folded into its payload: that
    // event is the frontend's cue to refetch, fires on every bulk batch, and
    // carries nothing. This one fires only when the GM lost something.
    if !unlinked_pins.is_empty()
        && let Err(e) = app.emit("pins:unlinked", unlinked_pins)
    {
        log::warn!("[ledger_watch] failed to emit pins:unlinked: {e}");
    }

    // Notes turned up at paths the records didn't hold — a reorganisation, most
    // likely — so links written as paths may point at where they used to be. The
    // frontend asks `plan_link_repairs` and lists any it can heal; this path never
    // rewrites a link itself (ADR-0014).
    if arrived && let Err(e) = app.emit("notes:arrived", ()) {
        log::warn!("[ledger_watch] failed to emit notes:arrived: {e}");
    }
}

/// Convert a canonical absolute event path to a ledger-relative, forward-slash
/// note path — or `None` if it is out of scope (see [`relative_in_scope`]) or
/// isn't a `.md` file.
fn relative_md(canonical_root: &Path, canonical_path: &Path) -> Option<String> {
    relative_in_scope(canonical_root, canonical_path).filter(|rel| rel.ends_with(".md"))
}

/// Convert a canonical absolute event path to a ledger-relative, forward-slash
/// path of any kind — or `None` if it escapes the ledger, is the ledger root
/// itself, or lives under any dot-segment (e.g. `.grimoire/`).
fn relative_in_scope(canonical_root: &Path, canonical_path: &Path) -> Option<String> {
    let rel = canonical_path.strip_prefix(canonical_root).ok()?;
    for component in rel.components() {
        if let Component::Normal(name) = component {
            if name.to_string_lossy().starts_with('.') {
                return None;
            }
        }
    }
    let rel_str = rel.to_string_lossy().replace('\\', "/");
    (!rel_str.is_empty()).then_some(rel_str)
}

/// Ledger-relative `.md` path for an event path that no longer exists on disk (a
/// delete or a move's `from` side). `None` if it is not an in-scope note.
fn missing_relative_md(canonical_root: &Path, event_path: &Path) -> Option<String> {
    missing_relative(canonical_root, event_path).filter(|rel| rel.ends_with(".md"))
}

/// Ledger-relative path for an event path that no longer exists on disk, so
/// `canonicalize` on the path itself fails. Walks up to the nearest ancestor that
/// is still there, canonicalizes that, and rejoins the vanished tail, so the same
/// prefix-strip + filtering as [`relative_in_scope`] applies. Walking further than
/// the parent matters when a folder goes with its notes: by the time the batch is
/// classified the note's parent is gone too.
fn missing_relative(canonical_root: &Path, event_path: &Path) -> Option<String> {
    let mut vanished = Vec::new();
    let mut ancestor = event_path;
    let mut resolved = loop {
        match std::fs::canonicalize(ancestor) {
            Ok(canonical) => break canonical,
            Err(_) => {
                vanished.push(ancestor.file_name()?);
                ancestor = ancestor.parent()?;
            }
        }
    };
    resolved.extend(vanished.iter().rev());
    relative_in_scope(canonical_root, &resolved)
}

/// Whether an upsert created a new note row or reconciled an existing one.
pub(crate) enum Upserted {
    Created,
    Modified,
}

/// The outcome of a [`move_external_note`].
pub(crate) enum Moved {
    /// The old path had a row: it was re-keyed in place (phase A). Phase B is
    /// deliberately skipped for external moves, so `stale_backlinks` is the count
    /// of other notes whose `[[old path]]` wikilinks were left as the external
    /// tool wrote them — the number the heal prompt offers to fix.
    Rekeyed { stale_backlinks: usize },
    /// No row for the old path — the caller falls back to creating the new path.
    NoRow,
}

/// Apply an external create-or-modify of `rel_path` from its on-disk `content`.
/// A note that already has a `notes` row reconciles its derived indexes in place
/// ([`Upserted::Modified`]); a note with no row is inserted with a title/parent
/// derived from its path, then reconciled ([`Upserted::Created`]).
pub(crate) fn upsert_external_note(
    conn: &mut SqliteConnection,
    index: Option<&tantivy::Index>,
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
            crate::note_index::reconcile(conn, index, &note, content, Some(rel_path))?;
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
            crate::note_index::reconcile(conn, index, &created, content, None)?;
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

    crate::note_index::remove(conn, index, note.id, &note.path)?;

    diesel::delete(n::notes.find(note.id))
        .execute(conn)
        .map_err(|e| e.to_string())?;
    Ok(true)
}

/// Apply an external removal of the folder `rel_path`: clear the derived indexes
/// of every note under it (while the rows still exist, mirroring `delete_folder`)
/// and delete those rows. Returns their paths, sorted — empty for a folder that
/// held no notes, which is still a removal the tree has to hear about.
///
/// Maps whose image lived in the folder are left alone: a map is not a note, the
/// watcher reconciles only notes, and dropping its row would take its pins too.
pub(crate) fn remove_external_folder(
    conn: &mut SqliteConnection,
    index: Option<&tantivy::Index>,
    rel_path: &str,
) -> Result<Vec<String>, String> {
    use crate::db::schema::notes::dsl as n;

    // `LIKE` is only the coarse filter, as in `delete_folder`: it is
    // case-insensitive and reads `_` as a wildcard, so the exact prefix decides.
    let prefix = format!("{rel_path}/");
    let doomed: Vec<(i32, String)> = n::notes
        .filter(n::path.like(format!("{prefix}%")))
        .select((n::id, n::path))
        .load::<(i32, String)>(conn)
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter(|(_, path)| path.starts_with(&prefix))
        .collect();

    crate::note_index::remove_many(conn, index, &doomed)?;
    diesel::delete(n::notes.filter(n::id.eq_any(doomed.iter().map(|(id, _)| *id))))
        .execute(conn)
        .map_err(|e| e.to_string())?;

    let mut paths: Vec<String> = doomed.into_iter().map(|(_, path)| path).collect();
    paths.sort();
    Ok(paths)
}

/// Apply an external move of `from_rel` → `to_rel` by re-keying the existing
/// `notes` row in place: its `path`/`title`/`parent_path` follow the file to its
/// new location and the row keeps its **id** (so an open editor pane bound to
/// that id follows the move without losing its session — the whole point of
/// correlating a move instead of treating it as delete+create).
///
/// Routes through the shared [`crate::note_mutation::rename`] so an external
/// move and an in-app rename can never diverge. External moves do **phase A
/// only** (`rewrite_backlinks = false`): the moved note is re-keyed and
/// reconciled, but inbound `[[old path]]` wikilinks in other notes are left as
/// the external tool wrote them. The plan `rename` returns is not applied here;
/// instead its length is reported (see [`Moved::Rekeyed`]) so the frontend can
/// offer a non-destructive heal prompt, which calls `apply_backlink_rewrite`
/// on consent (issue #135, ADR-0014).
///
/// Returns [`Moved::Rekeyed`] when a row existed and was re-keyed (emit
/// `note:moved`), carrying the count of other notes still linking to the old
/// path so the caller can offer to heal them; [`Moved::NoRow`] when the old path
/// had no row (the caller falls back to creating the new path).
pub(crate) fn move_external_note(
    conn: &mut SqliteConnection,
    index: Option<&tantivy::Index>,
    ledger_path: &Path,
    from_rel: &str,
    to_rel: &str,
    content: &str,
) -> Result<Moved, String> {
    use crate::db::schema::notes::dsl as n;

    let maybe_note = n::notes
        .filter(n::path.eq(from_rel))
        .first::<Note>(conn)
        .optional()
        .map_err(|e| e.to_string())?;

    let Some(old) = maybe_note else {
        return Ok(Moved::NoRow);
    };

    // The target row: same id/icon/etc., with path/title/parent derived from the
    // new location. `note_mutation::rename` persists exactly path/title/parent.
    let target = Note {
        path: to_rel.to_string(),
        title: title_from_path(to_rel),
        parent_path: parent_path_from(to_rel),
        ..old
    };

    let renamed =
        crate::note_mutation::rename(conn, index, ledger_path, from_rel, &target, content, false)?;
    // rewrite_backlinks was false, so phase B was skipped and the affected
    // sources came back as a deferred plan — its length is the heal count.
    let stale_backlinks = match renamed.backlinks {
        crate::note_mutation::RenamedBacklinks::Deferred(sources) => sources.len(),
        crate::note_mutation::RenamedBacklinks::Rewritten(_) => 0,
    };
    Ok(Moved::Rekeyed { stale_backlinks })
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
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "Ash.md");

        // An external editor rewrote the file with a new tag and wikilink.
        let content = "---\ntags: [npc]\n---\nSee [[Dragon.md]].";
        let result = upsert_external_note(&mut conn, None, "Ash.md", content).unwrap();
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
        let mut conn = test_conn();
        // No notes row for this path — a file created on disk outside the app.
        let content = "---\ntags: [creature]\naliases: [Drake]\n---\nSee [[Lair.md]].";
        let result =
            upsert_external_note(&mut conn, None, "Bestiary/Dragon.md", content)
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
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "Ash.md");

        upsert_external_note(&mut conn, None, "Ash.md", "---\ntags: [old]\n---\n[[Old.md]].")
            .unwrap();
        upsert_external_note(&mut conn, None, "Ash.md", "---\ntags: [new]\n---\n[[New.md]].")
            .unwrap();

        let tags: Vec<String> = nt::note_tags.select(nt::tag).load(&mut conn).unwrap();
        assert_eq!(tags, vec!["new"], "stale tags must be replaced, not accumulated");
        let links: Vec<String> = nl::note_links.select(nl::target_path).load(&mut conn).unwrap();
        assert_eq!(links, vec!["New.md"]);
    }

    #[test]
    fn remove_of_existing_note_drops_row_and_indexes_and_reports_removed() {
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "Ash.md");
        // Populate derived indexes so we can prove they're cleared.
        upsert_external_note(
            &mut conn,
            None,
            "Ash.md",
            "---\ntags: [npc]\naliases: [The Ash]\n---\nSee [[Dragon.md]].",
        )
        .unwrap();

        let removed = remove_external_note(&mut conn, None, "Ash.md").unwrap();
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
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "Kept.md");

        let removed = remove_external_note(&mut conn, None, "Ghost.md").unwrap();
        assert!(!removed, "a path with no row reports nothing removed");

        // The unrelated row must survive.
        let rows: Vec<String> = n::notes.select(n::path).load(&mut conn).unwrap();
        assert_eq!(rows, vec!["Kept.md"]);
    }

    // ── move_external_note ─────────────────────────────────────────────────────

    #[test]
    fn move_rekeys_the_row_in_place_preserving_id() {
        let dir = TempDir::new().unwrap();
        let mut conn = test_conn();
        insert_note(&mut conn, 7, "Characters/Aldric.md");
        // Seed derived rows under the OLD path so we can prove they re-key.
        upsert_external_note(
            &mut conn,
            None,
            "Characters/Aldric.md",
            "---\ntags: [npc]\n---\nSee [[Keep.md]].",
        )
        .unwrap();

        let moved = move_external_note(
            &mut conn,
            None,
            dir.path(),
            "Characters/Aldric.md",
            "People/Aldric the Bold.md",
            "---\ntags: [npc]\n---\nSee [[Keep.md]].",
        )
        .unwrap();
        assert!(
            matches!(moved, Moved::Rekeyed { .. }),
            "an existing note must be re-keyed and reported moved"
        );

        // Same row (id 7), now at the new path with title/parent derived from it.
        let row: Note = n::notes.find(7).first(&mut conn).unwrap();
        assert_eq!(row.path, "People/Aldric the Bold.md");
        assert_eq!(row.title, "Aldric the Bold");
        assert_eq!(row.parent_path, Some("People".to_string()));
        // Exactly one row — the move re-keyed, it did not create a second note.
        let count: i64 = n::notes.count().get_result(&mut conn).unwrap();
        assert_eq!(count, 1);

        // note_tags are keyed by path, so they must have followed to the new path.
        let tag_paths: Vec<String> = nt::note_tags.select(nt::note_path).load(&mut conn).unwrap();
        assert_eq!(tag_paths, vec!["People/Aldric the Bold.md"]);
    }

    #[test]
    fn move_of_untracked_path_reports_false() {
        let dir = TempDir::new().unwrap();
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "Kept.md");

        // No row for the old path — the caller will treat the new path as a create.
        let moved =
            move_external_note(&mut conn, None, dir.path(), "Ghost.md", "Risen.md", "body")
                .unwrap();
        assert!(
            matches!(moved, Moved::NoRow),
            "a move whose old path has no row reports NoRow"
        );
        let rows: Vec<String> = n::notes.select(n::path).load(&mut conn).unwrap();
        assert_eq!(rows, vec!["Kept.md"], "no phantom row is created here");
    }

    #[test]
    fn move_reports_stale_backlinks_and_leaves_them_untouched() {
        // An external move re-keys the moved note (phase A) but must NOT rewrite
        // inbound wikilinks (phase B is skipped); it reports how many are stale so
        // the frontend can offer to heal them.
        let dir = TempDir::new().unwrap();
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "Aldric.md");
        insert_note(&mut conn, 2, "Story.md");
        // Seed the moved note and a source that links to it by full path. Both
        // files must exist on disk so collect_backlink_rewrites_on_conn can read
        // the source to count it.
        upsert_external_note(&mut conn, None, "Aldric.md", "Aldric of the Keep.").unwrap();
        std::fs::write(dir.path().join("Story.md"), "The tale of [[Aldric.md]] begins.").unwrap();
        upsert_external_note(&mut conn, None, "Story.md", "The tale of [[Aldric.md]] begins.").unwrap();

        let moved = move_external_note(
            &mut conn,
            None,
            dir.path(),
            "Aldric.md",
            "Aldric the Bold.md",
            "Aldric of the Keep.",
        )
        .unwrap();

        // One inbound backlink is now stale.
        match moved {
            Moved::Rekeyed { stale_backlinks } => assert_eq!(stale_backlinks, 1),
            Moved::NoRow => panic!("existing note must re-key"),
        }
        // The source file is byte-for-byte untouched — phase B did not run.
        assert_eq!(
            std::fs::read_to_string(dir.path().join("Story.md")).unwrap(),
            "The tale of [[Aldric.md]] begins.",
            "an external move must not rewrite inbound wikilinks"
        );
    }

    #[test]
    fn move_with_no_inbound_links_reports_zero_stale() {
        let dir = TempDir::new().unwrap();
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "Aldric.md");
        upsert_external_note(&mut conn, None, "Aldric.md", "No one links here.").unwrap();

        let moved =
            move_external_note(&mut conn, None, dir.path(), "Aldric.md", "Renamed.md", "No one links here.")
                .unwrap();

        // No inbound links → count 0, so the caller emits no heal prompt.
        match moved {
            Moved::Rekeyed { stale_backlinks } => assert_eq!(stale_backlinks, 0),
            Moved::NoRow => panic!("existing note must re-key"),
        }
    }

    // ── classify_rename ────────────────────────────────────────────────────────

    #[test]
    fn classify_rename_correlates_two_in_scope_endpoints() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir(root.path().join("Characters")).unwrap();
        std::fs::create_dir(root.path().join("People")).unwrap();
        let canonical_root = std::fs::canonicalize(root.path()).unwrap();
        // `to` exists on disk; `from` is already gone (the file moved).
        let to = root.path().join("People").join("Aldric.md");
        std::fs::write(&to, "moved body").unwrap();
        let from = root.path().join("Characters").join("Aldric.md");

        let change = classify_rename(&canonical_root, &from, &to).unwrap();
        match change {
            Change::Moved { from_rel, to_rel, content } => {
                assert_eq!(from_rel, "Characters/Aldric.md");
                assert_eq!(to_rel, "People/Aldric.md");
                assert_eq!(content, "moved body");
            }
            _ => panic!("expected a Moved change"),
        }
    }

    #[test]
    fn classify_rename_declines_when_the_destination_is_out_of_scope() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir(root.path().join("Characters")).unwrap();
        let canonical_root = std::fs::canonicalize(root.path()).unwrap();
        // A note renamed to a non-`.md` name: `to` is not a note, so the pair
        // can't be a note move — decline so the caller degrades `from` to a
        // plain remove.
        let to = root.path().join("Aldric.txt");
        std::fs::write(&to, "x").unwrap();
        let from = root.path().join("Characters").join("Aldric.md");
        assert!(classify_rename(&canonical_root, &from, &to).is_none());
    }

    // ── correlate_moves ────────────────────────────────────────────────────────

    fn rels(changes: &[Change]) -> Vec<String> {
        changes
            .iter()
            .map(|c| match c {
                Change::Upsert { rel_path, .. } => format!("upsert:{rel_path}"),
                Change::Remove { rel_path } => format!("remove:{rel_path}"),
                Change::Moved { from_rel, to_rel, .. } => format!("moved:{from_rel}->{to_rel}"),
                Change::FolderRemoved { rel_path } => format!("folder-removed:{rel_path}"),
                Change::FolderArrived { rel_path, .. } => format!("folder-arrived:{rel_path}"),
                Change::FolderMoved { from_rel, to_rel, .. } => {
                    format!("folder-moved:{from_rel}->{to_rel}")
                }
            })
            .collect()
    }

    #[test]
    fn correlate_pairs_a_matching_delete_and_create() {
        let changes = vec![
            Change::Remove { rel_path: "Old.md".into() },
            Change::Upsert { rel_path: "New.md".into(), content: "same body".into() },
        ];
        // Oracle: the created content was written to "Old.md".
        let out = correlate_moves(changes, |from, content| from == "Old.md" && content == "same body");
        assert_eq!(rels(&out), vec!["moved:Old.md->New.md"]);
    }

    #[test]
    fn correlate_leaves_unmatched_delete_and_create_alone() {
        let changes = vec![
            Change::Remove { rel_path: "Gone.md".into() },
            Change::Upsert { rel_path: "Fresh.md".into(), content: "unrelated".into() },
        ];
        // Oracle never matches — an unrelated delete + create, not a move.
        let out = correlate_moves(changes, |_, _| false);
        assert_eq!(rels(&out), vec!["upsert:Fresh.md", "remove:Gone.md"]);
    }

    #[test]
    fn correlate_preserves_a_plain_modify() {
        let changes = vec![Change::Upsert {
            rel_path: "Edited.md".into(),
            content: "body".into(),
        }];
        // A lone modify (no delete to pair with) passes through untouched even if
        // the oracle would match — there is nothing for it to consider.
        let out = correlate_moves(changes, |_, _| true);
        assert_eq!(rels(&out), vec!["upsert:Edited.md"]);
    }

    // ── folders removed outside the app ───────────────────────────────────────

    /// What the frontend is told about a path that has just vanished from disk —
    /// classified, reconciled and turned into events exactly as the batch handler
    /// does, minus the debouncer and the `AppHandle`.
    fn events_for_vanished(
        conn: &mut SqliteConnection,
        root: &Path,
        vanished: &Path,
    ) -> Vec<(&'static str, serde_json::Value)> {
        let canonical_root = std::fs::canonicalize(root).unwrap();
        let change = classify(&canonical_root, vanished).expect("an in-scope path");
        emissions(reconcile_change(conn, None, root, change))
    }

    #[test]
    fn missing_relative_md_resolves_a_note_whose_folder_is_gone_too() {
        // Deleting a folder takes its notes with it, so by the time the batch is
        // classified the note's parent cannot be canonicalized either.
        let root = TempDir::new().unwrap();
        let canonical_root = std::fs::canonicalize(root.path()).unwrap();
        let deleted = root.path().join("zz Scratch").join("Deep").join("Note.md");
        assert_eq!(
            missing_relative_md(&canonical_root, &deleted),
            Some("zz Scratch/Deep/Note.md".to_string())
        );
    }

    /// The bug from the 2026-10 design review: an empty folder deleted on disk
    /// stayed in the Files tree, because nothing told the tree to refetch.
    #[test]
    fn an_empty_folder_removed_on_disk_refetches_the_tree() {
        let root = TempDir::new().unwrap();
        let mut conn = test_conn();
        std::fs::create_dir(root.path().join("zz Scratch")).unwrap();
        std::fs::remove_dir(root.path().join("zz Scratch")).unwrap();

        let events = events_for_vanished(&mut conn, root.path(), &root.path().join("zz Scratch"));
        assert_eq!(events, vec![("ledger:tree-changed", serde_json::Value::Null)]);
    }

    /// Windows reports a folder deleted with its contents as one removal of the
    /// folder — nothing for the notes inside it. Their rows have to go on the
    /// folder's word, or they linger as ghosts in search and backlinks.
    #[test]
    fn a_folder_removed_with_its_notes_drops_their_rows_and_says_so() {
        let root = TempDir::new().unwrap();
        let mut conn = test_conn();
        insert_note(&mut conn, 1, "zz Scratch/Note.md");
        insert_note(&mut conn, 2, "zz Scratch/Deep/Other.md");
        // Siblings a `LIKE 'zz Scratch%'` would also catch, plus an unrelated note.
        insert_note(&mut conn, 3, "zz Scratch 2/Keep.md");
        insert_note(&mut conn, 4, "zz Scratchpad.md");
        insert_note(&mut conn, 5, "Elsewhere.md");
        upsert_external_note(&mut conn, None, "zz Scratch/Note.md", "---\ntags: [npc]\n---\n[[Elsewhere.md]]")
            .unwrap();

        let events = events_for_vanished(&mut conn, root.path(), &root.path().join("zz Scratch"));
        assert_eq!(
            events,
            vec![
                ("note:removed", serde_json::json!({ "path": "zz Scratch/Deep/Other.md" })),
                ("note:removed", serde_json::json!({ "path": "zz Scratch/Note.md" })),
                ("ledger:tree-changed", serde_json::Value::Null),
            ]
        );

        let mut rows: Vec<String> = n::notes.select(n::path).load(&mut conn).unwrap();
        rows.sort();
        assert_eq!(rows, vec!["Elsewhere.md", "zz Scratch 2/Keep.md", "zz Scratchpad.md"]);
        let tags: Vec<String> = nt::note_tags.select(nt::note_path).load(&mut conn).unwrap();
        assert!(tags.is_empty(), "the removed notes' derived rows must go with them");
    }

    #[test]
    fn a_vanished_path_under_a_dot_folder_is_out_of_scope() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir(root.path().join(".grimoire")).unwrap();
        let canonical_root = std::fs::canonicalize(root.path()).unwrap();
        assert!(classify(&canonical_root, &root.path().join(".grimoire").join("thumbs")).is_none());
        assert!(classify(&canonical_root, &root.path().join(".trash")).is_none());
    }

    // ── folders that appear on disk ───────────────────────────────────────────

    use notify_debouncer_full::notify::event::{CreateKind, DataChange, RemoveKind};
    use notify_debouncer_full::notify::Event;

    fn event(kind: EventKind, paths: &[PathBuf]) -> Event {
        paths.iter().cloned().fold(Event::new(kind), Event::add_path)
    }

    /// A raw batch, taken the whole way the handler takes it: classified,
    /// correlated, reconciled, and turned into the events the frontend receives.
    fn events_for_batch(
        conn: &mut SqliteConnection,
        root: &Path,
        events: &[Event],
    ) -> Vec<(&'static str, serde_json::Value)> {
        let canonical_root = std::fs::canonicalize(root).unwrap();
        let changes = correlate_moves(classify_batch(&canonical_root, events), |_, _| false);
        batch_emissions(
            changes
                .into_iter()
                .map(|change| reconcile_change(conn, None, root, change))
                .collect(),
        )
    }

    fn note_row(conn: &mut SqliteConnection, id: i32) -> Note {
        n::notes.find(id).first(conn).unwrap()
    }

    fn all_paths(conn: &mut SqliteConnection) -> Vec<String> {
        let mut rows: Vec<String> = n::notes.select(n::path).load(conn).unwrap();
        rows.sort();
        rows
    }

    #[test]
    fn an_empty_folder_created_on_disk_refetches_the_tree() {
        let root = TempDir::new().unwrap();
        let mut conn = test_conn();
        let folder = root.path().join("Empty");
        std::fs::create_dir(&folder).unwrap();

        let events = events_for_batch(
            &mut conn,
            root.path(),
            &[event(EventKind::Create(CreateKind::Any), &[folder])],
        );
        assert_eq!(events, vec![("ledger:tree-changed", serde_json::Value::Null)]);
    }

    /// Windows reports a folder moved in from outside — or restored from the
    /// Recycle Bin — as one create of the folder, nothing for what it holds.
    #[test]
    fn a_folder_arriving_with_notes_gives_each_a_row() {
        let root = TempDir::new().unwrap();
        let mut conn = test_conn();
        let folder = root.path().join("Incoming");
        std::fs::create_dir_all(folder.join("Sub")).unwrap();
        std::fs::create_dir_all(folder.join(".obsidian")).unwrap();
        std::fs::write(folder.join("Note.md"), "---\ntags: [npc]\n---\nbody").unwrap();
        std::fs::write(folder.join("Sub").join("Deep.md"), "deep").unwrap();
        std::fs::write(folder.join(".obsidian").join("Hidden.md"), "no").unwrap();
        std::fs::write(folder.join("map.png"), "not a note").unwrap();

        let events = events_for_batch(
            &mut conn,
            root.path(),
            &[event(EventKind::Create(CreateKind::Any), &[folder])],
        );
        assert_eq!(events, vec![("ledger:tree-changed", serde_json::Value::Null)]);

        assert_eq!(all_paths(&mut conn), vec!["Incoming/Note.md", "Incoming/Sub/Deep.md"]);
        let deep: Note = n::notes.filter(n::path.eq("Incoming/Sub/Deep.md")).first(&mut conn).unwrap();
        assert_eq!(deep.title, "Deep");
        assert_eq!(deep.parent_path, Some("Incoming/Sub".to_string()));
        let tags: Vec<String> = nt::note_tags.select(nt::tag).load(&mut conn).unwrap();
        assert_eq!(tags, vec!["npc"], "an adopted note is reconciled, not just inserted");
    }

    /// `mkdir -p A/B` is two creates; the tree needs to hear about it once.
    #[test]
    fn nested_folders_arriving_together_refetch_the_tree_once() {
        let root = TempDir::new().unwrap();
        let mut conn = test_conn();
        std::fs::create_dir_all(root.path().join("A").join("B")).unwrap();
        std::fs::write(root.path().join("A").join("B").join("Note.md"), "x").unwrap();

        let events = events_for_batch(
            &mut conn,
            root.path(),
            &[
                event(EventKind::Create(CreateKind::Any), &[root.path().join("A")]),
                event(EventKind::Create(CreateKind::Any), &[root.path().join("A").join("B")]),
            ],
        );
        assert_eq!(events, vec![("ledger:tree-changed", serde_json::Value::Null)]);
        assert_eq!(all_paths(&mut conn), vec!["A/B/Note.md"]);
    }

    /// A folder is touched whenever something inside it changes. That is not the
    /// folder arriving, and walking it on every note save would refetch the tree
    /// for every keystroke-driven autosave in a subfolder.
    #[test]
    fn a_note_saved_inside_a_folder_does_not_count_as_the_folder_arriving() {
        let root = TempDir::new().unwrap();
        let mut conn = test_conn();
        let folder = root.path().join("Old");
        std::fs::create_dir(&folder).unwrap();
        std::fs::write(folder.join("Note.md"), "edited").unwrap();
        std::fs::write(folder.join("Stray.md"), "no row, and no event of its own").unwrap();
        insert_note(&mut conn, 1, "Old/Note.md");

        let events = events_for_batch(
            &mut conn,
            root.path(),
            &[
                event(EventKind::Modify(ModifyKind::Any), &[folder.clone()]),
                event(
                    EventKind::Modify(ModifyKind::Data(DataChange::Any)),
                    &[folder.join("Note.md")],
                ),
            ],
        );
        assert_eq!(
            events,
            vec![("note:content-changed", serde_json::json!({ "path": "Old/Note.md" }))]
        );
        assert_eq!(all_paths(&mut conn), vec!["Old/Note.md"], "the folder was not walked");
    }

    /// Renamed in Explorer: one paired event, and nothing for the notes inside.
    /// They keep their ids, so a pin or an open pane holding one stays attached.
    #[test]
    fn a_folder_renamed_on_disk_keeps_its_notes_ids() {
        let root = TempDir::new().unwrap();
        let mut conn = test_conn();
        std::fs::create_dir_all(root.path().join("New").join("Deep")).unwrap();
        std::fs::write(root.path().join("New").join("Note.md"), "---\ntags: [npc]\n---\nx").unwrap();
        std::fs::write(root.path().join("New").join("Deep").join("Other.md"), "y").unwrap();
        insert_note(&mut conn, 7, "Old/Note.md");
        insert_note(&mut conn, 8, "Old/Deep/Other.md");
        insert_note(&mut conn, 9, "Old Sibling/Keep.md");

        let events = events_for_batch(
            &mut conn,
            root.path(),
            &[event(
                EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
                &[root.path().join("Old"), root.path().join("New")],
            )],
        );
        assert_eq!(events, vec![("ledger:tree-changed", serde_json::Value::Null)]);

        let note = note_row(&mut conn, 7);
        assert_eq!(note.path, "New/Note.md");
        assert_eq!(note.parent_path, Some("New".to_string()));
        let other = note_row(&mut conn, 8);
        assert_eq!(other.path, "New/Deep/Other.md");
        assert_eq!(other.parent_path, Some("New/Deep".to_string()));
        assert_eq!(note_row(&mut conn, 9).path, "Old Sibling/Keep.md");
        let tag_paths: Vec<String> = nt::note_tags.select(nt::note_path).load(&mut conn).unwrap();
        assert_eq!(tag_paths, vec!["New/Note.md"], "derived rows follow the re-key");
    }

    /// Windows sends a folder's "modified" in a batch of its own just ahead of the
    /// rename that moves it, so by then the old name is already gone. Read as a
    /// removal, it dropped the rows the rename was about to re-key — every note
    /// in a renamed folder lost its id. A folder leaves by a remove or a rename.
    #[test]
    fn a_modify_on_a_folder_already_gone_is_not_its_removal() {
        let root = TempDir::new().unwrap();
        let mut conn = test_conn();
        insert_note(&mut conn, 7, "Old/Note.md");

        let events = events_for_batch(
            &mut conn,
            root.path(),
            &[event(EventKind::Modify(ModifyKind::Any), &[root.path().join("Old")])],
        );
        assert!(events.is_empty(), "{events:?}");
        assert_eq!(all_paths(&mut conn), vec!["Old/Note.md"]);

        // ...and the removal that follows in the same batch still counts.
        let events = events_for_batch(
            &mut conn,
            root.path(),
            &[
                event(EventKind::Modify(ModifyKind::Any), &[root.path().join("Old")]),
                event(EventKind::Remove(RemoveKind::Any), &[root.path().join("Old")]),
            ],
        );
        assert_eq!(events.len(), 2, "{events:?}");
        assert!(all_paths(&mut conn).is_empty());
    }

    /// A row whose file is not under the folder's new name has nothing to follow:
    /// it is dropped and reported, not re-keyed onto a path with no file.
    #[test]
    fn a_folder_rename_drops_a_row_whose_file_did_not_arrive() {
        let root = TempDir::new().unwrap();
        let mut conn = test_conn();
        std::fs::create_dir(root.path().join("New")).unwrap();
        std::fs::write(root.path().join("New").join("Note.md"), "x").unwrap();
        insert_note(&mut conn, 7, "Old/Note.md");
        insert_note(&mut conn, 8, "Old/Ghost.md");

        let events = events_for_batch(
            &mut conn,
            root.path(),
            &[event(
                EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
                &[root.path().join("Old"), root.path().join("New")],
            )],
        );
        assert_eq!(
            events,
            vec![
                ("note:removed", serde_json::json!({ "path": "Old/Ghost.md" })),
                ("ledger:tree-changed", serde_json::Value::Null),
            ]
        );
        assert_eq!(all_paths(&mut conn), vec!["New/Note.md"]);
        assert_eq!(note_row(&mut conn, 7).path, "New/Note.md");
    }

    /// Dragged into another folder in Explorer: not a paired rename but a
    /// removal and a create, of a folder with the same name.
    #[test]
    fn a_folder_moved_into_another_on_disk_keeps_its_notes_ids() {
        let root = TempDir::new().unwrap();
        let mut conn = test_conn();
        std::fs::create_dir_all(root.path().join("Dest").join("Old")).unwrap();
        std::fs::write(root.path().join("Dest").join("Old").join("Note.md"), "x").unwrap();
        insert_note(&mut conn, 7, "Old/Note.md");

        let events = events_for_batch(
            &mut conn,
            root.path(),
            &[
                event(EventKind::Remove(RemoveKind::Any), &[root.path().join("Old")]),
                event(EventKind::Create(CreateKind::Any), &[root.path().join("Dest").join("Old")]),
                event(EventKind::Modify(ModifyKind::Any), &[root.path().join("Dest")]),
            ],
        );
        assert_eq!(events, vec![("ledger:tree-changed", serde_json::Value::Null)]);
        assert_eq!(note_row(&mut conn, 7).path, "Dest/Old/Note.md");
        assert_eq!(all_paths(&mut conn), vec!["Dest/Old/Note.md"]);
    }

    /// A folder going and an unrelated one arriving in the same batch are not a
    /// move just because they coincide: the notes of the first are removed, the
    /// second's are new.
    #[test]
    fn folders_with_different_names_are_not_paired_as_a_move() {
        let root = TempDir::new().unwrap();
        let mut conn = test_conn();
        std::fs::create_dir(root.path().join("Fresh")).unwrap();
        std::fs::write(root.path().join("Fresh").join("Note.md"), "x").unwrap();
        insert_note(&mut conn, 7, "Gone/Note.md");

        let events = events_for_batch(
            &mut conn,
            root.path(),
            &[
                event(EventKind::Remove(RemoveKind::Any), &[root.path().join("Gone")]),
                event(EventKind::Create(CreateKind::Any), &[root.path().join("Fresh")]),
            ],
        );
        assert_eq!(
            events,
            vec![
                ("note:removed", serde_json::json!({ "path": "Gone/Note.md" })),
                ("ledger:tree-changed", serde_json::Value::Null),
            ]
        );
        assert_eq!(all_paths(&mut conn), vec!["Fresh/Note.md"]);
    }

    /// The app's own folder move (`relocate_folder`) has already re-keyed every
    /// row by the time the watcher hears the rename, under the same lock. The
    /// echo must find nothing to do but refetch.
    #[test]
    fn the_apps_own_folder_move_is_a_harmless_echo() {
        let root = TempDir::new().unwrap();
        let mut conn = test_conn();
        std::fs::create_dir(root.path().join("New")).unwrap();
        std::fs::write(root.path().join("New").join("Note.md"), "x").unwrap();
        insert_note(&mut conn, 7, "New/Note.md");

        let events = events_for_batch(
            &mut conn,
            root.path(),
            &[event(
                EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
                &[root.path().join("Old"), root.path().join("New")],
            )],
        );
        assert_eq!(events, vec![("ledger:tree-changed", serde_json::Value::Null)]);
        assert_eq!(note_row(&mut conn, 7).path, "New/Note.md");
        assert_eq!(all_paths(&mut conn), vec!["New/Note.md"]);
    }

    // ── require_unwatched ─────────────────────────────────────────────────────

    /// The obligation the token stands for: a bulk rewrite of a vault's notes may
    /// not run underneath a watcher pointed at that same vault (#217).
    #[test]
    fn a_vault_its_own_watcher_is_running_over_cannot_be_rewritten() {
        let vault = PathBuf::from("/vaults/Aldric");
        let err = unwatched_verdict(Some(&vault), &vault)
            .expect_err("a watched vault must refuse the rewrite");
        assert!(err.contains("Refusing to rewrite"), "err={err}");
    }

    /// And the case the guard must *not* fire on. A [[Format Migration]] is reached
    /// from a refused open, so the ledger the GM had open before that refusal may
    /// still be watched — a different vault, and none of this one's business.
    #[test]
    fn a_watcher_over_a_different_vault_does_not_block_the_rewrite() {
        assert!(unwatched_verdict(Some(Path::new("/vaults/Other")), Path::new("/vaults/Aldric")).is_ok());
        assert!(unwatched_verdict(None, Path::new("/vaults/Aldric")).is_ok());
    }
}
