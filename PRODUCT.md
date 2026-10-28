# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

A Tauri 2 desktop app (Windows, macOS, Linux) whose interface renders in the system webview. The design language is the app's own, not native per-OS.

## Register

product

## Users

Game Masters running tabletop RPG campaigns, from solo worldbuilders doing session prep to GMs managing live sessions at the table. They're focused, often mid-thought, moving fast between lore notes, scene audio, and maps. The interface competes with their imagination — the moment it demands attention, it has already lost.

## Product Purpose

Grimoire is a desktop worldbuilding tool for tabletop RPG Game Masters. It unifies notes, maps, scenes, and audio ambience into one ledger-based application. Success looks like a GM who never thinks about the tool during a live session — only about the world.

## Positioning

Notes, maps and ambient audio in one tool. A GM's lore, their annotated world maps and the soundscapes they play at the table live side by side and link to each other — a pin opens its location note, a scene plays from inside a note or a PDF passage — so running a session never means juggling separate apps. Neighbouring tools own one of these well; Grimoire's claim is that they belong together.

## Operating Context

- **Prep:** writing and linking lore, NPCs, locations and encounters; annotating maps; building audio scenes from local files and Spotify playlists.
- **Live play:** the same surface, mid-session — jumping to a note, a pin or a statblock, and switching the room's sound, in one gesture. There is no session mode.
- **The ledger:** a campaign is a folder on disk the GM picks. Notes are plain `.md` files; the app's database and indexes live in a hidden `.grimoire` folder inside it. The GM may also edit or move files outside the app, and Grimoire reconciles live.

## Capabilities and Constraints

Shipped (0.4.0, prerelease):

- **Notes** — Markdown editor with wikilinks, backlinks, aliases, tags, templates (four built in: NPC, Location, Session Log, Encounter) and note blocks: Timeline, Infobox, Statblock (with click-down pools and mark tracks), Callout.
- **Maps** — images annotated with pins and pin categories; pins link to notes.
- **Scenes** — named sets of audio slots (local audio, Spotify) played from a Scene Dashboard, embeddable in notes and linkable from PDF passages.
- **PDFs** — read-only viewing inside the ledger, with Scene-links as the only annotation kind.
- **Finding things** — full-text search and command palette, Graph pane, Quick Notes for parked thoughts.
- **Arrival** — Splash with recent ledgers, and a bundled Sample Ledger a first-time GM can explore.

Deliberately out of scope (see `CONTEXT.md` and `docs/adr/`):

- Initiative and combat tracking; conditions as a modelled vocabulary.
- Piping audio into Discord (ADR-0015).
- General-purpose PDF highlighting.

Constraints: local-first, no account; plain Markdown is the source of truth wherever a note is concerned. Builds are currently unsigned. Domain vocabulary is defined in `CONTEXT.md` and is binding — use its terms.

## Brand Personality

Focused / Arcane / Unhurried

References that capture the right feel: Notion (structured document-editor clarity), LegendKeeper (TTRPG-native, purposeful).

## Anti-references

- Heavy game UI: no leather textures, chrome bevels, glowing rune decorations, Diablo-style ornamentation. The game lives in the content, not the interface.
- Fantasy illustration overload: no ambient fog overlays, parchment textures, calligraphy fonts used as structural UI. Character comes from the content, not the container.

## Design Principles

**The tool disappears, the world remains.** Chrome stays invisible. Voice and personality live in the GM's named content — note titles, scene names, map annotations — not in the structural UI surrounding it.

**One action away.** Any piece of critical information is reachable in a single gesture. During a live session, the GM can't be slowed down by buried menus or modal interruptions.

**Restrained structure, expressive moments.** The app shell is quiet and functional. Arrival moments — the splash screen, empty states, the first note in a new ledger — earn richer, more considered treatment.

**The interface has no mode.** Prep and live play are the same surface. There is no "session start" ritual, no state the GM must enter or exit. The tool is always ready.

## Evidence on Hand

- Sample Ledger (bundled example world: interlinked notes, a map, a timeline, scenes, a parked Quick Note) — the real content future empty states and onboarding can point to.
- Product screenshots: `docs/screenshot.png`, plus those under `site/public/`.

No user testimonials, usage numbers or reviews exist; do not invent them.

## Accessibility & Inclusion

No specific WCAG compliance target at this stage. Reduce-motion support is respected — `prefers-reduced-motion` is already wired into the design system. Good defaults (focus rings, keyboard navigation, readable contrast) are the baseline.
