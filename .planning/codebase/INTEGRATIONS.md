# External Integrations

**Analysis Date:** 2026-04-28

## APIs & External Services

**Music Streaming:**
- Spotify - Ambient audio playback for scenes via Spotify Web Playback SDK + Web API
  - SDK/Client: Spotify Web Playback SDK loaded dynamically from `https://sdk.scdn.co/spotify-player.js` in `src/lib/stores/audio-engine.svelte.ts`
  - Web API: Direct `fetch` calls to `https://api.spotify.com/v1/me/player/*` (play, pause, repeat, shuffle, next, prev)
  - Auth: PKCE OAuth 2.0 flow; `SPOTIFY_CLIENT_ID` env var (in `src-tauri/.env`)
  - Token storage: SQLite `spotify_auth` table (access token, refresh token, expires_at)
  - Backend commands: `src-tauri/src/commands/spotify.rs`
  - Callback: local HTTP server on `127.0.0.1:8888` captures OAuth redirect; emits `spotify-auth-callback` Tauri event
  - Auto-refresh: tokens refreshed automatically when within 5 minutes of expiry (`spotify_get_access_token` command)
  - Required Spotify scopes: `streaming user-read-email user-read-private user-modify-playback-state`

## Data Storage

**Databases:**
- SQLite — primary persistence for all structured app data
  - Location: `<vault_path>/.grimoire/grimoire.db` (per-vault; created on vault open)
  - Client: Diesel 2.2.0 ORM; schema at `src-tauri/src/db/schema.rs`
  - Migrations: `src-tauri/migrations/` (14 migrations as of 2026-04-28); run automatically on vault open
  - Bundled: `libsqlite3-sys` with `bundled` feature — no system SQLite required
  - Tables: `notes`, `maps`, `pins`, `pin_categories`, `map_annotations`, `scenes`, `scene_slots`, `spotify_auth`

**File Storage:**
- Local filesystem only — vault directory chosen by user via native dialog
  - Notes: raw `.md` files on disk; path + metadata in SQLite `notes` table
  - Audio: copied into `<vault_path>/media/audio/` by `copy_audio_file` command (`src-tauri/src/commands/media.rs`)
  - Images: copied into `<vault_path>/media/images/` by `copy_image_file` / `save_image_bytes` commands
  - Map images: stored in vault media directory; accessed via Tauri asset protocol (`convertFileSrc`)

**Caching:**
- None — no external cache layer; Svelte 5 rune-based in-memory caching in `src/lib/stores/`

## Authentication & Identity

**Auth Provider:**
- Spotify OAuth 2.0 with PKCE (`src-tauri/src/commands/spotify.rs`)
  - Flow: backend generates authorization URL → opens in system browser → local TCP listener on port 8888 captures callback → code exchanged for tokens → tokens persisted to SQLite
  - Token refresh: manual via `spotify_refresh_token` command and automatic via `spotify_get_access_token`
  - Revoke: `spotify_revoke` command deletes token row from SQLite

**No user authentication for the app itself** — the vault is a local directory; no accounts or cloud login.

## Monitoring & Observability

**Error Tracking:**
- None — no external error tracking service

**Logs:**
- `console.error` calls in `src/lib/stores/audio-engine.svelte.ts` for Spotify player events (init, auth, account, play failures)
- Rust: standard `eprintln!` / panic messages surfaced through Tauri dev console
- No structured logging framework

## CI/CD & Deployment

**Hosting:**
- Desktop app distribution only — bundled via `tauri build` targeting all platforms
- Bundle formats: Windows (NSIS installer + MSI), macOS (`.app` + `.dmg`), Linux (AppImage + deb)
- Icons: `src-tauri/icons/` (32x32, 128x128, 128x128@2x, .icns, .ico)

**CI Pipeline:**
- None detected — no `.github/workflows/`, no CI config files

## Environment Configuration

**Required env vars:**
- `SPOTIFY_CLIENT_ID` — Spotify app client ID; must be in `src-tauri/.env` before `tauri dev` or `tauri build`

**Secrets location:**
- `src-tauri/.env` — not committed (gitignored); must be created manually by developer

## Webhooks & Callbacks

**Incoming:**
- Spotify OAuth redirect — handled by a short-lived local TCP server on `127.0.0.1:8888` spawned per auth flow (`src-tauri/src/commands/spotify.rs` lines 134–192)
  - Not a persistent webhook; server has a 120-second timeout and handles one request

**Outgoing:**
- Spotify Web API playback control (play, pause, repeat, shuffle, next, prev) — direct `fetch` calls from `src/lib/stores/audio-engine.svelte.ts`
- Spotify token endpoint `https://accounts.spotify.com/api/token` — called from Rust backend via `reqwest`

## Tauri Plugin Integrations

**`tauri-plugin-fs`** (with `watch` feature):
- Used in `src/lib/stores/` to watch vault directory for file changes
- Capability: `fs:allow-watch` with scope `**` (`src-tauri/capabilities/default.json`)

**`tauri-plugin-dialog`**:
- Native open-folder and open-file dialogs for vault selection and media import

**`tauri-plugin-opener`**:
- Opens external URLs (e.g., Spotify authorization URL) in system default browser

**Tauri Asset Protocol**:
- Enabled with scope `**` in `tauri.conf.json`
- Used by `convertFileSrc` to serve local audio and image files from vault directory to the WebView without IPC overhead

---

*Integration audit: 2026-04-28*
