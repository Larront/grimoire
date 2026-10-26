---
target: context menus (file tree, tab bar, scenes dashboard)
total_score: 16
max_score: 36
na_heuristics: 10
p0_count: 1
p1_count: 2
target_identity: "file:C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\sidebar\\FileTree.svelte"
target_fingerprint: "sha256:1f67c92283918eee83d098231c9f5626cd1b69853fb49c887386079fb004102a"
target_path: "C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\sidebar\\FileTree.svelte"
timestamp: 2026-10-26T21-26-58Z
slug: src-lib-components-sidebar-filetree-svelte
---
Method: dual-agent (A: design review in the running app · B: detector + live overlay). A and B shared the app for part of the run; B re-ran its views alone.

Target: the context menus — sidebar/FileTree.svelte, TabBar.svelte, panes/ScenesDashboard.svelte (with the ui/context-menu and ui/dropdown-menu primitives).

## Design health score

| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of system status | 2 | Folder delete toast says "deleted" while the row stays 5 s; a scene card's Play never becomes Stop |
| 2 | Match system / real world | 3 | Mostly GM words; "Change thumbnail" vs "Remove image", "Customise" vs "Change color" |
| 3 | User control and freedom | 1 | Stale Undo (P0); scene delete is a modal with no undo; a map can't be renamed |
| 4 | Consistency and standards | 1 | Three delete patterns, three wordings, two spellings, two row dialects |
| 5 | Error prevention | 1 | ArrowUp wraps onto Delete; folder delete is remove_dir_all behind a 5 s toast |
| 6 | Recognition rather than recall | 2 | No icons in tree/tab menus; no Ctrl+W / F2 hints |
| 7 | Flexibility and efficiency | 2 | Shift+F10 fails on tabs; no "New note from template" in a folder |
| 8 | Aesthetic and minimalist design | 3 | Clean and on-token; the scene card's 8 rows read as a list |
| 9 | Error recovery | 1 | A stale Undo does nothing and says nothing |
| 10 | Help and documentation | n/a | Menus are not a help surface |
| **Total** | | **16/36** | **Poor (44%)** |

## Design specificity

Stock shadcn menus with Grimoire's surface tokens (bg-popover, shadow-float, Nunito, Ember Error) but none of the house-standard menu behaviour (Block Handle / track rows: 13px rows, 14px icons at 70%, shortcut hints, Delete names its target, undo toast, no wrap). The three menus don't match each other either.

Detector: CLI exit 0, 0 findings; live overlay 0 findings inside [role=menu] across six views; the one page finding (cramped-padding on the Ctrl+K chip) is a known false positive. B's "hover uses --accent not --surface-hover" is a false positive per DESIGN §6 (the active row of a menu takes Crimson Tint). Measured, not detected: destructive text on its hover fill ≈3.5:1 (dark); submenu edge is a border while the parent's is a ring, and it overlaps the highlighted row; separators expose role="group".

## What's working
- Keyboard on tree rows and cards: Shift+F10 / Menu key opens with the first item focused; Escape returns focus to the row.
- Surface tokens right in both modes; Ember Error passes at rest (4.66:1 dark, 7.71:1 light).
- Menus shift up to stay inside the window at the bottom edge.

## Priority issues

**[P0] Undo can lie on a permanent delete.** `toastUndo` (src/lib/toast.ts:299) commits on its own setTimeout while sonner pauses the toast on hover, so the delete happens while Undo is still offered and Undo then does nothing. Folder delete is `remove_dir_all` (src-tauri/src/commands/tree.rs:173). Affects every toastUndo caller (tree, pins, tracks, templates, tags, Quick Notes, PDF links, block handle). At narrow widths the sidebar sheet's scrim covers the toast. Fix: commit when the toast closes; hide the row at once (ScenePane's pendingRemoval); toaster above the scrim. — /impeccable harden

**[P1] Delete differs in all three menus, backwards.** Tree: toast while the row stays. Scene card: modal AlertDialog (ScenesDashboard.svelte:417) "cannot be undone", silent about PDF scene-links. Fix: one destructive row — Trash icon, "Delete ‹name›", hide at once, "Deleted … · Undo", commit on close. — /impeccable harden

**[P1] The menus are not one family.** bits-ui `loop` wraps onto Delete; no ContextMenu.Shortcut anywhere (Close/Ctrl+W, Rename/F2; ScenePane's right-click copy drops F2/Del); "New Note"/"New Subfolder" vs "Note"/"Folder"; "Delete Note"/"Delete"/"Remove from scene"; "Customise" + "Favorite"/"Change color"; "Ctrl+N" vs "Ctrl 0"; two row dialects (context-menu-item 14px/16px icons vs BlockHandleMenu 13px/14px at 70%). Fix: the Block Handle row in the primitives, loop off, hints, one vocabulary. — /impeccable polish

**[P2] Customise submenu opens the older windows.** Change icon is a modal grid with no current-icon mark, bg-muted hover plus a crimson border, closes on first pick; Change color is a ColorPicker in a modal with an empty swatch beside #B89A5E; Change thumbnail (a native picker) is the first item. ScenePane's Appearance popover already does all three. Fix: one "Appearance…" item opening that popover at the card. — /impeccable distill

**[P2] Tree gaps.** New Map ignores the folder and makes a map with no image that never appears in the tree (AppSidebar.svelte:203); no Rename on a map; New Subfolder doesn't enter rename; note Rename doesn't focus the title; no "New note from template…" on a folder; tabs can't open their menu by keyboard (trigger is inside the role=tab, TabBar.svelte:185/211). — /impeccable harden

## Persona red flags
- Alex: no shortcut hints; tabs can't open their menu by keyboard; ArrowUp lands on Delete.
- Sam: separators read as groups; focus falls to Search after a delete commits, to body after Escape from a scene rename; icon dialog is 10 Tab stops.
- Riley: stale Undo; toast under the scrim; invisible map from New Map in a folder.
- Jordan: "Customise" leads to three windows; Rename on a note seems to do nothing; "deleted" while the row is there.
- GM mid-session: Play is second, never becomes Stop, does nothing visible while the scene plays.

## Minor observations
- Destructive hover ≈3.5:1 in dark mode.
- Submenu edge differs and overlaps the highlighted row.
- Item radius equals menu radius inside 4px padding; corners don't nest.
- Tab-overflow dropdown is hand-rolled (bg-accent hover, no shadow-float, no menu roles).
- No menu on empty tree space (probably WebView's default).
- "Delete Folder" doesn't say how many notes go with it.
- Folder rename puts the caret at the end rather than selecting.

## Questions to consider
- Should a folder delete in a local-first tool ever be permanent?
- Is a scene card's menu for playing or for editing?
- Why do tree rows have a right-click menu but no visible ⋯?
