---
name: Grimoire
description: A desktop worldbuilding tool for Game Masters — where the tool disappears and the world remains.
colors:
  # Surfaces — Iron palette (dark mode canonical)
  iron-dark: "#1c1917"
  iron-deep: "#131110"
  iron-raised: "#2a2522"
  iron-border: "#ffeee217"
  hover-overlay: "#fff0e60b"
  # Text — Ember palette
  ember-ash: "#f0ece8"
  ember-ash-muted: "#a39e99"
  ember-ash-faint: "#6b6460"
  # Primary accent — Crimson preset (default; five presets are user-switchable)
  crimson: "#c2483d"
  crimson-lit: "#ffffff"
  crimson-tint: "#c2483d1f"
  crimson-veil: "#c2483d3d"
  # Light mode surfaces (alt-theme reference)
  parchment: "#faf8f5"
  parchment-subtle: "#f2ede8"
  parchment-border: "#1f1a1d1a"
  # Feedback
  ember-error: "#d4645a"
  verdant-confirm: "#6ab187"
  # Graph categorical ramp — dark values; see The Dataviz Exception. The Graph pane is
  # the only consumer, and these are deliberately NOT the accent presets.
  viz-cat-1: "#3987e5"
  viz-cat-2: "#d95926"
  viz-cat-3: "#199e70"
  viz-cat-4: "#c98500"
  viz-cat-5: "#d55181"
  viz-cat-6: "#008300"
  viz-cat-7: "#9085e9"
  viz-cat-8: "#e66767"
typography:
  title:
    fontFamily: "Metamorphous, Georgia, serif"
    fontSize: "2.75rem"
    fontWeight: 400
    lineHeight: 1.15
  display:
    fontFamily: "Metamorphous, Georgia, serif"
    fontSize: "1.75rem"
    fontWeight: 400
    lineHeight: 1.25
  heading-2:
    fontFamily: "Metamorphous, Georgia, serif"
    fontSize: "1.375rem"
    fontWeight: 400
    lineHeight: 1.25
  heading-3:
    fontFamily: "Metamorphous, Georgia, serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.25
  headline:
    fontFamily: "Nunito, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.4
  prose:
    fontFamily: "Nunito, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.7
  field-label:
    fontFamily: "Nunito, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
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
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: 1.4
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
- Three levels of depth. In the page: border only. Floating: raised tone, border, one shared shadow. Modal: a dim scrim, no blur.
- Restrained component geometry. 6px structural / 8px elevated / 100px pill. Consumer-app softness is refused.
- Motion is purposeful. 150ms ease-out for state changes; nothing bounces.

## 2. Colors: The Iron & Ember Palette

Iron surfaces — warm dark neutrals tinted slightly toward the red-brown axis, never cold grey. Text is ember ash — the warm cream of old paper near a fire. The accent is user-chosen from five named presets; the default is Crimson. Surface neutrals are fixed regardless of preset.

### Primary

- **Crimson** (`#c2483d` dark / `#a83228` light): The default accent, and a **signal**: selection (active row, active tab), focus rings, the primary action, what is playing, and the underline that marks a link. Not a text colour for small type, and not decoration.
- **Crimson Tint** (`#c2483d1f` / rgba 12%): Selection backgrounds, active sidebar item background.
- **Crimson Veil** (`#c2483d3d` / rgba 24%): Accent borders, secondary tints.
- **Crimson Text** (`#ffffff`): Text on a Crimson-filled surface (primary button label), 4.9:1.

_Four alternate presets — Arcane (`#9b6bbf` dark), Verdant (`#5c9e6e` dark), Ice (`#5b9ec9` dark), Amber (`#c49a3c` dark) — follow the same structure. Each preset's label-on-fill pair clears 4.5:1: Crimson takes white; Arcane, Verdant, Ice and Amber take near-black, because pale text on a mid-tone fill cannot. **As text on Iron, no preset clears 4.5:1 at small sizes** (Crimson is 3.5:1) — which is the practical reason the accent marks links with an underline rather than colouring their words._

### Neutral

