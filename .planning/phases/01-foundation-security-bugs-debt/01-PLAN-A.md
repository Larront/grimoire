---
phase: 01-foundation-security-bugs-debt
plan: A
type: execute
wave: 1
depends_on: []
files_modified:
  - src-tauri/src/commands/spotify.rs
  - src-tauri/src/vault.rs
  - src-tauri/src/lib.rs
  - src/lib/stores/audio-engine.svelte.ts
autonomous: true
requirements:
  - FOUN-01
  - FOUN-05
  - FOUN-10

must_haves:
  truths:
    - "The Spotify access token is never returned to the renderer via IPC; `spotify_get_access_token` command is removed from the IPC bridge"
    - "All five Spotify Web API HTTP calls (play, repeat, shuffle, next, previous) are made from Rust using reqwest, not from the renderer using fetch"
    - "The Spotify OAuth event listener is unregistered after the auth flow completes (success or failure)"
    - "SPOTIFY_CLIENT_ID is loaded once at process startup into VaultState, not read from env on every Spotify command"
  artifacts:
    - path: "src-tauri/src/commands/spotify.rs"
      provides: "New Rust commands: spotify_play_track, spotify_resume, spotify_skip_next, spotify_skip_prev; no dotenv() calls per-command; client_id read from vault state"
    - path: "src-tauri/src/vault.rs"
      provides: "VaultState with spotify_client_id: String field"
    - path: "src-tauri/src/lib.rs"
      provides: "Registers new Spotify commands; removes spotify_get_access_token from handler list"
    - path: "src/lib/stores/audio-engine.svelte.ts"
      provides: "SpotifyPlayer methods invoke Rust commands instead of calling fetch; spotify_get_access_token invoke removed"
  key_links:
    - from: "src/lib/stores/audio-engine.svelte.ts"
      to: "src-tauri/src/commands/spotify.rs"
      via: "invoke('spotify_play_track'), invoke('spotify_resume'), invoke('spotify_skip_next'), invoke('spotify_skip_prev')"
    - from: "src-tauri/src/commands/spotify.rs"
      to: "https://api.spotify.com"
      via: "reqwest client calls"
    - from: "src-tauri/src/lib.rs"
      to: "src-tauri/src/vault.rs"
      via: "VaultState::new(client_id)"
---

<objective>
Fix two Spotify security issues: the access token crossing the IPC bridge (FOUN-01), the OAuth event listener leak (FOUN-05), and the client ID env re-read debt (FOUN-10).

Purpose: The access token exposure is a High-severity security vulnerability — any JavaScript running in the renderer (including injected content) can read the token and make arbitrary Spotify API calls on behalf of the user. This must be fixed before any new features are added.

Output: Five new Rust commands that handle all Spotify Web API HTTP calls. The renderer only invokes commands by name with parameters — it never sees a token. The OAuth listener unregisters itself. The client ID is cached in VaultState.
</objective>

<execution_context>
@C:/Users/lamonta/Code/grimoire/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/lamonta/Code/grimoire/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@C:/Users/lamonta/Code/grimoire/.planning/ROADMAP.md
@C:/Users/lamonta/Code/grimoire/.planning/phases/01-foundation-security-bugs-debt/01-RESEARCH.md

<interfaces>
<!-- Current VaultState (src-tauri/src/vault.rs) -->
```rust
pub struct VaultState {
    pub path: Option<PathBuf>,
    pub connection: Option<SqliteConnection>,
    pub pending_spotify_verifier: Option<String>,
    pub pending_spotify_state: Option<String>,
}
impl VaultState {
    pub fn new() -> Self { ... }
}
pub type AppVault = Mutex<VaultState>;
```

<!-- Current lib.rs startup -->
```rust
.manage(AppVault::new(VaultState::new()))
.invoke_handler(tauri::generate_handler![
    ...
    spotify_get_access_token,  // MUST BE REMOVED
    ...
])
```

