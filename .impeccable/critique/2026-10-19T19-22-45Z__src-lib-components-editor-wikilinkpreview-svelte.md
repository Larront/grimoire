---
target: link hover preview
total_score: 19
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\editor\\WikiLinkPreview.svelte"
target_fingerprint: "sha256:8c8f2d03ca483b2669a44f850ed7f5df9a991a3218bcdf38272f2406a1f415cc"
target_path: "C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\editor\\WikiLinkPreview.svelte"
timestamp: 2026-10-19T19-22-45Z
slug: src-lib-components-editor-wikilinkpreview-svelte
---
Method: dual-agent, run sequentially on the one app window (A: a38f8f5b40437a71e · B: a2a058b7a0a8a951e)

## Design Health Score — 19/40 (Poor)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | A card can stick after the pointer leaves; dotted links get only a native tooltip |
| 2 | Match system / real world | 2 | [[brackets]], .md paths, "Infobox", {align=…}, table pipes in the card |
| 3 | User control and freedom | 1 | Escape doesn't close it; can't move onto it or open from it; a stuck card survives everything |
| 4 | Consistency and standards | 2 | Only the note editor previews; Quick Notes links look the same and don't; map pin panel flattens the same excerpt |
| 5 | Error prevention | 2 | No flip at the bottom, no clamp at the right; wrapped links anchor to the wrong line |
| 6 | Recognition rather than recall | 2 | Alias link titles the card with the alias; Infobox facts reduced to one word |
| 7 | Flexibility and efficiency | 1 | No keyboard route; no handoff between links |
| 8 | Aesthetic and minimalist | 3 | Right frame; clutter and blank lines eat the 5-line budget |
| 9 | Error recovery | 2 | Unreadable notes fail silently; unwritten links show a native tooltip |
| 10 | Help and documentation | 2 | No Link Preview entry in DESIGN.md §5 |

## Design specificity
Frame is Grimoire's (popover, border, shadow-float, 288px, Metamorphous title). Content reads like a developer tool.
Detector: CLI clean. Live: path line low-contrast 2.5:1 dark / 2.1:1 light at 11px; text-occlusion hits are false positives (pointer-events-none card). Measured: card runs 154px past the window bottom near the foot of a note; role=tooltip has no id and nothing references it; links can't be focused.

## Priority issues
1. [P1] Stuck card: async resolve/read after the 400ms timer is never cancelled; survives Escape, scroll, movement.
2. [P1] Excerpt shows notation and loses Infobox content: "Infobox" label with rows thrown away; [[brackets]]; {attrs} leak; empty headings; blank lines eat the clamp.
3. [P1] No edge handling; wrapped links anchor to the second line.
4. [P2] Alias links title the card with the alias; path line shows the raw target (.md, #fragment) at 2.5:1.
5. [P2] Keyboard users get nothing; Quick Notes links have no preview.

## Personas
Alex: blink-and-wait between links; can't open/scroll the card.
Sam: no preview at all; card not announced.
GM mid-session: stuck card over the statblock; "Infobox" instead of facts; card off the bottom; card covers the next links in a list.

## Questions
Facts or prose first for an NPC? Should the card be a peek you can move onto? Do brackets earn their place?
