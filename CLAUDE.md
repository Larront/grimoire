# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Grimoire

A Tauri 2 desktop app for worldbuilding. Users open a "vault" (directory), then manage Notes (Markdown), Scenes (ambient audio with slots), and Maps (annotated images with pins). The frontend is Svelte 5 with SvelteKit; the backend is Rust with SQLite via Diesel.

## Commands

```bash
# Frontend dev (Vite only, no Tauri window)
bun run dev

# Full desktop app (Tauri + Vite)
bun run tauri dev

# Type-check
bun run check
bun run check:watch

# Build desktop app
bun run tauri build
```

No test suite exists yet.

## Architecture

### Frontend ↔ Backend Bridge

All data flows through Tauri IPC commands. The frontend calls `invoke('command_name', { args })` and the Rust backend handles it. Commands are registered in `src-tauri/src/lib.rs` and implemented in `src-tauri/src/commands/`.

### State Management

All app state lives in `src/lib/stores/` as Svelte 5 rune-based modules (`.svelte.ts` files). These are **not** Svelte stores — they use `$state` and `$effect` directly and are imported as singletons.

Key stores:
- `vault.svelte.ts` — tracks open vault path; triggers other stores to reload when vault opens/closes
- `notes.svelte.ts` — note list + content cache; reads `.md` files from disk via Tauri
- `scenes.svelte.ts` — scenes + per-scene slot cache
- `audio-engine.svelte.ts` — complex playback state machine bridging Web Audio API (local files) and Spotify Web Playback SDK

### Routing

SvelteKit file-based routing in SPA mode (no SSR — `adapter-static` with `fallback: 'index.html'`). Routes:
- `/` — vault splash or vault home
- `/note/[id]` — TipTap Markdown editor
- `/scene` — all scenes grid
- `/scene/[id]` — scene detail (audio slots)
- `/map/[id]` — planned, not yet implemented

### Component Structure

- `AppShell.svelte` — root layout when vault is open; wraps sidebar + main content
- `sidebar/AppSidebar.svelte` — file tree, scene list, action buttons
- `sidebar/FileTree.svelte` — recursive tree with context menu (rename/delete)
- `editor/Editor.svelte` — TipTap wrapper with Markdown extension
- `ui/` — shadcn-svelte generated components (do not hand-edit these)

### Rust Backend

`src-tauri/src/commands/` contains one file per domain:
- `vault.rs` — open/close vault, initializes DB connection and runs migrations
- `notes.rs` — CRUD for notes; content is stored as raw `.md` files on disk, metadata in SQLite
- `scenes.rs` — scenes and scene slots (audio config)
- `maps.rs` — maps, pins, pin categories
- `media.rs` — copies audio/image files into the vault's media directory
- `spotify.rs` — OAuth flow, token storage, token refresh

The `VaultState` (in `vault.rs`) is a `Mutex<Option<AppVault>>` managed by Tauri state. Commands guard against uninitialized vault with early returns.

### Database

SQLite at `<vault_path>/.grimoire/grimoire.db`. Diesel ORM with migrations in `src-tauri/migrations/`. Schema is auto-generated — edit migrations, not `schema.rs` directly.

## Key Libraries

| Library | Purpose |
|---|---|
| `@tiptap/*` | Rich text / Markdown editing |
| `bits-ui` | Headless UI primitives |
| `shadcn-svelte` | Pre-built UI components (in `src/lib/components/ui/`) |
| `paneforge` | Resizable panel layouts |
| `mode-watcher` | Dark/light mode |
| `@tauri-apps/plugin-fs` | File system access (with watch support) |
| `diesel` (Rust) | SQLite ORM |
| `reqwest` (Rust) | HTTP client (Spotify API calls) |

## Conventions

- **Svelte 5 runes only** — use `$state`, `$derived`, `$effect`. No legacy Svelte 4 stores.
- **shadcn-svelte components** are generated into `src/lib/components/ui/` — prefer using them rather than raw HTML for consistent styling.
- Tailwind CSS 4 (no `tailwind.config.ts` class list needed — uses CSS-first config in `app.css`).
- The Vite dev server runs on port **1420** (required by Tauri).

## Design Context

**Target users:** Tabletop RPG game masters managing lore, NPCs, maps, and session prep. They alternate between creative worldbuilding sessions and fast in-session lookups — the UI must serve both.

**Brand personality:** Arcane, Grounded, Purposeful. A spellbook of record, not a game or a toy. The fantasy aesthetic lives in typography and color, not decoration.

**Theme:** Dark mode is the primary/canonical experience. Design in dark first, light second.

**Typography is load-bearing:** `Metamorphous` (headings) carries the arcane character. `Nunito` (body) keeps things warm and readable. Preserve this contrast deliberately.

**Color:** Cool-toned — dark navy + teal. Reads as moonlight and deep water, not warm-fantasy amber. Avoid warm decorative color unless it's in user content.

**Design principles:**
1. **The world, not the tool** — UI chrome recedes; content dominates. Every element earns its presence.
2. **Arcane clarity** — Character from typography and color depth, never from literal fantasy iconography.
3. **Dark by nature** — Evaluate contrast and richness in dark palette first.
4. **Purposeful restraint** — Personality from a few deliberate choices, not accumulation of decoration.
5. **GM clarity under pressure** — Hierarchy must be scannable at a glance; labels unambiguous; loading states non-disruptive.

**Anti-patterns to avoid:** generic SaaS dashboard feel, gamified/kitsch dungeon aesthetics, personality-free minimalism, cluttered competing panels.
