---
target: timeline block
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\editor\\TimelineBlockView.svelte"
target_fingerprint: "sha256:fc286d5ffba46de9829a83c3b64fd66022f0dee329d5140f962a935dd4012619"
target_path: "C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\editor\\TimelineBlockView.svelte"
timestamp: 2026-10-13T21-55-28Z
slug: src-lib-components-editor-timelineblockview-svelte
---
Method: dual-agent (A: af83f5846182fd3d3 · B: aa4bab699f737e8d4)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Move/delete unannounced; can't tell which events hold a description |
| 2 | Match System / Real World | 3 | Reads as a chronicle; an empty date shows the word "Date" at rest |
| 3 | User Control and Freedom | 2 | Ctrl+Z undoes move/delete, but abandoned blank events stick and reach the file |
| 4 | Consistency and Standards | 2 | 17px controls vs 28px siblings, three focus styles, no tooltips, no block frame |
| 5 | Error Prevention | 1 | 8px insert strips go live between events; after a delete focus sits on the next Delete |
| 6 | Recognition Rather Than Recall | 2 | Hover-only controls; identical chevrons whether or not there's a description |
| 7 | Flexibility and Efficiency | 1 | One-step reorder only; 104 tab stops for 15 events; no shortcuts |
| 8 | Aesthetic and Minimalist Design | 3 | Calm at rest; hovering one row draws three dashed rules |
| 9 | Error Recovery | 2 | Undo works but says nothing |
| 10 | Help and Documentation | 2 | No tooltips; placeholders do all the teaching |
| **Total** | | **20/40** | **Acceptable** |

## Design Specificity Verdict

LLM: reading view is Grimoire's own — hollow-node spine, Metamorphous titles, Nunito dates, crimson only on the focused node. Editing chrome is the generic Row List (dashed full-width rules, 17px icons), less finished than the rebuilt Statblock and Scene player.

Deterministic: CLI clean on TimelineBlockView.svelte and RowList.svelte (exit 0, 0 findings). Overlay: 0 findings in the timeline at rest and hovered/expanded; 1 elsewhere (cramped-padding on the Ctrl+K badge, likely false positive). No rule targets hover-revealed controls.

## Priority Issues

[P1] A blank event the GM abandons is written into the note as `# `. Inserts deliberately don't commit, but the next edit commits the whole timeline snapshot (TimelineBlockView.svelte:49-57) and the serializer writes the blank title (timeline-block.ts). 8px full-width insert strips go live between events, so a stray click plants one. Reproduced twice.

[P1] Focus stays on the position, not the event, after move or delete — rows keyed by index (RowList.svelte:159). A second Enter on Move up swaps back; after Delete, focus is on the next event's Delete. Nothing announced.

[P1] Screen readers never hear a date or title: the shared field's aria-label replaces its text ("Event 1 title"); groups are "Event 1"; controls generic. Shared with Infobox/Statblock edit mode.

[P2] Descriptions hidden with no scent, and too small: identical chevrons, all collapsed; 12px/1.33 muted text vs 16px/1.7 prose; chevron ~2.6:1.

[P2] Description editor shrinks and hides text: textarea rows = newline count, ignoring wrap; 57px box over 104px of text, caret at end.

[P2] Row List chrome under-sized and inconsistent: 17px move/delete, 8px strips, three focus treatments (white halo in dark), no tooltips, cursor default on fields.

[P3] Authoring rough edges: fresh /timeline opens collapsed while Add event opens expanded; date above title but Tab goes title → chevron; empty "Date" placeholder at rest.

## Persona Red Flags

Alex: one-step reorder, 7 tab stops per event, no Alt+↑/↓ / Enter-for-next / expand-all; raw wikilink paths in edit.
Sam: content-less names, focus doesn't follow move/delete, no announcements, wikilinks pointer-only, white focus halo.
GM at the table: the answer to "when?" is the smallest, faintest text; 15 events exceed the window; no sign which events have notes; stray clicks plant blank events.

## Minor Observations

Stale docs (date described as Metamorphous/accent; shipped Nunito muted — correct). No block frame unlike siblings. Expanded set not remapped on undo (setAttrs). Chevron click leaves controls revealed via focus-within. Description expand animates grid-template-rows (app-wide motion item). Weak empty state. Sample copy "The [[The Order of Embers]]" reads "The The Order of Embers" (stub). Opening a note appended a trailing newline (not Timeline's).

## Questions to Consider

- If the table question is "when?", why is the date the faintest text?
- Should a description ever be completely hidden?
- Could the full row chrome appear only for keyboard focus, with one per-event menu for the pointer?
