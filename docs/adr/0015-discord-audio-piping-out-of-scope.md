# Discord audio-piping is out of scope

We considered adding a way to stream scene audio into a Discord voice channel for remote play — either by embedding a local Discord bot (Rust `songbird`), by remote-controlling Kenku FM via its Remote API, or via a virtual audio cable. We chose to build none of them: getting Grimoire's audio into Discord is out of scope.

The decision turns on one hard constraint. Grimoire's audio has two sources (`audio-engine.svelte.ts`): local files, which play through the Web Audio graph and _are_ capturable, and Spotify, which plays through the Spotify Web Playback SDK. The SDK's decoded audio is DRM-protected (EME) and never enters the Web Audio graph, so there is nothing to tap — and rebroadcasting it into a voice channel would violate Spotify's Developer ToS and put the credentials behind the _existing_ scene feature at risk. **No in-app path can carry Spotify audio**, which is the primary source for the workflows this feature was meant to serve.

That collapses the option space. Every buildable path (bot, Kenku-remote, virtual cable) can carry local files only, so none serves the Spotify-first case. Against that, the costs are real: the embedded bot is a heavy Rust voice build (voice gateway, Opus, encryption, native modules in the Tauri bundle) and — worse — a _permanent_ maintenance tax, since Discord periodically rotates its voice encryption modes and each change silently breaks users' audio until we chase it. The Kenku-remote path does not retire Kenku (it stays installed and running) and splits the audio library across two apps with manual id-mapping. The virtual-cable path pushes the most friction onto the user (third-party driver + a software mixer to fold in their mic + disabling Discord's voice DSP, which mangles music) for the worst audio quality. Taking on any of these — a forever-cost, for an optional feature that can't carry the source we care about most — is the wrong call.

## Consequences

- Grimoire stays a local prep-and-play surface. Audio playback (scenes, Spotify, local files, crossfade) is unaffected; only _transporting_ that audio to Discord is declined.
- Getting scene audio to remote players is left to the user's own system-audio routing, outside the app. We do not document or recommend a specific method.
- If this is ever reopened, it would be for **local-file audio only** and would still exclude Spotify — the DRM constraint is not something a future decision can engineer around.
- `audio-engine.svelte.ts` keeps its local/Spotify `SlotPlayer` split; no capture tap or `MediaStreamAudioDestinationNode` is added to the Web Audio graph.