- **Iron Dark** (`#1c1917`): Main canvas. The default surface for all content areas.
- **Iron Deep** (`#131110`): Sidebar surface. Recessed — establishes the content/chrome boundary.
- **Iron Raised** (`#2a2522`): Cards, popovers, command palette, toasts. Sits above the main canvas, 1.15:1 lighter.
- **Iron Border** (`rgba(255,238,226,0.09)`): Dividers, subtle borders, input strokes. Warm-white, not pure white, so it does not read cold on the tinted ramp.
- **Hover Overlay** (`rgba(255,240,230,0.045)`): Applied over any surface on hover. Light in dark mode; its inverse (`rgba(31,26,29,0.05)`) in light mode.

_The ramp was pure grey (`#181818` / `#1f1f1f` / `#262626`, R=G=B) until October 2026, so the warmth this section promised came only from the text and the accent, and its steps sat 1.08:1 apart. It was re-tuned after a side-by-side trial in the running app._
- **Ember Ash** (`#f0ece8`): Primary text. Warm cream, not white. Slight amber cast keeps the palette coherent.
- **Ember Muted** (`#a39e99`): Secondary text, inactive labels, metadata, sidebar items at rest. AA contrast on Iron Dark.
- **Ember Faint** (`#6b6460`): Decorative marks and placeholders. Intentionally sub-AA — non-essential and non-interactive only. Not section headers: a label that names a field (Tags, Category, Backlinks) conveys meaning and takes Ember Muted.
- **Parchment** (`#faf8f5`): Light mode canvas. The warm analogue to Iron Dark.
- **Parchment Subtle** (`#f2ede8`): Light mode sidebar surface.

### Feedback

- **Ember Error** (`#d4645a` dark / `#a02020` light): Destructive actions, failure states. Never decorative. Always paired with a status icon.
- **Verdant Confirm** (`#6ab187` dark / `#2e6e4a` light): System confirmations only. The one non-warm color in the system; its semantic is too universal to refuse.

### Named Rules

**The One Accent Rule.** One accent family, one user-controlled preset. No secondary palette. If reaching for a second color for decorative reasons, reach for a foreground opacity step instead.