<!-- Current SpotifyPlayer methods that fetch directly (audio-engine.svelte.ts) -->
```typescript
// playAtVolume: 3 fetch calls to api.spotify.com
// resume:       1 fetch call to api.spotify.com/v1/me/player/play
// skipNext:     1 fetch call to api.spotify.com/v1/me/player/next
// skipPrev:     1 fetch call to api.spotify.com/v1/me/player/previous
// All call: const token = await invoke<string>("spotify_get_access_token");
```

<!-- spotify-auth.ts — current broken unlisten pattern -->
```typescript
listen<{ code: string; state: string }>("spotify-auth-callback", async (event) => {
    // unlisten is never called — listener leaks
});
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add spotify_client_id to VaultState; create new Rust Spotify API commands</name>
  <files>
    src-tauri/src/vault.rs
    src-tauri/src/commands/spotify.rs
    src-tauri/src/lib.rs
  </files>
  <read_first>
    - src-tauri/src/vault.rs — understand VaultState struct and new() constructor before modifying
    - src-tauri/src/commands/spotify.rs — understand existing command signatures and the dotenv() calls to remove
    - src-tauri/src/lib.rs — understand the current manage() and invoke_handler registration before modifying
  </read_first>
  <action>
**Step 1 — src-tauri/src/vault.rs:**

Add `spotify_client_id: String` field to `VaultState`. Update `new()` to accept a `client_id: String` parameter and assign it:

```rust
pub struct VaultState {
    pub path: Option<PathBuf>,
    pub connection: Option<SqliteConnection>,
    pub spotify_client_id: String,
    pub pending_spotify_verifier: Option<String>,
    pub pending_spotify_state: Option<String>,
}

impl VaultState {
    pub fn new(spotify_client_id: String) -> Self {
        VaultState {
            path: None,
            connection: None,
            spotify_client_id,
            pending_spotify_verifier: None,
            pending_spotify_state: None,
        }
    }
}
```

**Step 2 — src-tauri/src/lib.rs:**

In `run()`, read SPOTIFY_CLIENT_ID once before calling `.manage()`:

```rust
let client_id = std::env::var("SPOTIFY_CLIENT_ID")
    .unwrap_or_default(); // empty string if not set — commands will return error
.manage(AppVault::new(VaultState::new(client_id)))
```

Also add `dotenvy::dotenv().ok();` at the very start of `run()` so the env var is available. Then add the new commands to `invoke_handler` (added in Step 3 below) and REMOVE `spotify_get_access_token` from the handler list.

**Step 3 — src-tauri/src/commands/spotify.rs:**

a) Remove all four `dotenv().ok()` calls and `env::var("SPOTIFY_CLIENT_ID")` reads from `spotify_start_auth_flow`, `spotify_exchange_code`, `spotify_refresh_token`, and `spotify_get_access_token`. In each, replace with `state.spotify_client_id.clone()` where needed (or `vault.lock()...spotify_client_id`).

b) For `spotify_start_auth_flow` and `spotify_exchange_code`: acquire `vault.lock()`, read `state.spotify_client_id.clone()`, then drop the lock before the async HTTP call.

c) For `spotify_refresh_token`: acquire lock, read `spotify_client_id` and `current_refresh` in the same lock acquisition, then drop before HTTP call.

d) For `spotify_get_access_token`: same pattern — read `client_id` and `auth` from the locked state, drop the lock, then do any HTTP refresh call. Keep this command for the Spotify Web Playback SDK `getOAuthToken` callback (it must remain on the IPC bridge because the SDK requires a token for player authentication — NOT for API calls). Do not remove it from the commands, only from the fetch calls in SpotifyPlayer.

e) Add these five new async Tauri commands after `spotify_revoke`:

```rust
#[tauri::command]
pub async fn spotify_play_track(
    source_id: String,
    use_context: bool,
    loop_mode: bool,
    shuffle: bool,
    device_id: String,
    vault: State<'_, AppVault>,
) -> Result<(), String> {
    let (client_id, access_token) = get_token_and_client(&vault).await?;
    let source_uri = source_id.replace("playlist_v2", "playlist");
    let body = if use_context {
        serde_json::json!({ "context_uri": source_uri })
    } else {
        serde_json::json!({ "uris": [source_uri] })
    };
    let client = reqwest::Client::new();
    let resp = client
        .put(format!("https://api.spotify.com/v1/me/player/play?device_id={device_id}"))
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Content-Type", "application/json")
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| format!("play request failed: {e}"))?;
    if !resp.ok_or_status() && resp.status().as_u16() >= 400 && resp.status().as_u16() < 500 {
        // Retry once after 1s — device may not be fully registered yet
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        let resp2 = client
            .put(format!("https://api.spotify.com/v1/me/player/play?device_id={device_id}"))
            .header("Authorization", format!("Bearer {access_token}"))
            .header("Content-Type", "application/json")
            .body(body.to_string())
            .send()
            .await
            .map_err(|e| format!("play retry failed: {e}"))?;
        if !resp2.status().is_success() {
            let text = resp2.text().await.unwrap_or_default();
            return Err(format!("play failed: {text}"));
        }
    }
    // Set repeat mode
    let repeat_state = if loop_mode { "track" } else { "off" };
    client
        .put(format!("https://api.spotify.com/v1/me/player/repeat?state={repeat_state}&device_id={device_id}"))
        .header("Authorization", format!("Bearer {access_token}"))
        .send().await.ok();
    // Set shuffle (only for context tracks)
    if use_context {
        client
            .put(format!("https://api.spotify.com/v1/me/player/shuffle?state={shuffle}&device_id={device_id}"))
            .header("Authorization", format!("Bearer {access_token}"))
            .send().await.ok();
    }
    Ok(())
}

