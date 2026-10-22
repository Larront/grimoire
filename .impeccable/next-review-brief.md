# Brief: the rest of Grimoire's design review

Hand this to the agent at the start of a new session. It describes what an earlier
review already covered and settled, and what is left to look at.

## Context

Grimoire is a Tauri 2 desktop app for tabletop RPG Game Masters: notes, maps and
ambient audio in one local "ledger". Read `PRODUCT.md`, `DESIGN.md` and `CONTEXT.md`
before starting. All three were updated by the previous review and are current.

The previous review (October 2026, merged to `next` at `5f62448`) worked at the level of
the design system and the main screens. It did **not** review components one by one. The
system-wide fixes reach every component, but the surfaces listed below have not had a
design judgement of their own layout, behaviour and states.

The previous critique snapshot is in `.impeccable/critique/`. It's history only; it lists
nothing still to do.

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
  grey. Nothing is set below 11px.
- **Live play.** A scene card's picture plays or pauses it, and a labelled Edit button
  opens the editor. The sidebar's Scenes group lists favourites (or the three newest)
  with always-visible play buttons. A playing row must not use the "current page"
  highlight.
- **Map panels float** (ADR-0006). Selecting a pin pans the map so the pin stays clear
  of the panel.
- **Repeated titles.** A `# Title` that repeats the note title is fixed in content (the
  sample world, templates), not hidden when rendering. Hiding it was tried and broke the
  cursor.

## What to review, in priority order

Use `/impeccable critique <target>` on one surface at a time, and judge it from the
**real running app**, not just the code. Show the owner the findings for each surface
before fixing anything.

### 1. Surfaces a GM uses at the table

1. **Scene editor**: `src/lib/components/panes/ScenePane.svelte`. This was never opened
   in the previous review. Check the hero header, the slot list, adding tracks (local and
   Spotify), the volume mixer, the thumbnail and colour pickers, and the controls drawn
   over the scene's art.
2. **PDF viewer and scene links**: `panes/PdfPane.svelte`, `PdfPage.svelte`,
   `PdfSceneLinkLayer.svelte` and `SceneLinkBubble.svelte`. These are deliberately left
   out of the neutral thumbnail rule, because the hue pairs each highlight with its chip.
   Check whether that pairing actually reads, plus search, the toolbar and zoom.
3. **The scene player inside notes**: `editor/SceneBlockView.svelte`. Review it on its
   own: the collapsed strip, the expanded mixer, the scene picker
   (`panes/ScenePicker.svelte`), and the unresolved-scene state.
4. **The mini player**: `sidebar/MiniPlayer.svelte`, `MiniPlayerTrack.svelte` and
   `MiniPlayerVisualizer.svelte`. Check it while playing, paused and expanded, and with
   Spotify controls.
5. **Statblock in use**: `editor/StatblockBlockView.svelte`. Check edit mode, HP and pool
   interaction, mark tracks, presets, and tiled encounters inside a callout. Damage
   targets were flagged as small for use at the table.

### 2. Note blocks not yet looked at closely

- **Timeline**: `editor/TimelineBlockView.svelte`, with "The Ashfen Chronicle" as the
  sample.
- **Image block**: `editor/ImageBlockView.svelte`. Check the controls over the image,
  alignment, width and the caption.
- **Infobox**: `editor/InfoboxBlockView.svelte`. Check its edit states, and the gap an
  empty title row leaves (noticed but not fixed).
- The **slash menu**, **block handle menu**, **wikilink suggestion** and **link hover
  preview** (all in `editor/`).

### 3. Dialogs and secondary screens

- **Settings** sections that weren't reviewed: Statblocks
  (`StatblockPresetsSettings.svelte`), Integrations and About (`SettingsDialog.svelte`).
- **TagManagerDialog**, **QuickNoteDialog**, **AdoptDialog** ("Make this world mine"),
  **UnlinkedPinsDialog**, **FailedImportsDialog**, **DbRecoveryDialog** and
  **FormatMigrationDialog**.
- **Template editor**: `panes/TemplatePane.svelte` and `sidebar/SidebarTemplates.svelte`.
- **Ledger home**: `panes/LedgerHome.svelte`, and **SampleBanner**.
- **Context menus**: `sidebar/FileTree.svelte`, `TabBar.svelte`,
  `panes/ScenesDashboard.svelte` (whose scene card menu has 8 actions) and
  `sidebar/SidebarTemplates.svelte`.

### 4. States, not screens

These come up across all of the above:

- **Toasts.** Every kind can be fired from the dev-only "Toasts" pill (bottom left in dev
  builds). Since the review, toasts have no coloured stripe and use the shared floating
  shadow.
- **Banners**: the conflict banner and the deleted-note banner in `panes/NotePane.svelte`.
- **Empty states**: an empty ledger, no scenes, no quick notes, a note with no backlinks.
- **The first-time splash** (no recent ledgers) in `src/routes/+page.svelte`. The
  previous review only saw the returning-user state.
- **Edge cases**: long names, a large ledger (hundreds of notes, many scenes and tags), a
  missing image file, load errors.
- **Keyboard-only use** of a whole task, such as opening a note, playing a scene and
  dropping a pin.
- **The collapsed sidebar rail**: it has no active-state marker, and Quick Notes and
  Templates aren't reachable from it.

## Known open items from the previous review

- **Sample art.** The owner is supplying four images. Don't invent or download art:
  - `src-tauri/sample-world/.grimoire/images/mira-ashvale.png` (portrait)
  - `src-tauri/sample-world/.grimoire/images/the-ember-keep.png` (landscape)
  - `src-tauri/sample-world/.grimoire/thumbnails/boss-battle.*` and `town-market.*`.
    These are picked up automatically by `seed_sample_world_scenes`.
- **The detector** reports about 30 leftover findings, mostly advisory or false
  positives: variable-font names read literally, test-file colours, a hex code inside a
  comment, and small radii on inline elements.
- **The website** (`site/DESIGN.md`) still calls the iron "cold metal" in its voice
  copy. That wording is the owner's call.

## How to see the real app

`bun run dev` alone can't load data, because the frontend needs the Tauri backend. Run
the full app with WebView2's debugging port open, then drive it over the Chrome DevTools
Protocol:

```bash
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" bun run tauri dev
```

The previous session's minimal driver is at `.impeccable/tmp/cdp.ts`, run with
`bun cdp.ts shot <out.png> [w h]` or `bun cdp.ts eval "<js>"`. Open the sample world with
**Explore an example world** on the splash. Some cautions:

- Editing a non-component `.ts` file or a `.md` file triggers a full page reload, which
  sends the app back to the splash.
- Changing a theme in Settings is a persisted setting. Put it back to the owner's choice
  (Dark, Crimson) afterwards.
- Pause any audio you start.

## Working agreements

- Explain findings in plain language first, with code names as supporting detail.
- Make technical decisions yourself. Ask the owner only about UX choices, and about
  changing an ADR or a documented decision.
- Keep modules consistent with each other first; simple code second.
- Follow `docs/agents/git-workflow.md`: branch from `next` (`feature/…`), commit per step
  with messages in the repo's narrative style, and merge back into `next` with `--no-ff`
  when the owner asks.
- Update DESIGN.md and CONTEXT.md whenever a decision changes.
