---
title: Codebase Concerns
focus: concerns
date: 2026-04-28
---

# Codebase Concerns

Technical debt, known bugs, security issues, performance bottlenecks, and fragile areas in the Grimoire codebase.

---

## Tech Debt

### Boolean Columns Stored as INTEGER
**Severity:** Low–Medium  
**Files:** `src-tauri/src/commands/scenes.rs`, `src-tauri/migrations/`  
`is_loop`, `shuffle`, and `archived` are stored as `INTEGER` in SQLite and require manual bool casts throughout Rust code. Diesel supports proper boolean columns — these should be migrated.

### Spotify Client ID Re-read Per Invocation
**Severity:** Low  
**Files:** `src-tauri/src/commands/spotify.rs`  
`SPOTIFY_CLIENT_ID` is re-read from `.env` on every command invocation instead of being loaded once at startup and stored in Tauri state. Adds unnecessary file I/O on each Spotify call.

### Misleading Parameter Name `_note_path`
**Severity:** Low  
**Files:** `src-tauri/src/commands/notes.rs`  
The `_note_path` parameter name implies it's unused (Rust underscore prefix convention), but it is actively used. Should be renamed to `note_path`.

### Stale Counts After Mutations
**Severity:** Low–Medium  
**Files:** `src/lib/stores/notes.svelte.ts`, `src/lib/stores/scenes.svelte.ts`  
Recent vault item counts are stale post-mutation. No cache invalidation is triggered after create/delete operations, so UI counts can be out of sync until the next full reload.

### No `close_vault` Backend Command
**Severity:** Medium  
**Files:** `src/lib/stores/vault.svelte.ts`, `src-tauri/src/commands/vault.rs`  
`closeVault()` in the frontend clears local state but never calls a Rust backend command to release the SQLite connection. The database handle persists until the process exits, which can cause issues on re-open or vault switching.

---

## Known Bugs

### Leaflet Layer Leak in MapCanvas
**Severity:** Medium  
**File:** `src/lib/components/maps/MapCanvas.svelte`  
`markerMap` and `annotationLayerMap` could accumulate Leaflet layers on same-type map-to-map navigation (e.g., navigating from `/map/1` to `/map/2` without full component teardown). Layers may not be properly cleaned up, causing visual artifacts or memory growth.

### Spotify OAuth Listener Never Unregistered
**Severity:** Low–Medium  
**File:** `src-tauri/src/commands/spotify.rs`, `src/lib/stores/audio-engine.svelte.ts`  
The Tauri event `listen()` handle for the Spotify OAuth callback is never unregistered. Repeated auth flows accumulate handlers.

### `isLoadingData` Tracks Only Image Load
**Severity:** Low  
**File:** `src/lib/components/maps/MapCanvas.svelte`  
`isLoadingData` resolves when the map image loads, but the concurrent pin and annotation fetches via IPC may still be in flight. The UI shows "ready" before map data has fully arrived.

---

## Security

### Spotify Access Token Exposed in Renderer
**Severity:** High  
**Files:** `src-tauri/src/commands/spotify.rs`, `src/lib/stores/audio-engine.svelte.ts`  
The raw Spotify access token is returned to the frontend via IPC and used directly in `fetch()` calls from the renderer process. This exposes the token to any JavaScript running in the webview. Token refresh and API calls should remain in the Rust backend.

### No Path Traversal Guard on File Operations
**Severity:** High  
**Files:** `src-tauri/src/commands/notes.rs`, `src-tauri/src/commands/media.rs`  
Vault-relative file paths supplied by the frontend are not validated against the vault root. A crafted path containing `..` could escape the vault directory and read or write arbitrary files on the user's system.

---

## Performance

### Map Images Loaded as Base64 over IPC
**Severity:** Medium  
**File:** `src-tauri/src/commands/maps.rs`  
`get_map_image_data_url` reads the entire map image into memory and returns it as a base64 string over the IPC bridge. The audio engine already uses the correct pattern (`convertFileSrc` from `@tauri-apps/api/core`) which serves assets via a local HTTP protocol without copying through the bridge. Maps should use the same approach.

### Icon Cache Rebuilt on Every MapCanvas Mount
**Severity:** Low  
**File:** `src/lib/components/maps/MapCanvas.svelte`  
`buildIconHtmlCache()` remounts all Lucide icons into DOM nodes on every `MapCanvas` mount. This should be cached at the module level (once per session) rather than per component instance.

---

## Fragile Areas

### `crossfadeTo` Lock Never Released on Error
**Severity:** High  
**File:** `src/lib/stores/audio-engine.svelte.ts`  
`crossfadeTo` sets `isCrossfading = true` but has no `try/finally` block. If `getSlots()` or any intermediate step throws, `isCrossfading` remains permanently `true`, freezing all future audio transitions until the app is restarted.

### Single Mutex Serializes All DB Access
**Severity:** Medium  
**File:** `src-tauri/src/commands/vault.rs`  
`VaultState` is a `Mutex<Option<AppVault>>` — all database commands must acquire this single lock. Concurrent read operations (e.g., loading notes + scenes simultaneously on vault open) are serialized, adding latency on slower hardware.

### Inconsistent Timestamp Formats
**Severity:** Low  
**Files:** `src-tauri/src/commands/notes.rs`, `src-tauri/src/commands/scenes.rs`, `src-tauri/migrations/`  
Some commands write timestamps as `%Y-%m-%d %H:%M:%S` (SQLite datetime), others use RFC3339. This makes sorting and comparison unreliable and could cause bugs when timestamps from different sources are compared.

---

## Missing Features / Gaps

| Gap | Impact |
|-----|--------|
| No `close_vault` Rust command | SQLite connection never explicitly released |
| No undo for destructive map ops | Pin deletes and annotation clears are permanent with no recovery |
| No file-system watcher for notes | External edits (outside the app) are not reflected until vault reload |
| No vault integrity check on open | Corrupted or partially-migrated DBs silently fail |

---

## Test Coverage Gaps

| Area | Risk |
|------|------|
| Audio engine state machine (crossfade, shuffle, `isCrossfading` lock) | High — complex async state with no safety net |
| MapCanvas / Leaflet integration | Medium — layer lifecycle bugs hard to catch manually |
| Silent IPC error handling paths | Medium — errors swallowed silently in several `invoke()` callers |
| Path traversal on file operations | High — security-critical, no tests exist |
| Spotify token refresh flow | Medium — time-dependent, hard to test manually |

---

## Notes

No test suite exists on the frontend. All Rust tests are standard `#[cfg(test)]` unit tests. The audio engine, map rendering, and IPC error paths are the highest-risk untested areas.
