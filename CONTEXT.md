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

### Details Pane

The right rail, when active. Surfaces metadata for the focused note in the active note pane. Not engaged on map or scene panes (Phase 5 scope). Pin metadata lives in the in-map floating `PinDetailPanel`, not in the Details Pane.
_Avoid_: "right sidebar" (confusable with the left sidebar), "inspector," "properties panel."

### Tag

A colorless, cross-cutting semantic label applied to a note or pin. Vault-global namespace (the same tag string means the same tag everywhere). For notes, tags live in markdown frontmatter; for pins, in SQLite. Never visually color-coded.
_Avoid_: "category" (that's a pin-specific concept), "label" (overloaded with UI labels).

### Pin Category

A per-map visual grouping for pins, defined by name + icon + color. Distinct from a Tag: a Category is a visual identity scoped to one map; a Tag is a semantic label that crosses maps and entity types.
_Avoid_: using "tag" and "category" interchangeably.

### Command Palette

The modal surface (`AppSearch.svelte`) hosting both vault search and command execution. Opened by the Search rail icon or Ctrl/⌘+K. Single canonical surface — there is no separate "search sidebar" or "command-only" palette. Results are rendered in fixed grouped sections: Commands → Tags → Notes → Maps → Scenes. Empty state shows a Recent section above Commands.
_Avoid_: "search modal," "command bar," "quick open" (overloaded with VS Code semantics).

### Search Index

The Tantivy index at `vault/.grimoire/search-index/` powering the Command Palette. Holds one document per searchable entity (note, map, scene); tags are a faceted multi-value field on note documents. Derived from SQLite + the vault filesystem and fully regenerable from a vault scan. SQLite remains the canonical entity store; the Search Index is never the source of truth.
_Avoid_: "search database" (it isn't a database), "fts index" (specific to the rejected FTS5 alternative).

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
| Tag storage authority             | Markdown frontmatter is the source of truth; SQLite is a derived index | Vault must remain portable and tool-agnostic; tags survive a `.grimoire/` wipe because they're regenerable from a vault scan |
| Taggable entities                 | Notes and pins (map markers) only — not maps, scenes, or folders | Phase 5 success criterion is a notes problem; pins benefit from cross-map semantic grouping; scenes already have favorites/dashboard organization |
| Tags vs pin categories            | Coexist as two distinct concepts                          | Pin category is per-map visual identity (name+icon+color); tag is colorless cross-cutting semantic label. They model different intent. |
| Pin tag storage                   | SQLite-authoritative (no markdown backing for pins)       | Pins are already SQLite-authoritative; tags don't introduce new fragility. Asymmetric with note tags by necessity. |
| Tag value shape                   | Flat strings, case-insensitive matching with original-case display, allowlist `a–z 0–9 - _ /`, no aliases | Hierarchy is a rabbit hole (rename semantics, recursive queries, tree UI); flat-with-slashes lets GMs opt into prefix conventions cheaply. Case-insensitive avoids the "Obsidian tag mess" after months of use. |
| Tag authoring (notes)             | Details Pane (right rail) chip editor is primary; app command palette is secondary entry point. No inline `#tag` in the note body. | The Details Pane was empty scaffolding looking for a job; tags + (future) backlinks give it identity. Inline `#tag` collides with hex colors and conflates prose with tool metadata. |
| Details Pane scope (Phase 5)      | Notes panes only. Map panes keep the existing floating `PinDetailPanel` (which gains tag-editing). Scene panes have no rail engagement. | Migrating in-map selection into the rail was a bigger architectural change than Phase 5 warrants. The floating panel works for pins; the rail's job for Phase 5 is "note metadata." Door open for additional pane types later. |
| Rail visibility on non-note panes | Rail collapses to width 0 and its toggle is hidden when the focused pane is not a note (including in split view) | Consistent with "the tool disappears" — if the pane has no Details Pane, no rail chrome is visible. Layout shift on focus change is acceptable because focus moves are intentional. |
| Tag chip editor behaviour         | Autocomplete from vault-global tag list; new tags require explicit "Create new tag: X" affordance in the dropdown; remove via X-on-hover or Backspace; chips display in insertion order; clicking an attached chip does nothing (yet) | Explicit "Create" avoids typo-tags; autocomplete makes the common case (reuse) one-keystroke; insertion order preserves "primary tag first" GM signal; chip-clicks reserved for later behaviour rather than baking in a navigation that might surprise. |
| Tag discovery surface             | Phase 5 ships *no* tag list or filter in the Files sidebar. Tags become discoverable via Search (Phase 6, `tag:foo` syntax) and the graph (Phase 9). | The sidebar list is a substantial UI surface (sorting, counts, grouping) for a discovery problem that Search will solve more flexibly. Avoid a half-built facet that competes with Search. |
| Rename / delete tags (Phase 5)    | Not in Phase 5 — append-only. Bulk operations wait until Phase 6 has the affected-notes list to make rename/delete safe and previewable. | Rename and delete are bulk operations that need a "preview impact" surface to feel safe; building that just for tag management duplicates Search work. |
| Tag garbage collection            | Tags with zero attached notes disappear from autocomplete on next vault scan. No orphan retention. | Index stays trivially regenerable from frontmatter; no "manage orphans" surface needed; revive a tag by typing it again. |
| Frontmatter format                | YAML, `---` delimited, key `tags`, inline array `tags: [npc, allied]`, no `#` prefix, all non-grimoire keys preserved verbatim, frontmatter block created on first tag and removed when last tag goes (if no other keys remain) | YAML/`tags`/no-prefix maximises Obsidian compatibility; inline is compact for typical 2–5-tag notes; preserving unknown keys is non-negotiable for the portability principle. |
| Tag hover display                 | Not in Phase 5 — no tooltip on file-tree rows, no wikilink preview popups | Wikilink hover-preview is a Phase 9 surface; standalone tag tooltips would just add noise to primary navigation. |
| Pin tag storage schema            | `pin_tags(pin_id, tag TEXT)` join table — no separate `tags` table | String values match how note tags appear in YAML; keeps tag value uniform across notes and pins; queryable for "all pins with tag X". |
| Pin Category in floating panel    | Add Pin Category selector to `PinDetailPanel` alongside tag editing (Phase 5)  | Already an open gap in the panel; surfacing it next to tags makes "how is this pin categorised" answerable in one place. |
| Note Details Pane schema (Phase 5)| Three sections, top-to-bottom: Tags chip editor, Folder breadcrumb (display only — no click-to-reveal), Modified (relative time). Nothing else. | The pane must not become a kitchen-sink property sheet. Title/Created/word-count/cover-image/frontmatter-passthrough deferred or rejected. Backlinks slot added in Phase 9. |
| Search surface (Phase 6)          | Single Command Palette modal hosts both vault search and command execution. No sidebar search panel. Search rail icon and Ctrl/⌘+K both open the palette. | Avoids two parallel search surfaces. The rail-icon-opens-modal pattern matches Settings (rail icon opens dialog) — exception is already established. |
| Search engine                     | Tantivy, single index over all entity types; tags as facets on note docs (see [ADR-0004](./docs/adr/0004-tantivy-search-engine.md)) | Fuzzy matching is GM-under-pressure typo tolerance (FTS5 only supports prefix wildcards). BM25 with field boosts and tag faceting also align with Phase 9 graph work. |
| Search result grouping            | Fixed sections in order: Commands → Tags → Notes → Maps → Scenes. Section headers are skipped during keyboard navigation. | Predictable scanning under live-play pressure; flat ranking with type chips forces a per-row identification step. Commands first matches palette muscle memory; Tags before Notes makes tag-filter syntax discoverable. |
| Tag result interaction            | Selecting a Tag result rewrites the query input to apply `tag:foo` as a filter and refreshes results in place. No "tag view" tab is opened. | Honours Phase 5's promise that tags are discoverable via Search and the graph (Phase 9). A Phase 6 tag view would be a degenerate file list, redundant with both the file tree and the future graph. |
| Tag filter composition            | Multiple `tag:` filters compose with **OR**. Free-text terms compose with `tag:` filters as **AND** (filter then search). `tag:npc` alone lists all notes carrying that tag. | OR across tags fits GM prep workflow ("cast a wide net"); AND between filter and text matches every standard search-box mental model (GitHub, Linear, ripgrep). |
| Note result row                   | One row per note, single excerpt (~120 chars centred on first body match), `N matches` chip when match count > 1. Opening from a free-text query scrolls to the match and plays a ~600ms highlight pulse. | Per-match rows let one dense note dominate; multiple excerpts per row create irregular heights. Single excerpt + match chip + scroll-to-match makes the palette an actual navigation tool, not just a list. |
| Empty palette state               | Recent section (cross-entity MRU, ~5 items) above Commands. Recent is the only place where grouping is mixed by entity type. | The most common reason to open the palette is "take me back." Recent is cross-entity because MRU recency matters more than entity type at this point of intent. |
| Initial Commands set              | 8 commands: Create new note/scene/map, Add tag to current note, Open Settings, Toggle theme, Switch vault, Rebuild search index. Append-only as later phases ship. | Curated and small. No contextual/plugin/user-defined commands in Phase 6 — extensibility surface is a separate problem. |
| Rebuild search index affordance   | Command palette only (no Settings entry) | Recovery action, not a setting. Surfacing in Settings creates a "should I rebuild?" worry that doesn't exist when it's a power-user command. |
| Search open-result behaviour      | Plain Enter: active pane, reuse existing tab in either pane. Ctrl/⌘+Enter: force new tab in active pane. Shift+Enter: opposite pane (creates split if needed). | Reuse avoids tab thrash from search-driven navigation; modifiers cover compare-two-views and open-to-the-side cases without a modal-on-modal prompt. |
| Search archived notes             | Excluded by default. Opt-in via `archived:true` (only archived) or `archived:any` (include archived). | Archived means "I deliberately put this out of my way" — default respects that intent; opt-in syntax preserves recoverability. |
| Search typing model               | Fires from char 2, 80ms debounce. Fuzzy on by default with tiered Levenshtein: 0 (<4 chars), 1 (4–7), 2 (8+). | Single chars are too noisy; 80ms is below human perception of lag. Tiered fuzzy keeps short queries focused while typo-tolerant on proper nouns. |
| Pin search (Phase 6)              | Pins are not searchable in Phase 6. They remain editable via the floating `PinDetailPanel`. | Pins are inside maps; flat palette results like "Pin: Captain Ash → in 'Harbor District'" are awkward without map context. The Phase 9 graph is the natural pin-discovery surface. |
