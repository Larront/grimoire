---
target: Template editor (TemplatePane + SidebarTemplates)
total_score: 16
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
target_identity: "file:C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\panes\\TemplatePane.svelte"
target_fingerprint: "sha256:714ec4945c49016b82a9bf06e3124646ee5a5b686556efe30c042787a45acdb7"
target_path: "C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\panes\\TemplatePane.svelte"
timestamp: 2026-10-22T21-24-41Z
slug: src-lib-components-panes-templatepane-svelte
---
Method: dual-agent (A: design review in the live app · B: detector + live overlay)

# Critique: the Template editor

Surfaces covered: the template pane (`panes/TemplatePane.svelte`), the sidebar's Templates section (`sidebar/SidebarTemplates.svelte`), and how templates are used: the palette's "Create note from template", "Create new template" and "Save note as template". All testing was in a throwaway copy of the example world.

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 1 | The pane never shows a save state. "Save note as template" gives no response at all. The delete toast says "deleted" while the row and tab are still there for 5 seconds. The open template's sidebar row is never highlighted. |
| 2 | Match with the GM's world | 3 | "Template" is plain language. But a new template is really named "Untitled", and the tags it will copy can't be seen. |
| 3 | User control and freedom | 2 | Undo on delete is right. A failed rename throws away what was typed. A deleted template's tab stays open and still accepts typing. |
| 4 | Consistency and standards | 1 | The Templates header is styled unlike Scenes and Files. Templates use two different icons. Template tabs have no icon. There's no "open in right pane". |
| 5 | Error prevention | 1 | Opening a second template breaks the tab bar. Characters like `:` and `?` reach the OS before anything stops them. |
| 6 | Recognition over recall | 2 | Tags are hidden, the picker shows no preview, and a note made from a template doesn't say which template it came from. |
| 7 | Flexibility and efficiency | 1 | Typing in the template picker doesn't filter it. There's no "from template" in the sidebar's New menu. A new template's title isn't focused. |
| 8 | Aesthetic and minimalist design | 3 | Quiet, and it shares the note column. |
| 9 | Error recovery | 1 | A bad name gets "Something went wrong — please try again", and trying again can't work. |
| 10 | Help and documentation | 1 | Nothing explains what a template does or that its tags get copied. |
| **Total** | | **16/40** | **Poor** |

## Design Specificity Verdict

**My review:** the template editor is a copy of the note editor with a smaller feature set, not something designed for templates.
- **What it gets for free:** the same 44px title, rule and editor, so slash blocks like the Infobox work.
- **What's missing:** nothing says what a template is for ("new notes start with this text and these tags").
- **The only marker:** a small crimson "Template" pill on the tab, which disappears when the app reloads.
- **The sidebar section** is a stock collapsible list.

**Detector:**
- **Code scan:** clean on both files, 0 findings.
- **Live overlay:** ran on 3 views (the pane, the right-click menu, the template picker) and flagged 6 elements.
- **Real low-contrast text (4):**
  - the "Templates" header: 2.9:1, because `opacity-50` halves an already-muted colour
  - the "New template" row: 2.7:1, though it's a button
  - the tab's "Template" badge: 2.6:1, crimson on crimson
  - "Delete Template" in the right-click menu: 4.2:1, which comes from the shared destructive colour and so affects every menu
- **False positive (1):** "cramped padding" on the Ctrl+K hint.
- **Agreement:** both assessments found the dim header and the crimson badge independently. The detector also caught the menu's destructive colour, which the design review missed.

The overlays have been removed again, so nothing is left showing in the app.

## Overall Impression

**What works:** the editing itself. Headings and note blocks behave exactly as they do in a note.

**What doesn't:** everything around the editing.
- The tags a template copies into every note are invisible and can't be edited.
- Opening the Templates section pushes your file tree off screen.
- Opening a second template freezes the tab bar.

**Biggest opportunity:** make the template show what it gives you. That means its tags, plus one line saying what it does.

## What's Working

- **Templates use the real editor.** An NPC template really can start with an Infobox. It works from the slash menu, as it does in notes.
- **Most of it works from the keyboard.** You can open the section and reach each row. Shift+F10 opens Rename and Delete, rename happens in place, and focus returns to the row after the menu closes.
- **Delete follows the agreed pattern:** an undo toast, not a confirmation dialog. A note made from a template opens with its title selected, ready to type over, and gets the template's tags (`tags: [npc]` arrived intact).

## Priority Issues

**[P0] Opening a second template breaks the tab bar**
- **What:** every template tab has the same ID, so the tab bar can't tell two of them apart (`TabBar.svelte:174` keys tabs by `tab.id + tab.type`, and all templates are `id: 0`). The bar stopped updating: it showed "NPC Template" while the pane said "No tab open". Only a reload fixed it.
- **Why it matters:** opening two templates is ordinary, and the main surface silently stops working.
- **Fix:** key template tabs by their file path.
- **Command:** `/impeccable harden`

