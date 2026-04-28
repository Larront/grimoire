# Phase 1: Foundation — Security, Bugs & Debt - Research

**Researched:** 2026-04-28
**Domain:** Tauri 2 / Svelte 5 / Rust / Diesel — security hardening, bug fixes, tech debt, git workflow
**Confidence:** HIGH — all findings are based on direct codebase inspection, not assumptions

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FOUN-01 | Spotify access token is never returned to the renderer; all Spotify API calls are made from the Rust backend | `spotify_get_access_token` already returns the token over IPC. `SpotifyPlayer.playAtVolume()` calls Spotify Web API directly from the renderer with that token. Fix: move all Spotify Web API calls (`/v1/me/player/play`, `/repeat`, `/shuffle`, `/next`, `/previous`) to new Rust commands. |
| FOUN-02 | Vault-relative file paths are validated against the vault root before any file read/write operation | `read_note_content`, `write_note_content`, `create_note`, `update_note`, `delete_note` in `notes.rs` and file ops in `media.rs` use `vault_path.join(&note_path)` with no `..` check. Fix: add `canonicalize` + `starts_with(vault_root)` guard. |
| FOUN-03 | `crossfadeTo` releases `isCrossfading` lock via try/finally so failures never freeze audio | `crossfadeTo` sets `isCrossfading = true` at line 473 of `audio-engine.svelte.ts`. The only release is inside the `setTimeout` callback. If `scenes.getSlots()` throws before the timeout is set, `isCrossfading` stays `true` permanently. Fix: wrap the body in `try/finally`. |
| FOUN-04 | Leaflet marker and annotation layers are fully cleaned up when navigating between maps | `MapCanvas.svelte` `onMount` cleanup correctly calls `mapInstance?.remove()` and clears both Maps. The risk is navigation that does not unmount the component. Verified: SvelteKit file-based routing unmounts `+page.svelte` on route change, which triggers `onMount` cleanup. The `markerMap` and `annotationLayerMap` are component-local (not module-level) so they reset with the component. No leak detected in current code — the concern from CONCERNS.md has been addressed by component structure. See Pitfall section for nuance. |
| FOUN-05 | Spotify OAuth event listener is unregistered after each auth flow completes | `spotify-auth.ts` `connectSpotify()` calls `listen("spotify-auth-callback", ...)` and never calls the returned unlisten function. Fix: capture the promise returned by `listen()`, await it to get the unlisten fn, call it after `invoke("spotify_exchange_code", ...)` completes (success or failure). |
| FOUN-06 | `isLoadingData` does not resolve until both the image load and the IPC pin/annotation fetches complete | In `map/[id]/+page.svelte`, `isLoadingData = false` is set in the `.finally()` of the `get_map_image_data_url` call, but the `Promise.all([get_pins, get_pin_categories, get_annotations])` runs concurrently with no tie to `isLoadingData`. Fix: merge both into a single `Promise.all` and set `isLoadingData = false` only when all three IPC calls and the image fetch resolve. |
| FOUN-07 | A `close_vault` Rust command exists and is called by the frontend `closeVault()` to release the SQLite connection | `vault.rs` has no `close_vault` command. `closeVault()` in `vault.svelte.ts` only clears frontend state. Fix: add `pub fn close_vault(vault: State<AppVault>)` that sets both `connection` and `path` to `None`, register it in `lib.rs`, call `invoke("close_vault")` from `closeVault()`. |
| FOUN-08 | Boolean columns (`is_loop`, `shuffle`, `archived`) are migrated to proper SQLite BOOLEAN type | Three columns declared as `INTEGER` in migrations. Diesel models use `i32`. Fix: new Diesel migration that uses `CREATE TABLE ... AS SELECT` recreation pattern (SQLite cannot ALTER COLUMN type), then update all Diesel model fields to `bool`. |
| FOUN-09 | Vault item counts are invalidated and refreshed after create/delete mutations | `note_count`, `scene_count`, `map_count` are set only during `open_vault` and stored in the `RecentVault` cache entry. They are not exposed as reactive store state — they only appear in the recent vault list on the home page. `notes.svelte.ts` exposes `noteCount = $derived(notes.length)` which does update reactively. The `RecentVault` counts in the recents list go stale. Fix: after create/delete mutations in notes/scenes/maps stores, call `notes.load()` / `scenes.load()` / `maps.load()` — the derived counts will update automatically. Also update the recent vault entry after mutations. |
| FOUN-10 | Spotify client ID is loaded once at startup into Tauri state, not re-read on every command | `spotify.rs` calls `dotenv().ok()` and `env::var("SPOTIFY_CLIENT_ID")` at the top of `spotify_start_auth_flow`, `spotify_exchange_code`, `spotify_refresh_token`, `spotify_get_access_token` — four separate reads per invocation. Fix: store `client_id: String` on `VaultState` (or a separate Tauri-managed struct), read once in `open_vault` or app startup. |
| FOUN-11 | Timestamps are consistent RFC3339 format throughout the backend | `maps.rs` line 144: `Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()` — SQLite datetime format. `spotify.rs` line 74: `(Utc::now() + ...).to_rfc3339()` — RFC3339. Migration defaults use `datetime('now')` (SQLite format). Fix: standardize all application-generated timestamps to RFC3339 (`Utc::now().to_rfc3339()`). Migration defaults can remain as SQLite `datetime('now')` — those are not application-written. |
| FOUN-12 | `_note_path` parameter is renamed to `note_path` in the Rust command handler | `notes.rs` line 33: `_note_path: String` is the parameter name; it is actively used on line 42 (`vault_path.join(&_note_path)`). Rust convention treats `_` prefix as "intentionally unused" — this is misleading. Fix: rename to `note_path` in the function signature and all usages within `create_note`. |
| FOUN-15 | `next` integration branch exists; branching strategy documented in CLAUDE.md per flow.md | `flow.md` exists at repo root documenting the `main/next/feature/*` strategy. Only `main` branch exists remotely. Fix: create `next` branch from `main`, push it to origin, add a `## Git Workflow` section to `CLAUDE.md` summarising the branching strategy and referencing `flow.md`. |
</phase_requirements>

