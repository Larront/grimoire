---
target: in-note scene player
total_score: 18
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
target_identity: "file:C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\editor\\SceneBlockView.svelte"
target_fingerprint: "sha256:0e06e0399a67478235ec901bc549deca054a74a0d31309c0c6de00b7323c3b0a"
target_path: "C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\editor\\SceneBlockView.svelte"
timestamp: 2026-10-13T02-22-35Z
slug: src-lib-components-editor-sceneblockview-svelte
---
Method: dual-agent (A: design-review subagent · B: detector subagent; sequential — one app window)

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 1 | Paused block still shows Pause/bars/crimson; every block's master crimson when anything plays |
| 2 | Match System / Real World | 2 | "‹" = change scene; "Resume" for unstarted tracks; "Unknown scene" |
| 3 | User Control and Freedom | 2 | Change scene unbinds at once; picker no cancel/Escape |
| 4 | Consistency and Standards | 1 | No preview/resume vs editor; unscoped master vs PDF bubble; Metamorphous picker rows |
| 5 | Error Prevention | 2 | Hidden collapsed-mixer sliders keyboard-reachable |
| 6 | Recognition Rather Than Recall | 2 | Unlabelled master; global Mute all per block |
| 7 | Flexibility and Efficiency | 2 | Picker no autofocus/Enter/arrows; 14 Tabs between blocks |
| 8 | Aesthetic and Minimalist Design | 3 | 7 strip controls while playing |
| 9 | Error Recovery | 1 | Deleted scene shows live dead controls + dead link |
| 10 | Help and Documentation | 2 | Sample prose only |
| Total | | 18/40 | Poor |

## Priority Issues
- [P0] Can't resume after pause: isThisScenePlaying = isScenePlaying stays true after pause (SceneBlockView.svelte:124-126, 146-155, 127-129, 366). Scope paused like ScenePane. (harden)
- [P1] Play aria-label reads global isScenePaused (:380-384); no scene name in labels. (harden)
- [P1] Track play no-op while stopped (toggleSlotPlayback :223-235 → resumeSlot early return); stopped mute cosmetic (:188-200). Use previewSlot / editor playSlot. (harden)
- [P1] Collapsed mixer controls in tab order (:491-495, needs inert); focus lost after Play (disabled while loading :377) and Stop (removed :398). (harden)
- [P2] Deleted scene: "Unknown scene" + live controls + dead "Open this scene" (:362-430, :503-509); empty scene Play enabled & silent. (harden)

## Detector
CLI 0; browser 0 inside blocks (collapsed + expanded); 3 out-of-scope elsewhere. Measured: name 6.24:1, pill 5.7:1, strip buttons 24px. Icons unchecked.

## Persona Red Flags
GM: no resume; no track audition; name truncates to "T." at 420px; "‹" next to Expand. Sam: unnamed repeated buttons; hidden tab stops; focus loss; double loop signal; 20px mixer buttons. Alex: picker keyboard dead; 14 Tabs; no shortcut.

## Minor
12px muted name; 4px block spacing; external-link hover icon; fixed 80px mixer sliders; skip row layout jump; Mute all lacks aria-pressed; gutter "Delete scene" deletes block; slash "Ambient Scene"; inline picker diverges from shared ScenePicker (Metamorphous rows, crimson hover, 2:1 placeholder, focus style).

## Questions
Master slider in a note block at all? Strip chip+name as play target? New scene from picker opens beside?
