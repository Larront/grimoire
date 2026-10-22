---
target: statblock in use
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
target_identity: "file:C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\editor\\StatblockBlockView.svelte"
target_fingerprint: "sha256:b1c9522cc4d6d2f358569ddef3ff1fcc84c4606c258b68dc3b0952e2f8e8f8da"
target_path: "C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\editor\\StatblockBlockView.svelte"
timestamp: 2026-10-13T20-26-33Z
slug: mponents-editor-statblockblockview-svelte-9b7969f9
---
Method: dual-agent (A: aab60941f51386934 · B: aa0ed2723d1dbb7d6)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Rejected input (abc, "- 12", -2d6) closes silently; no preview of the result |
| 2 | Match System / Real World | 3 | N/M, boxes, signed damage — the GM's own vocabulary |
| 3 | User Control and Freedom | 2 | Focus drops to the page after a hit, so Ctrl+Z does nothing until the GM clicks back into the note |
| 4 | Consistency and Standards | 2 | 17px icon-only controls, no tooltips, ring focus styles; the scene block uses 28px, titles, outline rings |
| 5 | Error Prevention | 1 | Missing the 16px HP target by 2px opens Armor Class as a text field; "-12" then writes AC "15-12" |
| 6 | Recognition Rather Than Recall | 2 | Nothing marks a pool as clickable; "unsigned is absolute" must be remembered |
| 7 | Flexibility and Efficiency | 2 | Arithmetic is fast, but hits can't be chained from the keyboard |
| 8 | Aesthetic and Minimalist Design | 3 | Calm, well-ranked card; 5E SRD preset fills view mode with 14 "Value" placeholders |
| 9 | Error Recovery | 1 | No message on junk input, no signal when a hit landed on the wrong row |
| 10 | Help and Documentation | 2 | Large Orc preset teaches by example; nothing inline explains -12 vs 12; slash menu hides presets |
| **Total** | | **20/40** | **Acceptable** |

## Design Specificity Verdict

LLM: Authored as a reference card (Metamorphous name, muted /68, hairline rail, shared block frame); generic-to-broken as a play surface — a live HP pool looks exactly like inert AC, marks are near-invisible (1.28:1 border), and encounter tiling never tiles.

Deterministic: CLI exit 0, one advisory (design-system-radius, 3px on .statblock-mark, StatblockBlockView.svelte:758 — borderline; the scale has no small-control step). Overlay: 0 findings in view mode and with the pool open; 1 in edit mode (low-contrast 3.1:1 "Name (optional)" placeholder from LinkedTextField.svelte:271). Detector cannot see hit sizes, focus loss or tiling, which carry the real problems.

## Priority Issues

[P0] Damage aimed at HP lands in the row below as text, silently. Every non-pool value is a one-click text field in view mode (StatblockBlockView.svelte:449-460); AC's field starts 2.3px under the 16px HP button. Verified: "-12" wrote AC "15-12", HP untouched. Contradicts ADR-0016 §6's own reason for the edit mode (a play slip editing the creature's definition).

[P1] Pools and marks too small and not legible as controls. Pool 22×16px with only a hover tint; marks 13.6px, border 1.28:1 (dark) / 1.22:1 (light); a mark's label isn't clickable.

[P1] Encounter tiling never happens. --statblock-narrow 24rem assumes a ~53rem callout (app.css:295-305); the note column is capped at 46rem, giving a 622px callout body. Two cards need 784px. Verified at 1536, 2400 emulated, and sidebar collapsed.

[P1] Focus dropped after every commit, Escape and mode change — no chained hits, Ctrl+Z inert until the note is clicked, a second Escape can't leave edit mode.

[P2] No screen-reader meaning ("Row 1 current value" for every creature's HP), no live announcement, junk input rejected silently, no "68 → 56" preview.

[P2] Mark tracks stack vertically when collapsed and in comfortable cards, against the code's stated intent (:418-420).

## Persona Red Flags

Alex: no chained hits; 17px hover-only icon controls without tooltips; slash menu hides presets; the visible "+" adds a section, not a row.
Sam: unnamed controls, no live region, focus lost after every action, wikilinks in entries aren't tab stops, three focus-ring styles.
GM mid-fight: 22×16 target that looks like text 2px above an editable AC; "12" meaning damage sets HP to 12 with no preview; undo silently does nothing.

## Minor Observations

Opening the pool shifts /68 by ~26px; edit mode doubles the height and shows raw [x][ ]; several blocks can be in edit mode at once; "Value" placeholders in view mode (3.1:1 / 2.5:1); collapsing near the note's end scrolls the block out from under the pointer; "[ ] [ ]" is rewritten "[ ][ ]" on first tick; ticked marks fill crimson (Signal Rule question); ~45px dead space under the encounter callout header; 3px mark radius off-scale; edit-mode "Name (optional)" 3.1:1.

Outside the statblock: after Back to a note then New → Note, typing the new note's title renamed the previous note (and rewrote links to it); separately a tab showed stale statblock values after another note was deleted.

## Questions to Consider

- Should anything but a pool or mark be editable outside edit mode?
- Is a ticked box "selected" under the Signal Rule, or crimson spent on state?
- Should the pool show its arithmetic while typing?
