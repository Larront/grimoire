---
name: Grimoire
description: A spellbook of record for tabletop RPG worldbuilders — Iron & Ember, dark-first.
colors:
  crimson: "#c2483d"
  crimson-dark: "#a83228"
  crimson-lit: "#f9f1f0"
  crimson-tint: "#c2483d1f"
  crimson-veil: "#c2483d3d"
  iron-deep: "#181818"
  iron-dark: "#1f1f1f"
  iron-raised: "#262626"
  iron-border: "#ffffff14"
  hover-overlay: "#ffffff0a"
  ember-ash: "#f0ece8"
  ember-muted: "#a39e99"
  ember-faint: "#6b6460"
typography:
  display:
    fontFamily: "Metamorphous, Georgia, serif"
    fontSize: "clamp(2.25rem, 5vw, 3rem)"
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: "normal"
  headline:
    fontFamily: "Metamorphous, Georgia, serif"
    fontSize: "clamp(1.875rem, 4vw, 2.25rem)"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "normal"
  title:
    fontFamily: "Nunito Variable, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: "Nunito Variable, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: "normal"
  label:
    fontFamily: "JetBrains Mono, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.15em"
rounded:
  structural: "6px"
  elevated: "8px"
spacing:
  section-y: "6rem"
  container-max: "72rem"
  gutter: "1.5rem"
components:
  button-primary:
    backgroundColor: "{colors.crimson}"
    textColor: "{colors.crimson-lit}"
    rounded: "{rounded.structural}"
    padding: "0.75rem 1.5rem"
  button-primary-hover:
    backgroundColor: "{colors.crimson-dark}"
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
  card-surface:
    backgroundColor: "{colors.iron-raised}"
    textColor: "{colors.ember-ash}"
    rounded: "{rounded.elevated}"
    padding: "0"
---

# Design System: Grimoire

## 1. Overview

**Creative North Star: "The Forge at Rest"**

Grimoire is cooled iron with an ember still glowing inside it. The surface is dark,
still, and disciplined — near-black greys layered by tone, hairline borders of the
faintest light — and against that stillness sits a single point of heat: crimson,
used sparingly, the way a live coal reads against cold metal. Nothing here is
decorative. The restraint *is* the brand: the product's own thesis is "the tool
disappears," and the site practices what the app preaches. Warmth is latent, held in
reserve, spent only where it counts.

This system is built for a Game Master evaluating a serious instrument. It must feel
crafted and owned — machined from iron, not assembled from templates. Depth comes from
honest tonal layering (deep → dark → raised) and thin white borders, never from
drop-shadows or glassy blur. Typography carries the atmosphere: a medieval display
face for the spellbook resonance, a clean humanist sans for the working text, a
monospace for the technical, local-first credibility signals. The metaphor of a
grimoire is held *lightly* — in language and type, never in costume.

This system explicitly rejects three things. It is **not a generic SaaS landing**:
no gradient-mesh hero, no three-identical-feature-cards, no big-number hero metrics,
no purple/indigo default. It is **not fantasy kitsch**: no faux-parchment, no dragon
clip-art, no blackletter, no wizard clichés. And it is **not corporate or sterile**:
it has a committed point of view and would never be mistaken for an anonymous B2B tool.

**Key Characteristics:**
- Dark-first, near-black iron surfaces layered by tone, not by shadow
- One committed accent (crimson) as the sole point of heat, used rarely
- Medieval display serif + humanist sans + monospace, each with a distinct job
- Flat, honest depth: hairline borders and tonal steps, zero drop-shadows
- Solid, forged interactions — weighty and deliberate, never flashy

## 2. Colors

A monochrome iron field warmed by a single ember. The palette is two families —
neutral irons and warm embers — with one saturated crimson accent that carries all
the heat.

### Primary
- **Ember Crimson** (`#c2483d`): The sole accent and the only saturated color in the
  system. Reserved for the primary CTA ("Download Grimoire"), the wordmark, feature
  eyebrow labels, and hover-reveal arrows. It is the ember in the forge — its scarcity
  is what gives it force.
- **Forge Crimson** (`#a83228`): The pressed/hover state of Ember Crimson. A deeper,
  cooler red that reads as the coal being pressed, not lit.
- **Crimson Lit** (`#f9f1f0`): A near-white warmed toward crimson, used only as the
  label color *on* a crimson button — the glow at the surface of the heat.
- **Crimson Tint** (`#c2483d1f`) & **Crimson Veil** (`#c2483d3d`): Low-opacity crimson
  washes for subtle fills and text selection highlight.

### Neutral (Iron)
- **Iron Deep** (`#181818`): The base body background. The cold metal everything sits on.
- **Iron Dark** (`#1f1f1f`): One tonal step up — alternating section backgrounds
  (e.g. the Features band) to segment the page without borders alone.
- **Iron Raised** (`#262626`): The highest tonal step — elevated surfaces like the
  screenshot frame. "Raised" is expressed by tone, never by shadow.
