# Brief: the rest of Grimoire's design review

Hand this to the agent at the start of a new session. It says what the review has
already covered and settled, and what is left to look at.

_Last updated 2026-10-23 (after the Template editor)._

## Context

Grimoire is a Tauri 2 desktop app for tabletop RPG Game Masters: notes, maps and
ambient audio in one local "ledger" (a "world" in the GM's words). Read `PRODUCT.md`,
`DESIGN.md` and `CONTEXT.md` before starting. All three are kept current by the review.

The review has two rounds. The first (October 2026, merged to `next` at `5f62448`) worked
at the level of the design system and the main screens. The second, still running, goes
**one surface at a time**: a critique of the real running app, the findings shown to the
owner in plain language, UX questions asked, then fixes on a `feature/…` branch merged
into `next`. Each surface's critique is in `.impeccable/critique/`.

## Done in the second round

Each is merged into `next` unless noted. DESIGN.md has an entry for most of them.

- **At the table:** scene editor, PDF viewer and scene links, the scene player inside
  notes, the mini player, statblock in use.
- **Note blocks:** Timeline, Image, Infobox, the slash menu, the block handle menu, the
  wikilink suggestion, the link hover preview.
- **Dialogs:** Settings (all sections), TagManagerDialog, QuickNoteDialog, AdoptDialog,
  UnlinkedPinsDialog, FailedImportsDialog, DbRecoveryDialog (plus a follow-up that
  salvages a damaged database with SQLite's own recovery before asking to rebuild,
  `feature/sqlite-recover-damaged-ledger`), and FormatMigrationDialog.
- **Template editor** (merged): the sidebar's Templates accordion is gone; templates are made from New → _Note from
  template…_ and the palette, and tended in a Templates dialog shaped like the Tag
  Manager. The pane shows and edits a template's tags. Also, app-wide: tabs have one
  identity (`tabKey`), so two template or PDF tabs no longer freeze the tab bar; new
  notes go beside the open note (CONTEXT.md, Note Placement — this reversed #227's
  "root, always"); one name check for files and folders (`names.rs`, `file-name.ts`);
  sidebar and tab hover take the Hover Overlay; Ember Error is `#dc6e64`.
- **Splash Screen** (merged): chosen by the owner
  from three layouts tried in the running app. Two columns — what Grimoire is and the
  ways to start; the last world as the subject with Continue focused, the others
  beneath. "World" throughout. The example world continues as left, or starts over
  on request (`existing_sample_ledger`, `ledger.continueSample`). Launch opens on
  Iron, not white. The crimson wordmark is the Signal Rule's one named exception.
  DESIGN.md §5 Splash has the whole spec.
- **SampleBanner** (merged): removed, with
  its "dismissed" pref. The example is named as itself ("The Ashfen Vale", marked
  "example" in the world menu and the window title, through `ledger.worldName`); it
  keeps the usual world menu (recent worlds — the way back) with Make this world mine
  added; its World Home says it's an example and that changes are kept. The Adopt
  dialog no longer promises a "fresh" example. A save that only changes trailing
  whitespace no longer counts as an edit.
- **Ledger home → World Home** (merged): the
  Splash's right-hand column carried into the world, in every empty pane (not only at
  zero notes; "No tab open" is gone): name, contents, New note focused on arrival,
  Note from template…, recently edited notes. Found and fixed on the way:
  - **A note name with `?` or `:` froze the app** (an endless loop in
    `resolve_note_filename` holding the world's lock; reachable by clicking an
    unresolved link). Note names now follow `names.rs`; the owner chose refusal with a
    toast over saving under a cleaned file name.
  - **The note pane remounted its editor on every notes reload** (`{#if
    notes.isLoading}`), so a rename lost the caret and undo history.
  - A note's `modified_at` was only its creation time; saves now move it.
  - Enter in a note's or template's title goes into its text.
- **Context menus** (merged): every menu is
  one design (`ui/menu-styles.ts`, DESIGN.md §5 Menus) — the Block Handle's rows,
  icons, sentence case, keys in Meta through `shortcut()`, arrows that stop at the
  ends, Delete last and by name. Tree rows get a "⋯", F2 and Delete; a folder makes
  notes from templates, names a new folder on the spot, and saves a new map's picture
  in it. A tab's menu opens from the keyboard. A scene card leads with Play/Stop, opens
  the Scene Editor's Appearance popover, and deletes with Undo. British spelling in GM
  copy. Found and fixed on the way:
  - **Undo could lie**: `toastUndo` committed on its own timer while the toast paused
    on hover, so a folder could be deleted from disk with Undo still showing. It commits
    when the toast closes now.
  - **Undo couldn't be pressed over a dialog or the sidebar's sheet**; a click on a toast
    now passes through and doesn't close them (`isOnToast`).
  - **A file-tree delete was permanent.** Notes, folders and PDFs go to the Recycle Bin
    now (`commands/recycle.rs`, the `trash` crate), the owner's call; maps and scenes
    keep Undo, as their database rows can't come back from a bin.
  - **The webview's own menu** (with a Refresh that reloads the app) showed on any
    right-click the app didn't handle.

