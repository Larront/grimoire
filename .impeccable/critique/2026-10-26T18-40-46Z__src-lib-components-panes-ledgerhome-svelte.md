---
target: Ledger home (LedgerHome.svelte)
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 1
target_identity: "file:C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\panes\\LedgerHome.svelte"
target_fingerprint: "sha256:48c24a3dc3c473163e89c5df0cf012dd4d24023cd1379db65035c90de0c13266"
target_path: "C:\\Users\\lamonta\\Code\\grimoire\\src\\lib\\components\\panes\\LedgerHome.svelte"
timestamp: 2026-10-26T18-40-46Z
slug: src-lib-components-panes-ledgerhome-svelte
---
Method: dual-agent (A: design review in the live app · B: detector + live overlay)

# Critique: Ledger home (the first page of a new world)

The reviewer worked in a brand-new throwaway world, "The Sunken Coast". It checked:
- the empty page itself
- pressing New note, then deleting every note to come back
- the template link
- a world with a scene but no notes
- split panes, light mode, and keyboard and screen-reader use

None of your worlds were touched.

**Incident:** the reviewer made the app hang while probing the error state; it's the bug below, and it's why the last session ended.

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | "Creating…" shifts the layout and can stick forever. Once a note exists, the world's name never appears in a pane again. |
| 2 | Match with the GM's world | 3 | Says "world", "note" and "template", but the search beside it says "Search ledger…". It says "first note" even when the world already has a scene. |
| 3 | User control and freedom | 3 | Escape out of the template picker returns to the link. Deleting a note can be undone. |
| 4 | Consistency and standards | 1 | It doesn't match the new Splash (name size, position, button, link style). There are two "New note" buttons, one capitalised "New Note". |
| 5 | Error prevention | 1 | A note name containing `?` or `:` freezes the whole app (below). |
| 6 | Recognition over recall | 3 | Both choices are visible. Nothing says what a template gives you. |
| 7 | Flexibility and efficiency | 3 | Ctrl+N works and opens the note with its title selected. The page never mentions the shortcut. |
| 8 | Aesthetic and minimalist design | 3 | Calm on its own, but the sidebar's own empty state competes with it. |
| 9 | Error recovery | 1 | Shows the raw backend error under the button, repeating the toast that already said it. |
| 10 | Help and documentation | 2 | Nothing about where notes are kept, or that the folder is yours. |
| **Total** | | **22/40** | **Acceptable** |

## Design Specificity Verdict

**Review:** half authored. Your world's name in the world font, and the line "Every world begins with its first note.", are Grimoire. The rest is a generic centred stack with a small crimson button and a grey link.

It doesn't read as the next page after the new Splash:
- the name shrinks from 44px to 32px and moves to the middle of the screen
- the button is smaller and has no arrow
- the quiet link loses its underline
- a second, generic "No notes yet / New Note" panel with a crimson icon sits in the sidebar beside it

It doesn't yet earn PRODUCT.md's promise of a considered "first note in a new ledger".

**Detector:**
- **Code scan:** one real finding. The world name is 32px, which isn't on the type scale (Title 44, H1 28).
- **Live overlay:** clean on the page itself in dark and light mode. In light mode, the sidebar's Graph and Settings labels are just under AA (4.47:1). The key-hint chip flag is a false positive. The focus ring on New note passes at 3.6:1.
- **Agreement:** both found the off-scale name. The review found everything a detector can't: focus on arrival, the duplicate calls to action, the raw error, and the freeze.

## Overall Impression

**What works:** the moment itself. You make a world on the Splash and land on its own name.

**What doesn't:**
- nothing is focused
- two "make your first note" invitations compete
- once you have one note, the world's home disappears for good, replaced by a grey "No tab open"

**Biggest opportunity:** make this page the Splash's right-hand column carried into the world. Same name, same voice, same Continue-style next step, and a home that's still there whenever a pane is empty.

## What's Working