- **Iron Border** (`#ffffff14`): A ~8%-white hairline for all borders and dividers.
  The only "light" in the structure.
- **Hover Overlay** (`#ffffff0a`): A ~4%-white wash for hover states on ghost buttons
  and list rows.

### Neutral (Ember Text)
- **Ember Ash** (`#f0ece8`): Primary text — a warm off-white, the color of settled ash.
  Headings and high-emphasis copy.
- **Ember Muted** (`#a39e99`): Secondary/body copy. Passes AA on Iron Deep (~6.6:1).
- **Ember Faint** (`#6b6460`): Tertiary — meta labels, eyebrows, fine print. Low
  contrast on Iron Deep (~3.1:1): permitted for large/label text only, never body.

### Named Rules
**The One Ember Rule.** Crimson is the only saturated color in the system and appears
on ≤10% of any screen. If a second accent hue shows up, or crimson starts filling
regions instead of marking them, the forge has caught fire — pull it back. Its rarity
is the entire point.

**The Tonal Depth Rule.** Elevation is expressed by stepping iron tone (deep → dark →
raised), never by shadow. If a surface needs to feel lifted, move it up the iron ramp
and add a hairline border — do not reach for `box-shadow`.

## 3. Typography

**Display Font:** Metamorphous (with Georgia, serif fallback)
**Body Font:** Nunito Variable (with system-ui, sans-serif fallback)
**Label/Mono Font:** JetBrains Mono (with Consolas, monospace fallback)

**Character:** A three-voice pairing on a deliberate contrast axis. Metamorphous is a
medieval-inflected display serif — it carries the grimoire resonance without tipping
into blackletter kitsch, and it appears *only* at large sizes where its character
reads as craft, not costume. Nunito is a warm, rounded humanist sans that keeps the
working text approachable and highly legible. JetBrains Mono handles the technical
register — the local-first / open-source / platform signals — lending engineered
credibility. Serif + sans + mono are maximally distinct; they never compete.

### Hierarchy
- **Display** (Metamorphous 400, `clamp(2.25rem → 3rem)`, line-height 1.15): The hero
  H1 and section H2s. The spellbook voice. `text-wrap: balance` for even lines.
- **Headline** (Metamorphous 400, `clamp(1.875rem → 2.25rem)`, line-height 1.25):
  Section-level H2s ("The tool disappears. The world remains.").
- **Title** (Nunito 600, `1.125rem`, line-height 1.4): Feature titles and download-row
  labels. Sans, not serif — the working layer starts here.
- **Body** (Nunito 400, `1rem`–`1.125rem`, line-height 1.65): All prose. Ember Muted
  on iron. Cap measure at 65–75ch (the current `max-w-xl`/`max-w-2xl` respects this).
- **Label** (JetBrains Mono 400, `0.75rem`, letter-spacing `0.15em`, UPPERCASE):
  Eyebrows and meta rows ("LOCAL-FIRST · OPEN SOURCE", "01 · NOTES", file formats).

### Named Rules
**The Serif-For-Voice Rule.** Metamorphous is for display sizes only (H1/H2 and the
wordmark). Never set body, buttons, or UI labels in the display serif — at small sizes
its character becomes noise and legibility drops. Working text is always Nunito.

**The Mono-For-Facts Rule.** JetBrains Mono marks the technical, verifiable facts —
platforms, formats, license, the numbered feature index. It signals "this is real and
precise," so don't spend it on ordinary prose.

## 4. Elevation

**Flat by tone, not by shadow.** This system uses **no drop-shadows anywhere**. Depth
is built entirely from a three-step iron tonal ramp and hairline white borders. The
body sits on Iron Deep; secondary bands step to Iron Dark; genuinely elevated surfaces
(the product screenshot) step to Iron Raised and gain a `1px` Iron Border edge. This
reads as honest, modern, and matte — a forged object, not a floating card. Backdrop
blur is used in exactly one place (the sticky nav, `backdrop-blur-sm` over a 95%-opaque
Iron Deep) as a functional legibility aid, never as decorative glassmorphism.

### Named Rules
**The No-Shadow Rule.** `box-shadow` is prohibited as a *depth* device. If a 2014-app
lifted-card look appears, the shadow is the mistake — delete it and step the iron tone
instead. Focus states may use a crimson ring; that is signal, not elevation.

**The Ember-Glow Exception.** One `box-shadow` is sanctioned, and only one: a soft
crimson glow on the **primary CTA** (`.ember-cta`). It reads as *energy* — the ember
earning its name — not as depth: it kindles in on load and intensifies on hover
(`0 12px 34px -10px var(--color-crimson)`). It never appears at rest on cards or
surfaces, and it is never a second color. This is the same "one functional exception"
posture as the nav's backdrop-blur.

## 5. Components

Interactions feel **solid and forged**: weighty, deliberate, machined from iron.
Feedback is confident but never flashy — a color deepens, an overlay warms, an arrow
catches the ember. State transitions run `150ms ease-out`.

