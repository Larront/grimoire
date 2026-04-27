---
title: Architecture
focus: arch
date: 2026-04-28
---

# Architecture

## Pattern

Tauri 2 desktop application: a SvelteKit SPA rendered in a WebView, backed by a Rust process that owns all disk and database access. The two halves communicate exclusively through Tauri IPC.

```
┌─────────────────────────────────────────────────────┐
│  WebView (Chromium)                                  │
│  SvelteKit SPA (adapter-static, no SSR)             │
│  Svelte 5 rune stores  ←→  UI Components            │
│         │                                            │
│    invoke() / listen()   ← Tauri IPC bridge →       │
└──────────────────────────────────────────────────────┘
              │
┌─────────────────────────────────────────────────────┐
│  Rust process (Tauri core)                           │
│  Command handlers  ←→  VaultState (Mutex<AppVault>) │
│         │                                            │
│    Diesel ORM → SQLite (.grimoire/grimoire.db)       │
│    Filesystem (notes as .md, media files)            │
└──────────────────────────────────────────────────────┘
```

## Layers

### Frontend

1. **Routes** (`src/routes/`) — SvelteKit page components. Thin; they read from stores and render components.
2. **Stores** (`src/lib/stores/`) — All application state. Svelte 5 rune-based singletons (`.svelte.ts` files). Call `invoke()` to load data; expose reactive getters.
3. **Components** (`src/lib/components/`) — Presentational + interactive UI. Three categories:
   - Feature components (`map/`, `editor/`, `sidebar/`) — domain-specific
   - Generated UI primitives (`ui/`) — shadcn-svelte, do not hand-edit
   - Root shell (`AppShell.svelte`) — layout wrapper
4. **Editor extensions** (`src/lib/editor/`) — Custom TipTap Node/Mark/Extension modules.

### Backend

1. **Entry point** — `src-tauri/src/lib.rs` registers all Tauri commands and plugins.
2. **Command handlers** (`src-tauri/src/commands/`) — One file per domain. Each handler acquires `VaultState`, performs DB or filesystem operations, returns serialized data.
3. **State** (`src-tauri/src/vault.rs`) — `VaultState` is a `Mutex<Option<AppVault>>`. `AppVault` holds the Diesel SQLite connection.
4. **DB layer** (`src-tauri/src/db/`) — Diesel models (`models.rs`), auto-generated schema (`schema.rs`), connection helper (`mod.rs`).

## Data Flow

### Vault Open/Close Lifecycle
```
User picks folder
  → vault.openVault()
  → invoke("open_vault", { path })
  → Rust: runs Diesel migrations, sets VaultState
  → returns { path, note_count, scene_count, map_count }
  → frontend stores set isOpen = true
  → other stores reactively reload (notes, scenes, maps)
```

### Note Save
```
Editor.svelte onChange
  → debounced write
  → invoke("write_note_content", { path, content })
  → Rust: writes .md file to vault/path
  → invoke("update_note", { id, title, ... })
  → Rust: updates notes table in SQLite
```

### Audio Crossfade
```
audioEngine.crossfadeTo(sceneId)
  → isCrossfading = true
  → invoke("get_scene_slots", { sceneId })
  → LocalPlayer.startAtVolume() for each new slot
  → fade out current slots, fade in new slots
  → stop old nodes after FADE_SEC
  → isCrossfading = false
```

### Map Image Display
```
map page mounts
  → invoke("get_map_image_data_url", { mapId })
  → Rust: reads image file, base64-encodes it, returns data URL
  → MapCanvas.svelte: sets img src to data URL
  → Leaflet map initialized on image load
  → parallel: invoke("get_pins"), invoke("get_annotations")
```

## Key Abstractions

### VaultState (`src-tauri/src/vault.rs`)
```rust
pub struct VaultState(pub Mutex<Option<AppVault>>);

pub struct AppVault {
    pub conn: SqliteConnection,
    pub path: String,
}
```
Guards every command that touches the DB. Commands pattern-match on `None` and return early if vault is not open.

### Rune Store Factory Pattern (`src/lib/stores/vault.svelte.ts`)
```typescript
function createVaultStore() {
  let path = $state<string | null>(null);
  let isOpen = $state(false);
  // ...
  return { get path() { return path; }, openVault, closeVault };
}
export const vault = createVaultStore();
```
All stores follow this pattern: factory function with `$state` locals, exported as module-level singleton. No Svelte 4 store primitives used.

### Tauri IPC Bridge
All cross-boundary calls use `invoke()` from `@tauri-apps/api/core`. Asset serving (audio files, images served efficiently) uses `convertFileSrc()` to route through the `asset://` protocol instead of copying bytes through IPC.

### TipTap Editor (`src/lib/editor/`)
Custom extensions registered as TipTap `Node` or `Extension` classes. `wiki-link.ts` handles `[[...]]` wikilink syntax. `scene-block.svelte.ts` is a Svelte 5 NodeView. `slash-command.ts` drives the `/` command palette.

## Entry Points

| Entry Point | Path |
|-------------|------|
| Tauri app bootstrap | `src-tauri/src/main.rs` → `lib.rs` |
| IPC command registry | `src-tauri/src/lib.rs` (invoke_handler macro) |
| SvelteKit app root | `src/routes/+layout.svelte` |
| SvelteKit layout config | `src/routes/+layout.ts` (SPA mode) |
| Vite config | `vite.config.ts` |
| Tailwind CSS config | `src/app.css` (CSS-first, no tailwind.config.ts) |

## Anti-patterns to Avoid

- Do not bypass `VaultState` — never call `SqliteConnection` directly outside a command handler.
- Do not use Svelte 4 stores (`writable`, `readable`, `derived`) — use `$state`/`$derived` runes.
- Do not hand-edit `src/lib/components/ui/` — these are generated by shadcn-svelte.
- Do not hand-edit `src-tauri/src/db/schema.rs` — generated by Diesel CLI from migrations.
- Do not transfer large files (images, audio) through `invoke()` — use `convertFileSrc()` and the asset protocol.