- **States, not screens** (merged): toasts,
  the note banners, empty states, edge cases, keyboard tasks and the rail, reviewed as
  one critique. The owner chose a "needs attention" place over problem toasts, a Compare
  in the conflict banner, tabs that shrink then scroll, and a "Create note" when search
  finds nothing. Found and fixed on the way:
  - **"Save to recreate" lost a note's tags and aliases** (it wrote the body alone over
    a file that was gone). It brings the frontmatter back now.
  - **Switching worlds called a good note unreadable**: the notes list kept the old
    world's rows until the new list arrived, and a tab found one under its own id.
  - Problem toasts outlived their world; collapsed toasts hid an Undo as it ran out;
    the tab bar grew past its pane, taking the open tab off screen; the tree sorted
    "Annal 1, 10, 100"; opening from the palette or closing a tab left focus nowhere;
    PDFs weren't in the palette; the tree was a Tab stop per row.
- **Animation consistency** (on `feature/animation-review`, awaiting merge): four
  motion tokens and one ease-out curve (DESIGN.md §5 Motion). Every section opens with
  the shared `Disclosure`; menus, dialogs, sheets, toasts, the docked panel, the rail
  and the Splash take the tokens; hover changes colour only. Reduce Motion became
  Match my computer / On / Off and everything asks it. Found and fixed on the way:
  - **Reduce Motion didn't reach Svelte's slides** (the sidebar, the tree): they run
    outside CSS, so they played at full length with it on. A few parts asked the
    computer's setting instead of the app's.
  - **The search "pulse" had never shown**: it animated `::selection`, which can't
    animate. A search hit is now tinted, held, then faded.
  - Toasts arrived in 400ms and were cut off as they left (sonner removes one 200ms in).

## Already decided — do not reopen

Apply these rules when reviewing. Raise them again only if a surface shows a concrete
reason one fails.

- **The Signal Rule.** Crimson (`--primary`) means only: selected, focused, the primary
  action, playing, or a link. Links appear as an underline, never as crimson text.
  Everything else is neutral. (DESIGN.md §2)
- **Warm iron.** The dark surfaces are `#131110` / `#1c1917` / `#2a2522`. The owner chose
  these after comparing them side by side in the running app.
- **Three levels of depth.** In the page: border only. Floating: `bg-popover`, border and
  `shadow-float`. Modal: `bg-scrim`, never blur. No other shadows and no `backdrop-blur`.
  Every note block shares one frame. (DESIGN.md §4)
- **The Two Voices Rule, refined.** Metamorphous is for names that are the subject
  (titles, headings, card names, the wordmark). Lists, menus, tabs, pickers and dialog
  titles use Nunito. (DESIGN.md §3)
- **The type scale.** Title 44 / H1 28 / H2 22 / H3 18 / H4 16, prose 16px at Balanced
  density, note column capped at 46rem. Field labels are Nunito 12px semibold in muted
  grey, not uppercase. Nothing is set below 11px. Density is app-wide; the accent is
  per world (the Density Scale Rule).
- **Live play.** A scene card's picture plays or pauses it, and a labelled Edit button
  opens the editor. The sidebar's Scenes group lists favourites (or the three newest)
  with always-visible play buttons. A playing row must not use the "current page"
  highlight.
- **Map panels float** (ADR-0006). Selecting a pin pans the map so the pin stays clear
  of the panel.
- **Repeated titles.** A `# Title` that repeats the note title is fixed in content (the
  sample world, templates), not hidden when rendering. Hiding it was tried and broke the
  cursor.
- **Note format updates** follow ADR-0017: the GM consents, a decline opens nothing,
  there is no compatibility mode.
- **What a world needs from the GM is in one place** (the owner's call, 2026-10): pins
  that lost their note, notes that couldn't open and links to a note moved outside
  Grimoire wait in **Needs attention** — the world menu (a quiet mark on its button) and
  the World Home — never in a toast. Each belongs to its world (cleared as one opens or
  closes), is said in the GM's words, and keeps a way back from the palette (and the
  file tree, where it fits). Database recovery and note format updates stay calm,
  closable toasts that name the world and go when it closes. Follow it for anything
  similar. (DESIGN.md §5 Needs attention; ADR-0014 amended.)
