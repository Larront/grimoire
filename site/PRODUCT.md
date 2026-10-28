# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Tabletop RPG Game Masters and worldbuilders — the people who prep campaigns and run
them live at the table. They are hands-on makers: they keep lore, NPCs, maps, and
session notes, and they care about owning their work. Many are technically literate
(drawn to local-first, plain Markdown, open source), but the audience spans from
tinkerers to hobbyist storytellers who just want a focused instrument that stays out
of the way.

Their context when they hit this site: evaluating whether Grimoire is worth adopting
for a campaign. They arrive skeptical of yet-another-note-app and wary of lock-in.
The site's job is to convince them this is a serious, well-crafted tool and get them
to download it.

## Product Purpose

A single-page marketing site for **Grimoire**, a free, open-source, local-first
desktop app (Windows / macOS / Linux) that unifies Markdown lore notes, interactive
maps, and ambient audio scenes into one portable folder ("the Ledger") the user owns.

The site exists to convert visitors into users. Success, in priority order:

1. **Downloads** — visitors grab the build for their OS. This is the primary goal.
2. **GitHub engagement** — stars, contributors, and issues, as the secondary path for
   the technically inclined.

Underneath both: establish credibility. The visitor should leave certain this is a
carefully made instrument by someone who understands the craft of running a game.

## Positioning

The same claim as the app (root `PRODUCT.md`): **notes, maps and ambient audio in
one tool.** Lore, annotated maps and the soundscapes a GM plays at the table live
together and link to each other, so running a session never means juggling apps.
Local-first, plain Markdown, open source and no account are the credibility signals
that back the claim, not the claim itself.

## Operating Context

- **Where visitors come from.** Believed to be mostly the GitHub repository (they
  have read the README and come here to download) and links shared in TTRPG
  communities such as Reddit and Discord (they arrive cold, with no context). There
  are no analytics, so this is the owner's belief, not a measurement.
- **What they decide here.** Whether Grimoire is worth trying for a campaign, which
  installer fits their machine, and whether to trust an unsigned build.
- **What happens after the download.** The first launch opens on the example ledger,
  _The Ashfen Vale_, which they can explore before making their own. A ledger they
  make is a folder they name and place; Grimoire keeps everything for it there.

## Capabilities and Constraints

**The site only claims what the release it links to contains.** The site deploys from
`main` and its download links resolve to the latest GitHub release, so a feature
merged into `next` goes on the site when it ships, not before. The full capability
list lives in the root `PRODUCT.md`; check a claim against the code before writing it.

Not features, whatever earlier copy said: maps nested inside maps, and journeys or
routes drawn on a map. Pins link to notes; map drawings are text, rectangles and
circles.

**Terminology (owner's decision, 2026-10-29).** _Ledger_ is the visitor-facing word for
the folder a GM keeps their campaign in: "a portable ledger", "your ledger", lower case
in running text. _World_
is the fiction they build in it: "the world you're building". The site uses ledger
for the thing on disk and never calls it a world. The app's Splash and menus still
say "world" for the folder (from the 2026-10 design review); bringing the app into
line is app work, not a reason for the site to drift.

Constraints: free and GPL-3.0; Windows, macOS and Linux; builds are unsigned; no
account, no cloud, no subscription.

## Brand Personality

**Literary, restrained, crafted.** Quiet confidence over hype. The voice is that of a
maker's tool, not a startup pitch — evocative but never purple, precise without being
cold. It borrows the _idea_ of a grimoire (a spellbook of record) as a metaphor for
substance and ownership, not as an excuse for fantasy costume.

- Voice: assured, spare, a little literary. Lines like "The tool disappears. The world
  remains." are the register — earned metaphor, no filler.
- Emotional goal: respect and trust. The reader should feel this was built by someone
  who runs games and sweats the details.
- Reference feel: **Arc / Raycast** — characterful product marketing with genuine
  personality and considered motion, yet clean, premium, and never noisy. Take the
  craft and confidence; leave the flashiness.

## Anti-references

- **Generic SaaS landing.** No gradient-mesh hero, no three-identical-feature-cards,
  no big-number hero metrics, no purple/indigo default palette. The AI-slop template.
- **Cheesy fantasy kitsch.** No faux-parchment textures, dragon clip-art, blackletter
  everywhere, or wizard-cliché imagery. The grimoire theme lives in metaphor, type,
  and restraint — not costume.
- **Corporate / sterile.** Not cold, not safe, not enterprise-blue. It must have a
  point of view; it should never read as "could be any B2B tool."

## Product Principles

1. **The tool disappears.** The product's own thesis is the site's discipline: nothing
   competes with the message. Restraint is the brand, not a limitation.
2. **Earn every flourish.** Atmosphere comes from typography, spacing, and one
   committed accent (crimson on iron), never from decoration bolted on. If an effect
   doesn't carry meaning, it doesn't ship.
3. **Show ownership and substance.** Local-first, plain Markdown, open source, no
   account — these credibility signals are the product's real magic. Make them felt,
   not just listed.
4. **Craft as proof.** The site's own polish is the argument. A meticulously made
   landing page is evidence the app is meticulously made.
5. **Metaphor, held lightly.** Lean on the grimoire/ledger/spellbook language for
   resonance, but always in service of clarity — never at the cost of a GM
   understanding exactly what they're downloading.

## Evidence on Hand

- Product screenshots in `site/public/`: `screenshot.png` (the example ledger, The
  Ashfen Vale, in the editor), `maps.webp` (map with a selected pin and its location
  note), `audio-note.webp` (a scene embedded in a note), `audio-pdf.webp` (a scene
  pinned to a PDF passage). All four predate the October 2026 warm iron surfaces and
  show the old grey app; they need recapturing from the release that ships it.
- The example ledger itself, bundled with the app: the source for any new screenshot.
- Live release data (version, per-OS download assets) fetched from GitHub at build time via
  `site/src/lib/releases.ts`.

Nothing else. There are no testimonials, user or download counts, press, reviews or
community quotes. Do not invent them, and do not imply them with placeholder copy.
Builds are unsigned and the app is a prerelease (`0.X.Y`); the site must not suggest
otherwise.

## Accessibility & Inclusion

Not a formal compliance gate for this project (per owner). Still, the impeccable
baseline holds and is non-negotiable craft: legible body-text contrast (the muted
ember-on-iron palette must be checked — ember-muted/ember-faint on dark iron need to
clear 4.5:1 for body copy), visible keyboard focus states, and a working
`prefers-reduced-motion` path (in `site/src/styles/global.css`). Treat these as part
of "crafted," not as a checkbox.