#[tauri::command]
pub async fn spotify_resume(
    device_id: String,
    vault: State<'_, AppVault>,
) -> Result<(), String> {
    let (_client_id, access_token) = get_token_and_client(&vault).await?;
    let client = reqwest::Client::new();
    client
        .put(format!("https://api.spotify.com/v1/me/player/play?device_id={device_id}"))
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Content-Type", "application/json")
        .send().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn spotify_skip_next(
    device_id: String,
    vault: State<'_, AppVault>,
) -> Result<(), String> {
    let (_client_id, access_token) = get_token_and_client(&vault).await?;
    let client = reqwest::Client::new();
    client
        .post(format!("https://api.spotify.com/v1/me/player/next?device_id={device_id}"))
        .header("Authorization", format!("Bearer {access_token}"))
        .send().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn spotify_skip_prev(
    device_id: String,
    vault: State<'_, AppVault>,
) -> Result<(), String> {
    let (_client_id, access_token) = get_token_and_client(&vault).await?;
    let client = reqwest::Client::new();
        .post(format!("https://api.spotify.com/v1/me/player/previous?device_id={device_id}"))
        .header("Authorization", format!("Bearer {access_token}"))
        .send().await.map_err(|e| e.to_string())?;
    Ok(())
}
```

Also add the private helper before these commands:

```rust
async fn get_token_and_client(vault: &State<'_, AppVault>) -> Result<(String, String), String> {
    // Same auto-refresh logic as spotify_get_access_token
    // Lock, read auth + client_id, drop lock, then optionally refresh
    let (auth, client_id) = {
        let mut state = vault.lock().map_err(|e| e.to_string())?;
        let conn = state.connection.as_mut().ok_or("No vault open")?;
        let auth = spotify_auth::table
            .find(1)
            .first::<SpotifyAuth>(conn)
            .map_err(|_| "Spotify not connected".to_string())?;
        let client_id = state.spotify_client_id.clone();
        (auth, client_id)
    };
    let expires_at = chrono::DateTime::parse_from_rfc3339(&auth.expires_at)
        .map_err(|e| format!("Invalid expires_at: {e}"))?
        .with_timezone(&Utc);
    if expires_at <= Utc::now() + chrono::Duration::minutes(5) {
        let token_data = post_to_token_endpoint(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", &auth.refresh_token),
            ("client_id", &client_id),
        ]).await?;
        let new_auth = parse_token_response(&token_data, Some(auth.refresh_token))?;
        let new_access = new_auth.access_token.clone();
        {
            let mut state = vault.lock().map_err(|e| e.to_string())?;
            let conn = state.connection.as_mut().ok_or("No vault open")?;
            persist_auth(&new_auth, conn)?;
        }
        return Ok((client_id, new_access));
    }
    Ok((client_id, auth.access_token))
}
```

f) In lib.rs `invoke_handler`, ADD: `spotify_play_track, spotify_resume, spotify_skip_next, spotify_skip_prev`. Keep `spotify_get_access_token` in the handler (SDK getOAuthToken callback still needs it). Remove it only from SpotifyPlayer.playAtVolume/resume/skipNext/skipPrev fetch calls (done in Task 2).

Note on reqwest response check: use `resp.status().is_success()` not `.ok_or_status()` — reqwest's `Response` has `status()` returning `StatusCode`. For the retry logic: check `!resp.status().is_success() && resp.status().as_u16() >= 400 && resp.status().as_u16() < 500`.
  </action>
  <verify>
    <automated>cd C:/Users/lamonta/Code/grimoire/src-tauri && cargo build 2>&1 | tail -5</automated>
  </verify>
  <acceptance_criteria>
    - `cargo build` exits 0 with no errors
    - `grep -n "dotenv" src-tauri/src/commands/spotify.rs` returns 0 lines (all removed)
    - `grep -n "spotify_client_id" src-tauri/src/vault.rs` returns at least 1 line
    - `grep -n "VaultState::new(" src-tauri/src/lib.rs` shows the call passes a `client_id` argument
    - `grep -n "spotify_play_track\|spotify_resume\|spotify_skip_next\|spotify_skip_prev" src-tauri/src/lib.rs` returns 4 lines
    - `grep -n "get_token_and_client\|spotify_play_track\|spotify_resume\|spotify_skip_next\|spotify_skip_prev" src-tauri/src/commands/spotify.rs` returns lines for all 5 items
  </acceptance_criteria>
  <done>VaultState has spotify_client_id; all dotenv() calls removed from spotify.rs; four new Rust commands exist and are registered; cargo build passes</done>
</task>

<task type="auto">
  <name>Task 2: Remove direct Spotify fetch calls from SpotifyPlayer; fix OAuth unlisten leak</name>
  <files>
    src/lib/stores/audio-engine.svelte.ts
    src/lib/utils/spotify-auth.ts
  </files>
  <read_first>
    - src/lib/stores/audio-engine.svelte.ts — read the full SpotifyPlayer class (lines 129-334) and the crossfadeTo function before modifying
    - src/lib/utils/spotify-auth.ts — read connectSpotify() to understand the listen() call that never unlistens
  </read_first>
  <action>
**Part A — audio-engine.svelte.ts SpotifyPlayer class:**

Replace all five direct `fetch("https://api.spotify.com/...")` calls with `invoke()` calls. The `deviceId` is already stored as `this.deviceId` — pass it as a parameter.

Replace `playAtVolume(slot: SceneSlot, initialVolume: number)`:
- Remove: `const token = await invoke<string>("spotify_get_access_token");`
- Remove: all three `fetch(...)` calls (play, repeat, shuffle)
- Add: `await invoke("spotify_play_track", { sourceId: slot.source_id, useContext: usesContext, loopMode: slot.loop, shuffle: !!slot.shuffle, deviceId: this.deviceId });`
- Keep: `await this.player!.setVolume(initialVolume)`, `this.currentVolume = initialVolume`, `this.currentSlot = slot`
- Keep: the `usesContext` derivation and the retry pattern (the Rust command handles retries internally)

Replace `resume()`:
- Remove: `const token = ...` and `fetch(...)` call
- Add: `await invoke("spotify_resume", { deviceId: this.deviceId });`

Replace `skipNext()`:
- Remove: `const token = ...` and `fetch(...)` call
- Add: `await invoke("spotify_skip_next", { deviceId: this.deviceId });`

Replace `skipPrev()`:
- Remove: `const token = ...` and `fetch(...)` call
- Add: `await invoke("spotify_skip_prev", { deviceId: this.deviceId });`

Do NOT remove the `getOAuthToken` callback's `invoke<string>("spotify_get_access_token")` call — the Spotify Web Playback SDK requires this.

**Part B — spotify-auth.ts connectSpotify():**

The `listen()` API returns `Promise<UnlistenFn>`. Fix the leak by awaiting the listen promise, capturing the unlisten function, and calling it inside the event handler after the exchange completes:

```typescript
export async function connectSpotify(): Promise<SpotifyAuthStatus> {
  const authUrl = await invoke<string>("spotify_start_auth_flow");

  const statusPromise = new Promise<SpotifyAuthStatus>((resolve, reject) => {
    // listen() returns Promise<UnlistenFn> — must await before handler can call it
    const unlistenPromise = listen<{ code: string; state: string }>(
      "spotify-auth-callback",
      async (event) => {
        // Unregister first to prevent duplicate firings
        const unlisten = await unlistenPromise;
        unlisten();
        try {
          const result = await invoke<SpotifyAuthStatus>("spotify_exchange_code", {
            code: event.payload.code,
            state: event.payload.state,
          });
          resolve(result);
        } catch (e) {
          reject(e);
        }
      }
    );
  });

  await openUrl(authUrl);
  return statusPromise;
}
```
  </action>
  <verify>
    <automated>cd C:/Users/lamonta/Code/grimoire && bun run check 2>&1 | tail -10</automated>
  </verify>
  <acceptance_criteria>
    - `bun run check` exits 0 with no type errors
    - `grep -n "fetch.*api.spotify.com" src/lib/stores/audio-engine.svelte.ts` returns 0 lines
    - `grep -n "invoke.*spotify_get_access_token" src/lib/stores/audio-engine.svelte.ts` returns exactly 1 line (inside getOAuthToken callback only)
    - `grep -n "invoke.*spotify_play_track\|invoke.*spotify_resume\|invoke.*spotify_skip_next\|invoke.*spotify_skip_prev" src/lib/stores/audio-engine.svelte.ts` returns 4 lines
    - `grep -n "unlisten\|unlistenPromise" src/lib/utils/spotify-auth.ts` returns at least 2 lines
    - `grep -n "listen(" src/lib/utils/spotify-auth.ts` returns 1 line (the fixed call)
  </acceptance_criteria>
  <done>No direct Spotify API fetch calls remain in the renderer; OAuth listener is properly unregistered after each auth flow; bun run check passes</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Renderer → IPC → Rust | Frontend JavaScript calls Tauri commands — cannot directly access Rust state |
| Rust → Spotify Web API | Rust makes HTTP calls with the access token; renderer never sees the token value |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01A-01 | Information Disclosure | `spotify_get_access_token` IPC command (pre-fix) | mitigate | Remove all fetch-with-token calls from renderer; move to Rust commands; token only read inside Rust |
| T-01A-02 | Elevation of Privilege | Renderer JS could call `spotify_get_access_token` and use token for arbitrary Spotify API calls | mitigate | After fix, token never crosses IPC bridge; renderer cannot construct API requests with it |
| T-01A-03 | Denial of Service | OAuth listener never unregisters — duplicate auth events could trigger multiple exchange calls | mitigate | unlisten() called inside the event handler after first invocation |
</threat_model>

<verification>
After both tasks complete:

1. `cargo build` exits 0
2. `bun run check` exits 0
3. `grep -rn "fetch.*api.spotify.com" src/` returns 0 results
4. `grep -n "dotenv" src-tauri/src/commands/spotify.rs` returns 0 results
5. `grep -n "spotify_client_id" src-tauri/src/vault.rs` returns at least 1 result
6. `grep -n "spotify_play_track" src-tauri/src/lib.rs` returns 1 result (registered)
</verification>

<success_criteria>
- Spotify access token never crosses the IPC bridge to the renderer
- All Spotify Web API calls (play, repeat, shuffle, next, previous) are made from Rust using reqwest
- `spotify_get_access_token` is removed from SpotifyPlayer fetch calls (remains for SDK getOAuthToken only)
- OAuth event listener is unregistered after each auth flow
- SPOTIFY_CLIENT_ID is loaded once at startup, not re-read per command
- Build passes: `cargo build` and `bun run check` both exit 0
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation-security-bugs-debt/01-A-SUMMARY.md`
</output>
