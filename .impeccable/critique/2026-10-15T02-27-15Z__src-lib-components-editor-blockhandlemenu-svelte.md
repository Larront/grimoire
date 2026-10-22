---
target: block handle menu
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
target_identity: "file:C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\editor\\BlockHandleMenu.svelte"
target_fingerprint: "sha256:d6195e21b729e2c064cc9929bc6ff1dfd8a767043e704cbd40a9e7f43a02c6bb"
target_path: "C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\editor\\BlockHandleMenu.svelte"
timestamp: 2026-10-15T02-27-15Z
slug: src-lib-components-editor-blockhandlemenu-svelte
---
Method: dual-agent, run sequentially on the one app window (A: a8ac761944c7c8191 · B: a2bd71473e34fad24)

## Design Health Score — 24/40 (Acceptable)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | Delete, Duplicate, Copy silent; moves not announced |
| 2 | Match system / real world | 3 | A bullet is "paragraph"; a creature is "statblock", not its name |
| 3 | User control and freedom | 3 | One undo per action; Ctrl+Z dead while the grip has focus |
| 4 | Consistency and standards | 2 | Menu styling differs from the slash menu; infobox/encounter grips break the gutter |
| 5 | Error prevention | 2 | ↑ from a fresh menu lands on Delete; Enter Enter turns a heading into a paragraph; grip on the wrong creature |
| 6 | Recognition rather than recall | 2 | Ctrl+Shift+H shown nowhere |
| 7 | Flexibility and efficiency | 3 | Keyboard raise/reorder/menu exist; list items cannot be reordered |
| 8 | Aesthetic and minimalist | 3 | Calm grip; ten-row menu |
| 9 | Error recovery | 2 | ↑/↓ on a bullet silently does nothing |
| 10 | Help and documentation | 1 | Shortcut undocumented; SR hint wrong for lists |

## Design specificity
The grip is Grimoire's (quiet, one grip, first-line placement). The menu is a generic Notion menu with the heading style the slash menu just dropped, and in an encounter the grip covers the creature's name.
Detector: CLI clean. Live: low-contrast "TURN INTO" heading 3.0:1 dark / 2.5:1 light; Delete text 3.6:1 dark. Measured (not a rule): grip box overlaps the statblock name inside callouts; grip icon 2.97:1 on light background.

## Priority issues
1. [P0] Grip over the creature's name inside an encounter callout, and on the wrong card when tiled: grip clamped to the column's left edge while the callout breaks out past it; overhang is a dead zone. Fix: clamp to the pane's edge; name the block in label and menu; mark the target block.
2. [P1] List items handled as their inner paragraph: Delete leaves an empty bullet, Duplicate an unbulleted paragraph, ↑/↓ do nothing or mangle nested lists. Fix: target listItem for actions.
3. [P1] Keyboard hazards: first Ctrl+Shift+H shows the grip without focus; menu focus starts on item 0, not the checked one; ↑ wraps to Delete; after Escape from a mouse-opened menu the focused grip follows the pointer to other blocks.
4. [P2] Menu out of step with the slash menu: 11px uppercase heading (3.0:1), full-bleed rows, Delete at 3.6:1, icons stay dim when selected, current item not brightened.
5. [P2] Destructive actions silent; when the menu flips above, Delete is nearest the pointer.

P3: infobox grip floats mid-column above the frame; grip icon 2.97:1 in light; grip radius 4px vs 6px; timeline grip on the frame not the title.

## Personas
Alex: cannot reorder bullets; Ctrl+Z dead on the grip; shortcut undiscoverable.
Sam: first shortcut press doesn't focus; arrow hint false for lists; nothing announced; focus starts off the ticked item, ↑ lands on Delete.
GM mid-session: grip on the creature's name or the wrong creature; "Delete statblock" doesn't say which; deletion silent.

## Questions
Should a statblock's grip use the creature's name? Does a tiled encounter need the grip at all? Is Turn into worth 7 of 10 rows?
