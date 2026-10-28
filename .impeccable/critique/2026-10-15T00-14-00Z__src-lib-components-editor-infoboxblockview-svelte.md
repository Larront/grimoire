---
target: infobox block
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\editor\\InfoboxBlockView.svelte"
target_fingerprint: "sha256:7ba589b77f1e4bfed92fb060f69866dc074c99e0de0e3efb00b33bde6d204699"
target_path: "C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\editor\\InfoboxBlockView.svelte"
timestamp: 2026-10-15T00-14-00Z
slug: src-lib-components-editor-infoboxblockview-svelte
---
Method: dual-agent (A: a2f6fe64981ee46d2 · B: ad0011a338a98dcf1)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Moves/deletes announced; Remove image is silent |
| 2 | Match System / Real World | 3 | Strong wiki-infobox metaphor; machine-like SR names ("Row 2 value") |
| 3 | User Control and Freedom | 2 | Remove image drops focus to body, so Ctrl+Z needs a click back first |
| 4 | Consistency and Standards | 2 | 17px thumbnail controls vs 24px gutter vs 28px elsewhere; placeholder policy mixed |
| 5 | Error Prevention | 2 | Invisible insert band takes clicks on the lower half of link text; Remove image is one click and wipes the caption |
| 6 | Recognition Rather Than Recall | 3 | Gutter has tooltips; thumbnail Replace/Remove don't; Alt+Enter undiscoverable |
| 7 | Flexibility and Efficiency | 2 | ~29 Tab stops across Mira's panel; adding a row costs several keystrokes |
| 8 | Aesthetic and Minimalist Design | 2 | Gutter + invisible title/Add rows waste 26–29% of the panel; values wrap badly |
| 9 | Error Recovery | 3 | Shared missing-image notice; broken links dotted |
| 10 | Help and Documentation | 2 | No Infobox entry in DESIGN.md §5 |
| **Total** | | **24/40** | **Acceptable** |

## Design Specificity Verdict

LLM: concept specific (640px column-threshold float, Metamorphous title, shared viewer); execution in the floated state reads as a cramped form — permanent control gutter and invisible bands over text.

Deterministic: CLI clean; overlay 0 findings in the infobox at rest, row hover, gap hover, thumbnail hover, and on Thornhaven; 1 elsewhere (Ctrl+K kbd, false positive). Detector can't see hit areas or reserved width.

## Priority Issues

[P1] The Row List's insert band overlays row text and takes clicks, including links (RowList.svelte:190-211, from the Timeline review). A 16px full-width z-10 strip over the bottom of the row above; in the Infobox rows touch, so clicks on the lower half of "Thornhaven Village" hit the strip. Also affects statblock edit mode.

[P1] The control gutter takes 80px (29%) of the floated panel: value column 128px vs 184px without; Mira's rows +61% taller.

[P2] Keyboard/SR access thin: links in values unfollowable from keyboard; rows not named by content; identical "Delete row"; panel unnamed; empty title read as placeholder; hidden insert buttons exposed.

[P2] Thumbnail controls old style (17px, no tooltips, ring-1, bg-card/90 no shadow); Remove image loses focus, silent, wipes caption; two Replace controls when missing; Add image 17px.

[P2] Invisible reserved chrome: empty title row and quiet Add row reserve 71/270px of Thornhaven's panel.

[P3] Editing a wrapped title/value collapses to a one-line scrolled input.

[P3] Long unbroken words overflow under the gutter; stacked 30% label column too wide.

## Persona Red Flags

Alex: many keystrokes per row; Alt+Enter in a field doesn't insert; Ctrl+Z after Remove image needs a click.
Sam: ~29 tab stops; links unfollowable; "Row 2 value"; five "Delete row"; unnamed panel; hidden insert buttons; 1px focus ring.
GM at the table: answer under a 3-line value; half of a link dead; "On the marsh" runs into "Camp".

## Minor Observations

Synthetic italic Metamorphous placeholder; placeholder policy inconsistent; insert plus over panel border; tall stacked portrait at 700px; stale live-region text; link preview of a note leads with raw infobox fence (preview's issue).

## Questions to Consider

- In a block that is read, not played, should reorder/delete live on the panel at all?
- Should the label column be shared and sized to the longest label?
- Should a note's link preview lead with its Infobox?
