# Architecture

## Frontend ↔ Backend Bridge

All data flows through Tauri IPC commands. The frontend calls `invoke('command_name', { args })` and the Rust backend handles it. Commands are registered in `src-tauri/src/lib.rs` and implemented in `src-tauri/src/commands/`.

## State Management

All app state lives in `src/lib/stores/` as Svelte 5 rune-based modules (`.svelte.ts` files). These are **not** Svelte stores — they use `$state` and `$effect` directly and are imported as singletons.

Key stores:

- `ledger.svelte.ts` — tracks open ledger path; triggers other stores to reload when ledger opens/closes
- `notes.svelte.ts` — note list + content cache; reads `.md` files from disk via Tauri
- `scenes.svelte.ts` — scenes + per-scene slot cache
- `audio-engine.svelte.ts` — complex playback state machine bridging Web Audio API (local files) and Spotify Web Playback SDK

Two seams sit beside the stores rather than in them:

- `src/lib/details/` — one [[Details Source]] per entity kind (note, pin, annotation) feeding a Details Pane body, plus the save-status machine and staleness guard they share. Instantiated per pane, not a singleton. Beside them, `pane-detail-surface.svelte.ts` holds the other half of a pane's Details Pane: the pane's measured width, the dock/float/sheet decision it implies, the visibility latch and the mobile overlay token. One per pane slot (`paneSurface('left' | 'right')`), claimed by whatever content the pane is showing; `DetailSurface.svelte` is the chrome it chooses between.
- `src/lib/ledger/events.ts` — the [[Ledger Watcher]]'s frontend event contract: every backend event name, its payload, and one `onLedgerEvents` subscription helper. Nothing else should spell these event names.

## Routing

SvelteKit file-based routing in SPA mode (no SSR — `adapter-static` with `fallback: 'index.html'`). Routes:

- `/` — ledger splash or ledger home
- `/note/[id]` — TipTap Markdown editor
- `/scene` — all scenes grid
- `/scene/[id]` — scene detail (audio slots)
- `/map/[id]` — planned, not yet implemented

## Component Structure

- `AppShell.svelte` — root layout when ledger is open; wraps sidebar + main content
- `sidebar/AppSidebar.svelte` — file tree, scene list, action buttons
- `sidebar/FileTree.svelte` — recursive tree with context menu (rename/delete)
- `editor/Editor.svelte` — TipTap wrapper with Markdown extension
- `ui/` — shadcn-svelte generated components (do not hand-edit these)

## Rust Backend

`src-tauri/src/commands/` contains one file per domain:

- `ledger.rs` — open/close ledger, initializes DB connection and runs migrations
- `notes.rs` — CRUD for notes; content is stored as raw `.md` files on disk, metadata in SQLite
- `scenes.rs` — scenes and scene slots (audio config)
- `maps.rs` — maps, pins, pin categories
- `media.rs` — copies audio/image files into the ledger's media directory
- `spotify.rs` — OAuth flow, token storage, token refresh

`LedgerState` (in `ledger.rs`) is the Tauri-managed state behind `AppLedger = Mutex<LedgerState>`: a folder, a database connection and a search index, all `None` until a ledger opens.

A command never reconstructs that from the three `Option`s. `with_open_ledger(&ledger, |l| …)` locks the state and hands the closure an `OpenLedger` — `path`, `conn`, `index` — or fails with `ERR_NO_LEDGER` / `ERR_LOCK_POISONED`, which are spelled once in `ledger.rs`. Commands whose work is all on disk take `ledger_path(&ledger)?` instead, which releases the lock before returning. The lock is held for the whole closure, so nothing inside it may call another command that locks `AppLedger`.

Domain work then takes the resolved `OpenLedger` (or plain `conn` / `&Path` params) in a `*_inner` / `*_on_conn` function, which is what the tests call — no `State<AppLedger>` required.

## Database

SQLite at `<ledger_path>/.grimoire/grimoire.db`. Diesel ORM with migrations in `src-tauri/migrations/`. Edit migrations, not `schema.rs` directly.

## Key Libraries

| Library                 | Purpose                                               |
| ----------------------- | ----------------------------------------------------- |
| `@tiptap/*`             | Rich text / Markdown editing                          |
| `bits-ui`               | Headless UI primitives                                |
| `shadcn-svelte`         | Pre-built UI components (in `src/lib/components/ui/`) |
| `mode-watcher`          | Dark/light mode                                       |
| `@tauri-apps/plugin-fs` | File system access (with watch support)               |
| `diesel` (Rust)         | SQLite ORM                                            |
| `reqwest` (Rust)        | HTTP client (Spotify API calls)                       |