---

## Summary

Phase 1 is a surgical cleanup phase — no new user-facing features. Every requirement has been verified by direct source inspection. The work divides into four categories:

**Security (High severity, do first):** FOUN-01 (Spotify token in renderer) and FOUN-02 (path traversal). FOUN-01 requires moving several Spotify Web API calls from the frontend `SpotifyPlayer` class to new Rust commands. FOUN-02 requires a path canonicalization guard on every file-touching command in `notes.rs` and `media.rs`.

**Bugs (Medium severity):** FOUN-03 (`isCrossfading` lock), FOUN-04 (Leaflet layer cleanup — partially already correct, see requirements detail), FOUN-05 (Spotify OAuth listener leak), FOUN-06 (`isLoadingData` race).

**Tech debt (Low-Medium severity):** FOUN-07 (`close_vault` command), FOUN-08 (boolean column migration), FOUN-09 (stale counts), FOUN-10 (Spotify client ID re-read), FOUN-11 (timestamp inconsistency), FOUN-12 (`_note_path` rename).

**Git workflow (Housekeeping):** FOUN-15 (`next` branch + CLAUDE.md documentation).

**Primary recommendation:** Work in dependency order — security fixes first (FOUN-01, FOUN-02), then bugs, then debt, then git workflow. Each fix is self-contained; no fix requires another to be done first.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Spotify API calls (play, repeat, shuffle, skip) | Rust backend | — | Token must not cross IPC boundary; all HTTP calls from Rust |
| Path validation | Rust backend | — | Security check must be at the trust boundary (IPC entry point) |
| Audio crossfade state machine | Frontend (store) | — | Web Audio API is browser-only; `isCrossfading` lives in the store |
| Leaflet layer lifecycle | Frontend (component) | — | Leaflet is a browser library; cleanup is component `onMount` teardown |
| Spotify OAuth listener | Frontend (utility) | — | `listen()` is a Tauri frontend API; unregistration must happen on same side |
| Map loading coordination | Frontend (route) | — | `isLoadingData` is route-local state coordinating UI; no backend change needed |
| SQLite connection release | Rust backend | — | Connection ownership lives in `VaultState`; only Rust can drop it |
| Boolean column types | Rust backend + DB | — | Migration changes SQLite schema; Diesel model types follow |
| Count invalidation | Frontend (stores) | — | Derived counts update automatically when store arrays are refreshed |
| Spotify client ID caching | Rust backend | — | Client ID is a build-time env var; cache in `VaultState` or app state |
| Timestamp format | Rust backend | — | All write-time timestamps are generated in Rust command handlers |
| Parameter rename | Rust backend | — | `_note_path` → `note_path` is a Rust source change only |
| Git workflow | Repository | — | Branch creation + CLAUDE.md documentation |