**Motion system.** Content is revealed, not decorated. On load the hero plays one
orchestrated staggered entrance (rise + fade, `~90ms` apart, `ease-out-expo`); on
scroll, the product screenshot (a slightly scaled reveal), the feature articles, and
the download rows animate in as content *groups* — never a blanket fade on every
section heading. All reveals are gated on a pre-paint `.js-motion` class, so the
default page (no-JS, reduced-motion, or headless) renders fully visible; motion is
pure enhancement and can never ship a section blank. Reveal timings sit in the
`600–780ms` band on `--ease-out-expo` (`cubic-bezier(0.16, 1, 0.3, 1)`). No bounce,
no elastic, no infinite loops.

### Buttons
- **Shape:** Gently squared corners (`6px`, `rounded-structural`).
- **Primary:** Ember Crimson (`#c2483d`) fill, Crimson Lit (`#f9f1f0`) label,
  semibold. Padding `0.75rem 1.5rem` (hero) or `0.375rem 1rem` (nav). The single
  loudest element on the page — there is only ever one primary in view.
- **Ghost:** Transparent, Ember Muted label. Hover fills with Hover Overlay
  (`#ffffff0a`) and lifts label to Ember Ash. Used for the secondary "View on GitHub".
- **Hover / Focus:** Primary deepens to Forge Crimson (`#a83228`). Provide a visible
  focus-visible ring in crimson for keyboard users.

### Cards / Containers
- **Corner Style:** `8px` (`rounded-elevated`) for the screenshot frame; `6px` for
  smaller structural elements.
- **Background:** Iron Raised (`#262626`) for the one true elevated surface.
- **Shadow Strategy:** None — see Elevation. Lift is tone + border only.
- **Border:** `1px` Iron Border (`#ffffff14`) on all sides. Never a colored side-stripe.
- **Internal Padding:** Content-driven; the screenshot frame clips the image flush.

### Navigation
- **Style:** Sticky top bar, `56px` tall, 95%-opaque Iron Deep with `backdrop-blur-sm`,
  hairline bottom border. Wordmark in Metamorphous crimson at left; links right.
- **States:** Links are Ember Muted, hover to Ember Ash on a Hover Overlay wash. The
  Download link is a compact Primary button. Below `sm`, the "Features" link hides;
  GitHub + Download persist.

### Feature Item (signature)
No cards. Each feature is a bare `<article>`: a mono crimson eyebrow (`01 · NOTES`), a
Nunito semibold title, and an Ember Muted body paragraph, laid out in a two-column grid
with generous asymmetric gutters (`gap-x-16 gap-y-14`). The absence of card chrome is
deliberate — the content stands on typography and space alone.

### Download List (signature)
A bordered list with `divide-y` hairline rows. Each row: OS name (Nunito semibold) at
left, mono file formats (Ember Faint) plus an arrow at right. On hover the whole row
warms with Hover Overlay and the arrow shifts from Ember Muted to crimson — the ember
catching as you reach for it.

## 6. Do's and Don'ts

### Do:
- **Do** keep crimson to ≤10% of any screen — one primary CTA, the wordmark, and small
  labels. Its scarcity is the design (The One Ember Rule).
- **Do** build depth from the iron tonal ramp (`#181818` → `#1f1f1f` → `#262626`) plus
  `#ffffff14` hairline borders. Step the tone; never add a shadow (The No-Shadow Rule).
- **Do** reserve Metamorphous for H1/H2 and the wordmark; set all working text and UI
  in Nunito, and technical facts in JetBrains Mono.
- **Do** use Ember Muted (`#a39e99`, ~6.6:1) for body copy. Keep measure at 65–75ch.
- **Do** provide visible keyboard focus states and honor `prefers-reduced-motion`
  (already scaffolded in `app.css`).

### Don't:
- **Don't** build a **generic SaaS landing**: no gradient-mesh hero, no three-identical
  feature cards, no big-number hero metrics, no purple/indigo palette.
- **Don't** slide into **fantasy kitsch**: no faux-parchment textures, no dragon
  clip-art, no blackletter, no wizard-cliché imagery. The grimoire lives in metaphor
  and type, not costume.
- **Don't** go **corporate/sterile**: no cold enterprise-blue, no personality-free
  safe defaults. This system has a point of view.
- **Don't** use `box-shadow` for depth, or `backdrop-filter` decoratively (the nav is
  the one functional exception).
- **Don't** set body text, buttons, or small UI labels in Metamorphous — legibility
  collapses at small sizes.
- **Don't** use Ember Faint (`#6b6460`, ~3.1:1 on Iron Deep) for anything but large or
  label-sized text. It fails AA for body copy — bump to Ember Muted if in doubt.
- **Don't** add a second saturated accent color. One ember only.
- **Don't** use colored side-stripe borders (`border-left`/`border-right` > 1px) on any
  surface. Full hairline borders or nothing.
