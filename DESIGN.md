---
name: Grimoire
description: A desktop worldbuilding tool for Game Masters — where the tool disappears and the world remains.
colors:
  # Surfaces — Iron palette (dark mode canonical)
  iron-dark: "#1f1f1f"
  iron-deep: "#181818"
  iron-raised: "#262626"
  iron-border: "#ffffff14"
  hover-overlay: "#ffffff0a"
  # Text — Ember palette
  ember-ash: "#f0ece8"
  ember-ash-muted: "#a39e99"
  ember-ash-faint: "#6b6460"
  # Primary accent — Crimson preset (default; five presets are user-switchable)
  crimson: "#c2483d"
  crimson-lit: "#f9f1f0"
  crimson-tint: "#c2483d1f"
  crimson-veil: "#c2483d3d"
  # Light mode surfaces (alt-theme reference)
  parchment: "#faf8f5"
  parchment-subtle: "#f2ede8"
  parchment-border: "#1f1a1d1a"
  # Feedback
  ember-error: "#d4645a"
  verdant-confirm: "#6ab187"
typography:
  display:
    fontFamily: "Metamorphous, Georgia, serif"
    fontSize: "1.875rem"
    fontWeight: 400
    lineHeight: 1.25
  headline:
    fontFamily: "Nunito, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.4
  title:
    fontFamily: "Nunito, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.4
  body:
    fontFamily: "Nunito, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.75
  label:
    fontFamily: "Nunito, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.4
  meta:
    fontFamily: "JetBrains Mono, monospace"
    fontSize: "0.65625rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.05em"
rounded:
  structural: "6px"
  elevated: "8px"
  pill: "100px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.crimson}"
    textColor: "{colors.crimson-lit}"
    rounded: "{rounded.structural}"
    padding: "0 16px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "#a83228"
    textColor: "{colors.crimson-lit}"
    rounded: "{rounded.structural}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ember-ash-muted}"
    rounded: "{rounded.structural}"
    padding: "0 12px"
    height: "36px"
  button-ghost-hover:
    backgroundColor: "{colors.hover-overlay}"
    textColor: "{colors.ember-ash}"
    rounded: "{rounded.structural}"
  input-field:
    backgroundColor: "{colors.hover-overlay}"
    textColor: "{colors.ember-ash}"
    rounded: "{rounded.structural}"
    padding: "0 12px"
    height: "36px"
  tag:
    backgroundColor: "{colors.iron-raised}"
    textColor: "{colors.ember-ash-muted}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
---

# Design System: Grimoire

## 1. Overview

**Creative North Star: "The Cartographer's Study"**

Measured, purposeful, quietly beautiful. Maps and notes share a surface. Utility and mystery inhabit the same room. Like a scholar's workroom lit from outside the frame: the tools are excellent and unpretentious, the work laid out on top of them carries all the magic. Nothing in the room decorates itself.

Grimoire operates across two registers simultaneously. The application shell is a precision instrument — iron surfaces, sparse chrome, functional Nunito type, restrained 150ms transitions. Then the GM names something: a note, a scene, a map. That name appears in Metamorphous and the world materialises. The interface's job is to make that threshold feel like crossing into something the GM owns. Chrome stays invisible. World content carries voice.

This system refuses theatricality. No leather textures, chrome bevels, glowing rune borders, ambient fog overlays, or parchment backgrounds. Those are costumes, not craft. The fantasy is already in the content; the interface needs only to get out of the way. The SaaS productivity aesthetic is equally banned: no rounded card grids, gradient blobs, Inter-on-white onboarding, or Obsidian-with-a-dungeon-icon imitation.

**Key Characteristics:**

- Dark-first. Iron surfaces are the default posture; light mode (Parchment) is a deliberate alt.
- Two-voice typography. Nunito for the tool; Metamorphous for the world. Boundary is content ownership.
- Single user-switchable accent. Five named presets (Crimson, Arcane, Verdant, Ice, Amber). No secondary palette.
- Flat tonal layering. Depth via surface values only; no shadows on structural chrome.
- Restrained component geometry. 6px structural / 8px elevated / 100px pill. Consumer-app softness is refused.
- Motion is purposeful. 150ms ease-out for state changes; nothing bounces.