**The Signal Rule.** The accent means one of five things: *selected*, *focused*, *the primary action*, *playing*, or *this is a link* (as an underline, never as the words' colour). Anything else stays neutral — create buttons, "you are in the sample", tag and alias pills, callouts, quotes, title rules, toggles in Settings. In a worldbuilding tool nearly every proper noun is a link; when links were painted crimson, the accent was a tenth of the prose and stopped meaning anything at all.

**The No Decorative Color Rule.** Color never categorizes file types, tag categories, or organizes information visually. Only the five semantic families exist. Differentiate with shape, icon, or text.

**The Sub-AA Exception.** Ember Faint (42% opacity) is intentionally below AA contrast. Reserved strictly for non-essential decorative labels, section headers, and placeholders. Prohibited for body text, interactive elements, or any content that conveys meaning.

**The Dataviz Exception.** A node-link graph plots category rather than decorating one, so the Graph pane — and only the Graph pane — may use a categorical ramp. The distinction is whether colour is _data being drawn_ or _chrome being dressed up_: a tag colouring a node in the graph is the former; a tag colouring its own chip in the sidebar is the latter, and stays refused.

The exception is narrow and carries two conditions. **The ramp is its own eight tokens** (`--viz-cat-1` … `--viz-cat-8`, defined in `app.css` with a stepped light-mode set), never the accent presets — those are the GM's choice about the app, not a palette to spend on their data. That prohibition is on the app _assigning_ a preset to encode something; it does not reach a GM _picking_ one. A colour chosen by hand for one pin, one annotation or one scene thumbnail is a decision about their world, not an encoding. All three are picked with one full colour picker (`ColorPicker`) and stored as hex — data, because a colour a ledger remembers must not re-resolve when the accent changes. The defaults they are born with (pin brass, annotation ash) live in `entity-colors.ts`. **Slots are assigned in fixed order over the ledger's sorted tag list and never cycled**; past the eighth tag, colour falls back to Ember Muted rather than wrapping round and giving two tags one identity. The assignment lives in `graph-palette.ts` so that every surface showing a tag's colour — the graph, the filter panel, the Tag Manager — resolves it from one place.

_The channel this exception does not have._ A per-tag node shape was built as the redundant channel and rejected: eight silhouettes at a 16px node read as smudges and cost more legibility than they bought. So in the graph, **colour is the only thing encoding which tag a node carries**, and a node-link diagram is an all-pairs form in which only the first three ramp steps stay separable under red/green colour-blindness. From the fourth tag on, some readers cannot tell two nodes apart by colour. That is accepted, not overlooked: every node is labelled, the filter panel names each tag beside its swatch and can isolate one at a time, hover dims everything but a node's neighbours, and search finds by name. If the graph ever needs to be honest about more than three tags at once, the answer is faceting or folding to "Other" — not a ninth hue, and not a shape channel returning by the back door.

## 3. Typography: Two Voices

**Tool Font:** Nunito (sans-serif, fallback: system-ui, sans-serif)
**World Font:** Metamorphous (display serif, fallback: Georgia, serif)
**Code Font:** JetBrains Mono (monospace, fallback: Consolas, monospace)

**Character:** Nunito is warm and functional — round terminals without being childlike, comfortable at small UI sizes. Metamorphous is a display face with historical authority; it makes the GM's names feel like they belong to a world that existed before the app. JetBrains Mono is precise and unremarkable — it makes metadata and tags read as technical without competing for attention.

### Hierarchy

- **Title** (Metamorphous 400, 44px / 2.75rem, lh 1.15): The note's and template's own title field. The largest type in the app, and the only thing at this size.
- **Display** (Metamorphous 400, 28 / 22 / 18 / 16px for H1–H4, lh 1.25): Note headings, map names, scene names, card names, the sidebar wordmark. Steps ~1.25x apart; more space above a heading than below it. Never bold; 400 weight only.
- **Prose** (Nunito 400, body size + 2px — 16px at Balanced, lh 1.7): Editor prose. The note column is capped at 46rem, about 72ch at this size and the widest measure that still lets an Infobox float beside the text.
- **Headline** (Nunito 600, 16px / 1rem, lh 1.4): Dialog and sheet titles, the detail panel header ("Details", "Pin"). App-constructed headers only.
- **Body** (Nunito 400, 14px / 0.875rem, lh 1.75): Sidebar rows, settings descriptions, the chrome's running text.
- **Label** (Nunito 500, 13px / 0.8125rem, lh 1.4): Buttons, input text, tooltip labels, command palette results.
- **Field label** (Nunito 600, 12px / 0.75rem, Ember Muted, sentence or title case as written): The name above a field or section — Tags, Backlinks, Linked Note, Shape, Recent ledgers. Not uppercase mono: at 10.5px in caps the old treatment was the hardest text in the app to read, on the labels a GM scans for.
- **Meta** (JetBrains Mono 400, 11px, lh 1.4): Data that is genuinely code-like — file paths, inline code, key hints. Not labels.

**The 11px floor.** Nothing in the app is set smaller than 11px.

### Named Rules

**The Two Voices Rule.** If the app constructed it, Nunito. If the GM named it, Metamorphous — *where the name is the subject*: a note's title, its headings, a map or scene name on its own surface, a card's name, the name at the top of a panel. Where a name is one item in a list — backlinks, palette results, pickers, the tab bar, the file tree — it is chrome listing things, and takes Nunito: Metamorphous's display letterforms slow a scan at 13–14px, and spent on every row it stops marking the threshold it exists to mark. Dialog titles are app-constructed and always Nunito.

**The Fixed Scale Rule.** Type sizes do not change across density settings. Only spacing and component height change. Dense mode is not smaller text — it is less vertical space.

## 4. Elevation

Depth has exactly three levels, named by what a surface *does*, not what kind of component it is. Each level has one treatment, and nothing invents a fourth.

| Level | What lives here | Treatment |
| --- | --- | --- |
| **In the page** | Note blocks (infobox, statblock, callout, scene embed), cards, the docked detail rail, the sidebar, sticky bars that belong to their pane | Iron Border, no shadow. Note blocks share one frame: 1px Iron Border, 8px radius, Iron Raised at 40%. |
| **Floating** | Menus, popovers, tooltips, suggestion lists, link previews, the floating detail panel, toasts, controls over the GM's imagery | Iron Raised (`bg-popover`), Iron Border, `shadow-float` |
| **Modal** | Dialogs, the command palette, sheets | A floating surface over `bg-scrim` — a dim, warm-black wash. No blur. |

`shadow-float` and `bg-scrim` are the only two depth utilities (`--elevation-float` and `--scrim` in `src/app.css`, stepped per mode). The shadow carries a real offset and a soft blur: it reads as height, not as a glow.

### Surface Hierarchy

- **Iron Deep** (`#131110`) — lowest tier: sidebar, docked detail rail, recessed panels
- **Iron Dark** (`#1c1917`) — base tier: main content canvas, default surface
- **Iron Raised** (`#2a2522`) — elevated tier: every floating surface, and the 40% wash on note blocks

### Named Rules

**The Three Levels Rule.** A surface is in the page, floating, or modal, and takes that level's treatment exactly. If you are adding a shadow, it is `shadow-float` on a floating surface; if you are blurring a backdrop, don't.

_Why this replaced the Shadowless Rule._ Grimoire used to be "entirely flat": no shadows, depth from tonal steps alone. That was right about decoration and wrong about floating surfaces. The dark ramp's steps are close together by design, so a menu over the editor could not read as *above* it on tone alone, and the rule had been quietly bypassed in about ten places by components that needed exactly that, each with its own ad-hoc shadow. One shared shadow wherever something genuinely floats keeps the intent (the tool does not decorate itself) and loses the inconsistency. The backdrop blur behind dialogs went for the opposite reason: it hid the note a GM was reading behind the palette, and bought nothing.

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

- **Style:** Iron Raised background, Iron Border stroke, Ember Ash text, pill radius (100px). Neutral — a tag is not a signal.
- **Add Tag variant:** Dashed Iron Border, Ember Faint text. Hover: Crimson text, dashed Crimson border.
- **No color-coded tags.** Type differentiation via text and icon only. The One Accent Rule applies here too.

### Cards (Scene Dashboard)

- **Corner Style:** Elevated corners (8px)
- **Background:** Iron Raised
- **Shadow:** None — a card is in the page (§4)
- **Border:** Iron Border
- **Internal Padding:** 16px
- **Behaviour:** The picture is the card's main target and plays / pauses the scene; an always-visible play control sits on it. A labelled Edit button in the footer opens the editor.
- **States:** Default, Hover (border lifts), Playing (Crimson border + filled play control), No image (Iron Raised + the scene's icon, muted — or the GM's chosen colour; never an app-assigned hue)

### Inputs / Fields

- **Style:** Iron Border stroke (1px), Hover Overlay background, structural radius (6px), Ember Ash text
- **Placeholder:** Ember Faint
- **Focus:** 2px solid Crimson outline, 2px offset, `:focus-visible` only
- **Disabled:** 35% opacity, `cursor: default`
- **Height:** Tracks `--row-h`
- **Linked Text Field** (every free-text value in a note block): drawn as text with live links; a click or Enter opens it in place, and Ctrl/Cmd+Enter follows its first link. A one-line value that wraps where it is drawn is edited wrapped, not collapsed to one scrolled line.

### Navigation — Icon Rail

Always-visible 48px column on the left edge. Brand mark at top (re-expands sidebar to last active section). Settings icon at bottom — subdued, smaller than primary rail items, pinned to footer. All icon-only elements carry `aria-label`. Active icon: Crimson. Inactive: Ember Muted. Hover: Ember Ash + Hover Overlay.

### Navigation — Sidebar

Iron Deep background. File tree rows at `--row-h` height, 12px horizontal padding (balanced density). Active row: Crimson Tint background, Crimson icon, Ember Ash text. Inactive: transparent background, Ember Muted icon, Ember Ash text. Hover: Hover Overlay. Section headers: Field label role (Nunito 600, 12px, Ember Muted).

### Command Palette (Signature Component)

560px wide, horizontally centred over the content area. A modal-level surface (§4): Iron Raised, 8px radius, `shadow-float` over a dim scrim. Never blurred — the app remains legible behind it. Input auto-focused on open; Esc returns focus to the triggering element. Results are list rows, so every result — note, map or scene — renders in Nunito (the Two Voices Rule on lists). Results group by type (Notes, Maps, Scenes) under a Field label.

### Slash Menu

What `/` offers in a note. Floating level, 240px wide and at most 300px tall, at the caret — below it, or above when it would not fit — and it follows the caret when the note scrolls.

- **A bare `/`:** Grimoire's own blocks first (Statblock, Scene, Infobox, Timeline, Image, Callout), then Text, then List, under 12px sentence-case headings in Ember Muted. The ten callout types fold into one Callout row; typing a type's name reaches it.
- **Typing:** one ranked list without headings — the label being typed first, then a word of it, then a keyword. A row whose label alone is ambiguous says what it is at its right ("Callout").
- **Statblock rows:** each says what Enter stamps — the vault's default shape or "Blank". Four letters of "statblock" lists the presets beneath it. After a name (`/statblock Goblin`) the first row is a statblock titled with it; presets the name starts sit below, never in Enter's place.
- **Selection:** the row Enter runs is Crimson Tint; the pointer moving onto a row selects it, so one row is lit. No match says "No blocks match …", and Enter then breaks the line.
- **After inserting:** the caret goes into the new block's first field or the line after it — a block is never left selected for the next keystroke to replace. A selected block shows a 2px Crimson outline while the editor has focus.
- **Screen readers:** focus stays in the text, and the editor points at the selected row; groups are named.

### Block Handle

One grip for the whole note, beside whichever block the pointer or caret is on: 18px, 6px radius, Ember Muted, fading in on hover. Ctrl/Cmd+Shift+H raises it from the text; ↑/↓ on it move the block; drag moves it; a click opens its menu.

- **Where:** in one column out in the gutter, level with the block's first line, never over a word. The floor is the pane's edge, not the column's, so a block that breaks out past the column — an encounter of tiled creatures — still gets its grip outside it. A block floated beside the text (an Infobox, an image) takes its grip at its own left edge instead.
- **Which block:** while the GM is on the grip or in its menu, the block is outlined with a neutral rule — crimson stays for *selected*. A bullet's grip holds the whole list item. The grip and its menu name the block by its own name where it has one (a creature, a callout's title, an infobox's), so "Delete Kobold B", not "Delete statblock".
- **Menu:** the slash menu's rows, 240px — Turn into (text blocks only; its types open in a submenu beside the row, focused on the kind the block already is), then Duplicate, Copy as Markdown, Delete in full-strength destructive. Focus opens on the first row and arrows stop at the ends rather than wrapping onto Delete.
- **Feedback:** Delete shows "Deleted … · Undo"; Copy confirms. Keyboard moves are announced. Undo works from the grip. Escape from a menu opened by mouse returns to the text; from one opened by keyboard, to the grip.

### Scene Player (Signature Component)

A scene embedded in a note (`/scene`), played from the note the GM is reading at the table. In the page: the shared note-block frame, with a crimson border while its scene plays.

- **Strip:** Play/Pause/Resume, Stop while active, then the scene — its chip and its Metamorphous name (14px) — which plays and pauses it for the pointer, as a card's picture and a PDF passage do; the button beside it is the keyboard's. The crimson now-playing bars follow the name while it sounds. Then Open beside the note, Change scene, and Expand. No master volume: that is global and lives in the mini player.
- **States are this scene's own.** Paused, playing and loading are asked of this scene (the engine's `sceneState`, which every surface that shows a scene asks), never the engine at large, so one block's controls never answer for another's.
- **Mixer:** one `SceneTrackRow` per track, the row the mini player's track list draws too — play (a preview while the scene is stopped), skip while a Spotify playlist sounds, the label, a source pill that drops when narrow, mute, volume, loop, and shuffle for a Spotify playlist. A track's mute is the engine's, so it shows wherever the track does; muted is drawn louder, not quieter. Collapsed, the mixer is `inert`.

