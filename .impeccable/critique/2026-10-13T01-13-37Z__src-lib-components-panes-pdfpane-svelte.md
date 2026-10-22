---
target: PDF viewer and scene links
total_score: 19
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
target_identity: "file:C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\panes\\PdfPane.svelte"
target_fingerprint: "sha256:cea49ad8a26762ec21e8020f46755d63fe4cc2fe2917821c65a72b748316d678"
target_path: "C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\panes\\PdfPane.svelte"
timestamp: 2026-10-13T01-13-37Z
slug: src-lib-components-panes-pdfpane-svelte
---
Method: dual-agent (A: design-review subagent · B: detector subagent; sequential — one app window)

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 1 | Page counter stuck; toolbar scrolls away; playing link 1px thicker; no link/remove feedback |
| 2 | Match System / Real World | 3 | Clear vocabulary |
| 3 | User Control and Freedom | 1 | Remove instant, no undo; scene name replaces PDF tab |
| 4 | Consistency and Standards | 2 | Chip colour vs scene colour; floating pieces lack shadow-float; platform scrollbar |
| 5 | Error Prevention | 2 | Selections don't snap to words |
| 6 | Recognition Rather Than Recall | 2 | Faint underlines only; no trailing icon |
| 7 | Flexibility and Efficiency | 1 | No keyboard path; Enter dead in picker; no Ctrl+= / fit-width |
| 8 | Aesthetic and Minimalist Design | 3 | Underline cuts glyphs at <=100% |
| 9 | Error Recovery | 2 | Link failures console-only; bare 0/0 |
| 10 | Help and Documentation | 2 | One hint |
| Total | | 19/40 | Poor |

## Priority Issues
- [P0] App document scrolls instead of the PDF: shell has min-h-svh but no max; PDF pages push it to 1825px in an 890px window. Toolbar, page counter, jump, sticky find all fail; 560px overflows horizontally. PdfPane.svelte:437,542-551 + AppShell. (harden)
- [P1] Links unreachable by keyboard / screen reader; bubble hover-only; picker ignores arrows/Enter. PdfSceneLinkLayer.svelte:149-186, ScenePicker.svelte:39-69. (harden)
- [P1] Coloured scenes break highlight↔chip pairing: chip bg chosen wash, chip icon + underline id-cycle. SceneLinkBubble.svelte:31-36, PdfSceneLinkLayer.svelte:115. (polish)
- [P1] Bubble scene name replaces the PDF tab, no history. SceneLinkBubble.svelte:48. (harden)
- [P2] Underline sits inside text (strikethrough at <=100%), sub-3:1 hues on cream, playing = 3px→4px only. PdfSceneLinkLayer.svelte:160-166. (polish)

## Detector
CLI: 2 advisories (PdfPage.svelte:367 dead fallback colour; :374 2px highlight radius). Browser: 1 true positive (page counter "/ 2" 3.2:1, PdfPane.svelte:467); 230 false positives on pdf.js invisible text layer; 1 out-of-scope (AppSearch kbd padding).

## Persona Red Flags
GM at table: toolbar gone; hover-aim-24px play; playing invisible; Remove beside volume no undo; name loses PDF; empty scene silently stops audio.
Sam: links unreachable; hover-only bubble; 0/0 not announced; Escape drops focus; label-in-name mismatch.
Alex: no keyboard linking; Enter dead; no Ctrl+= or fit-width; no linked-scenes list; New scene unnamed.

## Minor
No shadow-float on bubble/picker/hint; platform scrollbar; faint selection, no word snap; bubble covers text above; master slider crimson in every bubble; low-contrast "/ 2" and empty states; toolbar shift on zoom label; drifted links tooltip-only, still playable, red near crimson.

## Questions
Underline plays on click? Icon+name in margin? "Scenes in this PDF" list?