## 2. Colors: The Iron & Ember Palette

Iron surfaces — warm dark neutrals tinted slightly toward the red-brown axis, never cold grey. Text is ember ash — the warm cream of old paper near a fire. The accent is user-chosen from five named presets; the default is Crimson. Surface neutrals are fixed regardless of preset.

### Primary

- **Crimson** (`#c2483d` dark / `#a83228` light): The default accent. Active states, CTA buttons, links, focus rings, playing pulse, blockquote borders. Present on every screen; dominant on none.
- **Crimson Tint** (`#c2483d1f` / rgba 12%): Selection backgrounds, hover row tints, active sidebar item background.
- **Crimson Veil** (`#c2483d3d` / rgba 24%): Accent borders, secondary tints.
- **Crimson Text** (`#f9f1f0`): Text on a Crimson-filled surface (primary button label).

_Four alternate presets — Arcane (`#9b6bbf` dark), Verdant (`#5c9e6e` dark), Ice (`#5b9ec9` dark), Amber (`#c49a3c` dark) — follow the same three-token structure. All five meet AA contrast on Iron Dark._

### Neutral

- **Iron Dark** (`#1f1f1f`): Main canvas. The default surface for all content areas.
- **Iron Deep** (`#181818`): Sidebar surface. Slightly recessed — establishes the content/chrome boundary.
- **Iron Raised** (`#262626`): Cards, popovers, command palette, toasts. Sits above the main canvas.
- **Iron Border** (`#ffffff14` / rgba 8%): Dividers, subtle borders, input strokes.
- **Hover Overlay** (`#ffffff0a` / rgba 4%): Applied over any surface on hover. Light in dark mode; its inverse (`rgba(31,26,29,0.05)`) in light mode.
- **Ember Ash** (`#f0ece8`): Primary text. Warm cream, not white. Slight amber cast keeps the palette coherent.
- **Ember Muted** (`#a39e99`): Secondary text, inactive labels, metadata, sidebar items at rest. AA contrast on Iron Dark.
- **Ember Faint** (`#6b6460`): Decorative labels, placeholders, section headers. Intentionally sub-AA — non-essential and non-interactive only.
- **Parchment** (`#faf8f5`): Light mode canvas. The warm analogue to Iron Dark.
- **Parchment Subtle** (`#f2ede8`): Light mode sidebar surface.

### Feedback

- **Ember Error** (`#d4645a` dark / `#a02020` light): Destructive actions, failure states. Never decorative. Always paired with a status icon.
- **Verdant Confirm** (`#6ab187` dark / `#2e6e4a` light): System confirmations only. The one non-warm color in the system; its semantic is too universal to refuse.

### Named Rules

**The One Accent Rule.** One accent family, one user-controlled preset. No secondary palette. The primary is present on every screen but dominant on none. If reaching for a second color for decorative reasons, reach for a foreground opacity step instead.

**The No Decorative Color Rule.** Color never categorizes file types, tag categories, or organizes information visually. Only the five semantic families exist. Differentiate with shape, icon, or text.

**The Sub-AA Exception.** Ember Faint (42% opacity) is intentionally below AA contrast. Reserved strictly for non-essential decorative labels, section headers, and placeholders. Prohibited for body text, interactive elements, or any content that conveys meaning.

## 3. Typography: Two Voices

**Tool Font:** Nunito (sans-serif, fallback: system-ui, sans-serif)
**World Font:** Metamorphous (display serif, fallback: Georgia, serif)
**Code Font:** JetBrains Mono (monospace, fallback: Consolas, monospace)

**Character:** Nunito is warm and functional — round terminals without being childlike, comfortable at small UI sizes. Metamorphous is a display face with historical authority; it makes the GM's names feel like they belong to a world that existed before the app. JetBrains Mono is precise and unremarkable — it makes metadata and tags read as technical without competing for attention.

### Hierarchy

