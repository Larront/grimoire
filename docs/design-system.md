# Grimoire Design System

## Design Principles

Grimoire serves two distinct mental states: slow and creative during worldbuilding prep, fast and pressured during live sessions. Every design decision is tested against both.

**GM clarity under pressure** — the interface must never become an obstacle. When a GM needs to pull up an NPC description mid-session, the information is one action away.

**The tool disappears, the world remains** — chrome stays invisible. Character lives in the moments between work: empty states, arrival screens, named world content.

**Restrained by default, expressive where it counts** — structural UI is clean and purposeful. Key arrival moments (splash, empty states, scene dashboard) get richer treatment without becoming theatrical.

**Always session-ready, never session-gated** — there is no "start session" mode. The interface is equally usable for prep and live play without switching posture. The Scene Player, command palette, and icon rail are always available.

---

## Target Platforms

| Platform           | Priority | Notes                                   |
| ------------------ | -------- | --------------------------------------- |
| Desktop            | Primary  | Full sidebar, docked or collapsed       |
| Tablet (landscape) | Primary  | Sidebar as overlay, full feature parity |
| Tablet (portrait)  | Primary  | Sidebar as overlay, adapted layout      |
| Mobile             | Future   | Not in current scope                    |

Minimum supported viewport: 600px (tablet portrait). 768px and above receives full feature parity. Pointer input is primary; touch is a secondary consideration for tablet.

---

## Accent Theming

Five accent presets ship as named themes. All are evocative, never generic — no neutral greys, no corporate blues. The crimson preset is the default.

| Preset    | Dark hex  | Light hex | Label             |
| --------- | --------- | --------- | ----------------- |
| `crimson` | `#c4685e` | `#8a2e26` | Crimson (default) |
| `arcane`  | `#a48dd8` | `#5a3fa0` | Arcane            |
| `verdant` | `#7fb38a` | `#2f6b48` | Verdant           |
| `ice`     | `#7faec7` | `#2c6896` | Ice               |
| `amber`   | `#d3a14a` | `#8a6418` | Amber             |

Each preset drives the `--primary` CSS variable. The two derived tints are computed from it:

- `--primary` — the accent color itself (buttons, active states, links, icons)
- `--primary-subtle` — 16% opacity tint used for selection backgrounds and hover states
- `--primary-muted` — 40% opacity tint used for borders and secondary accents

In dark mode these are set directly via inline `style`. In light mode each preset maps to a named CSS class (e.g. `.accent-crimson`) because the light-mode hex values differ for contrast.

The accent preset is a user preference stored per vault alongside theme (light/dark) and density.

---

## Visual Identity

### Aesthetic Direction

Middle path between a modern productivity tool and an immersive fantasy artifact. Structural UI is clean and tool-like. Named world content (notes, maps, scenes) carries the fantasy voice.

Think of a luxury book: the text block is readable and functional, but the chapter openers have character.

### Typography

| Role              | Font           | Usage                                                                      |
| ----------------- | -------------- | -------------------------------------------------------------------------- |
| Body / Structural | Nunito         | All UI chrome: sidebar labels, buttons, inputs, settings, metadata         |
| World Content     | Metamorphous   | Note titles, map names, scene names — anything that _belongs to the world_ |
| Code / Mono       | JetBrains Mono | Editor code blocks, inline code, tags (pill labels), monospace metadata    |