---

## Standard Stack

All of these are already present in the project — Phase 1 adds no new dependencies.

### Core (already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `tauri` | 2.x | Desktop app shell, IPC, State management | Project foundation |
| `diesel` | 2.2.0 | SQLite ORM + migrations | Project foundation |
| `chrono` | 0.4 | RFC3339 timestamp generation (`Utc::now().to_rfc3339()`) | Already in Cargo.toml |
| `reqwest` | 0.12 | Spotify HTTP calls from Rust (FOUN-01) | Already in Cargo.toml |
| `@tauri-apps/api` | ^2 | `invoke()`, `listen()` IPC | Project foundation |

### No new dependencies required
Every requirement in Phase 1 is a code change to existing files. No new `npm install` or `cargo add` is needed.

---

## Architecture Patterns

### System Architecture Diagram

```
FOUN-01: Token flow BEFORE fix
  Renderer
    SpotifyPlayer.playAtVolume()
      → invoke("spotify_get_access_token") ← token crosses IPC bridge
      → fetch("https://api.spotify.com/...", { Authorization: `Bearer ${token}` })
                                            ← Spotify API called from renderer

FOUN-01: Token flow AFTER fix
  Renderer
    SpotifyPlayer.playAtVolume()
      → invoke("spotify_play_track", { sceneSlot })
          ↓ Rust command
          reads token from VaultState DB
          calls Spotify Web API with reqwest
          returns Result<(), String>

FOUN-02: Path validation guard
  IPC call: invoke("read_note_content", { notePath: "../../etc/passwd" })
    ↓
  Rust command:
    let full = vault_path.join(&note_path);
    let canonical = full.canonicalize()?;        ← resolves symlinks and ..
    if !canonical.starts_with(&vault_path) {     ← rejects escape attempts
        return Err("Path traversal denied");
    }
    fs::read_to_string(&canonical)

FOUN-03: Crossfade lock fix
  crossfadeTo():
    isCrossfading = true;
    try {
      const newSlots = await scenes.getSlots(newSceneId);  ← can throw
      ... audio setup ...
      crossfadeTimeoutId = setTimeout(() => {
        isCrossfading = false;    ← currently only release point
      }, fadeSec * 1000);
    } finally {
      if (/* timeout not set */) isCrossfading = false;   ← safe release
    }
```

### Recommended Project Structure

No structural changes needed for Phase 1. All changes are in-place edits to existing files:

```
src-tauri/src/commands/
├── spotify.rs          ← FOUN-01 (new Rust commands), FOUN-05 (listener fix in TS), FOUN-10 (client ID caching), FOUN-11 (timestamp)
├── notes.rs            ← FOUN-02 (path guard), FOUN-12 (rename _note_path)
├── vault.rs            ← FOUN-07 (close_vault command), FOUN-10 (client ID on VaultState)
├── maps.rs             ← FOUN-02 (path guard), FOUN-11 (timestamp)
└── media.rs            ← FOUN-02 (path guard)
src-tauri/src/
└── vault.rs            ← FOUN-07 (connection: Option<>), FOUN-10 (client_id field)
src-tauri/migrations/
└── XXXX_fix_boolean_columns/   ← FOUN-08
src-tauri/src/db/models.rs      ← FOUN-08 (bool fields)
src-tauri/src/lib.rs            ← FOUN-07 (register close_vault), FOUN-01 (register new Spotify commands)
src/lib/utils/spotify-auth.ts   ← FOUN-05 (unlisten call)
src/lib/stores/audio-engine.svelte.ts  ← FOUN-01 (remove direct fetch), FOUN-03 (try/finally)
src/lib/stores/vault.svelte.ts  ← FOUN-07 (invoke close_vault), FOUN-09 (count invalidation)
src/routes/map/[id]/+page.svelte ← FOUN-06 (isLoadingData coordination)
CLAUDE.md                        ← FOUN-15 (Git Workflow section)
```

