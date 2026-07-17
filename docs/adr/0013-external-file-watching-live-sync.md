# ADR-0013 — External file watching keeps the ledger live-synced

**Status:** Accepted
**Date:** 2026-07-07

## Context

Grimoire is local-first: notes are plain `.md` files on disk and the app is meant to sit alongside Obsidian, a text editor, `git`, and cloud-sync tools operating on the same ledger folder. But today nothing detects external changes. A note's body is read from disk exactly once per navigation (`read_note_content`, `NotePane.svelte`'s load `$effect` gated on `note.id !== lastFetchedId`); the SQLite metadata, the [[Derived Index]] set, and the Files tree are reconciled only at `open_ledger`. So if a `.md` file is edited, created, deleted, or moved outside the app while a ledger is open:

- an open note shows stale content, and worse, the editor's in-memory buffer **overwrites** the external edit on the next autosave (the 500ms debounce in `Editor.svelte`);
- new/deleted/renamed files never appear in or leave the Files tree until reopen;
- tags, links, aliases, and search silently drift from what's on disk.

This directly contradicts the portability principle the ledger is designed around ("delete `.grimoire/` and recover from a ledger scan" — the ledger *is* the source of truth, not the app's cache of it). We want external edits to appear live.

Two structural facts of the codebase shaped the decision:

1. **There is no single write chokepoint.** ~8 independent `std::fs` calls across `commands/notes.rs` and `commands/tree.rs` write/create/delete/rename note files. They *do* all sit next to a single index-update seam ([[Derived Index]] `reconcile`/`remove`). Notably `rename_note` rewrites an unbounded set of *other* notes (wikilink backlink rewrites), so any "the app just wrote this one path" scheme is insufficient.
2. **All app-internal state lives under one directory** — `<ledger>/.grimoire/` (SQLite `ledger.db` + `-wal`/`-shm`, Tantivy `search-index/`, thumbnails, images, audio, backups, `search.stale`, `prefs.json`). The existing traversal already skips leading-dot segments (`import.rs`). So a recursive watcher can exclude that one subtree and never see SQLite/Tantivy write churn.

## Decision

Add a **backend `notify` file watcher** rooted at the ledger that keeps the [[Derived Index]] set, the `notes` table, and the frontend live-synced with on-disk `.md` changes, distinguishing the app's own writes from genuine external edits by **content hash**, and resolving open-editor conflicts with a **non-destructive banner**. Built in stages (below); scope is the full ledger, not just open notes.

Seven resolved points:

1. **Scope — full ledger sync, staged.** Content reload, Files-tree sync, and DB/index reconciliation are all in scope, but delivered in the stage order below so the risky editor-conflict surface lands on a proven watcher.
2. **Watcher home — Rust backend (`notify`).** The watcher lives in `src-tauri`, drives `reconcile`/`remove`/`rebuild_all_from_ledger` directly, and emits Tauri events to the frontend. The frontend never watches files. (The compiled-in but unused `tauri-plugin-fs` `watch` feature is *not* the vehicle — full sync needs Rust-side DB access, not a frontend round-trip.)
3. **Echo suppression — content hash via a new write chokepoint.** Introduce `write_note_file(path, bytes)` and route all ~8 fs write sites through it; it records a hash of the exact bytes written into a bounded per-path registry on `AppLedger` (the [[Ledger Watcher]]'s recent-write set). On every watch event the watcher re-reads the file and hashes it: a hash that matches the registry is the app's own echo (consume and drop), a hash that differs is a genuine external edit. Race-free (an external edit that lands between our write and the event produces a different hash and is *not* suppressed) and it naturally covers `rename_note`'s many backlink files because each rewrite records its own hash.
4. **Conflict policy — clean reloads silently, dirty shows a [[Conflict Banner]].** When the file under an open note changes externally: if the editor buffer is clean, reload content from disk silently; if the buffer is dirty (unsaved edits / mid-debounce), show a non-destructive in-pane banner offering *Reload from disk* / *Keep my version*. Neither side is ever discarded without consent.
5. **Burst handling — debounce + adaptive fallback.** Coalesce raw events over a short window (~150ms; the `notify` debouncer also collapses atomic-save rename churn). A small coalesced batch reconciles per-file with targeted frontend events; a batch over a threshold (bulk op — `git checkout`, cloud sync, find-replace) falls back to `rebuild_all_from_ledger` (the same idempotent path `open_ledger` uses) plus a wholesale frontend refetch. Keeps a 500-file sync from issuing 500 Tantivy commits.
6. **Deleted / moved while open — keep-open banner + follow moves.** A file deleted on disk while open keeps its pane, marks the buffer unsaved, and shows a banner (*Save to recreate* / *Close*) — nothing the GM is looking at vanishes unprompted. A move (delete+create sharing a content hash within the debounce window, or a native `notify` rename event) is followed silently: the pane's path updates and editing continues. Unmatched → degrades to delete + new-file.
7. **Watcher exclusion — `<ledger>/.grimoire/`.** The recursive watcher ignores that one subtree (matching the existing leading-dot convention), so the app's own DB/index/media writes never generate events. Only `.md` writes need the hash-based echo suppression of point 3.

## Rationale

### Why the watcher is in Rust, not the frontend

Full sync means updating SQLite entities and the [[Derived Index]] set, which only the Rust side touches. A frontend `watchImmediate` watcher would round-trip every event back into a command anyway, and would split the "indexes agree with disk" invariant across the process boundary — the exact fragmentation the `note_index` reconcile seam (see the *Derived Index reconciliation* decision) exists to prevent. One watcher, next to the indexes it maintains, reusing `reconcile`/`remove`/`rebuild_all_from_ledger` verbatim.

### Why content hash beats a time-window mute

The obvious cheap scheme — add written paths to a "muted" set for N milliseconds — *loses data*: an external edit that lands inside the window is silently dropped, and N is unknowable across slow disks and cloud-sync latency. Hashing the bytes we wrote turns "is this our echo?" into an exact content comparison with no timing assumption. It costs one hash per write and per event (the content is already in hand on the write side, and the event handler must re-read to reconcile regardless), and it doubles as the move-correlation key for point 6. The unbounded-backlink-rewrite behaviour of `rename_note` makes a set-of-hashes mandatory anyway, so a per-path scheme was never viable.

### Why the write chokepoint is worth the refactor

The codebase already *wants* this seam — 8 sites re-implement "touch the file, then reconcile." Routing writes through `write_note_file` records the echo hash for free and gives future work (audit, backup-on-write, conflict detection) one place to hang off. It mirrors the deepening that produced the `note_index` reconcile module: concentrate a scattered invariant behind one verb.

### Why a banner, not external-wins or in-app-wins

External-wins can discard a sentence the GM is mid-typing when a sync tool writes; in-app-wins silently clobbers the external edit — the *exact* bug this ADR exists to kill. The banner is the only option that never destroys either side unprompted, and it matches Obsidian/VS Code muscle memory. It is deliberately the last stage: it needs a proven watcher and the editor's existing `dirty` flag beneath it.

### Why exclude `.grimoire/` solves most of the echo problem for free

Because every app-internal artifact is under `.grimoire/` and the traversal convention already skips it, the watcher never sees Tantivy segment writes or SQLite WAL churn. That means the hash-based suppression only has to arbitrate genuine `.md` writes — a far smaller, well-bounded surface than "everything the app does to the folder."

## Consequences

- **New dependency.** `notify` (with a debouncer — `notify-debouncer-full`, which also surfaces native rename events feeding point 6) is added to `src-tauri`. The `tauri-plugin-fs` `watch` feature, compiled in but unused, can be dropped unless wanted elsewhere.
- **Write path refactor precedes everything.** Stage 0 is a pure refactor: introduce `write_note_file` + the recent-write hash registry on `AppLedger`, route all fs write sites through it, no behavior change. This is the foundation both echo suppression and move-correlation stand on.
- **Watcher lifecycle rides `open_ledger`.** The watcher starts on ledger open, is torn down / re-rooted on ledger switch and window close, and is a no-op when no ledger is open. It reuses the idempotent Ledger setup framework's reconcile functions, so an external change and an open-time rebuild share one code path.
- **Frontend event contract.** The backend emits targeted events (`note:content-changed` `{path}`, `note:removed` `{path}`, `ledger:tree-changed`) for small batches and a coarse `ledger:rebuilt` for the bulk-fallback case; the frontend refetches the notes store / Files tree / active [[Details Source]] accordingly. Content reload for an open note is gated on the [[Conflict Banner]] policy (point 4).
- **Staged delivery.** Stage 0 write chokepoint → Stage 1 watcher + reconcile/echo-suppression (tree & metadata go live) → Stage 2 frontend refetch listeners → Stage 3 clean-buffer content reload → Stage 4 conflict banner + deleted/moved-while-open handling. Each stage is independently shippable; the motivating "edit an open note externally and see it" case is complete at Stage 3, hardened at Stage 4.
- **Ledger portability reinforced.** With the watcher live, the app tracks the filesystem rather than assuming it owns it — the "delete `.grimoire/` and recover from a ledger scan" principle now holds *during* a session, not only across restarts.
</content>
</invoke>
