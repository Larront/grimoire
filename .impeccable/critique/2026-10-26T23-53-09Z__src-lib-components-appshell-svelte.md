---
target: states, not screens (toasts, banners, empty states, edge cases, keyboard, rail)
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 4
target_identity: "file:C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\AppShell.svelte"
target_fingerprint: "sha256:3ab16c92e553e43edbffaef0712ea14851ce913a9e9363f800b80e854fbf9a46"
target_path: "C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\AppShell.svelte"
timestamp: 2026-10-26T23-53-09Z
slug: src-lib-components-appshell-svelte
---
Method: dual-agent, run one after the other on the one app (A: design review in the running app · B: detector + live overlay).

Target: states, not screens — toasts, the NotePane banners, empty states, edge cases (long names, a large world, sort order, many tabs), keyboard-only tasks, the collapsed rail.

## Design health score

| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of system status | 2 | An Undo or lasting toast can sit hidden behind newer ones; the active tab can be off screen; the rail has no active marker |
| 2 | Match system / real world | 2 | "Search ledger…", "on disk", "Reload from disk", "moved externally", "this ledger's database" |
| 3 | User control and freedom | 2 | Save to recreate drops tags and aliases; the deleted banner's Close discards without asking; repair toasts follow the GM to the Splash |
| 4 | Consistency and standards | 1 | Three empty-state dialects; banners break the Signal and focus rules; "Leave as-is" toast; off-scale page titles |
| 5 | Error prevention | 2 | The conflict banner shows no difference; "Keep my version" is primary and overwrites the other change |
| 6 | Recognition rather than recall | 2 | PDFs not in the palette; no Ctrl+Tab; long names truncate to identical prefixes |
| 7 | Flexibility and efficiency | 2 | No arrow keys in the tree (146 Tab stops in a big world); no "create note" from a search that finds nothing |
| 8 | Aesthetic and minimalist design | 3 | Mostly quiet; three lasting toasts take ~360 of 560px with three crimson buttons |
| 9 | Error recovery | 2 | False "couldn't be read" after switching worlds; a failed recreate only logs |
| 10 | Help and documentation | 3 | Empty states mostly explain themselves; Tag Manager's gives no next step |
| **Total** | | **21/40** | **Acceptable** |

## Design specificity

Specific where each surface was reviewed on its own (repair toasts, the missing-image block, Quick Notes' empty line, the scene editor's empty state, World Home); generic in the seams between them. Detector: CLI 0 findings over 12 files; live overlay 0 real findings across 12 views (the Ctrl+K key chip is the known false positive). B's measurements: tab strip 2025px in 920 and unscrollable, active tab and "+" off screen; long tab names truncate identically with no tooltip; tree sorts Annal 1, 10, 100…; a lasting toast went to opacity 0 behind three newer ones; banner focus ring is a crimson box-shadow with no offset, invisible on the crimson buttons; banner icon is --primary.

## Priority issues

**[P0] Save to recreate loses the note's tags and aliases.** NotePane.svelte:169-183 writes `getMarkdown()` (body only) and the save restores frontmatter from a file that is gone. Verified live and in code.

**[P1] A false "This note couldn't be read" after switching worlds** from the world menu: the restored tab's id matches a note of the previous world and `lastFetchedId` (NotePane.svelte:75) stops the re-read.

**[P1] Repair toasts outlive their world.** closeLedger takes down only the recovery and format toasts; the pins, unreadable-notes and external-move toasts stay on the Splash.

**[P1] Many tabs push the active tab, "+" and the Details toggle off screen**; tabs can't scroll, long names are indistinguishable, the Template badge eats the name; no Ctrl+Tab.

**[P1] The two NotePane banners break decided rules and leave the GM choosing blind**: crimson warning icon, their own focus ring (invisible on crimson buttons), 12px text, "on disk"; no way to see the other version; focus lost after a choice; Close discards the only copy without asking. The load-error state uses crimson "Close tab" text.

**[P2] Hidden toasts**: sonner shows three; an Undo behind an error keeps counting, a lasting toast goes to opacity 0.

**[P2] Lists sort as text everywhere but templates** (tree, palette, scenes, maps, tags).

**[P2] Empty states in three dialects**, two breaking the Signal Rule (All Scenes, the empty map); the palette's "No results found." in full-strength text with no way on.

**[P2] Keyboard tasks still break**: focus after palette open and close, no tree arrow keys, PDFs not in the palette, map keyboard use not landed (unnamed pins, no keyboard placing, Leaflet's white tooltip).

## Minor observations
- Toasts: the external-move toast (Infinity duration, no ✕, "Leave as-is", straight quotes); mixed quote styles and "Please try again"; light neutral toast pure white; outdated app.css comments; ToastLab lacks two kinds; Undo toast has no close button.
- Banners: both can stack; hover takes bg-accent; deleted banner stays after the file returns.
- Empty states: "No backlinks yet" in Ember Faint carries meaning; Details hints faint mono; backlink rows hover crimson; palette hits painted crimson, raw "#" in snippets; no empty line for the sidebar Scenes group; All Scenes / Quick Notes titles 30px semibold, off scale.
- Edge cases: the title input clips mid-letter with no ellipsis; Obsidian `![[x.png]]` embeds show raw; the Details "Folder" shows a root note's file name; the Splash count is stale after a first note.
- Rail: no active marker, no Quick Notes / New / Templates; Search/Files/Scenes full-strength vs Graph/Settings muted; the dev Toasts pill covers Settings at 1280.

## Questions to consider
- Should a world-level problem live in a toast at all, or in one quiet "needs attention" row that never stacks or outlives its world?
- Should the conflict banner stop asking and keep both versions?
- If every list sorted with compareNames and truncated in the middle, how many long-name findings would remain?
