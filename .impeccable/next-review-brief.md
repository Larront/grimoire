# Brief: the rest of Grimoire's design review

Hand this to the agent at the start of a new session. It says what the review has
already covered and settled, and what is left to look at.

_Last updated 2026-10-23._

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
  `feature/sqlite-recover-damaged-ledger`), and FormatMigrationDialog (on
  `feature/format-migration-review`, awaiting merge).

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

1. **Template editor**: `panes/TemplatePane.svelte` and `sidebar/SidebarTemplates.svelte`.
2. **The Splash Screen** (`src/routes/+page.svelte`), added by the owner. All its modes:
   returning with Recent Ledgers, first-time (no recent ledgers), and creating a world
   (the create form shares `NewLedgerFields.svelte` with the Adopt dialog). Include
   **Explore an example world**, which resets the example without asking.
3. **Ledger home**: `panes/LedgerHome.svelte` (the empty-ledger home inside the app).
4. **SampleBanner**.
5. **Context menus**: `sidebar/FileTree.svelte`, `TabBar.svelte`,
   `panes/ScenesDashboard.svelte` and `sidebar/SidebarTemplates.svelte`. The scenes
   dashboard's card menu has 8 actions, still opens the old colour and icon windows, and
   deletes a scene through a modal.

### 2. States, not screens

These come up across everything above:

- **Toasts.** Every kind can be fired from the dev-only "Toasts" pill (bottom left in dev
  builds).
- **Banners**: the conflict banner and the deleted-note banner in `panes/NotePane.svelte`.
- **Empty states**: an empty ledger, no scenes, no quick notes, a note with no backlinks.
- **Edge cases**: long names, a large ledger (hundreds of notes, many scenes and tags), a
  missing image file, load errors. Lists sort names as text, not by number ("Annal 1,
  Annal 10, Annal 11"), everywhere including the file tree.
- **Keyboard-only use** of a whole task, such as opening a note, playing a scene and
  dropping a pin. Keyboard use of the map was spun off as a separate task; check whether
  it has landed.
- **The collapsed sidebar rail**: it has no active-state marker, and Quick Notes and
  Templates aren't reachable from it.

### 3. Animation consistency, last (added by the owner)

Expand and collapse should animate the same way everywhere. Today: the statblock's
collapse has no animation (only its chevron rotates); callouts have one; the scene
block's mixer slides with a grid-rows transition; the sidebar and file tree use Svelte
`slide`; shadcn popovers, menus and dialogs use `animate-in` fade and zoom. Survey every
collapsible and transition, pick one motion vocabulary (respecting reduced motion), and
apply it.

## Leftovers from surfaces already reviewed

Not fixed yet; pick them up when they fit a pass above:

- **Statblock**: several blocks can be in edit mode at once; collapsing near a note's end
  scrolls the block away; links inside entries aren't Tab stops; a fresh block's visible
  "+" adds a section, not a row.
- **Infobox**: its narrow panel lost about 16px to the row-controls gutter when Row List
  was rebuilt.
- **Broken wikilinks after bulk moves outside Grimoire**: a manual "repair backlinks"
  tool is planned as the escape hatch.

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
