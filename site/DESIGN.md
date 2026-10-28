---
name: Grimoire
description: The website for Grimoire, a spellbook of record for tabletop RPG worldbuilders — Iron & Ember, dark-first, in the app's own vocabulary.
colors:
  # Every value comes from shared/tokens.css; the app's DESIGN.md is canonical.
  crimson: "#c2483d"
  crimson-lit: "#ffffff"
  crimson-tint: "#c2483d1f"
  crimson-veil: "#c2483d3d"
  iron-deep: "#131110"
  iron-dark: "#1c1917"
  iron-raised: "#2a2522"
  iron-border: "#ffeee217"
  hover-overlay: "#fff0e60b"
  ember-ash: "#f0ece8"
  ember-muted: "#a39e99"
  ember-faint: "#6b6460"
typography:
  display:
    fontFamily: "Metamorphous, serif"
    fontSize: "clamp(2.25rem, 5vw, 3rem)"
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: "normal"
  headline:
    fontFamily: "Metamorphous, serif"
    fontSize: "clamp(1.875rem, 4vw, 2.25rem)"
    fontWeight: 400
    lineHeight: 1.375
    letterSpacing: "normal"
  feature:
    fontFamily: "Metamorphous, serif"
    fontSize: "clamp(1.5rem, 3vw, 2rem)"
    fontWeight: 400
    lineHeight: 1.375
    letterSpacing: "normal"
  article:
    fontFamily: "Metamorphous, serif"
    fontSize: "1.25rem"
    fontWeight: 400
    lineHeight: 1.375
    letterSpacing: "normal"
  title:
    fontFamily: "Nunito Variable, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "normal"
  lead:
    fontFamily: "Nunito Variable, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.625
    letterSpacing: "normal"
  body:
    fontFamily: "Nunito Variable, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.625
    letterSpacing: "normal"
  small:
    fontFamily: "Nunito Variable, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.625
    letterSpacing: "normal"
  code:
    fontFamily: "JetBrains Mono Variable, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  structural: "6px"
  elevated: "8px"
spacing:
  section-y: "6rem"
  container-max: "72rem"
  gutter: "1.5rem"
motion:
  base: "150ms"
  arrive: "300ms"
  stagger: "75ms"
  rise: "8px"
  ease-out: "cubic-bezier(0.2, 0, 0, 1)"
components:
  button-primary:
    backgroundColor: "{colors.crimson}"
    textColor: "{colors.crimson-lit}"
    rounded: "{rounded.structural}"
    padding: "0.75rem 1.5rem"
  button-primary-hover:
    backgroundColor: "#c2483dcc"
    textColor: "{colors.crimson-lit}"
    rounded: "{rounded.structural}"
    padding: "0.75rem 1.5rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ember-muted}"
    rounded: "{rounded.structural}"
    padding: "0.75rem 1.5rem"
  button-ghost-hover:
    backgroundColor: "{colors.hover-overlay}"
    textColor: "{colors.ember-ash}"
    rounded: "{rounded.structural}"
    padding: "0.75rem 1.5rem"
  asset-button:
    backgroundColor: "{colors.iron-raised}"
    textColor: "{colors.ember-ash}"
    rounded: "{rounded.structural}"
    padding: "0.5rem 0.75rem"
  text-link:
    textColor: "{colors.ember-ash}"
    underlineColor: "{colors.crimson}"
    underlineThickness: "1px (2px on hover)"
    underlineOffset: "3px"
  focus-ring:
    outline: "2px solid {colors.crimson}"
    outlineOffset: "2px"
  screenshot-frame:
    backgroundColor: "{colors.iron-raised}"
    textColor: "{colors.ember-ash}"
    rounded: "{rounded.elevated}"
    padding: "0"
---

# Design System: Grimoire (website)

The website conforms to the app. Colour, type, radius and motion are imported from
`shared/tokens.css`, and the app's root `DESIGN.md` is canonical: where this record
and the app's disagree, the app's wins and this one is out of date. What follows is
how the site uses that vocabulary, and the few things only the site needs.

## 1. Overview

**Creative North Star: "The Forge at Rest"**

Grimoire is cooled iron with an ember still glowing inside it. The surface is dark,
still and disciplined — near-black irons with a faint red-brown cast, layered by tone,
hairline borders of the faintest warm light — and against that stillness sits a single
point of heat: crimson, used only as a signal, the way a live coal reads against cold
metal. Nothing here is decorative. The restraint _is_ the brand: the product's own
thesis is "the tool disappears", and the site practises what the app preaches.

