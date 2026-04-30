# Architecture

## Frontend ↔ Backend Bridge

All data flows through Tauri IPC commands. The frontend calls `invoke('command_name', { args })` and the Rust backend handles it. Commands are registered in `src-tauri/src/lib.rs` and implemented in `src-tauri/src/commands/`.

## State Management

All app state lives in `src/lib/stores/` as Svelte 5 rune-based modules (`.svelte.ts` files). These are **not** Svelte stores — they use `$state` and `$effect` directly and are imported as singletons.

Key stores:

- `vault.svelte.ts` — tracks open vault path; triggers other stores to reload when vault opens/closes
- `notes.svelte.ts` — note list + content cache; reads `.md` files from disk via Tauri
- `scenes.svelte.ts` — scenes + per-scene slot cache
- `audio-engine.svelte.ts` — complex playback state machine bridging Web Audio API (local files) and Spotify Web Playback SDK

## Routing

SvelteKit file-based routing in SPA mode (no SSR — `adapter-static` with `fallback: 'index.html'`). Routes:

- `/` — vault splash or vault home
- `/note/[id]` — TipTap Markdown editor
- `/scene` — all scenes grid
- `/scene/[id]` — scene detail (audio slots)
- `/map/[id]` — planned, not yet implemented

## Component Structure

- `AppShell.svelte` — root layout when vault is open; wraps sidebar + main content
- `sidebar/AppSidebar.svelte` — file tree, scene list, action buttons
- `sidebar/FileTree.svelte` — recursive tree with context menu (rename/delete)
- `editor/Editor.svelte` — TipTap wrapper with Markdown extension
- `ui/` — shadcn-svelte generated components (do not hand-edit these)

## Rust Backend

`src-tauri/src/commands/` contains one file per domain:

- `vault.rs` — open/close vault, initializes DB connection and runs migrations
- `notes.rs` — CRUD for notes; content is stored as raw `.md` files on disk, metadata in SQLite
- `scenes.rs` — scenes and scene slots (audio config)
- `maps.rs` — maps, pins, pin categories
- `media.rs` — copies audio/image files into the vault's media directory
- `spotify.rs` — OAuth flow, token storage, token refresh

`VaultState` (in `vault.rs`) is a `Mutex<Option<AppVault>>` managed by Tauri state. Commands guard against uninitialized vault with early returns.

## Database

SQLite at `<vault_path>/.grimoire/grimoire.db`. Diesel ORM with migrations in `src-tauri/migrations/`. Edit migrations, not `schema.rs` directly.

## Key Libraries

| Library                 | Purpose                                               |
| ----------------------- | ----------------------------------------------------- |
| `@tiptap/*`             | Rich text / Markdown editing                          |
| `bits-ui`               | Headless UI primitives                                |
| `shadcn-svelte`         | Pre-built UI components (in `src/lib/components/ui/`) |
| `paneforge`             | Resizable panel layouts                               |
| `mode-watcher`          | Dark/light mode                                       |
| `@tauri-apps/plugin-fs` | File system access (with watch support)               |
| `diesel` (Rust)         | SQLite ORM                                            |
| `reqwest` (Rust)        | HTTP client (Spotify API calls)                       |