### Mini Player

The scene that is playing, in the sidebar's footer, for a GM whose eyes are on a note. Two rows and nothing more, so the footer never pushes the file tree away. Framed as the in-note player is — a raised panel (`bg-card/40`, 8px radius, a border) whose border is crimson while the scene sounds — so it reads as its own section rather than one more footer row.

- **The scene:** the crimson playing bars (a pause mark when paused, a spinner while starting), the scene's name in Metamorphous (14px), which opens the scene, "Paused" or "Starting" in words when that is true, and **Tracks**.
- **Transport:** Pause/Resume and Stop, then — set apart by a rule — Mute all and the master volume, which is every scene's level. Stop always works, including during a crossfade. Pause ignores a press while a scene starts rather than greying out, so keyboard focus stays put.
- **Which scene:** the one the GM last chose. During a crossfade that is the scene starting, not the one fading out, on every surface.
- **Tracks:** a floating panel beside the sidebar (floating level), one `SceneTrackRow` per track. It used to fold open in the footer and took nearly half the window.
- **Collapsed sidebar:** the Scenes stand-in draws the playing bars while a scene sounds, and that scene's Pause/Resume sits beneath it.
- **Keyboard:** `Ctrl/Cmd+Shift+Space` (or a media play/pause key) pauses and resumes from anywhere; while a scene is active the command palette leads with Pause, Stop audio and Mute all audio.
- **Change scene:** the shared `ScenePicker` in a dropdown, marking the current scene and keeping it until another is chosen. With no scene chosen, the same picker sits inside the block's frame.
- **Empty and missing:** a scene with no tracks can't be started and the strip offers to add some; a deleted scene shows "This scene no longer exists" and Choose a scene, not a player.