### Pattern 1: Path Traversal Guard (FOUN-02)

**What:** Canonicalize the resolved path and verify it remains inside the vault root before any file read/write.

**When to use:** Every Rust command that takes a user-supplied path and accesses the filesystem.

```rust
// Source: Rust stdlib std::path::Path::canonicalize + starts_with
fn validate_vault_path(vault_root: &std::path::Path, relative: &str) -> Result<std::path::PathBuf, String> {
    let joined = vault_root.join(relative);
    let canonical = joined.canonicalize()
        .map_err(|e| format!("Invalid path: {e}"))?;
    if !canonical.starts_with(vault_root) {
        return Err("Path escapes vault root".to_string());
    }
    Ok(canonical)
}
```

**Caveat:** `canonicalize()` requires the path to exist. For write operations on new files, canonicalize the parent directory instead, then append the filename.

### Pattern 2: Tauri Event Unlisten (FOUN-05)

**What:** `listen()` returns a promise that resolves to an unlisten function. Call it when the event is no longer needed.

```typescript
// Source: @tauri-apps/api/event listen() API — [VERIFIED: codebase grep of existing listen usage]
const unlistenFn = await listen<{ code: string; state: string }>(
  "spotify-auth-callback",
  async (event) => {
    try {
      const result = await invoke<SpotifyAuthStatus>("spotify_exchange_code", { ... });
      resolve(result);
    } catch (e) {
      reject(e);
    } finally {
      unlistenFn(); // always unregister, even on error
    }
  }
);
```

### Pattern 3: try/finally Lock Release (FOUN-03)

**What:** Any lock that is set to `true` before an async operation must be released in a `finally` block.

```typescript
// Applied to crossfadeTo in audio-engine.svelte.ts
isCrossfading = true;
try {
  const newSlots = await scenes.getSlots(newSceneId);
  // ... rest of crossfade setup ...
  crossfadeTimeoutId = setTimeout(() => {
    isCrossfading = false;
    // ... rest of timeout body ...
  }, fadeSec * 1000);
} catch (e) {
  console.error("[audio-engine] crossfadeTo failed:", e);
  isCrossfading = false;
  loadingSceneId = null;
}
```

Note: because the normal release is in a `setTimeout`, `finally` alone is insufficient. The catch block must explicitly release when the timeout has not yet been scheduled.

### Pattern 4: close_vault Rust Command (FOUN-07)

**What:** Reset `VaultState` fields to `None` to explicitly drop the SQLite connection.

```rust
// Source: direct codebase inspection of vault.rs VaultState struct
#[tauri::command]
pub fn close_vault(vault: State<AppVault>) -> Result<(), String> {
    let mut state = vault.lock().map_err(|e| e.to_string())?;
    state.connection = None;  // drops SqliteConnection, closes file handle
    state.path = None;
    state.pending_spotify_verifier = None;
    state.pending_spotify_state = None;
    Ok(())
}
```

### Pattern 5: Boolean Column Migration (FOUN-08)

**What:** SQLite cannot ALTER COLUMN type. The standard approach is table recreation via a series of SQL statements.

