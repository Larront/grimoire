---
target: mini player
total_score: 17
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 4
target_identity: "file:C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\sidebar\\MiniPlayer.svelte"
target_fingerprint: "sha256:b1b162055346517565be81ed4e84579e784a37a5b9bc970a5e3549e4e7c55419"
target_path: "C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\sidebar\\MiniPlayer.svelte"
timestamp: 2026-10-13T18-58-14Z
slug: src-lib-components-sidebar-miniplayer-svelte
---
Method: dual-agent (A: a228690a354a7dc11 · B: a63c33aa4311ae9f0)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Paused looks the same as playing (all crimson); during a scene change it names the old scene; nothing on the collapsed rail |
| 2 | Match System / Real World | 3 | Standard transport icons, the GM's own scene and track names |
| 3 | User Control and Freedom | 2 | Pause and Stop locked for the whole 2.5s scene change; the name doesn't open the scene; Resume undoes deliberate single-track pauses |
| 4 | Consistency and Standards | 1 | Drifted from the rebuilt in-note player: sizes, labels, inert, source pill, loop styling; mute isn't shared between surfaces |
| 5 | Error Prevention | 1 | Hidden sliders take keyboard input and save it; toggling loop on a muted track saves volume 0 |
| 6 | Recognition Rather Than Recall | 2 | No tooltips; master slider unlabelled; no "Paused" |
| 7 | Flexibility and Efficiency | 1 | No palette command or hotkey for pause/stop/mute; 21 Tabs to reach Pause |
| 8 | Aesthetic and Minimalist Design | 2 | Tidy collapsed; expanded it is 6 crimson marks and 45% of the window |
| 9 | Error Recovery | 1 | Play on an unloaded track silently does nothing; loop silently can't be turned back on |
| 10 | Help and Documentation | 2 | Names exist but are generic ("Mute track" ×N) |
| **Total** | | **17/40** | **Poor** |

## Design Specificity Verdict

LLM: mostly generic — a legacy piece the rebuilt siblings left behind. Any app's mini media player: 12px label, canvas level meter, green "S" brand pill. Only the iron surface and crimson-for-playing are Grimoire's, and crimson leaks into paused. None of the in-note player's settled decisions reached it (NowPlayingBars, Metamorphous name, 28px controls, inert collapsed panel, named per-track controls, neutral source pill, aria-disabled, state scoped to the scene).

Deterministic scan: CLI 0 findings on all three files (exit 0). Live overlay injected in the running app, expanded and collapsed: 0 findings inside the mini player; 3 elsewhere (cramped-padding on the Ctrl+K hint, line-length on the Start Here callout, em-dash-overuse on note text) — all outside scope, likely false positives or content. The detector checks broad patterns and can't judge state, hit size or the visualiser, so its silence is weak evidence here. Overlay removed after the run.

## Priority Issues

[P0] Stop during a scene change leaves the new scene playing with nothing able to stop it. Engine: crossfadeTo bails on abort without stopping its incoming players (audio-engine.svelte.ts:642); stopAll only stops committed players. Mini player hides it by disabling Pause/Stop for 2.5s (MiniPlayer.svelte:86,99); the in-note player's Stop is enabled and can orphan audio today. Fix: stop incoming players on abort (and stop starting more), then enable Stop everywhere; Pause uses the aria-disabled pattern.

[P1] Its state disagrees with every other surface. Paused stays crimson (active={isPlaying}, which pause never clears; canvas always text-primary). Scene change shows the outgoing scene (activeSceneId, not loadingSceneId ?? activeSceneId). Track mute is per-component (MiniPlayerTrack mutedVolume; SceneBlockView slotMutedVolumes). One-track preview looks like the whole scene. Fix: one shared "sounding" derivation, NowPlayingBars, show the incoming scene, mute owned by the engine.

[P1] Track settings go stale and save wrong values — shared root cause. scenes.getSlots is a plain non-reactive cache; each surface holds its own copy, so a change in one doesn't reach the others. Verified: loop can be turned off but never back on; loop while muted saves volume 0; Play on an unloaded track is a silent no-op. Fix: make the slot cache reactive in the scenes store so every surface reads one copy; save the pre-mute volume; mark unloaded tracks.

[P1] The folded track list is still keyboard-live: 8 invisible Tab stops; arrow keys changed and saved a hidden track's volume. Fix: inert={!expanded} (as SceneBlockView).

[P1] A long track label pushes every track's controls out of the sidebar (list 439px in a 293px sidebar). Fix: minmax(0,1fr) on the grid, min-w-0 on rows.

[P2] Footer budget, collapsed rail, keyboard reach. Expanded footer is 397px of 890 (45%), file tree down to 2 rows; 57% in the 900×700 sheet. Collapsing the sidebar removes all audio state and control. No palette commands or hotkey.

## Persona Red Flags

Alex: no hotkey/palette command; 21 Tabs to Pause; scene name doesn't open the scene; Resume undoes single-track pauses.
Sam: 8 invisible focus stops that save; "Pause track"/"Mute track" without track names; master mute labelled "Unmute" with no aria-pressed; visualiser role=img with no state; no live announcement on scene change.
GM mid-session: Stop locked 2.5s on every scene change; paused reads as playing; muted draws quieter not louder; 20–24px targets vs 28px elsewhere; collapsing the sidebar loses audio control; a long name hides every Pause.

## Minor Observations

Canvas visualiser blurry at DPR 2.5, ignores Reduce Motion, animates while paused, flat for Spotify. Scene name Nunito 12px vs Metamorphous 14px on the in-note strip. Loop-off 1.69:1, muted icon 2.64:1, spinner 2.08:1 (light theme worse). Green Spotify pill breaks One Accent. Loop label flips AND has aria-pressed. Album skip row does nothing (engine treats only playlists as skippable). Skip buttons on a third row; Play at the right end unlike siblings. No tooltips. "Unknown Scene" fallback. Expanded state per instance, resets on Stop. Master icon stays crimson-slider while paused in ScenePane too.

## Questions to Consider

- If this is the GM's only audio control while in notes, why does it vanish when they collapse the sidebar to focus?
- Does the mini player need a third copy of the track mixer, when the note and the editor already have one?
- Should a mid-session volume nudge rewrite the prepared mix?
