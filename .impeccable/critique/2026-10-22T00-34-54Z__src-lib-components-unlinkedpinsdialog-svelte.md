---
target: unlinked pins dialog
total_score: 18
max_score: 40
p0_count: 1
p1_count: 2
target_identity: "file:C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\UnlinkedPinsDialog.svelte"
target_fingerprint: "sha256:2cc8555dffeedd82e02cee15dede6c99fac503082e0f75a1dcfbdc1365ae01c8"
target_path: "C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\UnlinkedPinsDialog.svelte"
timestamp: 2026-10-22T00-34-54Z
slug: src-lib-components-unlinkedpinsdialog-svelte
---
Method: dual-agent, run sequentially on the one app window (A: design review · B: detector + browser evidence). The dialog was driven through the app's own store (`unlinkedPinsModal`) with the Example World's real map, since it only appears after a real repair.

## Design Health Score — 18/40 (Poor)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | List never shrinks as pins are fixed; the permanent toast vanishes on "Show pins" |
| 2 | Match with real world | 2 | "bookkeeping", "repaired", plural title for one pin |
| 3 | User control & freedom | 1 | Once closed, nothing reopens the list |
| 4 | Consistency & standards | 2 | bg-muted/50 (invisible) and hover:bg-accent (the selected tint); 512px; 32px rows; 14px text |
| 5 | Error prevention | 2 | Long map title erases the pin title; stale list leads to deleted maps |
| 6 | Recognition over recall | 1 | Pin not selected on the map; the old note never named |
| 7 | Flexibility & efficiency | 1 | One pin per trip; no grouping |
| 8 | Aesthetic & minimalist | 3 | Calm and short |
| 9 | Error recovery | 2 | Reassures, but not which note to re-link to |
| 10 | Help & documentation | 2 | "Open a map to re-link" doesn't say how |

Detector: CLI 0; browser 0 inside the dialog or toast.

## Priority issues

- **[P0] The flow loses the list after one step.** Sonner's action closes the "permanent" toast; a row click closes the dialog; nothing reopens it.
- **[P1] A row opens the map but not the pin** — nothing selected, and it may restore a different pin.
- **[P1] The note the pin used to open is never named** — `UnlinkedPin` carries no old note title.
- **[P2] Long map titles erase pin titles; horizontal scrollbar.**
- **[P2] Banned tokens; clipped focus ring; two focus styles.**
- **[P3] Copy:** singular toast says "these pins"; plural title for one pin; "when it opened" also used for mid-session repairs (`pins:unlinked`), whose second batch replaces the first.

## Out of scope, found here

Map markers have no accessible name and no keyboard activation (Leaflet 1.9.4, `keyboard:false`), so a keyboard user cannot select a pin to re-link it. The toast is visible but unclickable over another modal.

## Questions

1. Should unambiguous pins re-link themselves?
2. Dialog, or a "needs a note" state on the map?
3. Where does the list live durably?