**[P1] A template's tags are invisible and can't be edited**
- **What:** the editor reads the template's `tags: [npc]`, hides it, and quietly writes it back on save. A template made in the app can never get tags. The only route is to tag a note and use "Save note as template", which gives no response.
- **Why it matters:** tags are half of what a template does. The test task "make a Faction template that tags notes `faction`" can't be done in the template editor.
- **Fix:** put the note pane's tag row under the template's title, without backlinks or aliases.
- **Command:** `/impeccable shape`, then `/impeccable polish`

**[P1] A template doesn't look like a template, and forgets it is one after a reload**
- **What:**
  - Template tabs have no icon.
  - The "Template" badge isn't saved with the tab, so after a reload the tab just says "NPC".
  - The badge is crimson, which uses the accent as a category label and breaks the Signal Rule.
  - The pane itself is identical to a note.
- **Fix:**
  - Work out the badge from the tab type instead of storing it.
  - Use one template icon everywhere (the sidebar uses one icon, the picker another).
  - Make the badge neutral.
  - Add one quiet Nunito line above the title, e.g. "Template · new notes start with this".
- **Command:** `/impeccable clarify`

**[P1] The Templates section buries the file tree**
- **What:** the section sits in the sidebar footer with no height limit. Opening it with 11 templates pushes Files out of view, and that area has no visible scrollbar, so it looks as if your notes vanished. The section also breaks the sidebar's own conventions:
  - its header is dimmer and lighter than Scenes and Files, at 2.9:1
  - the open template's row is never marked
  - the list is sorted by character code, not naturally: "Annal 1, Annal 10, Annal 2", with "bandit camp" after "Session Log" (`templates.rs:114`), which breaks the settled sort rule
  - hovering a row uses the crimson tint, so it looks selected (this is sidebar-wide)
- **Fix:** cap the section's height and let it scroll, or move it (see the questions). Match the Scenes and Files header style, mark the active row, and sort naturally.
- **Command:** `/impeccable layout`

**[P2] Names fail badly, and some actions say nothing**
- **What:**
  - `:` and `?` get "Something went wrong — please try again".
  - A duplicate name gets a generic toast far from the row.
  - Either way, what you typed is lost and focus drops to nowhere.
  - A new template is literally named "Untitled", and its title isn't focused.
  - Deleting a template leaves its tab open, and typing there fires error toasts.
  - "Save note as template" says nothing.
  - Templates added or changed outside the app don't appear until something else refreshes the list.
- **Fix:**
  - Check the name as it's typed, and keep the field open with the reason under it.
  - Return proper error codes from Rust.
  - Focus and select the title of a new template.
  - Close the tab when the delete actually happens.
  - Confirm "Saved 'Iron Hand' as a template", with Open.
  - Have the list follow file changes made outside the app.
- **Command:** `/impeccable harden`

## Persona Red Flags

- **Alex (keyboard power user):**
  - Typing "fac" in the template picker filters nothing; it took 5 arrow presses to reach Faction.
  - After "New template", the title is 8 Tab presses away.
  - Ctrl+K only answers a lowercase k, so it fails with Caps Lock on.
- **Sam (keyboard-only / screen reader):**
  - The title field has no label, only a placeholder.
  - The header and the "New template" row are below AA contrast.
  - Focus is lost after a rename, a failed rename and a delete.
  - Nothing marks the open template as current.
- **Riley (stress tester):**
  - Two open templates freeze the tab bar.
  - Names sort by character code.
  - The 81-character name is cut at a word in the big title, so it reads as if it were the whole name, and it has no tooltip in the sidebar or tab.
  - `:` and `?` give the generic error.
- **A GM mid-prep who wants the NPC template to tag notes `npc` and start with an Infobox:**
  - The Infobox part works.
  - They can't see that NPC already tags `npc`, so they can't confirm it or add a second tag.
  - The new note lands at the top of the world, not in Characters.
  - The note doesn't record which template it came from.

## Minor Observations

- **Rename field ring:** the sidebar's rename field draws its own crimson ring instead of the global focus outline.
- **Existing name not selected:** neither rename field selects the current name when it opens.
- **Straight quotes:** the delete toast uses `"Annal 1" deleted`; other toasts use curly quotes.
- **Picker placeholder:** it still says "Type a command or search..." in picker mode.
- **Long names in the picker:** an 81-character name wraps to two lines there.
- **Product doc:** PRODUCT.md mentions "a built-in Encounter template", but there are four (NPC, Location, Session Log, Encounter).
- **Possible undo race (inferred from code, not seen):** the delete runs on a plain 5-second timer, so hovering the toast to pause it may not stop the delete.

## Questions to Consider

- Should a template be its own kind of document at all? It could be a note marked "use as template", which would bring tags, the Details panel and properties for free and remove the second editor.
- Making something from a template lives only in the palette. Why isn't it in the sidebar's **New ▾** menu, where you reach to create things ("New → NPC")? That would be one gesture.
- If a template's tags matter enough to copy into every note, why are they the one part of it you can't see?