### Scene Editor

The scene's own surface (`ScenePane`), built for the table as much as for prep.

- **Header:** a 128px band carrying the scene's picture, or its colour, or neutral Iron Raised (`sceneThumbColors`, as on its card), with the icon, the name in Metamorphous at H1 (28px), and an **Appearance** button. The dark legibility gradient sits only over a picture. Header, transport and tracks share one centred column, so their left edges align.
- **Appearance:** one popover (`ui/popover`, floating level) holding picture, colour and icon, each marking the current choice; it stays open while the GM tries things. Colour is a full picker — a saturation and brightness square, a hue strip, a hex field and Default — the same one pins and annotations use, and the dashboard's Customise dialog; the header follows the drag and the scene saves on release. Any colour is drawn as a preset was, an 18% wash behind the icon with the icon in the colour itself. The button is always visible and takes the floating treatment, because it sits over the GM's imagery.
- **Transport:** pinned under the header while the tracks scroll. It reflects _this_ scene only: Play Scene, then Pause + Stop with the now-playing bars, then Resume + Stop. Play Scene is disabled on a scene with no tracks. The master volume is labelled "Master" and carries a mute.
- **Track rows:** play (which plays that track on its own while the scene is stopped), the name (click to rename), a Nunito source pill, volume, loop, shuffle (Spotify playlists only), and a visible menu (Rename `F2`, Remove `Del`) beside the right-click one. Removing a track is an undo toast. In a narrow pane the row sheds its pill and narrows its slider rather than overlapping.
- **Empty:** a Metamorphous headline, one line, and Add Track as the primary action.

