# Grimoire — Design Context

## Core Design Principles

- **GM clarity under pressure** — the interface must never become an obstacle. Information is one action away at all times.
- **The tool disappears, the world remains** — chrome stays invisible. Character lives in empty states, arrival screens, and named world content.
- **Restrained by default, expressive where it counts** — structural UI is purposeful. Arrival moments (splash, empty states, scene dashboard) get richer treatment.
- **Always session-ready, never session-gated** — no explicit session mode. The interface is equally usable for prep and live play without switching posture.

---

## Design Language

### Two Voices

The app has two typographic voices that map to a content boundary:

| Voice  | Font         | Applies to                                      |
| ------ | ------------ | ----------------------------------------------- |
| Tool   | Nunito       | All UI chrome: sidebar, tabs, buttons, metadata |
| World  | Metamorphous | Anything the GM authored: note titles, map names, scene names |

The boundary is **content ownership** — if the app constructed it, Nunito. If the GM named it, Metamorphous. This boundary holds even for the same piece of text in different contexts (a note title in the tab bar uses Nunito; the same title in the editor heading uses Metamorphous).

### Accent System

Five named presets drive `--primary`. All are evocative, never generic — no neutral greys, no corporate blues.

| Preset    | Dark hex  | Light hex |
| --------- | --------- | --------- |
| `crimson` | `#c4685e` | `#8a2e26` |
| `arcane`  | `#a48dd8` | `#5a3fa0` |
| `verdant` | `#7fb38a` | `#2f6b48` |
| `ice`     | `#7faec7` | `#2c6896` |
| `amber`   | `#d3a14a` | `#8a6418` |

`--primary-subtle` (16% opacity) and `--primary-muted` (40% opacity) are derived from `--primary`. There is no separate `--accent` token — `--primary` is the single accent family.

### Color Families

Five semantic families. No sixth family. No decorative color use.

- `--background`, `--background-subtle`, `--background-elevated`, `--background-border`
- `--foreground`, `--foreground-muted` (66%/62% opacity), `--foreground-faint` (42% opacity — sub-AA, decorative only)
- `--primary`, `--primary-foreground`, `--primary-subtle`, `--primary-muted`
- `--error` (`#d4645a` dark / `#a02020` light) — destructive actions, failures
- `--success` (`#6ab187` dark / `#2e6e4a` light) — system confirmations only

### Focus Ring

Tracks `--primary`. 2px solid, 2px offset. Uses `:focus-visible` only.

### Border Radius

| Context                                | Radius |
| -------------------------------------- | ------ |
| Structural (rows, inputs, buttons)     | 6px    |
| Elevated (cards, popovers, palette)    | 8px    |
| Pill tags / chips                      | 100px  |

### Default Theme

Dark. Light and System are available in Settings.

---

## Layout

### App Shell

`[ Icon Rail ] [ Sidebar ] [ Main Content ] [ Right Rail ]`

- **Icon Rail** — always visible, 48px. Brand mark (re-expand to last section), Search, Files (expand + activate file tree), Scenes. Settings lives as a subdued footer icon, not a primary rail item.
- **Sidebar** — docked on ≥1024px (default open), overlay on ≤1023px (default closed).
- **Right Rail** — 300px. Docked on ≥1024px. Overlay on ≤1023px. Mutually exclusive with sidebar overlay (opening one closes the other). In split view, follows focus — shows metadata for the active pane's document.

### Overlay Mutual Exclusion

At ≤1023px, sidebar and right rail are both overlays. They cannot be open simultaneously — opening one closes the other.

### Settings

Opens as a dialog. Not embedded in the sidebar, not a full-screen page.

### Scene Player Panel

Invisible until at least one scene exists in the vault. Once a scene exists, the collapsible panel persists at the bottom of the sidebar scroll area above the footer.

---

## Resolved Decisions

| Decision | Choice | Reason |
| -------- | ------ | ------ |
| Accent token name | `--primary` (not `--accent`) | Aligns with shadcn token model; avoids split naming |
| Ice preset | Intentional | Atmospheric (elemental), not corporate blue |
| Focus ring | Tracks `--primary` | Cohesion; all five presets meet AA on `--background` |
| Default theme | Dark | Crimson accent and warm palette land hardest on dark |
| Session mode | None (ambient) | No explicit trigger; interface is always session-ready |
| Settings location | Dialog | Not sidebar-embedded, not full-screen |
| Right rail at tablet | Overlay, mutual exclusion with sidebar | Avoids double-overlay stacking complexity |
| Right rail in split view | Follows focus | Least surprising; no extra UI needed |
| Border radius base | 6px structural / 8px elevated | "Restrained by default" — 10px reads too consumer-app |
| Scene Player visibility | Hidden until first scene exists | No placeholder noise; Scene Dashboard handles discoverability |