- **Display** (Metamorphous 400, 30px / 1.875rem, lh 1.25): Note titles, map names, scene names, sidebar wordmark — anything the GM authored. Never bold; 400 weight only.
- **Headline** (Nunito 600, 16px / 1rem, lh 1.4): Major content headings, modal titles, right rail "Details" header. App-constructed headers only.
- **Title** (Nunito 500, 14px / 0.875rem, lh 1.4): Tab labels, command palette section groupings. Also used at 10.5px uppercase with 0.1em letter-spacing for sidebar section headers.
- **Body** (Nunito 400, 14px / 0.875rem, lh 1.75): Editor prose, sidebar note rows, settings descriptions. Cap at 65–75ch in long-form reading contexts.
- **Label** (Nunito 500, 13px / 0.8125rem, lh 1.4): Buttons, input text, tooltip labels, command palette result items.
- **Meta** (JetBrains Mono 400, 10–10.5px, lh 1.4, ls 0.05em): Tags, right rail metadata (type, folder, date), inline code, section header caps.

### Named Rules

**The Two Voices Rule.** If the app constructed it, Nunito. If the GM named it, Metamorphous. This boundary holds even for the same piece of text in different contexts: a note title in the tab bar is Nunito (tool chrome); the same title as an editor heading is Metamorphous (world content). No exceptions.

**The Fixed Scale Rule.** Type sizes do not change across density settings. Only spacing and component height change. Dense mode is not smaller text — it is less vertical space.

## 4. Elevation

This system is entirely flat. No `box-shadow`. No `drop-shadow` on structural chrome. Depth is achieved through tonal layering: Iron Deep sits below Iron Dark, which sits below Iron Raised. Three surface steps are the complete elevation vocabulary.

This is a direct expression of "the tool disappears." Shadows would make the chrome visible and present. Tonal steps make surfaces legible without drawing attention to the interface itself.

### Surface Hierarchy

- **Iron Deep** (`#181818`) — lowest tier: sidebar, recessed panels, secondary surfaces
- **Iron Dark** (`#1f1f1f`) — base tier: main content canvas, default surface
- **Iron Raised** (`#262626`) — elevated tier: cards, command palette, popovers, dialogs, toasts

### Named Rules

**The Shadowless Rule.** No `box-shadow` or `drop-shadow` on interface chrome. If a surface needs elevation, use Iron Raised background. If it needs separation, use Iron Border. Shadows exist in the GM's world — in scene art, map overlays, atmospheric imagery — not in the tool surrounding them.

## 5. Components

Components respond with precision and without hurry. State transitions are 150ms ease-out. Nothing bounces, nothing overshoots. Every component rests quiet and signals clearly.

### Buttons

- **Shape:** Gently restrained corners (structural 6px). Consistent with all other chrome.
- **Primary:** Crimson fill, Crimson Text label. Height tracks `--row-h` (36px balanced / 44px cozy / 28px dense). Hover: darkens to light-mode Crimson (`#a83228`, ~10% darker). Used for actions that advance the GM's world: create note, create scene, create map.
- **Ghost:** Transparent background, Ember Muted label. Hover: Hover Overlay background, Ember Ash label. Used for cancel, secondary toolbar actions, contextual controls.
- **Destructive:** Ember Error fill. Reserved for irreversible actions after an explicit confirmation step — not a first-touch affordance.
- **Focus:** 2px solid Crimson outline, 2px offset, `:focus-visible` only.
- **Sizing:** Height always tied to `--row-h`. All three density levels supported automatically.

### Tags / Chips

- **Style:** Iron Raised background, Iron Border stroke, JetBrains Mono 10.5px, Ember Muted text, pill radius (100px), 2px 10px padding.
- **Add Tag variant:** Dashed Iron Border, Ember Faint text. Hover: Crimson text, dashed Crimson border.
- **No color-coded tags.** Type differentiation via text and icon only. The One Accent Rule applies here too.

### Cards (Scene Dashboard)

- **Corner Style:** Elevated corners (8px)
- **Background:** Iron Raised
- **Shadow:** None — Shadowless Rule is absolute
- **Border:** Iron Border
- **Internal Padding:** 16px
- **States:** Default, Hover (Hover Overlay layered over Iron Raised), Playing (Crimson Tint background), Loading (generated thumbnail fallback — warm background + music icon, never a broken image or blank)

### Inputs / Fields

