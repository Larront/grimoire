---
target: scene editor (ScenePane)
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\panes\\ScenePane.svelte"
target_fingerprint: "sha256:5120076512850e6cc25bea63905c63fcfe2cc47149e9a1c84d1784538b1908b5"
target_path: "C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\panes\\ScenePane.svelte"
timestamp: 2026-10-12T22-28-44Z
slug: src-lib-components-panes-scenepane-svelte
---
Method: dual-agent (A: design-review subagent · B: detector subagent; sequential — one app window)

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 2 | Editor never shows "playing"; shows another scene's paused state as its own |
| 2 | Match System / Real World | 3 | Shuffle offered on local files; "Spotify URI" vs "link or URI" |
| 3 | User Control and Freedom | 2 | Track delete is a modal with no undo |
| 4 | Consistency and Standards | 1 | Three surfaces draw one scene three ways; sliders differ from in-note player |
| 5 | Error Prevention | 2 | 3px volume hit area; Play crimson on empty scene; Add disabled with no reason |
| 6 | Recognition Rather Than Recall | 2 | Rename/delete right-click only; appearance hover-only; no volume value |
| 7 | Flexibility and Efficiency | 1 | No shortcuts, reorder, double-click rename, per-track audition |
| 8 | Aesthetic and Minimalist Design | 3 | Restrained; crimson leaks into decoration |
| 9 | Error Recovery | 2 | Empty-scene Play silently does nothing |
| 10 | Help and Documentation | 2 | Minimal; drop hint incomplete |
| Total | | 20/40 | Acceptable |

## Design Specificity
Hero (Metamorphous name over art) is Grimoire; below it a stock shadcn mixer. Detector: CLI 0 findings; browser clean at rest and hover; Add Track dialog has 2 low-contrast findings (active tab crimson text 3.1:1, ScenePane.svelte:962-971 — also a Signal Rule breach; drop hint 3.0:1, :1012-1013). No false positives.

## Priority Issues
- [P1] Wrong-scene Resume: ScenePane.svelte:613,618 use global isScenePaused/isCrossfading; scope to this scene as SceneBlockView.svelte:147 does. (harden)
- [P1] Three identities: hero uses ACCENT_BG[scene.id % 5] (:51-54) instead of sceneThumbColors(); default icon Music2 here/sidebar/in-note vs Clapperboard on dashboard (CONTEXT says clapperboard); hero icon ignores chosen colour. (polish)
- [P1] Volume sliders: 3px opacity-0 range inputs, no thumb/label/focus/value; master unlabelled (:645-664, :793-811). Reuse/extract the in-note slider (SceneBlockView.svelte:492-508). (harden)
- [P2] Appearance controls hover-only (:543-580) — first 3 Tab stops invisible; bg-black/65 pills not floating treatment; picker modals (:877-946) show no current selection; icon names "Wand2". (polish)
- [P2] Not built for the table: transport bar not sticky (:599); no crimson playing signal; dead per-track glyphs when stopped (:699-760); Shuffle on local files (:835-846, :1071-1074); 560px overflow clips Shuffle and master. (adapt)

## Persona Red Flags
GM at the table: wrong-scene Resume; transport scrolls away; 3px sliders; no playing signal; no track audition; master looks per-scene; empty Play silent.
Sam: invisible first 3 Tab stops; unnamed sliders without focus; unlabelled per-track transport; Loop/Shuffle names lack track; scene name input unnamed, no focus ring; nested Cancel button (:1079-1081); Escape from rename drops focus to body.
Alex: no Space/F2/Delete; no reorder; right-click-only rename; modal round trips for colour/icon.

## Minor Observations
Name 30px off-scale, long names clip; gradient on colour heroes; mono source pill; empty state crimson tile, Nunito heading, outline Add vs crimson Play; new scene name not focused; Spotify auto-label dead code (:373 vs :461); drop hint omits m4a/aac; stale "icon rail" copy; modal delete + misleading "cannot be undone"; centred list vs full-width header misalign; dialog scroll-lock shift ~15px; Add Track dialog height jump.

## Questions
Does the editor need a 208px hero? Editor or viewer without per-track audition? One shared SlotRow/VolumeSlider? Neutral fills until playing?
