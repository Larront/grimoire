---
target: tag manager
total_score: 14
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
target_identity: "file:C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\TagManagerDialog.svelte"
target_fingerprint: "sha256:1714eb226894d251404e8aff2236643f5454456507355f14d534912c7578350e"
target_path: "C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\TagManagerDialog.svelte"
timestamp: 2026-10-20T00-58-46Z
slug: src-lib-components-tagmanagerdialog-svelte
---
Method: dual-agent, run sequentially on the one app window (A: a13a7a7d362e1ce65 · B: a0f2bcb807c0917cb)

## Design Health Score — 14/40 (Poor)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 1 | Changes don't reach an open Graph or tag chips; failed rename is a generic error |
| 2 | Match system / real world | 2 | Merge labelled "Rename"; bare counts; hide works on the alphabetical first tag |
| 3 | User control and freedom | 1 | No undo; Escape on the menu closes the dialog; dismissed confirm leaves actions dead |
| 4 | Consistency and standards | 1 | Native colour picker, hand-built menu, modal destructive confirm, monospace names |
| 5 | Error prevention | 1 | No name validation; silent merge; recolour cascades; stale Graph/note overwrite |
| 6 | Recognition rather than recall | 2 | Merge target typed exactly; no column labels |
| 7 | Flexibility and efficiency | 1 | No search/sort/bulk; 3 Tab stops a row |
| 8 | Aesthetic and minimalist | 3 | Quiet; native well and grey swatches foreign |
| 9 | Error recovery | 1 | Invalid name loses the typed text with a generic toast |
| 10 | Help and documentation | 1 | Automatic vs chosen colours, 8-colour limit, primary-tag hiding unexplained |

## Design specificity
A stock dialog holding a bare list; none of the house vocabulary Settings just set.
Detector: CLI clean, live clean inside the dialog. Measured: menu not on the Floating level (Iron Dark well, no shadow), clipped by the dialog on the last row; ⋯ trigger has no aria-haspopup/expanded and no visible hover; Escape closes the dialog; header scrolls away; light swatches lore/npc/session under 3:1.

## Priority issues
1. [P0] Changes don't propagate; a stale Graph filter or open note writes the old tag/colour back.
2. [P0] Rename/merge/delete ignore graph styles (hidden and colour lost; orphan rows).
3. [P1] Confirm flow broken (Enter cancels rename; dismissed confirm sticks), modal, no undo, crimson Delete.
4. [P1] Native colour picker; recolouring one tag repaints the others.
5. [P2] Long names push controls off; menu not Floating, clipped, Escape closes everything.

## Personas
Alex: no search/sort/bulk; two dialogs per rename; 3 Tab stops a row.
Sam: Enter cancels rename; no menu keys; unlabelled input; focus lost to body.
GM tidying tags: open note resurrects the old tag; Graph unchanged; "Renamed" for a merge; styles vanish.

## Questions
Should a tag's colour settle and stay? Is hiding a tag style or a Graph filter? Should tags be a pane rather than a modal?