- **The name is the subject**, in Metamorphous, and the only thing at display size. The one line of copy is Grimoire's own voice.
- **The hand-offs mostly work.** Ctrl+N and New note open "Untitled" with the title selected. In a split, the note opens in the pane you clicked. Escape out of the template picker returns to the link.
- **Light mode passes contrast** on the page itself.

## Priority Issues

**[P0] A note name with `?` or `:` freezes the whole app**
- **What:** making a note whose name Windows can't hold sends the backend into an endless loop while it holds the world's lock. Every later action hangs. Confirmed in code at `notes.rs:52`.
- **How you'd hit it:** clicking an unresolved link like `[[Who rang the bell?]]`, which creates the note it names. Mid-session, that's a frozen app.
- **Fix:** stop the loop on an error, and check the name first with the same rule templates and folders now use.
- **Command:** `/impeccable harden`

**[P1] It breaks the Splash's promises on arrival**
- **What:**
  - Nothing is focused when the new world opens; New note is the 13th Tab stop.
  - The name is 32px and centred, the button 32px with no arrow, the link not underlined. The Splash uses 44px, a fixed top position, a 40px Continue with an arrow, and underlined quiet links.
- **Fix:** build it as the Splash's right-hand column carried forward, with New note focused on arrival only, as Continue is.
- **Command:** `/impeccable layout`

**[P2] Two invitations, and crimson where it doesn't belong**
- **What:** the sidebar's own empty state, with a crimson icon tile, a heading, a line and its own "New Note" button, sits beside the page's New note. Split with a scene open, there are three crimson calls on screen.
- **Fix:** while the page shows, cut the sidebar to one muted line and drop its button. Keep the button only when no pane shows the home. Use one casing.
- **Command:** `/impeccable distill`

**[P2] The home is all-or-nothing**
- **What:**
  - A world with scenes but no notes still says "first note".
  - Once you have notes, closing every tab gives "No tab open / Open a note, map, or scene from the sidebar": no world name, and its small grey line measures about 3.2:1.
- **Fix:** see the questions below.
- **Command:** `/impeccable onboard`

**[P2] Errors said twice, in the raw**
- **What:** a failed New note prints the backend's own error text in red under the button, repeating the friendly toast. The Splash just lost exactly this line.
- **Fix:** delete it.
- **Command:** `/impeccable harden`

## Persona Red Flags

- **Jordan (first world, made on the Splash a moment ago):**
  - lands with nothing focused and two invitations
  - is told nothing about where notes live or that the folder is theirs
  - after naming the first note and pressing Enter, the cursor goes nowhere, so typing does nothing
- **Alex (power user):**
  - Ctrl+N is great but never mentioned
  - after the first note, the world's home is gone for good
- **Sam (screen reader):**
  - 13 Tab stops to the one action
  - a `<main>` nested inside another `<main>`
  - "Creating…" isn't announced
  - the template link's focus ring is square while everything else is rounded
- **Riley (stress tester):**
  - a note name with `?` freezes the app
  - "Creating…" can stick with no way out
- **A GM making a world for tonight's one-shot:** templates hide behind a grey link with no hint of what's in them, and the page they started from is gone after the first NPC.

## Minor Observations

- **Two ellipsis styles:** "Creating..." uses three dots beside "…or start from a template", and the button widens when its label changes.
- **Notes from templates:** a note made from the NPC template is still called "Untitled".
- **Repeated heading:** the template picker repeats its placeholder as a heading ("Choose a template…" over "Choose a template").
- **Fallback name:** the page's fallback world name is "My Ledger", the wrong word and a name that doesn't exist.
- **Enter in a note title** blurs it rather than moving into the body. This is the note pane's behaviour, so it affects every note.

## Questions to Consider

- Should Ledger home simply be the Splash's right-hand column grown up: the same name, a contents line ("Nothing in it yet" / "1 scene"), and one primary next step?
- Should a brand-new world show what goes in it (a note, a map, a scene) as three plain typographic rows using the world's own name, with no illustrations and no tour?
- Should the home exist only at zero notes, or become the world's front page whenever a pane is empty (recent notes, its map, its last scene), replacing "No tab open" for good?
