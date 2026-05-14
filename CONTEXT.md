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

| Voice | Font         | Applies to                                                    |
| ----- | ------------ | ------------------------------------------------------------- |
| Tool  | Nunito       | All UI chrome: sidebar, tabs, buttons, metadata               |
| World | Metamorphous | Anything the GM authored: note titles, map names, scene names |

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

| Context                             | Radius |
| ----------------------------------- | ------ |
| Structural (rows, inputs, buttons)  | 6px    |
| Elevated (cards, popovers, palette) | 8px    |
| Pill tags / chips                   | 100px  |

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

## Domain Terms

### Scene

A named container of audio slots used during tabletop sessions. Scenes have a visual identity (thumbnail), a favorite flag, and an ordered list of slots. They are the primary unit of audio scene-setting during live play.

### Scene Thumbnail

The visual identity of a scene card. Composed of two independent layers:
- **Background layer** — user-uploaded image, or derived accent color when no image is set
- **Icon layer** — a Lucide icon (default or user-overridden) that renders on top of both image and color backgrounds

The icon persists regardless of whether an image is uploaded. Uploading an image replaces the color background only — the icon layer is always present.

### Fallback Thumbnail

The thumbnail treatment when no image has been uploaded: derived accent color + icon. Both layers are independently user-overridable (stored as nullable `thumbnail_color` and `thumbnail_icon` on the scene). `NULL` means "use the derived/default."

### Scene Dashboard

The primary scene management surface, opened via "All Scenes" in the sidebar. Rendered as a tab in the active pane. Displays a grid of scene cards ordered: favorites first, then creation order. Contains a header toolbar with a "+ New Scene" button.

### Scene Editor

The individual scene configuration surface (ScenePane). Opened as a tab. Layout: hero header (thumbnail + scene name overlaid + play controls), then the slot list below. The primary place to manage slots and scene appearance.

### Slot

A single audio source within a scene. Sources are `local` (vault-relative audio file path) or `spotify` (Spotify URI). Slots have per-slot volume, loop toggle, shuffle toggle (Spotify playlists only), and integer order. One scene has many slots; deleting a scene cascade-deletes its slots.

---

## Resolved Decisions

| Decision                          | Choice                                                    | Reason                                                                              |
| --------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Accent token name                 | `--primary` (not `--accent`)                              | Aligns with shadcn token model; avoids split naming                                 |
| Ice preset                        | Intentional                                               | Atmospheric (elemental), not corporate blue                                         |
| Focus ring                        | Tracks `--primary`                                        | Cohesion; all five presets meet AA on `--background`                                |
| Default theme                     | Dark                                                      | Crimson accent and warm palette land hardest on dark                                |
| Session mode                      | None (ambient)                                            | No explicit trigger; interface is always session-ready                              |
| Settings location                 | Dialog                                                    | Not sidebar-embedded, not full-screen                                               |
| Right rail at tablet              | Overlay, mutual exclusion with sidebar                    | Avoids double-overlay stacking complexity                                           |
| Right rail in split view          | Follows focus                                             | Least surprising; no extra UI needed                                                |
| Border radius base                | 6px structural / 8px elevated                             | "Restrained by default" — 10px reads too consumer-app                              |
| Scene Player visibility           | Hidden until first scene exists                           | No placeholder noise; Scene Dashboard handles discoverability                       |
| Vault image layout                | Note images → `vault/images/`; thumbnails → `vault/.grimoire/thumbnails/` | Split by intent: user content vs app metadata (see ADR-0001)        |
| Scene thumbnail icon persistence  | Icon renders on image AND color backgrounds               | Icon is persistent scene identity, not a fallback (see ADR-0002)                    |
| Fallback color derivation         | Hash of scene id → accent preset; nullable override column | Zero-friction default; user can override without uploading an image               |
| Scene Dashboard routing           | Opens as tab in active pane (`scenes://dashboard`)        | Allows split-view with notes during prep; consistent with tab navigation model      |
| Dashboard Spotify controls        | Skip/shuffle/loop shown only when active scene has a Spotify playlist slot | Controls are Spotify playlist controls surfaced at scene level — not scene queue navigation |
| Scene card click                  | Opens scene editor tab; play is a secondary button on card | Thumbnail management kept off dashboard surface (editor or right-click menu only)  |
| Scene ordering in dashboard       | Favorites pinned top, then creation order                 | Most useful default for live play; no `sort_order` column needed                    |
| Playing indicator timing          | Follows `loadingSceneId` (moves on click, before crossfade completes) | 2.5s crossfade feels unresponsive if UI doesn't acknowledge the click immediately |
| Scene card context menu           | 8 actions: Open, Play, Favorite/Unfavorite, Customise (thumbnail/color/icon submenu), Rename, Delete | Full management without navigating to editor |
| Scene editor layout               | Hero header (thumbnail + name + play controls) above slot list | Typical scene has 1–3 slots; hero header doesn't steal meaningful space             |
| Add Scene affordance              | Header button above dashboard grid                        | Toolbar location; allows future search/sort controls alongside it                   |
| Dashboard empty state             | Action-oriented prompt + decorative default thumbnail + CTA button | Passive "no scenes" label is not enough — prompt to create is part of discovery   |
| Mini-player in Phase 2            | Unchanged                                                 | Its value is when scenes are out of focus (GM editing notes); dashboard covers the in-focus case |
| Note image orphan cleanup         | None in Phase 4                                           | Building cross-note reference tracking bleeds Phase 9 (graph/backlinks) work in; defer until orphans are a real problem |
| Image caption ↔ alt text          | Single field — `alt` renders as visible caption below the image when non-empty | One labeling field instead of two; matches how a GM labels a portrait (visible) and incidentally provides a11y |
| SVG support in note images        | Dropped — `images/` allowlist is `jpg, jpeg, png, gif, webp` only | XML-based format with script / external-fetch attack surface; no compelling GM use-case (icons are already Lucide); re-enable later if needed with a sanitizer |
