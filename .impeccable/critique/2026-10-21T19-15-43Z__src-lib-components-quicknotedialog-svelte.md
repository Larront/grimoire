---
target: quick note dialog
total_score: 21
max_score: 40
p0_count: 0
p1_count: 3
target_identity: "file:C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\QuickNoteDialog.svelte"
target_fingerprint: "sha256:61453cd3317d162cb5456f01d16a09d3c19a81c0b67a361ad4d800361a592fe8"
target_path: "C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\QuickNoteDialog.svelte"
timestamp: 2026-10-21T19-15-43Z
slug: src-lib-components-quicknotedialog-svelte
---
Method: dual-agent, run sequentially on the one app window (A: design review · B: detector + browser evidence)

## Design Health Score — 21/40 (Acceptable)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 1 | Enter empties the box and nothing else changes; saves on Escape/click-away are invisible; no live region |
| 2 | Match with real world | 3 | "Park a thought…" is good; Escape saving inverts the convention; links written as file paths |
| 3 | User control & freedom | 2 | A "never mind" Escape saves the line with no Undo |
| 4 | Consistency & standards | 2 | Width/position/field style differ from the palette; focus treatment isn't the house ring; three icons for one feature |
| 5 | Error prevention | 3 | Nothing lost; a long line hides its own start |
| 6 | Recognition over recall | 1 | No visible hint of Enter/Escape; the palette never shows the shortcut; no way to the pane |
| 7 | Flexibility & efficiency | 3 | Works from anywhere; finishing takes Enter then Escape, and Enter on empty does nothing |
| 8 | Aesthetic & minimalist | 3 | Quiet; a bordered field boxed inside a padded card |
| 9 | Error recovery | 2 | A failed write is a generic toast and a dialog that won't close |
| 10 | Help & documentation | 1 | The rules exist only in the sr-only description |

Detector: CLI 0 findings. Browser: placeholder 3.0:1 dark / 2.5:1 light (`placeholder:text-muted-foreground/60`); everything else flagged belonged to the page behind.

## Priority issues

- **[P1] Capture is silent.** No sign a line landed after Enter (sidebar count only, dimmed, absent when collapsed); no live region; closing saves invisibly. Fix: a status line under the box and a polite announcement; Undo for saves made by leaving.
- **[P1] The rules are invisible to sighted GMs.** Escape saves, Enter stays open — said only to screen readers. Fix: key hints in Meta under the box, plus a way to the pane.
- **[P1] One-line field hides long thoughts.** 1066px of text in a 478px field scrolls sideways; the pane shows the same lines wrapped. Fix: an auto-growing textarea (DESIGN §5: a value that wraps where drawn is edited wrapped).
- **[P2] Doesn't match the palette; field boxed twice; always-crimson border.** 512px centred vs palette 384px top-anchored; field fill identical to the card so only a permanent crimson border marks it. Fix: field as the surface, palette's place on screen.
- **[P2] Thin screen-reader semantics.** `aria-expanded`/`aria-activedescendant` without `role=combobox`. Fix: combobox role + aria-autocomplete in the shared capture box.
- **[P3] Opens stacked over the palette** (two scrims); focus returning to the sidebar's Settings button when nothing was focused.

## Persona red flags

- Alex: Enter-Enter doesn't finish; no key to the pane; palette never teaches Ctrl+Shift+N.
- Sam: silence after Enter; menu state may not be announced.
- GM mid-session: can't confirm the save at a glance; a reflexive Escape saves junk with no Undo.

## Minor

CONTEXT.md:251 says the dialog is "done" after one line but Enter keeps it open; sidebar uses Inbox while the pane/palette use NotebookPen; sidebar row not active while the pane is open; new captures land at the bottom of Today; field 37.6px vs --row-h 36; `[[` menu overlaps the field border by 4px; re-exploring the example world from inside it leaves stale Quick Notes in memory (ledger-collection reload keyed on path).

## Questions

1. Is Enter "done" or "next line" — and if next line, should Enter on an empty box close?
2. Field-as-surface like the palette, or a card holding a field?
3. Links by name in the box rather than the written path?