### PDF Scene-links

A Scene-link makes a passage of an adventure PDF play its scene. It is built for the GM at the table: find the passage, play it, in one gesture.

- **Underline:** in the scene's hue, set just below the text (it scales with zoom) so it never crosses the letters. The hue is the one place a scene with no chosen colour still gets one — it pairs the passage with its scene — and `sceneLinkHue` is its only source, for the underline, the bubble's chip and the picker alike.
- **Marker:** a small chip in the page's left margin, beside the line where the link starts: the scene's icon in its hue, or the crimson playing bars while it sounds. It reads from across the table without relying on colour, and it is the link's button and only keyboard stop.
- **Playing:** clicking the passage or the marker plays or stops the scene. A playing passage takes a wash of its hue.
- **Bubble:** on hover or focus, floating level. Play/Stop, master volume (crimson only while this scene plays), the scene's name (opens it beside the PDF), change scene, and Remove with an undo toast. A scene with no tracks cannot be played from a link, and the bubble says why.
- **Scenes in this PDF:** a toolbar list of every link in page order, to jump to or play.
- **Drifted:** a link whose text no longer matches is drawn dashed in Ember Error, with a warning marker and a line in the bubble.

### Image

An image in a note: a map, a handout, a portrait.

- **Placement:** left and right float the image beside the prose that follows (at the Infobox's 640px threshold; below it, the image stands at its side); centre never floats. Width is a percentage of the column.
- **Selected:** a crimson outline on the image, a floating toolbar above it (never over it) — align left, centre, right, View full size, Replace — 28px with tooltips, and a resize handle with a grip on the side the image grows toward, showing the width while it moves. The caption is a Linked Text Field.
- **Missing:** the shared notice — "This image was moved or deleted", the file name, Replace — with no error toast.

### Image Viewer

The image shown to the table, from the Image block (double-click, Enter or Space when selected, or View full size) and the Infobox's portrait. The image fits the window; a click toggles actual size. The backdrop is solid Iron Deep — the one surface that hides the note rather than dimming it, because the note is the GM's prep. No caption is drawn. Close is a 36px floating button; Escape closes, and focus returns to where it was.

### Timeline

Dated events on a vertical spine, read at the table to answer "when?".

- **Date in the margin:** a 7rem column left of the spine, right-aligned against it, Nunito medium in the text colour; in a narrow pane (under 28rem) it moves above the title. The title is Metamorphous 16px beside a hollow node, which turns crimson while the GM is in one of the event's fields.
- **Descriptions:** a closed event with a description shows its first line in Ember Muted and a chevron that opens the rest at 14px on a reading line height; an event without one shows nothing at rest and offers "Add description" on hover or focus.
- **Frame and rows:** the shared note-block frame; rows are the Row List's. A blank event is never written to the file, and one left without typing is dropped.

### Infobox

A compact panel of facts about the note's subject — a wiki infobox — floated beside the prose when the column is wide enough, stacked above it when not.

- **Rows:** one label column for the whole panel, as wide as its longest label (up to 45%), labels in Ember Muted and values in the text colour, both Nunito 12px; values take the rest and wrap. Rows sit 4px apart, so a label that wraps reads as one label. Fields stay wrapped while edited.
- **Title:** optional, Metamorphous. An untitled panel draws no title line.
- **Adding:** "Add a title", Add image and Add row float above the panel's top-right corner on hover or focus, at the floating level — nothing inside the panel is kept for controls it is not showing.
- **Row controls:** each row's moves and delete sit behind one "⋯" (the Row List's menu form); a gutter of three took 29% of a floated panel.
- **Portrait:** View full size, Replace and Remove float on the thumbnail on hover or focus. After Remove, focus goes to Add image and "Image removed. Ctrl+Z to undo" is announced.