```sql
-- Migration up: fix boolean columns in scene_slots
-- SQLite boolean migration pattern: recreate table
PRAGMA foreign_keys = OFF;
CREATE TABLE scene_slots_new (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    scene_id   INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    source     TEXT NOT NULL,
    source_id  TEXT NOT NULL,
    label      TEXT NOT NULL,
    volume     REAL NOT NULL DEFAULT 0.8,
    is_loop    BOOLEAN NOT NULL DEFAULT TRUE,
    slot_order INTEGER NOT NULL DEFAULT 0,
    shuffle    BOOLEAN NOT NULL DEFAULT FALSE
);
INSERT INTO scene_slots_new SELECT id, scene_id, source, source_id, label, volume,
    CASE WHEN is_loop != 0 THEN TRUE ELSE FALSE END,
    slot_order,
    CASE WHEN shuffle != 0 THEN TRUE ELSE FALSE END
FROM scene_slots;
DROP TABLE scene_slots;
ALTER TABLE scene_slots_new RENAME TO scene_slots;
PRAGMA foreign_keys = ON;
```

After migration, update Diesel model:
```rust
// models.rs SceneSlot: change i32 fields to bool
pub is_loop: bool,   // was: i32
pub shuffle: bool,   // was: i32
// Also Note.archived: bool  (was: i32)
```

### Pattern 6: Spotify Client ID in App State (FOUN-10)

**What:** Read `SPOTIFY_CLIENT_ID` once and store on `VaultState` (or a separate app-level state struct). Commands read from state rather than calling `dotenv()` each time.

```rust
// Option A: Add to VaultState (simpler, available immediately)
pub struct VaultState {
    pub path: Option<PathBuf>,
    pub connection: Option<SqliteConnection>,
    pub spotify_client_id: String,          // loaded once at startup
    pub pending_spotify_verifier: Option<String>,
    pub pending_spotify_state: Option<String>,
}

// In lib.rs run():
let client_id = std::env::var("SPOTIFY_CLIENT_ID")
    .expect("SPOTIFY_CLIENT_ID must be set");
.manage(AppVault::new(VaultState::new(client_id)))
```

### Pattern 7: FOUN-01 — Moving Spotify API Calls to Rust

**What:** The `SpotifyPlayer` class currently calls Spotify Web API endpoints directly from the renderer. These must move to Rust commands.

**New Rust commands needed:**
- `spotify_play_track(scene_slot: SceneSlot, device_id: String)` — replaces `playAtVolume` fetch calls
- `spotify_pause(device_id: String)` — replaces `player.pause()` / stop fetch
- `spotify_resume(device_id: String)` — replaces resume fetch
- `spotify_skip_next(device_id: String)` — replaces skip next fetch
- `spotify_skip_prev(device_id: String)` — replaces skip prev fetch
- `spotify_set_repeat(state: String, device_id: String)` — replaces repeat fetch
- `spotify_set_shuffle(state: bool, device_id: String)` — replaces shuffle fetch

