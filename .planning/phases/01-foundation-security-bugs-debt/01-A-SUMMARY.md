---
plan: 01-A
status: complete
phase: 01-foundation-security-bugs-debt
self_check: PASSED
---

## Summary

Eliminated the Spotify access-token IPC bridge vulnerability, moved all Spotify Web API calls to Rust, fixed the OAuth event-listener leak, and cached SPOTIFY_CLIENT_ID in VaultState at startup.

## What Was Built

**Task 1 — Rust backend (committed as `3917432`):**
- Added `spotify_client_id: String` field to `VaultState`; `new()` now accepts `client_id` param
- `lib.rs` reads `SPOTIFY_CLIENT_ID` env var once at startup via `dotenvy::dotenv()`, passes to `VaultState::new()`
- Added private `get_token_and_client()` helper with auto-refresh logic (reads from DB, drops lock before HTTP call)
- Added four new Tauri commands: `spotify_play_track`, `spotify_resume`, `spotify_skip_next`, `spotify_skip_prev`
- Removed all `dotenv().ok()` / `env::var("SPOTIFY_CLIENT_ID")` per-command reads from `spotify.rs`
- All four new commands registered in `invoke_handler`; `spotify_get_access_token` kept for SDK `getOAuthToken` callback

**Task 2 — Frontend (committed as `876f455`):**
- Replaced all four `fetch("https://api.spotify.com/...")` calls in `SpotifyPlayer` with `invoke()` calls:
  - `playAtVolume` → `invoke("spotify_play_track", ...)`
  - `resume` → `invoke("spotify_resume", ...)`
  - `skipNext` → `invoke("spotify_skip_next", ...)`
  - `skipPrev` → `invoke("spotify_skip_prev", ...)`
- `spotify_get_access_token` invoke kept only in `getOAuthToken` SDK callback (required for Web Playback SDK authentication)
- Fixed `connectSpotify()` in `spotify-auth.ts`: `listen()` return value captured as `unlistenPromise`; unlisten called inside handler after first event to prevent duplicate firings

## Key Files

### key-files.modified
- `src-tauri/src/vault.rs` — VaultState gains `spotify_client_id: String`
- `src-tauri/src/commands/spotify.rs` — 4 new Rust commands, dotenv removed, get_token_and_client helper
- `src-tauri/src/lib.rs` — new commands registered, client_id read at startup
- `src/lib/stores/audio-engine.svelte.ts` — SpotifyPlayer fetch calls replaced with invoke
- `src/lib/utils/spotify-auth.ts` — OAuth listener leak fixed

## Decisions

- `spotify_get_access_token` is kept on the IPC bridge — the Spotify Web Playback SDK's `getOAuthToken` callback requires it for player authentication. It is NOT used for Web API calls anymore.
- Pre-existing `AppSearch.svelte` type error in `bun run check` is unrelated to this plan; confirmed present before any Plan A changes.

## Deviations

None from the plan spec.

## Self-Check

- ✓ `grep "fetch.*api.spotify.com" src/lib/stores/audio-engine.svelte.ts` → 0 lines
- ✓ `grep "invoke.*spotify_get_access_token" src/lib/stores/audio-engine.svelte.ts` → 1 line (getOAuthToken only)
- ✓ `grep "invoke.*spotify_play_track\|spotify_resume\|skip_next\|skip_prev" audio-engine.svelte.ts` → 4 lines
- ✓ `grep "dotenv" src-tauri/src/commands/spotify.rs` → 0 lines
- ✓ `grep "spotify_client_id" src-tauri/src/vault.rs` → present
- ✓ `grep "spotify_play_track" src-tauri/src/lib.rs` → registered
- ✓ `grep "unlistenPromise" src/lib/utils/spotify-auth.ts` → listener leak fixed