- **Style:** Iron Border stroke (1px), Hover Overlay background, structural radius (6px), Ember Ash text
- **Placeholder:** Ember Faint
- **Focus:** 2px solid Crimson outline, 2px offset, `:focus-visible` only
- **Disabled:** 35% opacity, `cursor: default`
- **Height:** Tracks `--row-h`

### Navigation — Icon Rail

Always-visible 48px column on the left edge. Brand mark at top (re-expands sidebar to last active section). Settings icon at bottom — subdued, smaller than primary rail items, pinned to footer. All icon-only elements carry `aria-label`. Active icon: Crimson. Inactive: Ember Muted. Hover: Ember Ash + Hover Overlay.

### Navigation — Sidebar

Iron Deep background. File tree rows at `--row-h` height, 12px horizontal padding (balanced density). Active row: Crimson Tint background, Crimson icon, Ember Ash text. Inactive: transparent background, Ember Muted icon, Ember Ash text. Hover: Hover Overlay. Section headers: uppercase JetBrains Mono 10.5px, Ember Faint, 0.1em letter-spacing.

### Command Palette (Signature Component)

560px wide, horizontally centred over the content area. Iron Raised background, 8px radius. Not a full-screen overlay — the app remains visible behind it. Input auto-focused on open; Esc returns focus to the triggering element. Scene name results render in Metamorphous; all other results and UI chrome in Nunito. Results group by type (Notes, Maps, Scenes) with an uppercase JetBrains Mono category label.

### Scene Player (Signature Component)

Collapsed header: `--row-h` tall, Nunito label, Metamorphous scene name (12px), animated pulse dot (Crimson) when playing. Expanded body: transport row with primary play/pause button (Crimson Tint background, Crimson icon; hover fills solid Crimson), track list with Crimson-gradient level meters. Track hover: level meter hides, a volume range slider appears in its place via grid row swap — no visible layout jump.

## 6. Do's and Don'ts

### Do:

- **Do** use Metamorphous exclusively for GM-authored content: note titles, map names, scene names, splash wordmark. Never on structural app chrome.
- **Do** use tonal surface steps (Iron Deep / Iron Dark / Iron Raised) to convey depth. Three steps are enough; the Shadowless Rule completes the rest.
- **Do** pair every error and success state with a status icon (circle-x / circle-check). Red and green are invisible to ~8% of male users; color alone is not accessible.
- **Do** use Crimson sparingly — active states, primary buttons, links, focus rings. Its scarcity is what makes it read as signal.
- **Do** keep component height tied to `--row-h`. All three density settings are handled automatically.
- **Do** give every icon-only button an `aria-label` — icon rail, toolbar buttons, close buttons, mute toggles.
- **Do** return focus to the triggering element when overlays, dialogs, and command palette close.
- **Do** make empty states purposeful: a Metamorphous headline, one Nunito orienting line, one CTA.
- **Do** use `prefers-reduced-motion` to snap all transitions to instant and replace animated elements (waveform visualizer → static level bar, pulse dot → static dot).

### Don't:

- **Don't** use leather textures, chrome bevels, glowing rune borders, or Diablo-style ornamentation. The game lives in the GM's content, not in the interface chrome.
- **Don't** use parchment backgrounds, ambient fog overlays, or calligraphy fonts as structural UI elements. Atmosphere belongs to the content layer.
- **Don't** apply `box-shadow` or `drop-shadow` to interface chrome. The Shadowless Rule is absolute.
- **Don't** introduce a second accent color. The five presets are a single `--primary` family; they are not a multi-color palette.
- **Don't** use color to categorize files, tags, or folders. Shape and text only.
- **Don't** use Ember Faint (`#6b6460`) for body text or interactive labels. It is sub-AA and reserved for non-essential decorative text.
- **Don't** bold Metamorphous. It is a display face — weight 400 only, always.
- **Don't** use a modal dialog for destructive confirmation. Prefer undo toast (low-stakes) or inline "Delete? / Cancel" (higher-stakes). Modals are disproportionate.
- **Don't** animate CSS layout properties (`width`, `height`, `padding`, `top`, `left`). Transitions use `opacity`, `transform`, and `color` only.
- **Don't** make this look like Obsidian with a TTRPG skin. This is its own thing.
