---
target: image block
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\editor\\ImageBlockView.svelte"
target_fingerprint: "sha256:cd155e66268a87e6c297efde21dabfa56ce7cedae0f29a11665d44b4b925f390"
target_path: "C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\editor\\ImageBlockView.svelte"
timestamp: 2026-10-14T21-32-21Z
slug: src-lib-components-editor-imageblockview-svelte
---
Method: dual-agent (A: ac83e7cfa878e7be0 · B: a59744f3b1a4e94f9)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | No selected cue on the image; no width readout while dragging; missing image raises a generic error toast |
| 2 | Match System / Real World | 2 | "Align right" doesn't wrap text; "View full size" means native pixels; missing state prints a raw path |
| 3 | User Control and Freedom | 3 | Ctrl+Z and Escape work; caption Escape doesn't revert; Space deletes a selected image |
| 4 | Consistency and Standards | 2 | 22px untooltipped controls; caption is a raw input; Infobox image has Replace but no viewer, this one the reverse |
| 5 | Error Prevention | 2 | Typing/Space replaces a selected image; /image offers SVG then refuses it; toolbar covers Replace |
| 6 | Recognition Rather Than Recall | 2 | No tooltips, no hover cursor; Replace only appears once the file is broken |
| 7 | Flexibility and Efficiency | 2 | Good keyboard width slider; no presets; viewer not on double-click or a key |
| 8 | Aesthetic and Minimalist Design | 3 | Restrained chrome; selecting reflows the note; aligned images leave dead columns |
| 9 | Error Recovery | 1 | Missing state: 2.99:1 text, raw path, false "please try again", Replace covered |
| 10 | Help and Documentation | 2 | Good aria-labels, nothing visible explains the icons |
| **Total** | | **21/40** | **Acceptable** |

## Design Specificity Verdict

LLM: correctly layered and quiet (chrome only on selection, floating toolbar), but the generic TipTap image pattern with Grimoire tokens; the two GM moments — an image beside prose, showing it to the table — are the weakest.

Deterministic: CLI clean (exit 0). Overlay: 0 findings in the block at rest, selected, or in the open viewer; 2 elsewhere (Ctrl+K badge, a prose paragraph's line length). The detector can't see layout, hit size or the viewer's sizing.

## Priority Issues

[P1] The viewer can't show the table: native size (max-w-none, ImageBlockView.svelte:375) — a 320×200 image tiny on a 1536 screen, a 1200×896 map cut off; caption absent; bg-black/80; only via select → 22px icon; double-click nothing; Space deletes; Infobox portraits have no viewer.

[P1] Missing image misleads and blocks its fix: resolveLedgerImage uses the toasting api → "Something went wrong — please try again" on every open; 12px at 2.99:1 with a raw path; toolbar covers Replace; View still offered.

[P2] Left/right alignment never wraps prose: align sets align-items on a full-width column (:192, :46-50) — The Ember Keep's right/40% image leaves a 393px hole.

[P2] Selecting reflows the note and the caption is inert: single-line input replaces a wrapping <p> (block shrinks 100px), Enter/Escape do nothing, not the LinkedTextField contract.

[P2] Chrome off the sibling standard: 22px, no tooltips, /60 icons at 2.99:1, blank resize handle, toolbar covers a 10%-width image.

## Persona Red Flags

Alex: no width presets/readout; drag drift on centred images; no Replace for a working image.
Sam: no live region; caption probably read twice (no figure/figcaption); caption keys inert; missing text under 3:1; generic viewer name.
GM at the table: two clicks + 22px target; native size; note visible behind 80% backdrop; Space deletes; Infobox portrait can't be shown.

## Minor Observations

No selected outline; cursor auto; caption underline 1.15:1; caption wraps per word at narrow widths; caption-less image reserves 21px; fixed h-20 loading skeleton; viewer close button off-standard; /image filter includes svg (slash-command.ts:207); Infobox image controls 17px; CONTEXT.md:401 says ledger/images/ vs .grimoire/images/; toolbar fade 120ms without reduced-motion guard (animation pass).

## Questions to Consider

- When a GM sets an image to "right", what do they expect the words to do?
- Is "View full size" for the GM or the players?
- Why is Replace only for broken images?
