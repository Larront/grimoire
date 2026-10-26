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
- **Context menus** (on `feature/context-menus-review`, awaiting merge): every menu is
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
- **Repair surfaces share one pattern** (unlinked pins, notes that couldn't open,
  database recovery, note format updates). They name the world; say it once (no toast
  repeating a dialog); use a calm, lasting, closable toast that counts down and belongs
  to its world (opening or closing a world takes it down); offer a way back to the list
  from the command palette (and the file tree, where it fits); and give reasons in the
  GM's words, never the OS's. Follow it for anything similar.
- **Focus** uses the app's global 2px outline with a 2px offset; components don't add
  their own rings.

## What to review, in order

Use `/impeccable critique <target>` on one surface at a time, and judge it from the
**real running app**, not just the code. Show the owner the findings for each surface
before fixing anything.

### 1. Remaining dialogs and secondary screens

None left: the context menus were the last.

### 2. States, not screens

These come up across everything above:

- **Toasts.** Every kind can be fired from the dev-only "Toasts" pill (bottom left in dev
  builds). `toastUndo` commits when its toast closes now (the context menus pass);
  the rest haven't been looked at as a family.
- **Banners**: the conflict banner and the deleted-note banner in `panes/NotePane.svelte`.
- **Empty states**: an empty ledger, no scenes, no quick notes, a note with no backlinks.
- **Edge cases**: long names, a large ledger (hundreds of notes, many scenes and tags), a
  missing image file, load errors. Lists sort names as text, not by number ("Annal 1,
  Annal 10, Annal 11"), everywhere including the file tree; templates now sort
  naturally through `compareNames` (`utils/file-name.ts`), which the rest can reuse. A
  long note or template name is cut at the edge of its 44px title field (an `<input>`),
  so it reads as if that were the whole name. In a tab, the _Template_ badge leaves
  little room for the name ("Facti…").
- **Keyboard-only use** of a whole task, such as opening a note, playing a scene and
  dropping a pin. Keyboard use of the map was spun off as a separate task; check whether
  it has landed.
- **The collapsed sidebar rail**: it has no active-state marker, and Quick Notes and
  Templates aren't reachable from it (Templates are in the New menu, which collapses
  with it, and in the palette).

### 3. Animation consistency, last (added by the owner)

Expand and collapse should animate the same way everywhere. Today: the statblock's
collapse has no animation (only its chevron rotates); callouts have one; the scene
block's mixer slides with a grid-rows transition; the sidebar and file tree use Svelte
`slide`; shadcn popovers, menus and dialogs use `animate-in` fade and zoom. Survey every
collapsible and transition, pick one motion vocabulary (respecting reduced motion), and
apply it.

## Leftovers from surfaces already reviewed

Not fixed yet; pick them up when they fit a pass above:

- **The editor re-saves some notes as they open**, rewriting the file with a trailing
  blank line (the example's Start Here). A whitespace-only save no longer moves a
  note's modified time, but the write itself shouldn't happen on open: a GM's file
  changes on disk without their edit.
- **"Ledger" in GM-facing copy** still: the sidebar search ("Search ledger…"), the
  palette's "Switch ledger…" and "Open new ledger" commands.
- **World Home**: a note made from a template is still called "Untitled". The app
  shell nests one `<main>` inside another. A link whose text has `?` or `:` can't
  become a note (refused, by the owner's choice); if GMs trip on it, the alternative
  is a file name cleaned of those characters with the title kept as written.
- **Splash**: a world whose folder moved offers Look again and ✕, but no "Find it…"
  to point the recent entry at its new folder (needs a backend re-point of the recent
  entry). The default window is 1280×832; whether a smaller launch window suits the
  Splash better was raised and not decided. "Ledger" still appears in other GM-facing
  copy (the sidebar's ledger selector, the palette's "Switch ledger…").

- **Statblock**: several blocks can be in edit mode at once; collapsing near a note's end
  scrolls the block away; links inside entries aren't Tab stops; a fresh block's visible
  "+" adds a section, not a row.
- **Infobox**: its narrow panel lost about 16px to the row-controls gutter when Row List
  was rebuilt.
- **Broken wikilinks after bulk moves outside Grimoire**: a manual "repair backlinks"
  tool is planned as the escape hatch.
- **Context menus**:
  - **Deleting from the file tree should send notes, folders and PDFs to the Recycle Bin
    (Trash on a Mac), with no Undo toast** — the owner's decision. Not built: it needs
    the `trash` crate, and the registry could not be reached from the review machine.
    Until then the tree still deletes for good when its (now honest) Undo toast closes.
    Maps and scenes keep Undo either way: a map's pins and a scene live in the database,
    which no recycle bin can give back.
  - The map's title badge hovers with a crimson border and carries a second shadow.
  - `ColorPicker` with no colour chosen shows an empty swatch beside a hex value.
  - The pin and annotation panels label their sections in Title Case ("Linked Note",
    "Text Colour"); menus are sentence case now.
  - Right-clicking empty space in the file tree shows the webview's own menu.

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
  lasting toasts use `2 ** 31 - 1`. A toast under an open dialog can't be clicked.

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