### Row List

The rows of a timeline, an infobox and a statblock's edit mode.

- **Inserting:** hovering the gap between two rows draws a dashed line where the new row will land, with a plus on it (on the spine, in a timeline); only the plus inserts. The gap is real space (`--row-gap`, the block's to set) and the hover zone is that space alone, never over a row's words or links. Alt+Enter inserts below the focused row. A labelled "Add …" ends the list, quiet while reading and always shown when the list is empty; a block with its own Add may leave it out.
- **Row controls:** Move up (Alt+↑), Move down (Alt+↓) and Delete, 24px with tooltips, in a gutter at the row's right — in the flow, so they never cover the row's words — revealed on hover or focus. A narrow block takes them as one "⋯" menu per row instead, which also offers Insert below.
- **Focus and speech:** focus follows the row through a move and goes into the next row after a delete; moves and deletes are announced, and rows are named by their content.

### Statblock

A creature to play on mid-fight, and a reference card the rest of the time. One mode, scoped to structure (ADR-0016 §6).

- **View mode plays pools and marks, and nothing else.** Every other value reads as text and is edited behind the pencil with the rest of the creature's definition: a value that changes in play is written as a pool (`HP: 43/59`) or a mark track (`Conditions: [ ] Prone`).
- **Pool:** the current value is a chip (Iron Border, 6px radius) inside a 28px target; the maximum is drawn, never targeted. Typing shows what Enter will do (`→ 56`), refuses junk in Ember Error rather than closing, and Enter or Escape returns focus to the chip.
- **Marks:** 16px boxes with a 24px reach and an Ember Muted border; the word beside a box ticks it too. A ticked box fills with the foreground colour — not crimson, which the Signal Rule keeps for playing, active and selected.
- **Names:** every control is named for the creature and the GM's label ("Kobold A HP, 3 of 5"), and a polite announcement says what each hit or tick did. Ctrl+Z works from the chip.
- **Chrome:** collapse, width, save-as-preset and edit, 28px each with tooltips, revealed on hover or focus. Edit mode turns the frame dashed crimson.
- **Encounters:** narrowed creatures in a callout tile; the callout grows past the prose column to as many 24rem creatures as the pane fits, up to three, its width snapped to whole cards.

### Volume Slider

One component (`VolumeSlider`) for every level in the app: the scene editor, the in-note player, the mini player and the PDF scene-link bubble.

- **Construction:** the real range input sits over a drawn track at opacity 0 and is the only thing the pointer touches. This keeps several sliders on the same level in step, and it stays. The input fills its 20px-tall wrapper, which is the hit area.
- **Drawing:** a 4px track, a fill and a 12px handle. The fill and handle are **crimson only while the audio the slider sets is playing** (the Signal Rule's _playing_), and neutral at rest.
- **Access:** every slider has a name ("Master volume", "Heavy Rain volume") and a value in percent. A keyboard focus ring is drawn on the track.

## 6. Do's and Don'ts

### Do:

- **Do** use Metamorphous for GM-authored names where the name is the subject: note titles and headings, map and scene names on their own surfaces, card names, the splash wordmark. In lists, menus, tabs and dialog titles, Nunito.
- **Do** place every surface at one of the three levels (§4) and give it that level's treatment — border in the page, `shadow-float` floating, scrim for modal.
- **Do** pair every error and success state with a status icon (circle-x / circle-check). Red and green are invisible to ~8% of male users; color alone is not accessible.
- **Do** use Crimson only as a signal — selection, focus, the primary button, playing, and link underlines. Its scarcity is what makes it read as signal.
- **Do** keep component height tied to `--row-h`. All three density settings are handled automatically.
- **Do** give every icon-only button an `aria-label` — icon rail, toolbar buttons, close buttons, mute toggles.
- **Do** return focus to the triggering element when overlays, dialogs, and command palette close.
- **Do** make empty states purposeful: a Metamorphous headline, one Nunito orienting line, one CTA.
- **Do** use `prefers-reduced-motion` to snap all transitions to instant and replace animated elements (waveform visualizer → static level bar, now-playing bars → still bars).

### Don't:

- **Don't** use leather textures, chrome bevels, glowing rune borders, or Diablo-style ornamentation. The game lives in the GM's content, not in the interface chrome.
- **Don't** use parchment backgrounds, ambient fog overlays, or calligraphy fonts as structural UI elements. Atmosphere belongs to the content layer.
- **Don't** hover or select with `bg-muted`. It is the same Iron Raised as a card, a popover and a menu, so on any of them it draws nothing. Hover takes the Hover Overlay (`bg-surface-hover`) on any surface; the active row of a list or menu takes Crimson Tint (`bg-surface-selected`).
- **Don't** invent a shadow. If a surface floats it takes `shadow-float`; if it is in the page it takes none. No `backdrop-blur` anywhere.
- **Don't** introduce a second accent color. The five presets are a single `--primary` family; they are not a multi-color palette.
- **Don't** use color to categorize files, tags, or folders. Shape and text only.
- **Don't** use Ember Faint (`#6b6460`) for body text or interactive labels. It is sub-AA and reserved for non-essential decorative text.
- **Don't** bold Metamorphous. It is a display face — weight 400 only, always.
- **Don't** use a modal dialog for destructive confirmation. Prefer undo toast (low-stakes) or inline "Delete? / Cancel" (higher-stakes). Modals are disproportionate.
- **Don't** animate CSS layout properties (`width`, `height`, `padding`, `top`, `left`). Transitions use `opacity`, `transform`, and `color` only.
- **Don't** make this look like Obsidian with a TTRPG skin. This is its own thing.
