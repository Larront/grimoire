# Research: can Spotify play, or be remote-controlled, from iPad Safari?

Findings for [#243](https://github.com/Larront/grimoire/issues/243), on the map
[Grimoire on the web](https://github.com/Larront/grimoire/issues/242).

Gathered 2026-10-30. Facts only; no design decisions for Grimoire are made here.

Each claim names its source. The labels mean:

- **[Spotify docs]** / **[Spotify terms]**: developer.spotify.com, read on the date above.
- **[Spotify support]**: support.spotify.com (consumer help pages).
- **[Apple]** / **[WebKit]**: developer.apple.com, webkit.org, bugs.webkit.org.
- **[Forum]**: Spotify Community, GitHub issues, or Apple Developer Forums posts by
  non-staff. These are reports of what someone saw, not documentation. Several
  Spotify Community threads could only be read through search-engine excerpts,
  because the pages did not render for the fetch tool; those are marked **[Forum, excerpt]**.
- **[Not found]**: looked for and not found in any primary source.

Nothing here was tested on an iPad. Section 6 lists what only a device test can settle.

---

## 0. How Grimoire uses Spotify today (for reference)

Read from the code on `next` (commit `7f9fe55`):

- One Web Playback SDK player is shared by all Spotify slots
  (`SpotifyContext` in `src/lib/stores/audio-engine.svelte.ts`). The SDK makes the
  browser itself a Spotify Connect device, and Grimoire targets that device's `device_id`.
- Starting a slot calls the Web API from Rust: `PUT /me/player/play?device_id=…`, then
  `PUT /me/player/repeat?state=track|off`, then `PUT /me/player/shuffle` for playlists
  (`spotify_play_track` in `src-tauri/src/commands/spotify.rs`).
- Volume, fades and master volume all go through the SDK's `player.setVolume()`. A fade
  is 25 `setVolume` steps.
- Sign-in is Authorization Code with PKCE, no client secret, redirect URI
  `http://127.0.0.1:8888/callback`, scopes
  `streaming user-read-email user-read-private user-modify-playback-state`. The client ID
  is baked in at build time (`SPOTIFY_CLIENT_ID`, `src-tauri/src/lib.rs`), so every
  install shares one Spotify app registration.
- Grimoire does **not** currently request `user-read-playback-state`, which is the scope
  the device-list endpoint needs (see 2.2).

---

## 1. Does the Web Playback SDK run in iPad Safari?

### 1.1 What Spotify documents

- **iOS is listed as supported.** The SDK overview says it is supported by "most web
  browsers (Chrome, Firefox, Safari and Microsoft Edge)" in "both mobile (Android and iOS)
  and Desktop". **[Spotify docs]**
  <https://developer.spotify.com/documentation/web-playback-sdk>
- **iPadOS is not mentioned by name** anywhere in the SDK docs. **[Not found]**
- **Documented iOS limitations** (Troubleshooting section of the same page): "The playback
  does not start automatically after transfering playback" and "The user must interact
  with the SDK events to play audio." **[Spotify docs]**
- **Autoplay.** The getting-started tutorial says "Safari on iOS and other mobile browsers
  have restrictions for autoplay behaviour", and that on a mobile browser "you may have to
  click the Toggle Play button". **[Spotify docs]**
  <https://developer.spotify.com/documentation/web-playback-sdk/tutorials/getting-started>
- **`activateElement()`** exists for autoplay-restricted browsers: it must be called "in
  advance" from a user interaction, "Otherwise it will be in pause state once it's
  transferred." There is also an `autoplay_failed` event. **[Spotify docs]**
  <https://developer.spotify.com/documentation/web-playback-sdk/reference>
- **Volume on iOS — the important one for Scenes.** The SDK reference, under
  `setVolume()`, says: "On iOS devices, the audio level is always under the user's
  physical control. The volume property is not settable in JavaScript. Reading the volume
  property always returns 1." **[Spotify docs]** (same reference page). This is copied
  from Apple's 2012 Safari audio guide (1.2).
- **Encryption.** `initialization_error` fires when the player cannot be created, "Most
  likely due to the browser not supporting EME protection." **[Spotify docs]**
- **Premium.** "The Web Playback SDK requires a Spotify Premium subscription (mobile only
  types of premium subscriptions are excluded)." `account_error` fires otherwise.
  **[Spotify docs]**
- **History.** Spotify's 2021 "Web Playback SDK out of beta" post announced mobile-browser
  support "for most scenarios", with limits around autoplay and background play. The post
  URL (<https://developer.spotify.com/community/news/2021/09/13/web-playback-sdk-out-of-beta>)
  returned HTTP 500 when fetched; this summary comes from a search-engine excerpt of it.
  Older docs said iOS was not supported, which is why forum posts disagree.

### 1.2 What Apple / WebKit document

- **User gesture to start audio.** "Safari on iOS has required a user gesture to play
  media in a `<video>` or `<audio>` element"; the gesture must come from a `touchend`,
  `click`, `doubleclick` or `keydown` handler, and `play()` returns a Promise that rejects
  otherwise. **[WebKit]** blog, 2016-07-25:
  <https://webkit.org/blog/6784/new-video-policies-for-ios/>
- **Volume (old Apple statement).** Apple's Safari HTML5 Audio and Video Guide, "iOS-Specific
  Considerations": "On iOS devices, the audio level is always under the user's physical
  control. The `volume` property is not settable in JavaScript." It also says iOS plays
  only one audio stream at a time. That guide is archived and last updated **2012-12-13**.
  **[Apple]**
  <https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/Using_HTML5_Audio_Video/Device-SpecificConsiderations/Device-SpecificConsiderations.html>
- **Volume (newer WebKit change, iPad-specific).** WebKit bug 193745, "[iOS] Enable media
  element volume on iPad", was landed and closed RESOLVED FIXED on 2019-01-24. **[WebKit]**
  <https://bugs.webkit.org/show_bug.cgi?id=193745>. Bug 241657 (2022) refactored the iOS
  guard on `HTMLMediaElement.volume` into a capability check. **[WebKit]**
  <https://bugs.webkit.org/show_bug.cgi?id=241657>.
  So WebKit's source indicates per-element volume was enabled on iPad in 2019, while
  Spotify's SDK docs still carry Apple's 2012 "not settable on iOS" note. **No primary
  source says which one holds for the SDK in current iPad Safari.** The SDK's internals
  (whether it uses an `<audio>` element's volume or Web Audio gain) are not documented.
  **[Not found]**
- **iPad Safari presents itself as a Mac.** Since iPadOS 13, Safari on iPad requests
  desktop sites by default and sends a `Macintosh` user agent; users can change this in
  Settings → Safari → Request Desktop Website. **[Forum]** Apple Developer Forums, no Apple
  staff reply: <https://developer.apple.com/forums/thread/119186>. No Apple documentation
  page for this was found. **[Not found]** Relevance: any browser sniffing in the SDK or
  Spotify's player would see "desktop Safari", not "iOS".
- **EME / FairPlay in iOS Safari.** No webkit.org or developer.apple.com page stating the
  iOS/iPadOS version that shipped EME was found. **[Not found]** Third-party sources
  (caniuse, video-DRM vendors) put it at iOS 11.2–11.3; one Spotify forum post says
  iOS 13.4. **[Forum / secondary]** <https://caniuse.com/drm>,
  <https://community.spotify.com/t5/Spotify-for-Developers/Web-Playback-SDK-should-work-on-iOS-13-4-but-it-does-not/td-p/5232605>

### 1.3 What developers report (observation, not documentation)

All **[Forum, excerpt]**; mostly 2021–2023, none mention iPadOS 26 or later:

- Calling `activateElement()` did not get past Safari's autoplay policy; a workaround was to
  call `player.connect()` on the first user interaction instead of on SDK load (tested on
  macOS Safari 16.2).
  <https://community.spotify.com/t5/Spotify-for-Developers/Web-Playback-SDK-Playing-song-directly-in-browser-issues-IOS/td-p/5538195>
- `resume` did not work on iOS Safari while iOS Chrome worked.
  <https://community.spotify.com/t5/Spotify-for-Developers/Web-Playback-SDK-Resume-not-working-on-Safari-Mobile-and-Desktop/m-p/5595145/highlight/true>
- `setVolume` did not change volume in iOS browsers, while it worked on desktop and Android.
  <https://community.spotify.com/t5/Spotify-for-Developers/Spotify-Web-SDK-iOS-Safari-Chrome-Playback-Issues-Setting-Volume/td-p/5316263>
- SDK stopped working on iOS 15, worked on older iOS.
  <https://community.spotify.com/t5/Spotify-for-Developers/Web-Playback-SDK-not-playing-on-iOS-15/m-p/5427466>
- On an iPad (6th gen), Spotify's web player loaded in Safari but said "not supported" inside
  a `WKWebView`.
  <https://community.spotify.com/t5/Spotify-for-Developers/Web-Player-not-supported-in-WKWebView-on-iPadOS/td-p/5138660>
- A 2026 thread exists on SDK behaviour inside `WKWebView` on iOS 18/26; its content could not
  be read. <https://community.spotify.com/t5/Spotify-for-Developers/Web-Playback-SDK-behavior-inside-WKWebView-on-iOS/td-p/7456028>

Spotify's consumer help lists Safari as a supported web-player browser with no version or
mobile caveat. **[Spotify support]**
<https://support.spotify.com/us/article/supported-devices-for-spotify/>

### 1.4 Answer to the ticket's first bullet

- **Documented:** the SDK is officially supported on iOS Safari, with documented
  limitations: playback must be started by a user tap, and on iOS volume is (per Spotify's
  docs) not settable from JavaScript.
- **Not documented:** iPadOS specifically, or any particular iPadOS major version. No
  version-specific statement for the current or previous iPadOS major was found from
  Spotify or Apple.
- **Observed, not documented:** autoplay, resume and volume problems on iOS Safari
  (2021–2023 forum reports).
- **Conflict to settle by testing:** WebKit enabled per-element media volume on iPad in 2019,
  but Spotify's docs still say volume is fixed on iOS. Grimoire's fades and per-slot
  volume depend on `setVolume`, so this is the deciding fact.

---

## 2. Remote-controlling the Spotify app on the iPad (Web API / Connect)

Here Grimoire would not play audio itself; it would tell the Spotify iPad app what to play
through the Web API's Player endpoints.

### 2.1 Requirements

- **Premium.** Every Player endpoint page says: "This API only works for users who have
  Spotify Premium." **[Spotify docs]** e.g.
  <https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback>
- **Scopes.** Control endpoints (play, pause, repeat, volume, shuffle, transfer, skip) need
  `user-modify-playback-state`; listing devices and reading playback state need
  `user-read-playback-state`. The `streaming` scope is for the Web Playback SDK only.
  **[Spotify docs]** <https://developer.spotify.com/documentation/web-api/concepts/scopes>
- **One device plays at a time per account.** "You can only play on one device at a time"
  per Spotify account; starting playback elsewhere pauses the first device.
  **[Spotify support]** <https://support.spotify.com/us/article/manage-devices/>,
  <https://support.spotify.com/us/article/supported-devices-for-spotify/>

### 2.2 Finding the iPad

- `GET /me/player/devices` lists devices. "Some device models are not supported and will
  not be listed in the API response." Each device has `id`, `is_active`,
  `is_private_session`, `is_restricted` ("if this is 'true' then no Web API commands will
  be accepted by this device"), `name`, `type`, `volume_percent`, and `supports_volume`
  ("If this device can be used to set the volume"). Device IDs are "unique and persistent
  to some extent" and cached IDs "should periodically be cleared out and refetched".
  **[Spotify docs]**
  <https://developer.spotify.com/documentation/web-api/reference/get-a-users-available-devices>
- **Whether the iPad app must be open/foregrounded is not documented.** **[Not found]**
- Observed: a phone's Spotify app often drops out of the device list (or the API returns
  `404 NO_ACTIVE_DEVICE`) until the user opens the app, sometimes until they also start a
  track. **[Forum]**
  <https://community.spotify.com/t5/Spotify-for-Developers/Get-a-User-s-Available-Devices-does-not-show-iPhone/td-p/5259140>,
  <https://community.spotify.com/t5/Spotify-for-Developers/no-available-devices-are-found/td-p/5074185>,
  <https://community.spotify.com/t5/Spotify-for-Developers/Playback-tracks-without-active-devices/td-p/5630276>
- A former Spotify guide ("Using the Connect Web API", URL now retired) said the Connect
  Web API "relies on local network connections to discover and interact with some
  devices", and that devices may not appear when newly added, asleep, or tied to another
  account. Only known through a quote in a GitHub issue (2020-05-02, non-staff).
  **[Forum]** <https://github.com/spotify/web-api/issues/1337>
- Transferring to an inactive device returned HTTP 500 and the device then vanished from
  the list. **[Forum]**
  <https://community.spotify.com/t5/Spotify-for-Developers/Endpoint-quot-Transfer-Playback-quot-returns-500-error-when-all/td-p/6594944>
- Consumer troubleshooting for Connect on phones/tablets: reopen the Spotify app, keep
  devices on one Wi-Fi, and on iPhone allow Spotify local-network access.
  **[Spotify support]** <https://support.spotify.com/us/article/spotify-connect/>

### 2.3 What can be controlled

| Need                         | Endpoint                                                                                       | Documented behaviour                                                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Start a playlist/album/track | `PUT /me/player/play` (`context_uri` or `uris`, `offset`, `position_ms`, optional `device_id`) | Starts on the given or active device. **[Spotify docs]** [ref](https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback) |
| Move playback to the iPad    | `PUT /me/player` (`device_ids` — exactly one; `play: true/false`)                              | More than one ID returns 400. [ref](https://developer.spotify.com/documentation/web-api/reference/transfer-a-users-playback)                 |
| Pause                        | `PUT /me/player/pause`                                                                         | Listed under `user-modify-playback-state`. [scopes](https://developer.spotify.com/documentation/web-api/concepts/scopes)                      |
| Loop                         | `PUT /me/player/repeat?state=track\|context\|off`                                              | "track will repeat the current track", "context will repeat the current context". [ref](https://developer.spotify.com/documentation/web-api/reference/set-repeat-mode-on-users-playback) |
| Volume                       | `PUT /me/player/volume?volume_percent=0..100`                                                  | Integer 0–100, whole-device volume. Device may report `supports_volume: false`. [ref](https://developer.spotify.com/documentation/web-api/reference/set-volume-for-users-playback) |

Every Player endpoint also says: "The order of execution is not guaranteed when you use
this API with other Player API endpoints." **[Spotify docs]**

- **Looping:** achievable on paper — `repeat=track` and `repeat=context` are documented for
  any controllable device. **[Spotify docs]**
- **Per-slot volume:** there is one volume per device, set in whole percent. Because the
  account plays on one device at a time (2.1), at most one Spotify slot can sound at once
  in either approach — Grimoire's desktop already shares one SDK player across slots.
- **Volume on an iPad/iPhone device:** not documented either way. **[Not found]** Users
  report they cannot set an iPhone/iPad's Spotify volume from another device, and Web API
  volume calls to phones gave mixed results. **[Forum]**
  <https://community.spotify.com/t5/Spotify-for-Developers/Web-API-mixed-results-setting-volume-on-web-player-and-phone/td-p/5315308>,
  <https://community.spotify.com/t5/iOS-iPhone-iPad/No-volume-control-on-Spotify-connect/td-p/587886>.
  A 2024 Daring Fireball item describes Apple restricting how third-party apps set iPhone
  system volume, affecting Spotify Connect's use of the volume buttons. **[Secondary]**
  <https://daringfireball.net/linked/2024/09/06/more-on-spotify-connect-and-iphone-volume-buttons>.
  The device's own `supports_volume` flag is the documented way to find out at runtime.

### 2.4 Latency and limits

- **Latency:** Spotify publishes no latency figure for Player commands or for how fast a
  Connect device reacts. **[Not found]**
- **Rate limits:** computed over "a rolling 30 second window"; exceeding it gives HTTP 429
  with a `Retry-After` header in seconds. Development-mode apps have a lower limit than
  extended-quota apps; no numbers are published. **[Spotify docs]**
  <https://developer.spotify.com/documentation/web-api/concepts/rate-limits>
- **Development-mode quotas** are separate from rate limits, grouped in buckets that "are
  subject to change", and (since July 2026) counted per developer account, so all of a
  developer's dev-mode Client IDs share them. A quota 429 carries `reason: QUOTA_EXCEEDED`.
  **[Spotify docs]**
  <https://developer.spotify.com/documentation/web-api/concepts/quota-modes>,
  <https://developer.spotify.com/documentation/web-api/references/changes/july-2026>
- For scale: today's 25-step SDK fade would be 25 Web API volume calls per fade if moved to
  `PUT /me/player/volume`. Whether that stays under the dev-mode limit is unknowable from
  the docs, since no numbers are published.
- The February 2026 dev-mode changes removed or renamed many endpoints (library, batch
  fetches, browse, `GET /users/{id}`, playlist `/tracks` → `/items`, search limit 50 → 10)
  but **did not list any `/me/player/*` endpoint** as changed. **[Spotify docs]**
  <https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide>

### 2.5 Answer to the ticket's second bullet

- Remote control is a documented, supported use of the Web API: start a playlist, pause,
  loop (track or context), set volume, transfer playback.
- It needs Premium, the `user-modify-playback-state` and `user-read-playback-state` scopes,
  and the iPad's Spotify app appearing in the device list.
- Whether the app must be open is **not documented**; forum reports consistently say a
  backgrounded/idle phone app drops off the list until reopened.
- No latency is published; rate limits are a rolling 30 s window with unpublished numbers.
- Looping is achievable; per-slot volume is whole-device volume only, and whether the iPad
  app accepts remote volume at all is not documented (`supports_volume` tells you at
  runtime; forums suggest iOS devices often refuse).

---

## 3. OAuth when Grimoire is served from a web origin

- **Flow.** Authorization Code with PKCE is the documented flow for apps that cannot keep a
  client secret, including single-page web apps. The token request takes `grant_type`,
  `code`, `redirect_uri`, `client_id`, `code_verifier` — no client secret. **[Spotify docs]**
  <https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow>
- **Browser-only token exchange is Spotify's own example.** The "Display your Spotify
  profile data in a web app" how-to is a single-page app that POSTs to
  `https://accounts.spotify.com/api/token` with `fetch` from the browser, no backend, no
  secret. CORS itself is not discussed on any page. **[Spotify docs]**
  <https://developer.spotify.com/documentation/web-api/howtos/web-app-profile>
- **Refresh without a secret.** For PKCE, the refresh request needs `client_id`; the
  `Authorization: Basic client_id:client_secret` header is "Only required for the
  Authorization Code" flow. A refresh may or may not return a new refresh token; "When a
  refresh token is not returned, continue using the existing token." **[Spotify docs]**
  <https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens>
- **Refresh tokens expire.** "Refresh tokens issued to apps registered in the Developer
  Dashboard have a lifetime of 6 months", and "Refreshing an access token does not extend
  the refresh token's lifetime." Spotify advises building re-authorisation in before then.
  **[Spotify docs]** (same page)
- **Redirect URI rules.** "Use HTTPS for your redirect URI, unless you are using a loopback
  address"; loopback must be the IP literal (`http://127.0.0.1:PORT` or `http://[::1]:PORT`);
  "`localhost` is not allowed"; the URI "must exactly match" what is registered, except
  loopback IP literals, which may use dynamic ports. **[Spotify docs]**
  <https://developer.spotify.com/documentation/web-api/concepts/redirect_uri>,
  <https://developer.spotify.com/documentation/web-api/tutorials/migration-insecure-redirect-uri>
- **One registration for desktop and web.** An app's settings accept "one or more"
  redirect URIs. **[Spotify docs]**
  <https://developer.spotify.com/documentation/web-api/concepts/apps>. So a single Client
  ID can hold both the desktop's `http://127.0.0.1:8888/callback` and an `https://…`
  callback on the web edition's origin. No page says the two must be separate apps.
  Users, quotas and the allowlist are per Client ID (section 4), so both editions would
  share them.
- **Implicit grant** is marked deprecated in Spotify's docs and is not an option to plan on.
  **[Spotify docs]** (sidebar of the authorization docs; migration guide
  "Implicit grant to Authorization code").

---

## 4. Developer terms and quotas for a small invite-only app

### 4.1 Development mode (where Grimoire's app would sit)

- **Five users.** "Up to 5 authenticated Spotify users can use an app that is in
  development mode"; each must be added to the app's allowlist; others get HTTP 403.
  **[Spotify docs]** <https://developer.spotify.com/documentation/web-api/concepts/quota-modes>
- **Owner needs Premium.** "All Development Mode apps require the app owner to have an
  active Spotify Premium subscription"; if it lapses the app stops working until renewed.
  **[Spotify docs]**
  <https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide>
- **Timeline of these limits.** New dev-mode apps from 2026-02-11; existing apps migrated
  2026-03-09. "Existing apps are grandfathered: If you already have multiple Client IDs or
  more than 5 users, you will retain them." Spotify postponed the *endpoint* changes for
  existing apps, but the Premium requirement, five-user cap and Client-ID limit took effect
  as planned. **[Spotify docs]** migration guide above, and
  <https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security>
  - Whether Grimoire's existing Client ID had more than 5 allowlisted users before
    2026-03-09 (and so kept them) can only be seen in its Developer Dashboard.
- **Client IDs per developer:** 1 from February 2026, raised to 25 in July 2026; dev-mode
  quota is shared across them. **[Spotify docs]**
  <https://developer.spotify.com/documentation/web-api/references/changes/july-2026>
- **Stated purpose of dev mode:** "learning, experimentation, and personal projects for
  non-commercial use by individual developers." **[Spotify docs]** (Feb 2026 blog above)

### 4.2 Extended quota mode

- Unlimited users and higher rate limits, but since 2025-05-15 Spotify "only accepts
  applications from organizations (not individuals)". Listed criteria include a legally
  registered business, a launched service, "at least 250k MAUs", availability in key
  markets, and commercial viability. Review "can take up to six weeks". **[Spotify docs]**
  <https://developer.spotify.com/documentation/web-api/concepts/quota-modes>,
  <https://developer.spotify.com/blog/2025-04-15-updating-the-criteria-for-web-api-extended-access>

### 4.3 Terms text that touches this use

Quoted for the record only. This is not legal advice and has not been reviewed by Legal;
how any of it applies to Grimoire is a question for the Legal team (or Spotify), not for
this note.

- Web Playback SDK page: "This SDK must not be used in commercial projects without
  Spotify's prior written approval." **[Spotify terms]**
  <https://developer.spotify.com/documentation/web-playback-sdk>
- Developer Policy (effective 2025-05-15), §III.7: "Do not permit any device or system to
  segue, mix, re-mix, or overlap any Spotify Content with any other audio content".
  §III.6 bars synchronising sound recordings with visual media; §III.10 says Spotify is
  "for personal, non-commercial use"; §IV.1 restricts streaming to subscribers.
  **[Spotify terms]** <https://developer.spotify.com/policy>
- Developer Terms, Version 10 (effective 2025-05-15): §III.1.a licence "for private
  personal use"; §VI.2 / §VI.7.1 allow Spotify to limit calls and impose quotas.
  **[Spotify terms]** <https://developer.spotify.com/terms>
- Player endpoint pages repeat four policy notes: streaming apps "may not be commercial",
  keep audio "in its original form", do not synchronise with visual media, no
  "non-interactive broadcasting". **[Spotify docs]** e.g.
  <https://developer.spotify.com/documentation/web-api/reference/transfer-a-users-playback>
- No clause specific to iPad, Safari, or web vs desktop editions was found. **[Not found]**

---

## 5. Short answer

1. **SDK on iPad Safari:** officially supported on iOS Safari (Spotify docs), but iPadOS and
   specific versions are never named, and nothing confirms the current or previous major.
2. **SDK limits on iOS (documented):** playback must start from a user tap; volume is "not
   settable in JavaScript" per Spotify's docs — which would break Scene fades and per-slot
   volume. WebKit enabled media volume on iPad in 2019, so this needs a device test.
3. **SDK problems on iOS (observed only):** autoplay, resume and `setVolume` failures in
   2021–2023 forum reports.
4. **Remote control via Web API:** documented and supported — play a playlist, pause, loop
   (`repeat=track|context`), set volume, transfer. Needs Premium and the
   `user-read-playback-state` scope Grimoire doesn't request today.
5. **iPad app must be reachable:** undocumented; forum reports say a backgrounded Spotify
   app on iPhone/iPad drops out of the device list until reopened.
6. **Volume when remote-controlling:** one whole-device volume in whole percent; iOS devices
   may report `supports_volume: false` (forums suggest they often do). No latency figures
   are published; rate limits use a rolling 30 s window with no published numbers.
7. **OAuth from a web origin:** PKCE works browser-only with no secret or backend (Spotify's
   own example). Redirect must be HTTPS (loopback IP excepted); one app can register both
   the desktop and web redirect URIs.
8. **Tokens:** refresh needs only `client_id` under PKCE; refresh tokens last 6 months and
   are not extended by refreshing.
9. **Dev mode:** 5 allowlisted users per app (grandfathered if more before 2026-03-09), owner
   must hold Premium; extended quota is organisations only with 250k MAU, so effectively
   out of reach for an invite-only app.

---

## 6. Open questions only a device test can answer

- Does `player.setVolume()` change loudness in current iPad Safari (and does
  `getVolume()` return 1)?
- Does `new Spotify.Player(...).connect()` succeed in iPad Safari, and does the first
  `PUT /me/player/play` to its device start audio when triggered from a tap?
- Can a Safari tab's local audio (Grimoire's ambient slots) and the Spotify iPad app's audio
  play at the same time, or does one interrupt the other?
- How long after backgrounding does the Spotify iPad app disappear from
  `GET /me/player/devices`, playing vs paused?
- What does the iPad's Spotify app report for `supports_volume`, and do
  `PUT /me/player/volume` calls take effect?
- Round-trip time from a Web API call to audible change on the iPad.