- **The collapsed rail stays as it is** (the owner's call, 2026-10): no Quick Notes, New
  or Templates on it. The palette reaches all three.
- **Focus** uses the app's global 2px outline with a 2px offset; components don't add
  their own rings.

## What to review, in order

Use `/impeccable critique <target>` on one surface at a time, and judge it from the
**real running app**, not just the code. Show the owner the findings for each surface
before fixing anything.

### 1. Remaining dialogs and secondary screens

None left: the context menus were the last.

### 2. States, not screens

Done (`feature/states-review`; see "Done in the second round").

### 3. Animation consistency, last (added by the owner)

Done (`feature/animation-review`). The owner's calls: a section opens with one quick
glide (150ms, its arrow turning with it), the docked panel and rail ease rather than
crawl, the Splash keeps its rise but quicker, and Reduce Motion is "Match my computer"
(the default) / On / Off, which everything asks. DESIGN.md §5 Motion has the four
tokens and the rules.

## Leftovers from surfaces already reviewed

The bugs among them were fixed in one pass (`feature/leftovers-bug-pass`): a note
re-saved as it opened, a deleted note's banner that stayed when its file came back,
the Infobox's rows short of the panel, and the statblock's four (one open for editing
at a time, the page held still as a block closes, entry links as Tab stops, every Add
shown while authoring). What is left is features and polish.

Not fixed yet; pick them up when they fit a pass above:

- **World Home**: a note made from a template is still called "Untitled". The app
  shell nests one `<main>` inside another. A link whose text has `?` or `:` can't
  become a note (refused, by the owner's choice); if GMs trip on it, the alternative
  is a file name cleaned of those characters with the title kept as written.
- **Splash**: the default window is 1280×832; whether a smaller launch window suits the
  Splash better was raised and not decided. (A world whose folder moved has Find it…
  now: it opens from where the GM says it is, a folder that isn't a world yet opening
  as one, by the owner's choice.)
- **States, not screens**:
  - Map keyboard use hasn't landed: `MapCanvas.svelte` still has `keyboard: false`;
    pins are unnamed `role=button`s, can't be placed by keyboard, and focusing one
    shows Leaflet's white tooltip.
  - Long names: lists cut them in the middle, and a note's title wraps to a second line
    rather than being cut (the owner's choice).
  - The owner chose to leave the rest of these: map keyboard use, the World Home's
    "Untitled" template note and nested `<main>`, and the Splash's launch size.
- **Context menus**: the leftovers were done in the same pass (the Recycle Bin, the
  map badge, the colour picker's empty state, sentence-case panel labels, a menu for the
  tree's root and no webview menu). The last three followed: the remaining Title Case
  labels are sentence case, the current tree row's "⋯" is a Tab stop, and a folder sent
  to the Recycle Bin says what went with it.
- **Animation**: both leftovers were fixed after the merge (a shell dialog closes the
  narrow window's sheet; toasts follow the app's Reduce Motion, not only the computer's).

## Known open items

- **Sample art.** The owner is supplying four images. Don't invent or download art:
  - `src-tauri/sample-world/.grimoire/images/mira-ashvale.png` (portrait)
  - `src-tauri/sample-world/.grimoire/images/the-ember-keep.png` (landscape)
  - `src-tauri/sample-world/.grimoire/thumbnails/boss-battle.*` and `town-market.*`.
    These are picked up automatically by `seed_sample_world_scenes`.
- **The detector** reports leftover findings, mostly advisory or false positives:
  variable-font names read literally, test-file colours, a hex code inside a comment, and
  small radii on inline elements.
- **The website** (`site/DESIGN.md`) still calls the iron "cold metal" in its voice
  copy. That wording is the owner's call.

## How to see the real app

`bun run dev` alone can't load data, because the frontend needs the Tauri backend. Run
the full app with WebView2's debugging port open, then drive it over the Chrome DevTools
Protocol:

```bash
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" bun run tauri dev
```

Keep scratch files **outside the repo**. The last session's helpers are in
`%LOCALAPPDATA%\Temp\grimoire-review-B\` (they may have been cleaned away; they are small
to rebuild): `cdp.ts` (`shot`, `zoom`, `eval`, `key`, `click`), `cleanup.js`, and
fixtures that build throwaway worlds under `%LOCALAPPDATA%\Temp\grimoire-review\`.

Cautions:

- **Never open, migrate or rebuild the owner's real worlds** ("No Room For A Wallflower",
  "Gods Ascendant", "Lost Mine of Phandelver"). Test in the example world or a throwaway
  world. After using a throwaway world, close it and remove it from Recent Ledgers, so the
  list is exactly those three.
- Don't use the palette's "Switch ledger…" or "Open new ledger" (they open a native file
  picker the agent can't drive). Don't call `navigator.clipboard`.
- Editing a non-component `.ts` file or a `.md` file triggers a full page reload, which
  sends the app back to the splash. Hot reload can also leave **two copies of a store
  module**; a script that imports the newest copy may see an empty store while the app
  still has a world open. Reload the page, or check every copy, before trusting it.
- Changing a theme in Settings is a persisted setting. Put it back to the owner's choice
  (Dark, Crimson) afterwards.
- Pause any audio you start.
- svelte-sonner: a toast with `duration: Infinity` that is later updated closes at once;
  lasting toasts use `2 ** 31 - 1`. A toast takes clicks over a dialog only because
  `app.css` gives the toaster `pointer-events: auto` and the modal primitives pass a click
  on a toast (`isOnToast`).

## Working agreements

- Explain findings in plain language first, with code names as supporting detail.
- Make technical decisions yourself. Ask the owner only about UX choices, and about
  changing an ADR or a documented decision.
- Keep modules consistent with each other first; simple code second. Prefer fixes that
  help several surfaces.
- Follow `docs/agents/git-workflow.md`: branch from `next` (`feature/…`), commit per step
  with messages in the repo's narrative style, and merge back into `next` with `--no-ff`
  when the owner asks.
- Update DESIGN.md and CONTEXT.md whenever a decision changes.