The distinction reinforces a mental model: the world has one voice, the tool has another. Metamorphous weight is always 400 (it's a display face — do not bold it).

**Type scale (Nunito):**

- `10.5px` — section headers in sidebar (uppercase, tracked, 0.1em letter-spacing)
- `11–12px` — UI labels, tooltips, right rail metadata
- `12.5px` — tab labels, sidebar note rows
- `14.5px` — body text in editor preview and sidebar rows (default `--font-body`)

**Type scale (Metamorphous):**

- Used at display sizes only (`13px`+). Never below `12px` — it loses legibility.

**Type scale (JetBrains Mono):**

- `9–10.5px` — tags, metadata fields
- `13.5px` — code blocks and inline code in the editor

### Color System

Five semantic families. Shades within each family are allowed. No sixth family.

| Family       | Shades                             | Use                                               |
| ------------ | ---------------------------------- | ------------------------------------------------- |
| `background` | default, subtle, elevated, border  | Surfaces, dividers                                |
| `foreground` | default, muted, faint              | All text and icons                                |
| `primary`    | default, foreground, subtle, muted | Active states, CTAs, links, focus, sidebar active |
| `error`      | default, foreground, subtle        | Destructive actions, failures                     |
| `success`    | default, foreground, subtle        | System confirmations only                         |

Hover states are achieved with a transparent overlay on whichever background surface the element sits on — `rgba(255,255,255,0.04)` in dark mode, `rgba(31,26,29,0.05)` in light mode.

**Surface hierarchy** within the `background` family:

| Variable               | Light                 | Dark                  | Use                                 |
| ---------------------- | --------------------- | --------------------- | ----------------------------------- |
| `--background`         | `#fcfafb`             | `#1f1f1f`             | Main canvas                         |
| `--background-subtle`  | `#f3f1f2`             | `#181818`             | Sidebar surface — slightly recessed |
| `--background-elevated`| `#ffffff`             | `#262626`             | Cards, popovers, raised surfaces    |
| `--background-border`  | 8% foreground opacity | 8% foreground opacity | Dividers, subtle borders            |

**Text** within the `foreground` family:

| Variable             | Light                    | Dark                     | Use                                       |
| -------------------- | ------------------------ | ------------------------ | ----------------------------------------- |
| `--foreground`       | `#1f1a1d`                | `#d9d9d9`                | Primary text                              |
| `--foreground-muted` | `#1f1a1d` at 66% opacity | `#d9d9d9` at 62% opacity | Inactive labels, dimmed items             |
| `--foreground-faint` | `#1f1a1d` at 42% opacity | `#d9d9d9` at 42% opacity | Placeholders, section headers, decorative |

`--foreground-muted` and `--foreground-faint` are opacity tints of `--foreground`, not separate color stops.

**Primary** is accent-preset-driven — it changes based on the user's chosen preset. Values for each preset are in the Accent Theming section. The default (crimson):

| Variable              | Light                      | Dark                       | Use                                     |
| --------------------- | -------------------------- | -------------------------- | --------------------------------------- |
| `--primary`           | `#8a2e26`                  | `#c4685e`                  | Accent color — buttons, icons, links    |
| `--primary-foreground`| `#fcfafb`                  | `#1f1f1f`                  | Text/icons placed on a primary surface  |
| `--primary-subtle`    | `--primary` at 16% opacity | `--primary` at 16% opacity | Selection backgrounds, active row tints |
| `--primary-muted`     | `--primary` at 40% opacity | `--primary` at 40% opacity | Accent borders, secondary tints         |

**Primary owns:**

- Active rail icon
- Active tab (underline indicator)
- Selected sidebar item (background tint)
- Playing audio pulse
- Filled favorite star
- CTA buttons
- Links

**Error and Success** are system feedback only — sparingly. Never use as decorative color. Success (green) is the one non-warm color allowed; its semantic is too universal to fight.

| Variable           | Dark      | Light     |
| ------------------ | --------- | --------- |
| `--error`          | `#d4645a` | `#a02020` |
| `--success`        | `#6ab187` | `#2e6e4a` |

Both are muted and warm-adjacent — they read as semantic signals without clashing against the palette.

**Never:** decorative color use, color-coded file types, more than one accent family.

**Contrast — key pairings:**

The near-neutral palette produces high contrast between text and background. `--foreground-faint` (42% opacity) is intentionally sub-AA — it is only used for decorative, non-essential labels. Never use it for body text or interactive labels.

| Foreground               | Surface          | Hex pairing           | Approx ratio | Status            |
| ------------------------ | ---------------- | --------------------- | ------------ | ----------------- |
| `--foreground` (light)       | `--background` (light) | `#1f1a1d` / `#fcfafb` | ~17:1        | ✓ AAA             |
| `--foreground-muted` (light) | `--background` (light) | —                     | ~5.8:1       | ✓ AA              |
| `--foreground-faint` (light) | `--background` (light) | —                     | ~3.4:1       | ⚠ Large text only |
| `--primary` crimson (light)  | `--background` (light) | `#8a2e26` / `#fcfafb` | ~9.5:1       | ✓ AAA             |
| `--foreground` (dark)        | `--background` (dark)  | `#d9d9d9` / `#1f1f1f` | ~14:1        | ✓ AAA             |
| `--foreground-muted` (dark)  | `--background` (dark)  | —                     | ~5.3:1       | ✓ AA              |
| `--foreground-faint` (dark)  | `--background` (dark)  | —                     | ~3.3:1       | ⚠ Large text only |
| `--primary` crimson (dark)   | `--background` (dark)  | `#c4685e` / `#1f1f1f` | ~5.1:1       | ✓ AA              |

Contrast for non-default accent presets must be verified separately — some may not reach AA on `background` surfaces.

**Error and success require secondary encoding alongside color.** Always pair a status icon (circle-x / circle-check) with error/success copy — never rely on color alone. Red/green colorblindness affects ~8% of males; the color distinction alone is invisible to them.

### Border Radius

Restrained by default. Structural chrome is tight; elevated surfaces get slightly more softness.

| Context                                  | Radius |
| ---------------------------------------- | ------ |
| Sidebar rows, tab bar, inputs, buttons   | 6px    |
| Scene cards, command palette, popovers   | 8px    |
| Toasts                                   | 8px    |
| Pill tags / chips                        | 100px  |

### Motion

**Default:** Swift and purposeful. 150–250ms transitions, ease-out curves. No bounces, no spring physics. The app is a tool, not a toy.

**Atmospheric exceptions** (these can breathe):

- Audio waveform visualizer
- Playing state pulse indicator in sidebar
- Scene crossfade transitions

**Reduced motion** (user toggle in Settings):

- All transitions snap to instant (0ms)
- Waveform visualizer becomes a static level bar
- Playing pulse becomes a static filled dot
- Crossfades still occur in audio — only visual transition is removed

---

## Layout System

### App Shell

Layout from left to right:

```
[ Sidebar ] [ Main Content Area ] [ Right Rail ]
```

The sidebar collapses to a narrow icon rail — the grid responds accordingly.

**Sidebar** — Collapses to icon rail on user toggle.

- On large screens: docked (pushes main content), default open
- On small screens / tablet: overlay (slides over main content), default closed
- Toggle: click the active rail icon or a chevron at the sidebar edge

**Sidebar (expanded)** — Contains all primary navigation. Fixed structure from top to bottom:

1. **Brand header** — Metamorphous wordmark "Grimoire", vault name subtitle, collapse button
2. **Inline search bar** — click to open the command palette
3. **Pinned section** — star icon, flat list of starred/pinned notes (collapsible)
4. **Recent section** — clock icon, up to 5 recently opened notes (collapsible)
5. **Campaign tree** — folder icon, hierarchical file tree (collapsible, with "+" to create)
6. **Scene Player panel** — docked at bottom of scroll area, collapsible (see below)
7. **Footer** — vault select button (current vault name + chevron; click opens vault switcher popover)

**Icon Rail (collapsed state)** — 48px wide, contains:

Main icons (top):
- Brand mark — re-expands sidebar to last active section
- Search icon — triggers Command Palette
- Files icon — expands sidebar and activates the file tree section
- Scenes icon — opens the scenes page

Footer icon (bottom, smaller / subdued):
- Settings — opens the settings dialog (not a full primary rail icon; visually lighter, pinned to bottom of rail)

**Main Content Area** — hosts the active document or view. Supports tabs and split view.

**Right Rail** is toggled independently and adds the third column when visible. In split view it follows focus — the rail reflects the document in the currently active pane.

### Breakpoints

| Name             | Width       | Sidebar Behavior        |
| ---------------- | ----------- | ----------------------- |
| Desktop          | ≥1280px     | Docked, default open    |
| Laptop           | 1024–1279px | Docked, default open    |
| Tablet landscape | 768–1023px  | Overlay                 |
| Tablet portrait  | 600–767px   | Overlay, higher density |

768px and above: full feature parity, sidebar defaults closed on overlay. 600–767px: all features accessible, layout is denser, sidebar always starts closed. Below 600px: untested, not in scope.

### Tabs + Split View

Each content area has a tab bar. Tabs persist open documents

**Split view:** Left/right only, maximum 2 panes. Each pane has its own independent tab bar. The divider is draggable (paneforge). No top/bottom splits. No more than 2 panes.

Primary use case: note open on left, map open on right during a live session.

---

## Component Patterns

### Files Sidebar — Unified File Tree

Notes and maps coexist in the same hierarchical folder tree. File type is communicated by icon shape only — never by color. Both use `--foreground-muted` for the icon, `--foreground` for the label.

- Note icon: document/page icon
- Map icon: map/pin icon
- Folder: chevron + folder icon, toggles open/closed

No type filter toggle. Folders are the only organizational primitive.

### Scene Player (Sidebar Panel)

The Scene Player is a collapsible panel docked at the bottom of the sidebar scroll area, above the footer.

The Scene Player panel is not rendered until at least one scene exists in the vault. Once a scene exists it persists in the sidebar regardless of whether audio is playing.

**Collapsed header** (always visible when a scene exists):

- Chevron toggle, music icon, "Scene" label, scene name (Metamorphous 12px), pulse dot when playing

**Expanded body:**

1. **Transport row** — Play/Pause button (`--primary-subtle` background, `--primary` icon; hover fills solid primary), Stop button, master volume slider
2. **Track list** — one row per audio track in the active scene. Each track:
   - Mute toggle (volume icon, faint → dimmed when muted)
   - Track name
   - Level meter: 3px bar, gradient from `--primary-muted` to `--primary`, animates with volume
   - On hover: meter hides, a range slider appears in its place (grid row swap)

### Right Rail

The Right Rail is a 300px panel on the right edge, toggled via the editor toolbar. It uses `--background-subtle` surface with `--background-border` left border. At viewports ≤1023px it becomes an overlay (slides over main content from the right). The sidebar and right rail overlays are mutually exclusive — opening one closes the other.

**Header:** Metamorphous title "Details", close button.

**Sections** (separated by 16px margin, each with an uppercase 10px label):

1. **Properties** — key/value pairs: Type (icon + text), Folder (monospace), Updated (date), Pinned (star icon or —)
2. **Tags** — pill tags using `--background-elevated` + `--background-border`, JetBrains Mono 10.5px. "Add" pill uses dashed border, `--primary` on hover
3. **Links out** — list of outgoing wiki-links from the current note. Icon + title per link. Hover: `--primary-subtle` background
4. **Backlinks** — list of notes that link to this note. Header + snippet of the linking context (11px italic, faint)

Empty states: short italic faint text ("No outgoing links", "No backlinks yet").

### Wiki-Links

Notes support `[[note-id]]` or `[[note-id|Display Text]]` inline links. In rendered preview:

- Resolved links: `--primary` color, dashed underline (`--primary-muted`), hover fills `--primary-subtle` background
- Broken links (note not found): `--foreground-faint` color, italic, dashed underline

### Scene Dashboard (Scenes Route)

The dedicated Scenes route retains a card-based grid for scene browsing and management (distinct from the in-sidebar Scene Player which handles playback). The dashboard is for creating, deleting, and configuring scenes; the sidebar player is for live session control.

Keep the existing dashboard spec: card grid, thumbnail fallback, four card states (Default/Hover/Playing/Loading), play/pause/skip/shuffle controls.

### Scene Page (Configurator)

Reached by opening an individual scene from the dashboard. This is where slots are configured — audio sources, volume, loop.

Scene name in Metamorphous at the top. Each slot: source label (Nunito), volume slider (primary fill), loop toggle. Waveform visualizer per slot if audio is loaded.

### Command Palette

Triggered by the search rail icon or `Cmd+K` (Mac) / `Ctrl+K` (Windows). Opens as a floating dialog centred on the main content area.

**Behaviour:**

- Input auto-focused on open; `Esc` closes and returns focus to prior element
- Results appear as the user types — no submit required
- Searches across: file names, scene names, map names, note headings
- Results grouped by type (Notes, Maps, Scenes) with a small muted label
- Keyboard navigable: `↑↓` to move, `Enter` to open, `Cmd+Enter` to open in a new tab

**Visual treatment:**

- Background: `--background-elevated` — not a full modal overlay; the app remains visible behind it
- Width: 560px fixed, centred horizontally
- Scene name results: Metamorphous. All other results and UI chrome: Nunito.
- No results state: "Nothing found for '[query]'" — short, non-blaming

The Command Palette is the primary power-user path.

### Arrival Moments / Empty States

Each empty state gets:

- A purposeful spot illustration or atmospheric icon treatment
- A Metamorphous headline
- A Nunito body line orienting the user
- A single primary CTA

**Splash screen:** Metamorphous wordmark "Grimoire", a subtle decorative element (geometric pattern or atmospheric motif), recent vaults list, "Open Vault" and "Create Vault" actions.

**Empty vault:** "Your world awaits" or similar — not generic "No items found."

**No scenes:** Evocative empty state, "Create your first scene" CTA.

**No maps:** "Chart the unknown" or similar. CTA to create a map.

### Settings

Settings opens as a dialog (modal). It is not embedded in the sidebar or a full-screen page.

Settings include:

- **Theme:** Light / Dark / System (default: Dark)
- **Accent:** Crimson (default) / Arcane / Amber / Verdant / Ice
- **Density:** Cozy / Balanced (default) / Dense
- **Reduce motion:** Toggle (off by default, respects OS `prefers-reduced-motion` as initial value)
- Vault-specific config (Spotify client ID, inline helper text explaining how to obtain one)

**Density definitions** — only spacing and component height change. Type sizes are fixed in all modes.

Three density levels, controlled by `data-density` attribute on the root element (or a `.density-*` class). The CSS variable `--row-h` drives all row heights.

| Element                    | Cozy | Balanced (default) | Dense  |
| -------------------------- | ---- | ------------------ | ------ |
| `--row-h` (sidebar rows)   | 28px | 24px               | 21px   |
| `--font-body`              | 15px | 14.5px             | 13.5px |
| `--font-ui`                | 13px | 12.5px             | 11.5px |
| `--pad-x` (editor padding) | 28px | 22px               | 16px   |
| Tab bar height             | 40px | 36px               | 32px   |
| Icon rail icon size        | 20px | 18px               | 16px   |

The three density names replace the previous two-tier Comfortable/Compact model. "Balanced" is the default shipped state.

---

## System States

### Loading

All async operations (file open, audio source connect, vault load) must show a loading state. Do not show empty content and hope it populates.

- **Skeleton screens** for list items and file tree rows: `--foreground-muted` at 20% opacity, `border-radius: md`, width varies per element. Animate with a subtle shimmer (left-to-right gradient sweep, 1.5s loop). Reduced motion: static skeleton, no shimmer.
- **Scene card thumbnails** that are loading show the generated fallback (warm background + music icon) until the image resolves — do not show a broken image or blank space.
- **Audio source connecting**: slot shows a spinner (primary color, 16px) inside the waveform area. Label: "Connecting…"
- **Vault loading on launch**: splash screen remains visible with a subtle loading indicator below the vault list. Do not navigate away until the vault is ready.

### Toasts / Feedback

Single toast component, bottom-right, `z-index` above all content. Stacks if multiple appear (max 3 visible).

- **Success toast**: success icon (circle-check, `success` color) + short confirmation copy. Auto-dismisses after 3s.
- **Error toast**: error icon (circle-x, `error` color) + short failure copy. Persists until dismissed — errors should not auto-dismiss.
- **Undo toast**: used after destructive actions. Shows for 5s with an "Undo" link (primary color). Dismissing without undo makes the action permanent.

Copy voice: short and non-blaming. "Scene deleted" + Undo, not "Scene was successfully deleted." Never say "successfully."

### Destructive Actions

Destructive actions (delete file, delete scene, remove slot) require one of:

1. **Undo toast** (preferred for low-stakes deletion): execute immediately, offer 5s undo. Use for single-item deletes where recovery is straightforward.
2. **Inline confirmation** (for higher-stakes or bulk): replace the action button with "Delete?" / "Cancel" inline — no modal. Use for actions that cannot be undone or affect many items.

Never use a modal for a destructive confirmation — it is disproportionate and blocks the interface.

### Error States

- **Files error**: "Couldn't load your files" + Retry button. Show in the sidebar where the tree would appear.
- **Scenes error**: "Couldn't load scenes" + Retry button. Show in the main content area.
- **Audio disconnect**: slot shows "Source unavailable" label replacing the waveform, with a Reconnect link. The scene continues — other slots that are working are unaffected.
- **Vault load failure** (launch): stay on splash screen, show an error message below the vault list with a Retry option.

---

## Keyboard & Accessibility

### Required Keyboard Shortcuts

| Action               | Mac     | Windows  |
| -------------------- | ------- | -------- |
| Open Command Palette | `Cmd+K` | `Ctrl+K` |
| Close tab            | `Cmd+W` | `Ctrl+W` |
| Toggle sidebar       | `Cmd+\` | `Ctrl+\` |
| New note             | `Cmd+N` | `Ctrl+N` |
| Save (notes)         | `Cmd+S` | `Ctrl+S` |

All keyboard shortcuts must be documented in a Settings help section and discoverable via the Command Palette (typing "/" surfaces command list).

### Focus Management

- All interactive elements receive focus via `Tab` in DOM order
- Use `:focus-visible` only — not `:focus` — to suppress ring on mouse click while preserving it for keyboard
- Focus ring: `--primary`, 2px solid, 2px offset
- After a modal or overlay closes, return focus to the element that triggered it
- Icon rail icons require `aria-label` values (e.g., `aria-label="Files"`, `aria-label="Open command palette"`)
- Sidebar tree items use `role="treeitem"` with `aria-expanded` on folders

### Accessible Names

- Icon-only buttons always have `aria-label`
- Scene cards have `aria-label="[scene name], [playing/paused]"` — the playing state is part of the accessible name

---