The Spotify Web Playback SDK (`window.Spotify.Player`) itself runs in the renderer — that is unavoidable (it's a JavaScript SDK). The `getOAuthToken` callback already correctly calls `invoke("spotify_get_access_token")` rather than storing the token. The issue is the _direct fetch calls_ to `api.spotify.com` from `playAtVolume`, `resume`, `skipNext`, `skipPrev`. These must move to Rust.

**Device ID handling:** The SDK device ID is obtained in the renderer via the `ready` event. It must be passed to Rust commands as a parameter since it is a runtime value from the browser SDK.

### Anti-Patterns to Avoid

- **Skipping `canonicalize()` for new files:** Don't only validate existing paths. For `write_note_content` where the file may not yet exist, canonicalize the parent directory and check that.
- **Using `try/finally` to release `isCrossfading` without also clearing the timeout:** If the `try` block throws before `crossfadeTimeoutId` is set, the timeout will never fire — the `finally` must guard against this.
- **Adding a `dotenvy::dotenv()` call at app startup without removing the per-command calls:** Remove all four `dotenv().ok()` calls from spotify commands when adding startup loading.
- **Creating `next` branch from a dirty working tree:** Always create `next` from a clean `main` with a verified build.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Path traversal prevention | Custom string-splitting logic | `Path::canonicalize()` + `starts_with()` | Handles symlinks, `.`, `..`, and platform path separators correctly |
| Timestamp formatting | Custom format strings | `chrono::Utc::now().to_rfc3339()` | RFC3339 is a standard; custom formats introduce inconsistency bugs |
| SQLite boolean migration | ALTER COLUMN (not supported) | Table recreation pattern (see Pattern 5) | SQLite's only supported DDL for column type changes |
| Tauri event cleanup | Manual counter tracking | `listen()` unlisten function | `listen()` returns the unlisten fn; use it |

---

## Common Pitfalls

### Pitfall 1: canonicalize() Fails on Non-Existent Paths
**What goes wrong:** `Path::canonicalize()` returns an error if the path does not exist. Write operations on new notes will fail the guard.
**Why it happens:** `canonicalize()` resolves the path on the actual filesystem — the file must exist.
**How to avoid:** For create/write operations, split the path: canonicalize the parent directory (which exists), then append the filename. Validate the parent is inside the vault root.
**Warning signs:** Test with a note that hasn't been written to disk yet.

### Pitfall 2: Leaflet Layer Leak Scenario — Same Component, Different Map
**What goes wrong:** `markerMap` and `annotationLayerMap` are declared at the component level (not module level). When SvelteKit navigates from `/map/1` to `/map/2`, the component is destroyed and recreated — `onMount` cleanup runs, clearing both maps. However, if the component is somehow reused (e.g., via `+layout.svelte` wrapping or future keep-alive), the leak would reappear.
**How to avoid:** The current onMount cleanup (`mapInstance?.remove(); markerMap.clear(); annotationLayerMap.clear()`) is correct. Confirm that no layout wraps `MapCanvas` with a persistent container that prevents unmount.
**Warning signs:** Visual duplicate markers after navigating map → map without a full page reload.

### Pitfall 3: Diesel boolean fields after migration — serde rename conflict
**What goes wrong:** `SceneSlot` has `#[serde(rename = "loop")]` on `is_loop`. After changing `is_loop: i32` to `is_loop: bool`, the serde rename still works correctly, but the frontend TypeScript type `SceneSlot.loop: number` needs to change to `SceneSlot.loop: boolean`. Updating one without the other causes subtle type coercion bugs.
**How to avoid:** Update the TypeScript `SceneSlot` type in `src/lib/types/vault.ts` in the same task as the Rust model change.
**Warning signs:** `slot.loop` comparisons in audio-engine behave unexpectedly (e.g., `if (slot.loop)` vs `if (slot.loop !== 0)`).

### Pitfall 4: Spotify Device ID Timing
**What goes wrong:** When moving Spotify play calls to Rust (FOUN-01), the device ID is obtained asynchronously from the SDK `ready` event. If the Rust command is called before the device is registered, the Spotify API returns 404.
**Why it happens:** The SDK emits `ready` when the player is connected, but Spotify's backend takes ~1s to register the device. The existing code already has a retry-after-1s pattern for this.
**How to avoid:** Retain the retry logic in the Rust command or keep it in the frontend calling code. Pass device ID from frontend to Rust as a parameter — do not try to persist it in `VaultState`.

### Pitfall 5: `next` Branch and Existing PRs
**What goes wrong:** If `next` is pushed to origin after this phase's work is merged to `main`, future feature branches must start from `next` not `main`. Any instruction or habit of branching from `main` will create merge conflicts.
**How to avoid:** CLAUDE.md documentation must be explicit: "Always branch from `next`". Create `next` from the tip of `main` so they start in sync.

### Pitfall 6: Timestamp Migration — Existing Data
**What goes wrong:** `modified_at` and `created_at` values already stored in the DB use SQLite `datetime('now')` format (`2026-03-16 02:12:55`). After the timestamp fix, new records will use RFC3339 (`2026-03-16T02:12:55+00:00`). Mixed formats in the same column make sorting unreliable.
**Why it happens:** FOUN-11 only changes application-generated timestamps; it does not say "migrate existing data".
**How to avoid:** Decide explicitly: either also migrate existing timestamps in a SQL UPDATE, or accept mixed formats and document that `ORDER BY modified_at` will not sort cross-format records correctly. Given this is an early-stage app with likely few or no production vaults, a data migration in the same migration file is the cleaner choice.

---

## FOUN-01 Detail: What Stays in Renderer, What Moves to Rust

This is the most complex requirement. Clear boundary:

| Operation | Where | Why |
|-----------|-------|-----|
| Spotify Web Playback SDK (`window.Spotify.Player`) | Renderer — stays | JavaScript SDK, cannot run in Rust |
| `getOAuthToken` callback | Renderer — stays (already calls `invoke`) | SDK requires JS callback |
| SDK `ready` event → get `device_id` | Renderer — stays | SDK event is browser-only |
| `player.setVolume()` | Renderer — stays | SDK method, not an HTTP call |
| `player.pause()` | Renderer — stays | SDK method, not an HTTP call |
| `player.connect()` / `player.disconnect()` | Renderer — stays | SDK lifecycle, not an HTTP call |
| `fetch("api.spotify.com/v1/me/player/play")` | **Move to Rust** | HTTP call with token |
| `fetch("api.spotify.com/v1/me/player/repeat")` | **Move to Rust** | HTTP call with token |
| `fetch("api.spotify.com/v1/me/player/shuffle")` | **Move to Rust** | HTTP call with token |
| `fetch("api.spotify.com/v1/me/player/next")` | **Move to Rust** | HTTP call with token |
| `fetch("api.spotify.com/v1/me/player/previous")` | **Move to Rust** | HTTP call with token |

The `SpotifyPlayer.playAtVolume()` method makes 3 HTTP calls (play, repeat, shuffle). All three move to a single `spotify_play_track` Rust command. `resume()`, `skipNext()`, `skipPrev()` each make one HTTP call — each becomes its own Rust command.

The `SpotifyPlayer.fadeVolumeTo()` method uses `player.setVolume()` (SDK method) — this stays in the renderer.

---

## FOUN-09 Detail: Where Counts Are Displayed

After direct inspection:

- **`notes.svelte.ts`:** `noteCount = $derived(notes.length)` — updates reactively when `notes.load()` is called after mutations. This is already correct for the notes list.
- **`scenes.svelte.ts`:** No derived count — `scenes.length` accessed directly. Updates when `scenes.load()` called.
- **`vault.svelte.ts` `RecentVault` cache:** `note_count`, `scene_count`, `map_count` stored in the recent vaults list entry. Updated only on `openVault()`. These go stale after mutations.
- **Home page (`+page.svelte`):** Displays recent vault counts from the `RecentVault` JSON file (via `get_recent_vaults` command). These only update when the vault is next opened.

The fix for FOUN-09: after every `create_note`/`delete_note` mutation in the frontend, call `notes.load()` (if not already done). The `noteCount` derived value then updates automatically. For the home page recent vault display, call `invoke("add_recent_vault", {..., note_count: updatedCount})` to refresh the stored count.

---

## Environment Availability

Step 2.6: SKIPPED (no external dependencies identified — all changes are code edits to existing files within the current tech stack).

---

## Open Questions (RESOLVED)

1. **FOUN-04: Is MapCanvas already correct?**
   - What we know: `onMount` teardown calls `mapInstance?.remove()`, `markerMap.clear()`, `annotationLayerMap.clear()`. SvelteKit file-based routing unmounts components on navigation.
   - What's unclear: Whether any parent layout or transition wrapper could prevent unmount.
   - Recommendation: Verify by navigating map-to-map in the running app and checking for duplicate markers. If none — mark FOUN-04 as a documentation/comment fix only (add an explicit comment explaining the cleanup).
   - **RESOLVED:** MapCanvas cleanup is already correct. Plan D (Task 1) reads and confirms the code, then adds a documentation comment. No substantive code change unless verification reveals a gap.

2. **FOUN-08: Migrate existing timestamp data in the boolean migration, or a separate migration?**
   - What we know: Mixing `datetime()` format and RFC3339 in the same column breaks `ORDER BY`.
   - What's unclear: Whether the project has any real vaults with data that would be affected.
   - Recommendation: Include a `UPDATE` to convert existing timestamps in the FOUN-11 migration. This is safe for an early-stage project.
   - **RESOLVED:** Plan E Task 2 includes a `CASE WHEN modified_at LIKE '%T%' THEN ...` UPDATE statement in the RFC3339 migration to normalize existing rows in the same migration pass.

3. **FOUN-10: Store client ID on VaultState or as a separate Tauri-managed struct?**
   - What we know: `VaultState` is re-initialized on `open_vault`. `SPOTIFY_CLIENT_ID` is app-wide, not vault-specific.
   - What's unclear: Which is cleaner architecturally.
   - Recommendation: Add `spotify_client_id: String` to `VaultState::new()` — it's read at process start, same as the initial state. Alternatively, use a separate `SpotifyConfig` struct managed via `.manage()`. Either works; `VaultState` is simpler given the existing pattern.
   - **RESOLVED:** Plan A uses `VaultState` (adds `spotify_client_id: String` field, reads it once in `open_vault`). Simpler than a separate struct given the existing codebase pattern.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | SvelteKit file-based routing unmounts `MapCanvas.svelte` (and therefore triggers `onMount` cleanup) when navigating between map routes | FOUN-04 | If routes are cached/kept-alive, Leaflet layers accumulate. Verify manually. |
| A2 | `dotenvy` reads from `src-tauri/.env` at build time via the `build.rs` / `tauri_build` pipeline, so the env var is set during `tauri dev` | FOUN-10 | If the env loading is purely runtime, startup reading requires `dotenvy::dotenv()` to remain but can be called once |

---

## Sources

### Primary (HIGH confidence — direct codebase inspection)
- `src-tauri/src/commands/spotify.rs` — FOUN-01, FOUN-05, FOUN-10, FOUN-11 [VERIFIED: read in full]
- `src-tauri/src/commands/notes.rs` — FOUN-02, FOUN-12 [VERIFIED: read in full]
- `src-tauri/src/commands/vault.rs` — FOUN-07 [VERIFIED: read in full]
- `src-tauri/src/commands/maps.rs` — FOUN-11 [VERIFIED: grep line 144]
- `src-tauri/src/vault.rs` — FOUN-07, FOUN-10 [VERIFIED: read in full]
- `src-tauri/src/db/models.rs` — FOUN-08 [VERIFIED: read in full]
- `src-tauri/src/lib.rs` — FOUN-07, FOUN-01 [VERIFIED: read in full]
- `src/lib/stores/audio-engine.svelte.ts` — FOUN-01, FOUN-03 [VERIFIED: read in full]
- `src/lib/stores/vault.svelte.ts` — FOUN-07, FOUN-09 [VERIFIED: read in full]
- `src/lib/stores/notes.svelte.ts` — FOUN-09 [VERIFIED: read in full]
- `src/lib/utils/spotify-auth.ts` — FOUN-05 [VERIFIED: read in full]
- `src/lib/components/map/MapCanvas.svelte` — FOUN-04, FOUN-06 [VERIFIED: read in full]
- `src/routes/map/[id]/+page.svelte` — FOUN-06, FOUN-04 [VERIFIED: read in full]
- `src-tauri/migrations/` — FOUN-08 [VERIFIED: all migration files listed]
- `flow.md` — FOUN-15 [VERIFIED: read in full]
- `.planning/codebase/CONCERNS.md` — all requirements [VERIFIED: read in full]
- `.planning/config.json` — nyquist_validation: false [VERIFIED: read]

### Secondary (MEDIUM confidence)
- `graphify-out/GRAPH_REPORT.md` — community structure confirms audio engine, map canvas, vault lifecycle, and Spotify auth as distinct clusters [VERIFIED: read]

---

## Metadata

**Confidence breakdown:**
- Security fixes (FOUN-01, FOUN-02): HIGH — exact code locations identified, fix patterns documented
- Bug fixes (FOUN-03, FOUN-05, FOUN-06): HIGH — root causes confirmed by code inspection
- FOUN-04 (Leaflet cleanup): MEDIUM — cleanup code exists and appears correct; runtime verification recommended
- Tech debt (FOUN-07 through FOUN-12): HIGH — exact lines and patterns documented
- FOUN-15 (Git workflow): HIGH — `flow.md` exists and is complete; `next` branch simply needs creating

**Research date:** 2026-04-28
**Valid until:** This research describes the codebase as of 2026-04-28. Valid until any of the inspected files change.