The site is built for a Game Master evaluating a serious instrument. It must feel
crafted and owned, and it must look like the product it shows: the screenshots sit in
chrome made of the same tokens, so the page and the app read as one thing. Depth comes
from tonal layering and thin warm borders, never from shadows or blur. Typography
carries the atmosphere: Metamorphous for every heading, Nunito for everything a visitor
reads, and monospace only where the words are literally code. The grimoire metaphor is
held _lightly_ — in language and type, never in costume.

This system rejects three things. It is **not a generic SaaS landing**: no
gradient-mesh hero, no three identical feature cards, no big-number metrics, no
purple/indigo default, no eyebrow labels over headings. It is **not fantasy kitsch**:
no faux-parchment, no dragon clip-art, no blackletter. And it is **not corporate or
sterile**: it has a point of view.

**Key Characteristics:**

- Dark-only, warm iron surfaces layered by tone, never by shadow
- Crimson as signal only (the app's Signal Rule), plus the wordmark
- Two voices — Metamorphous for headings, Nunito for reading — and mono for code-like facts
- Flat, honest depth: hairline borders and tonal steps; no shadows, no blur, no glow
- Quiet motion on the app's tokens: things rise 8px over 300ms; hover changes colour only
- Honest about being early: the release is stated as an early 0.x release

## 2. Colours

A warm iron field with a single ember. Two families — irons and embers — and one
saturated crimson that carries every signal. All values live in `shared/tokens.css`;
the site defines no palette of its own.

### Primary

- **Ember Crimson** (`#c2483d`, `--primary`): The only saturated colour. It marks the
  primary action (the hero CTA, the nav's Download, the recommended installer on the
  visitor's own row), the focus ring, the underline under a link in running text, and
  the wordmark.
- **Crimson Lit** (`#ffffff`, `--primary-foreground`): The label on a crimson fill.
- **Crimson Veil** (`#c2483d3d`, `--primary-muted`): The text selection highlight.
- **Crimson Tint** (`#c2483d1f`, `--primary-subtle`): Shared token; the site does not
  currently use it.

A pressed or hovered crimson button is crimson at 80% (`bg-primary/80`), not a second
crimson.

### Neutral (Iron)

- **Iron Deep** (`#131110`, `--background-subtle`): The page background, the sticky
  nav, and the browser's `theme-color`.
- **Iron Dark** (`#1c1917`, `--background`): One step up — the Features band, so the
  page segments by tone, not only by border.
- **Iron Raised** (`#2a2522`, `--background-elevated`): The screenshot frames and the
  recommended installer button on a platform row that isn't the visitor's.
- **Iron Border** (`rgba(255,238,226,0.09)`, `--background-border`): Every border and
  divider. Warm, not white.
- **Hover Overlay** (`rgba(255,240,230,0.045)`, `--hover-overlay`): The hover wash on
  ghost buttons, nav links and secondary installer buttons.

### Neutral (Ember text)

- **Ember Ash** (`#f0ece8`, `--foreground`): Headings, platform names, links in running
  text, and the mobile notice. 14.9:1 on Iron Dark.
- **Ember Muted** (`#a39e99`, `--foreground-muted`): Body copy, captions, fine print,
  fact lists, platform notes, file types. 6.6:1.
- **Ember Faint** (`#6b6460`, `--foreground-faint`): Not used for text on the site. Its
  one use is the hover border of the raised installer button.

### Named Rules

**The Signal Rule (from the app).** Crimson means the primary action, focus, or "this
is a link" — and a link is marked by a crimson _underline_, never by crimson words. The
wordmark is the app's one named exception and licenses nothing else: no crimson
headings, labels, rules or glows beside it. Feature headings carry no crimson.

**The Tonal Depth Rule.** Elevation is a step up the iron ramp (deep → dark → raised)
plus a hairline Iron Border. Nothing else.

## 3. Typography

**Heading font:** Metamorphous (`font-heading`)
**Reading font:** Nunito Variable (`font-sans`)
**Code font:** JetBrains Mono Variable (`font-mono`)

All three are imported once, in `shared/tokens.css`, so the family names cannot drift
from the packages that register them.

**Character:** Metamorphous carries the spellbook voice in every heading, and only in
headings. Nunito is warm and highly legible, and it is the voice of everything a visitor
reads, including captions and fine print. JetBrains Mono appears only where the text is
literally a code-like token.

### Hierarchy

- **Display** (Metamorphous 400, `clamp(2.25rem, 5vw, 3rem)`, line-height 1.15,
  balanced): the hero H1.
- **Headline** (Metamorphous 400, `clamp(1.875rem, 4vw, 2.25rem)`, `leading-snug`):
  section H2s ("The tool disappears. The world remains.", "Take up the ledger.").
- **Feature** (Metamorphous 400, `clamp(1.5rem, 3vw, 2rem)`, `leading-snug`,
  balanced): the Maps and Scenes H3s.
- **Article** (Metamorphous 400, `1.25rem`, `leading-snug`): the four foundation
  headings.
- **Title** (Nunito 600, `1rem`): platform names in the download list.
- **Lead** (Nunito 400, `1.125rem`, `leading-relaxed`): the hero paragraph.
- **Body** (Nunito 400, `1rem`, `leading-relaxed`, Ember Muted): all prose, held to
  `max-w-md`–`max-w-xl`.
- **Small** (Nunito 400, `0.875rem`, Ember Muted): captions, the hero's fine print,
  feature fact lists, platform notes, first-run steps, release line, footer.
- **Code** (JetBrains Mono 400, `0.75rem`, Ember Muted): an installer's file type and
  size (`.exe · 14 MB`), and the version tag in the release line.

### Named Rules

**Headings stand alone.** No eyebrow, kicker or label above a heading, and no section
numbers ("01 · MAPS"). A heading says what the section is; nothing introduces it.

**Metamorphous for headings.** Every heading on the page, H1 to H3, is Metamorphous,
except platform names in the download list, which are working labels in Nunito.
Buttons, links, captions and body are never set in the display face.

**Mono for code.** JetBrains Mono marks only what is literally code: file extensions,
file sizes beside them, the version tag. Captions, fine print, platform notes, fact
lists and labels are Nunito. No uppercase tracked mono labels.

## 4. Elevation

**Flat by tone. No shadows, no blur, anywhere on the site.** Depth is the iron ramp and
the Iron Border. The page sits on Iron Deep; the Features band steps to Iron Dark; the
screenshot frames step to Iron Raised with a 1px Iron Border and an 8px radius. The
sticky nav is solid Iron Deep with a hairline bottom border — the app has no backdrop
blur, so neither does the site.

The app's floating level (`shadow-float`) has no counterpart here: nothing on the site
floats.

### Named Rules

**The No-Shadow Rule.** The site uses no `box-shadow`, no glow and no
`backdrop-filter`. If a surface needs to read as lifted, step the tone and add the
border.

## 5. Components

Interactions are solid and quiet: a colour deepens, an overlay warms, an underline
thickens. State transitions run on the shared defaults (`--motion-base`, 150ms, on
`--ease-out`).

### Motion

The site uses the app's motion tokens (`shared/tokens.css`) and the app's rules:

- **Arrive.** The hero (heading, lead, CTAs, fine print) and the scroll reveals
  (screenshot, Maps, Scenes, each foundation article, each platform row) rise 8px and
  fade in over `--motion-arrive` (300ms) on `--ease-out` (`cubic-bezier(0.2, 0, 0, 1)`)
  — the same rise as the app's Splash, because the hero says the same line.
- **Staged, briefly.** Staged steps wait 75ms each (`--i` × 75ms), never more.
- **Hover changes colour, nothing else.** No lift, scale or shift on any element.
- **Gated.** Every reveal start-state is scoped to `.js-motion`, which `Layout.astro`
  sets before first paint only when JS runs and `prefers-reduced-motion` is not set.
  Without it the page renders fully visible; the scroll observer is a no-op. Under
  reduced motion, animations and transitions are cut to nothing and smooth scrolling
  is off.

### Focus

The app's ring, set globally: `:focus-visible` draws a 2px Crimson outline at 2px
offset. An outline rather than Tailwind's ring, so the offset never paints a halo on
the Features band.

### Buttons

- **Shape:** 6px corners (`rounded-sm`).
- **Primary:** Crimson fill, white label, semibold, `0.75rem 1.5rem` in the hero,
  `0.375rem 1rem` in the nav. Hover: crimson at 80%. One primary action in the hero.
- **Ghost:** transparent, Ember Muted label; hover takes the Hover Overlay and Ember
  Ash. "View on GitHub" and the nav links.

### Links in running text

Ember Ash words with a 1px crimson underline at 3px offset, at rest — the app's link
treatment. Hover thickens the underline to 2px. Footer links are quiet navigation:
Ember Muted, Ember Ash on hover, no underline.

### Screenshot frames

8px radius, Iron Raised, 1px Iron Border, image clipped flush. Each has a Nunito
caption below in Ember Muted, `0.875rem`. Never a shadow or a coloured side-stripe.

### Navigation

Sticky, 56px, solid Iron Deep, hairline bottom border. The wordmark in Metamorphous
crimson at left; at right, Features (hidden below `sm`) and GitHub as ghost links, then
a compact primary Download.

### Feature showcase

Under the Features H2 and its intro, two showcases, each a Metamorphous H3, a body
paragraph and a fact list (Nunito, `0.875rem`, Ember Muted, wrapped inline with
`gap-x-6`, no bullets or separators). Maps sits beside its screenshot at `lg`; Scenes
puts its copy above two screenshots side by side from `sm`.

### Foundation articles

Below a hairline rule, four bare `<article>`s in a 2×2 grid from `sm` (`gap-x-16
gap-y-12`): "Plain Markdown, never locked in", "Built for the table", "Local-first,
portable, yours", "Open, and early". Each is a Metamorphous heading and a body
paragraph. No cards, no labels, no icons.

### Download section (signature)

Two columns at `lg` (copy at most 24rem left, platform list right); stacked below.

- **Copy column:** the H2, a paragraph about the example ledger, the release line
  (mono version tag · "early release" · British date, from the GitHub API), and a note
  that builds aren't code-signed yet with a text link to the source.
- **Platform list:** a list bordered top and bottom with hairline dividers. Each row
  has the OS name (Title), a Nunito note saying what it needs and which file to pick,
  its asset buttons, and its own first-run step for the unsigned-build warning.
- **Asset buttons:** the label, the file type and size in mono, and a drawn SVG arrow —
  down for a direct installer, up-right for the releases page fallback. The first
  (recommended) asset is Iron Raised with an Iron Border (hover: the border goes Ember
  Faint); the others are ghost. The arrow turns crimson on hover.
- **Your computer.** A script detects the visitor's OS, moves that row first, adds
  "Your computer" beside its name (Nunito, Ember Muted), turns its recommended button
  primary (crimson fill, white label, file type and arrow), and relabels the hero CTA
  "Download for <OS>". Phones and tablets get "Grimoire is a desktop app…" in Ember Ash
  instead. Without JS every row shows equally, in a fixed Windows, macOS, Linux order.

### Footer

Hairline top border; the crimson Metamorphous wordmark, "© Aaron Lamont · GPL-3.0",
and GitHub, Report a bug and Releases as quiet links.

## 6. Do's and Don'ts

### Do:

- **Do** take every colour, font, radius and duration from `shared/tokens.css`, and
  follow the app's `DESIGN.md` where this record is silent.
- **Do** keep crimson to signals: the primary action, focus, link underlines, and the
  wordmark (The Signal Rule).
- **Do** build depth from the iron ramp (`#131110` → `#1c1917` → `#2a2522`) and the warm
  Iron Border.
- **Do** set every heading in Metamorphous and every line a visitor reads in Nunito.
- **Do** mark links in running text with a crimson underline on Ember Ash words.
- **Do** gate reveals on `.js-motion`, rise 8px over `--motion-arrive` on `--ease-out`,
  and stage at 75ms.
- **Do** say plainly that the release is early (0.x), and say which file to pick.
- **Do** use the product's terms: a "ledger" (lower case) is the folder, a "world" is
  the fiction.

### Don't:

- **Don't** put an eyebrow, kicker or number above a heading.
- **Don't** colour headings, labels or words crimson. A link is its underline.
- **Don't** use JetBrains Mono for captions, labels, notes or lists — only file types,
  sizes and the version tag.
- **Don't** use `box-shadow`, a glow, or `backdrop-filter` anywhere on the site.
- **Don't** move, lift or scale anything on hover; change its colour.
- **Don't** invent durations or curves; use the shared motion tokens.
- **Don't** build a generic SaaS landing: no gradient-mesh hero, no identical feature
  cards, no big-number metrics, no purple/indigo palette.
- **Don't** slide into fantasy kitsch: no parchment textures, no dragon clip-art, no
  blackletter.
- **Don't** use Ember Faint for text.
- **Don't** add a second saturated accent, or a coloured side-stripe border.
