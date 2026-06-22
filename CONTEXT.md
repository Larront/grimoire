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

Invisible until at least one scene exists in the ledger. Once a scene exists, the collapsible panel persists at the bottom of the sidebar scroll area above the footer.

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

A single audio source within a scene. Sources are `local` (ledger-relative audio file path) or `spotify` (Spotify URI). Slots have per-slot volume, loop toggle, shuffle toggle (Spotify playlists only), and integer order. One scene has many slots; deleting a scene cascade-deletes its slots.

### Details Pane

The pane-local detail surface for a pane's active entity, rendered by the shared `DetailPanel` shell. Each pane owns its own surface, toggled independently by the user (see [ADR-0006](./docs/adr/0006-pane-local-detail-surface.md)). Presentation is width-based: **docked** (rail on the pane's right edge) when the pane is wider than the dock threshold (~820px), **floating** (anchored overlay) when narrower. Maps always float so the surface never shrinks or occludes the canvas. With no split, the single full-width pane's docked rail sits at the window edge, identical to the former app-level rail. Bodies differ per entity (`NoteDetails`, `PinDetails`, `AnnotationDetails`); the shell, section kit, controlled edit contract, and tokens are shared.
_Avoid_: "right sidebar" (confusable with the left sidebar), "inspector," "properties panel," "app-level rail" (it is pane-local now).

### Command Bindings

The generated, committed TypeScript file (`src/lib/bindings.gen.ts`) that tauri-specta emits from the Rust `#[tauri::command]` definitions — one typed async function per command, plus the shared type mirrors. Never hand-edited; regenerated by running the app in debug (export happens in `run()` under `#[cfg(debug_assertions)]`). See [ADR-0009](./docs/adr/0009-tauri-specta-typed-command-bindings.md).
_Avoid_: "the API" (overloaded), "stubs," "the invoke layer" (that's the wrapper below).

### Command Wrapper

The single hand-written boundary module (`$lib/api`) that re-exports the Command Bindings with the project's error posture applied and carries the few commands specta can't type (the `create_annotation` arity carve-out). Frontend code imports commands from here, **never** from `bindings.gen.ts` directly. Two surfaces (see [ADR-0010](./docs/adr/0010-command-error-posture.md)): **`api.*`** toasts a GM-friendly message on failure then rethrows; **`api.silent.*`** logs then rethrows (no toast) — for background work with its own error UI (the [[details-source]] modules) and fire-and-forget calls. Both always log and rethrow, so no command fails without a trace or silently proceeds as if it succeeded.
_Avoid_: "service layer," "client" — it is a thin posture-and-carve-out adapter over generated code, not a service.

### Error Code

A stable `ERR_CODE:` prefix a Rust command puts on its error string for the small set of failures that are genuinely actionable by the GM (currently `ERR_NAME_TAKEN`, `ERR_UNSUPPORTED_IMAGE`, `ERR_SPOTIFY_AUTH`). The [[command-wrapper]] matches the prefix to friendly copy; everything else gets one generic line. A convention, not a typed enum (see ADR-0010). The raw detail is always logged, never shown to the GM.
_Avoid_: "error enum" (it is a string convention), "error type."

### Details Source

The per-entity reactive module that feeds a Details Pane body. It owns everything between the body and the backend: the fetch fan-out (tags, aliases, collisions, backlinks, outbound links, categories…), the refresh invariants ("alias save → re-check collisions", "any note save → reload backlinks via linksTick"), and the save-status machine the `DetailPanel` shell renders. One per entity kind (`note-details-source.svelte.ts`, `pin-details-source.svelte.ts`), instantiated by the pane, feeding the body through ADR-0006's controlled props. Bodies never fetch; panes never choreograph. The pin source covers auxiliary data only — the pin row itself (position, patches via `update_pin`) stays with MapPane, which the canvas needs for rendering.
_Avoid_: "details store" (it is instantiated per pane, not a global singleton), "controller" (MVC connotations the codebase doesn't use), "details data" (says nothing about owning invariants).

### Tag

A colorless, cross-cutting semantic label applied to a note or pin. Ledger-global namespace (the same tag string means the same tag everywhere). For notes, tags live in markdown frontmatter; for pins, in SQLite. Never visually color-coded.
_Avoid_: "category" (that's a pin-specific concept), "label" (overloaded with UI labels).

### Pin Category

A per-map visual grouping for pins, defined by name + icon + color. Distinct from a Tag: a Category is a visual identity scoped to one map; a Tag is a semantic label that crosses maps and entity types.
_Avoid_: using "tag" and "category" interchangeably.

### Template

A static markdown file stored in `ledger/.grimoire/templates/`. Its filename (minus `.md`) is its display name in the template picker. When used to create a note, the file's full content — including any frontmatter (e.g. `tags: [npc]`) — is copied verbatim into the new note. No variable substitution.
_Avoid_: "note template" (redundant — templates always produce notes), "snippet" (implies fragment, not a full document structure).

### Templates Section

The collapsible section at the bottom of the Files sidebar that lists all files in `ledger/.grimoire/templates/`. Provides inline rename and delete, and a "+" header button to create new templates. Distinct from the note/map file tree — templates are not part of the ledger note hierarchy.

### Command Palette

The modal surface (`AppSearch.svelte`) hosting both ledger search and command execution. Opened by the Search rail icon or Ctrl/⌘+K. Single canonical surface — there is no separate "search sidebar" or "command-only" palette. Results are rendered in fixed grouped sections: Commands → Tags → Notes → Maps → Scenes. Empty state shows a Recent section above Commands.
_Avoid_: "search modal," "command bar," "quick open" (overloaded with VS Code semantics).

### Derived Index

The collective name for the four indexes derived from a note's content that must stay consistent with it on every note write: the tag index (`note_tags`), the Link Index (`note_links`), the alias index (`note_aliases`), and the Search Index (Tantivy). SQLite-backed derived indexes are canonical-adjacent and written transactionally; the Search Index is regenerable and non-fatal (see ADR-0004/0005). Reconciling all four against a note's content is the job of the `note_index` module's `reconcile`/`remove` operations — no command updates them piecemeal.
_Avoid_: "secondary index" (general DB term), "cache" (implies disposability; the SQLite-backed ones are authoritative for their relation).

### Search Index

The Tantivy index at `ledger/.grimoire/search-index/` powering the Command Palette. Holds one document per searchable entity (note, map, scene); tags are a faceted multi-value field on note documents. Derived from SQLite + the ledger filesystem and fully regenerable from a ledger scan. SQLite remains the canonical entity store; the Search Index is never the source of truth.
_Avoid_: "search database" (it isn't a database), "fts index" (specific to the rejected FTS5 alternative).

### Link Index

The SQLite `note_links(source_id, target_path)` table tracking every wikilink extracted from note content. `source_id` is the authoring note's SQLite id; `target_path` is the raw `[[...]]` text as written (path-keyed, not id-keyed). Rows where `target_path` matches no `notes.path` or `note_aliases.alias` represent links to Stub Notes. Populated incrementally on every `save_note`; fully regenerable from a ledger scan on `open_ledger`. See [ADR-0005](./docs/adr/0005-link-index-path-keyed.md).
_Avoid_: "backlinks table," "link database."

### Backlink

An inbound wikilink: a note that references the current note via `[[...]]` syntax. Surfaced in the Details Pane (Backlinks section) and the Graph Pane. The opposite of an Outbound Link.
_Avoid_: "incoming link," "inbound reference."

### Outbound Link

A wikilink authored in the current note body that points to another note. Displayed in the Details Pane below Backlinks. Broken outbound links (pointing to Stub Notes) are shown dimmed with a "not yet created" indicator.
_Avoid_: "forward link."

### Stub Note

A note that is referenced by a wikilink but does not yet exist on disk. Stub notes appear in the Graph Pane as dimmer, smaller nodes. Clicking a stub node in the graph creates the note with the link text as its title and opens it in the active pane.
_Avoid_: "ghost note," "missing note," "placeholder note."

### Orphan Note

A note with no inbound or outbound wikilinks. Appears in the Graph Pane as a disconnected node. Not hidden by default.
_Avoid_: "unlinked note," "isolated note."

### Note Alias

An alternative name for a note, usable in wikilink resolution. Stored in frontmatter (`aliases: [...]`), indexed in the SQLite `note_aliases(note_id, alias TEXT)` table. When typing `[[alias text]]`, the wikilink suggestion dropdown shows the note whose alias matches. Wikilink-resolution-only — aliases do not affect how the note title displays anywhere in the app.
_Avoid_: "note nickname," "alternate title."

### Graph Pane

The ledger-wide force-directed graph. Opened as a tab (one max — opening when a graph tab already exists navigates to it). Entry points: Graph rail icon (opens the pane directly, no sidebar step) or the *Open graph view* command. Nodes represent notes (including Stub Notes) and maps; edges represent wikilinks (note→note) and pin references (map→note via `pins.note_id`). Rendered with Cytoscape.js.
_Avoid_: "knowledge graph" (too broad), "graph view tab."

### Timeline

An inline note widget that displays an ordered sequence of Timeline Events. Authored in the note body via the `/timeline` slash command and rendered as a custom TipTap block. Its data lives in the note's own markdown (it is note content, not a referenced entity), serialized as a fenced ` ```timeline ` code block so the events stay legible in any markdown tool. A note may contain more than one Timeline.
_Avoid_: "timeline entity" (it is not SQLite-backed like a Scene), "history" (overloaded with undo).

### Timeline Event

A single entry in a Timeline. Has a **date label** (free-text — "3rd of Frostfall", never a parsed calendar date), a **title**, and an optional **description**. Title and description are plain strings that may contain literal `[[wikilinks]]`, which render as clickable links and feed the Link Index, Backlinks, and Graph exactly like prose wikilinks. Events have no chronological sorting — their order is the order the GM arranges them.
_Avoid_: "milestone," "entry" (too generic).

### Splash

The full-window arrival screen shown whenever no ledger is open (`src/routes/+page.svelte`). Three states: **first-time** (no recent ledgers — hosts the onboarding entry), **returning** (Recent Ledgers list), and **creating** (new-ledger form). Distinct from the empty-ledger home (*"Every world begins with its first note"*), which shows when a ledger is open but holds no notes.
_Avoid_: "welcome screen," "start page," "home" (the empty-ledger home is a separate surface).

### Sample Ledger

A bundled, pre-populated example ledger the app copies to disk so a first-time GM can explore a living world — interlinked notes, a map, a timeline, a few scenes — before building their own. Surfaced via the *Explore an example world* action on the first-time Splash. Tool-voice noun; user-facing copy always says "world," never "sample ledger."
_Avoid_: "demo ledger," "template ledger" (a Template produces a single note, not a ledger), "tutorial" (it teaches by exploration, not a guided tour).

### PDF

A document file the GM keeps in the ledger, surfaced in the Files tree and opened read-only in a `PdfPane` tab. Path-addressed, not a SQLite entity (see [ADR-0011](./docs/adr/0011-pdfs-path-addressed-not-entities.md)): the tab carries the ledger-relative path the way a Template tab carries `templatePath`, never an integer id. Rendered with PDF.js ([ADR-0012](./docs/adr/0012-pdfjs-over-native-webview-viewer.md)). PDFs enter the ledger by filesystem drop-in or by folder-targeted drag-and-drop onto the Files tree (bytes copied in). The PDF feature includes [[Scene-link]] annotations, built last in the same effort.
_Avoid_: "Document" (premature generalization — there is no epub/docx roadmap), "attachment," "handout" (a use-case, not the entity).

### Scene-link

A Scene attached to a range of selected text inside a [[PDF]] — the one form of PDF annotation in scope. The GM selects text and links a Scene; the text gains a Scene-accent-tinted underline (with a trailing scene icon, and an active state while its Scene plays). Hovering the underlined span reveals an inline bubble toolbar (▶ Play/Stop · master volume · Scene name → opens the Scene editor, with a change-dropdown whose footer offers _＋ New scene_ · Remove). Anchored to a character range on a page (`pdf_scene_links(id, pdf_path, page, start_offset, end_offset, quote, scene_id, created_at)`), stored canonically in SQLite, keyed by the PDF path (the one piece of non-regenerable PDF state). `ON DELETE CASCADE` on `scene_id` removes the link when its Scene is deleted. This is the only inbound dependency a PDF places on a Scene.
_Avoid_: "highlight" (the visual treatment, not the entity; and generic highlighting is explicitly out of scope), "PDF annotation" used loosely (a Scene-link is the *only* annotation kind), "bookmark."

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
| Detail surface placement (ADR-0006) | Pane-local; width-based dock (≥~820px) / float (<~820px); maps always float | Supersedes "follows focus." Each pane owns its surface; symmetry removes the split-view arbitration; width preserves editor space without regressing the no-split docked case |
| Detail surface multiplicity        | Per-pane, user-controlled; 0/1/2 surfaces may be open at once (incl. two floating map panels) | The GM owns their information load — see everything during prep, close panels for focus. Tool does not auto-hide to enforce restraint |
| Border radius base                | 6px structural / 8px elevated                             | "Restrained by default" — 10px reads too consumer-app                              |
| Scene Player visibility           | Hidden until first scene exists                           | No placeholder noise; Scene Dashboard handles discoverability                       |
| Ledger image layout                | Note images → `ledger/images/`; thumbnails → `ledger/.grimoire/thumbnails/` | Split by intent: user content vs app metadata (see ADR-0001)        |
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
| Tag storage authority             | Markdown frontmatter is the source of truth; SQLite is a derived index | Ledger must remain portable and tool-agnostic; tags survive a `.grimoire/` wipe because they're regenerable from a ledger scan |
| Taggable entities                 | Notes and pins (map markers) only — not maps, scenes, or folders | Phase 5 success criterion is a notes problem; pins benefit from cross-map semantic grouping; scenes already have favorites/dashboard organization |
| Tags vs pin categories            | Coexist as two distinct concepts                          | Pin category is per-map visual identity (name+icon+color); tag is colorless cross-cutting semantic label. They model different intent. |
| Pin tag storage                   | SQLite-authoritative (no markdown backing for pins)       | Pins are already SQLite-authoritative; tags don't introduce new fragility. Asymmetric with note tags by necessity. |
| Tag value shape                   | Flat strings, case-insensitive matching with original-case display, allowlist `a–z 0–9 - _ /`, no aliases | Hierarchy is a rabbit hole (rename semantics, recursive queries, tree UI); flat-with-slashes lets GMs opt into prefix conventions cheaply. Case-insensitive avoids the "Obsidian tag mess" after months of use. |
| Tag authoring (notes)             | Details Pane (right rail) chip editor is primary; app command palette is secondary entry point. No inline `#tag` in the note body. | The Details Pane was empty scaffolding looking for a job; tags + (future) backlinks give it identity. Inline `#tag` collides with hex colors and conflates prose with tool metadata. |
| Details Pane scope                | Superseded by ADR-0006. Was notes-only (Phase 5); now the shared `DetailPanel` engages on note and map panes via pluggable bodies (`NoteDetails`, `PinDetails`, `AnnotationDetails`). Scene/graph/empty panes have no surface. | ADR-0003 left the door open to extend the rail to other pane types; ADR-0006 opens it by unifying the three drifted surfaces behind one shell. |
| Rail visibility on non-note panes | Superseded by ADR-0006. A pane shows its surface only when it has an entity to describe (note, or map with a pin/annotation selected) and the user has it toggled open; otherwise the docked region collapses to width 0. | Per-pane user-controlled visibility replaces the global "hide on non-note focus" rule. "The tool disappears" still holds — an empty surface collapses — but the user, not focus, decides. |
| Tag chip editor behaviour         | Autocomplete from ledger-global tag list; new tags require explicit "Create new tag: X" affordance in the dropdown; remove via X-on-hover or Backspace; chips display in insertion order; clicking an attached chip does nothing (yet) | Explicit "Create" avoids typo-tags; autocomplete makes the common case (reuse) one-keystroke; insertion order preserves "primary tag first" GM signal; chip-clicks reserved for later behaviour rather than baking in a navigation that might surprise. |
| Tag discovery surface             | Phase 5 ships *no* tag list or filter in the Files sidebar. Tags become discoverable via Search (Phase 6, `tag:foo` syntax) and the graph (Phase 9). | The sidebar list is a substantial UI surface (sorting, counts, grouping) for a discovery problem that Search will solve more flexibly. Avoid a half-built facet that competes with Search. |
| Rename / delete tags (Phase 5)    | Not in Phase 5 — append-only. Bulk operations wait until Phase 6 has the affected-notes list to make rename/delete safe and previewable. | Rename and delete are bulk operations that need a "preview impact" surface to feel safe; building that just for tag management duplicates Search work. |
| Tag garbage collection            | Tags with zero attached notes disappear from autocomplete on next ledger scan. No orphan retention. | Index stays trivially regenerable from frontmatter; no "manage orphans" surface needed; revive a tag by typing it again. |
| Frontmatter format                | YAML, `---` delimited, key `tags`, inline array `tags: [npc, allied]`, no `#` prefix, all non-grimoire keys preserved verbatim, frontmatter block created on first tag and removed when last tag goes (if no other keys remain) | YAML/`tags`/no-prefix maximises Obsidian compatibility; inline is compact for typical 2–5-tag notes; preserving unknown keys is non-negotiable for the portability principle. |
| Tag hover display                 | Not in Phase 5 — no tooltip on file-tree rows, no wikilink preview popups | Wikilink hover-preview is a Phase 9 surface; standalone tag tooltips would just add noise to primary navigation. |
| Pin tag storage schema            | `pin_tags(pin_id, tag TEXT)` join table — no separate `tags` table | String values match how note tags appear in YAML; keeps tag value uniform across notes and pins; queryable for "all pins with tag X". |
| Pin Category in floating panel    | Add Pin Category selector to `PinDetailPanel` alongside tag editing (Phase 5)  | Already an open gap in the panel; surfacing it next to tags makes "how is this pin categorised" answerable in one place. |
| Note Details Pane schema (Phase 5)| Three sections, top-to-bottom: Tags chip editor, Folder breadcrumb (display only — no click-to-reveal), Modified (relative time). Nothing else. | The pane must not become a kitchen-sink property sheet. Title/Created/word-count/cover-image/frontmatter-passthrough deferred or rejected. Backlinks slot added in Phase 9. |
| Search surface (Phase 6)          | Single Command Palette modal hosts both ledger search and command execution. No sidebar search panel. Search rail icon and Ctrl/⌘+K both open the palette. | Avoids two parallel search surfaces. The rail-icon-opens-modal pattern matches Settings (rail icon opens dialog) — exception is already established. |
| Search engine                     | Tantivy, single index over all entity types; tags as facets on note docs (see [ADR-0004](./docs/adr/0004-tantivy-search-engine.md)) | Fuzzy matching is GM-under-pressure typo tolerance (FTS5 only supports prefix wildcards). BM25 with field boosts and tag faceting also align with Phase 9 graph work. |
| Search result grouping            | Fixed sections in order: Commands → Tags → Notes → Maps → Scenes. Section headers are skipped during keyboard navigation. | Predictable scanning under live-play pressure; flat ranking with type chips forces a per-row identification step. Commands first matches palette muscle memory; Tags before Notes makes tag-filter syntax discoverable. |
| Tag result interaction            | Selecting a Tag result rewrites the query input to apply `tag:foo` as a filter and refreshes results in place. No "tag view" tab is opened. | Honours Phase 5's promise that tags are discoverable via Search and the graph (Phase 9). A Phase 6 tag view would be a degenerate file list, redundant with both the file tree and the future graph. |
| Tag filter composition            | Multiple `tag:` filters compose with **OR**. Free-text terms compose with `tag:` filters as **AND** (filter then search). `tag:npc` alone lists all notes carrying that tag. | OR across tags fits GM prep workflow ("cast a wide net"); AND between filter and text matches every standard search-box mental model (GitHub, Linear, ripgrep). |
| Note result row                   | One row per note, single excerpt (~120 chars centred on first body match), `N matches` chip when match count > 1. Opening from a free-text query scrolls to the match and plays a ~600ms highlight pulse. | Per-match rows let one dense note dominate; multiple excerpts per row create irregular heights. Single excerpt + match chip + scroll-to-match makes the palette an actual navigation tool, not just a list. |
| Empty palette state               | Recent section (cross-entity MRU, ~5 items) above Commands. Recent is the only place where grouping is mixed by entity type. | The most common reason to open the palette is "take me back." Recent is cross-entity because MRU recency matters more than entity type at this point of intent. |
| Initial Commands set              | 8 commands: Create new note/scene/map, Add tag to current note, Open Settings, Toggle theme, Switch ledger, Rebuild search index. Append-only as later phases ship. | Curated and small. No contextual/plugin/user-defined commands in Phase 6 — extensibility surface is a separate problem. |
| Rebuild search index affordance   | Command palette only (no Settings entry) | Recovery action, not a setting. Surfacing in Settings creates a "should I rebuild?" worry that doesn't exist when it's a power-user command. |
| Search open-result behaviour      | Plain Enter: active pane, reuse existing tab in either pane. Ctrl/⌘+Enter: force new tab in active pane. Shift+Enter: opposite pane (creates split if needed). | Reuse avoids tab thrash from search-driven navigation; modifiers cover compare-two-views and open-to-the-side cases without a modal-on-modal prompt. |
| Search archived notes             | Excluded by default. Opt-in via `archived:true` (only archived) or `archived:any` (include archived). | Archived means "I deliberately put this out of my way" — default respects that intent; opt-in syntax preserves recoverability. |
| Search typing model               | Fires from char 2, 80ms debounce. Fuzzy on by default with tiered Levenshtein: 0 (<4 chars), 1 (4–7), 2 (8+). | Single chars are too noisy; 80ms is below human perception of lag. Tiered fuzzy keeps short queries focused while typo-tolerant on proper nouns. |
| Pin search (Phase 6)              | Pins are not searchable in Phase 6. They remain editable via the floating `PinDetailPanel`. | Pins are inside maps; flat palette results like "Pin: Captain Ash → in 'Harbor District'" are awkward without map context. The Phase 9 graph is the natural pin-discovery surface. |
| Template format                   | Static markdown file in `ledger/.grimoire/templates/`. Filename (minus `.md`) is the display name. Content (including any frontmatter) copied verbatim into the new note. No variable substitution. | Static templates are the full value proposition — structure saves time, not pre-filled content. Variables would require a templating engine and fill-in-blanks UI. |
| Built-in templates                | Four built-ins (`NPC.md`, `Location.md`, `Session Log.md`, `Encounter.md`) injected into `ledger/.grimoire/templates/` on first ledger open. Directly editable by the GM. Settings exposes a *Restore default templates* action that overwrites only the four built-ins. | Built-ins must be customisable — every campaign has its own NPC structure. Restore covers accidental loss without hiding the files from the GM. |
| Template creation surface         | *Create note from template* is a separate command palette entry — the existing *Create new note* flow is unchanged (creates blank note immediately). Selecting the command replaces palette results inline with a template picker list; selecting a template creates the note immediately using the same folder context as *Create new note*. | Inserting a picker into the blank-note flow adds friction to the common case. Separate command keeps both paths clean. |
| Templates sidebar section         | A collapsible section at the bottom of the Files sidebar listing all `ledger/.grimoire/templates/` files. Full CRUD (rename, delete) using the same patterns as the file tree. Section header "+" button wired to *Create new template*. | Templates are first-class GM tools, not hidden app internals — they deserve sidebar visibility. A dedicated section keeps them out of the note hierarchy. |
| Template discoverability          | Templates are not indexed by Tantivy and do not appear as Command Palette search results. Discovery is via the Templates sidebar section and the *Create note from template* picker. | A sixth search group for ~12 items adds noise; the sidebar section already solves "find and edit a template." |
| Ledger setup framework             | Idempotent calls on every `open_ledger` — no ledger format version number, no migration registry. App delivery is handled by Tauri's updater. | Version tracking adds a coordination surface with no payoff when calls are cheap to skip; Tauri handles "which code runs." |
| Setup call categories             | Two kinds: **check-and-skip** (cheap stat-based checks, always run — e.g. `inject_builtin_templates`) and **incremental** (expensive derive operations that compare a `last_indexed_at` timestamp against the most-recently-modified ledger file and skip if nothing changed — e.g. tag index, search index, future backlinks index). | "Always rebuild" is acceptable now but becomes O(n) tax on every open as the ledger grows; staleness signal keeps correctness while avoiding the cost on stable ledgers. |
| Link index storage                | SQLite `note_links(source_id INTEGER, target_path TEXT)` — path-keyed, same pipeline as `note_tags`, regenerable from ledger scan (see ADR-0005) | Path-keyed so broken links are representable as rows (enabling Stub Note rendering and dimmed outbound indicators). Id-keyed would silently drop unresolvable links. |
| Wikilink rename handling          | On `rename_note`: auto-rewrite all `note_links` rows referencing the old path; update raw markdown in each source note; show toast after ("N notes updated"). Settings toggle to require a blocking confirmation dialog instead. | Silent rewrite matches GM-under-pressure flow. Blocking dialog option for GMs who rename deliberately and want to audit which notes are affected before committing. |
| Note aliases                      | Wikilink-resolution-only. Stored as `aliases: [...]` in frontmatter. SQLite `note_aliases(note_id, alias TEXT)` index. Chip editor in Details Pane between Tags and Backlinks. Alias collision (two notes sharing the same alias) shown as an inline warning chip, not a hard error. | Aliases broaden wikilink discovery without polluting note titles or display names. Collision is a warning not an error to preserve ledger-portability — the GM decides which note "wins." |
| Details Pane section order (Phase 9) | Tags → Aliases → Backlinks → Outbound → Folder → Modified | Editable sections (Tags, Aliases) group at top as authoring tools. Read-only navigation (Backlinks, Outbound) form a "connections" block below. Passive metadata (Folder, Modified) at the bottom. |
| Backlinks / Outbound display      | Title (Metamorphous) + folder path (Nunito, muted). Capped at 5 with expand-in-place. Empty state shows section header + "No backlinks yet" (section not hidden). Broken outbound links shown dimmed with a "not yet created" indicator. | Cap prevents popular notes from making the rail unusably long. Showing the empty state surfaces the feature to GMs who haven't yet linked notes. |
| Graph node types                  | Notes (all, including Stub Notes) + Maps. Edges: wikilinks (note→note) and pin references (map→note via `pins.note_id`). Orphan notes shown as disconnected. | Pin→note edges are already in the schema and represent meaningful place↔lore relationships. Stub notes surface the "referenced but not yet written" signal — hiding them removes a useful prompt. |
| Stub note click in graph          | Click-to-create: creates the note immediately with the link text as its title, opens in the active pane. Stub node resolves to a real node on next graph refresh. | Consistent with "GM clarity under pressure" — the action the GM wants is obvious, so do it without a confirmation step. |
| Orphan notes in graph             | Shown as disconnected nodes, not hidden by default, no show/hide toggle. | Honest picture of the ledger. The tag filter panel handles noise reduction. |
| Graph rendering library           | Cytoscape.js (`cose` force-directed layout). CSS custom properties read at render time via `getComputedStyle` and re-applied on theme/accent change. | Handles zoom/pan/click/hover out of the box; suitable for 100–300 node scale; full visual control via its CSS-like style config. |
| Graph pane lifecycle              | One graph tab max. Opening the graph when a tab already exists navigates to it. Rail icon opens the pane directly (no sidebar step — graph has no sidebar content). | No "which graph is current?" confusion. Rail skips sidebar because there is no sidebar content for the graph. |
| Graph node coloring               | Color by primary tag (first tag in frontmatter array). Untagged nodes use `--foreground-muted`. Per-tag graph color config in Settings; shortcut to that config accessible from the graph filter panel. | Color-by-primary-tag is legible and leverages existing tag insertion-order convention. Settings is canonical; graph panel shortcut reduces friction during prep. |
| Graph node sizing                 | Proportional to backlink count with min/max size caps so stub and orphan nodes remain visible. | Hub notes naturally dominate visually; size signal reduces reliance on always-on labels. |
| Graph tag filter panel            | Panel in the graph pane. Per-tag show/hide toggle. Shortcut to open the tag's graph color config in Settings. Show/hide by tag is in scope for Phase 9. | Co-locates filter and config navigation in the graph context without duplicating the full Settings surface inline. |
| Graph search                      | Search input in graph panel header. Typing filters/highlights matching nodes; Enter focuses the camera on the first match. | A 100+ note ledger is hard to navigate spatially; search-to-focus is the keyboard path to a specific node without mousing through a dense layout. |
| Derived Index reconciliation       | A single `note_index` module owns all four derived indexes behind two verbs: `reconcile(note, content, prev_path)` (create/update/rename via optional `prev_path`) and `remove(note_id, path)`. Disk I/O and the canonical `notes` row stay in each command; content extraction happens once into a private `DerivedFacets`. The three SQLite index writes share one `conn.transaction`; the cross-note backlink rewrite on rename stays in `links.rs`. | Every note-write command previously re-orchestrated tag/link/alias/search updates by hand, re-parsing content and dropping the Tantivy error. One reconcile module concentrates the "indexes agree with content" invariant in one test surface. Disk ops stay in the command because they genuinely differ per command and aren't the duplicated complexity. |
| Search-stale handling               | `reconcile`/`remove` return `ReconcileOutcome { search_stale }`. On a Tantivy write failure the module writes a persisted stale marker under `.grimoire/`; `open_ledger` rebuilds and clears it on next launch. A live in-session debounced rebuild is deferred — `reconcile` stays synchronous and only *reports* staleness, so a future scheduler is a localized add outside the seam. | Honors ADR-0004's "mark stale and schedule rebuild" without the concurrency surface of a background thread that re-locks `LedgerState` and hot-swaps the Tantivy `Index`. Keeping `reconcile` synchronous preserves its testability — the whole point of the deepening. The manual `rebuild_search_index` command remains the escape hatch. |
| Timeline serialization (Phase 8)    | Note content, serialized inline as a fenced ` ```timeline ` code block (Option B) — not an opaque HTML blob, not a SQLite entity. Body is blank-line-separated records of labeled lines (`Date:`/`Title:` + description); `Title:` required, date/description optional; wikilinks-only formatting. See [ADR-0007](./docs/adr/0007-timeline-fenced-markdown-block.md). | The events ARE the content (unlike a Scene id-reference), so the ledger-portability principle applies: a fenced block keeps every event legible/greppable/hand-editable in Obsidian or VS Code, matching the Mermaid/Dataview convention. Opaque HTML (`<timeline>`) would degrade to garbage in other tools. |
| Timeline event linking (Phase 8)    | Event title and description carry explicit literal `[[wikilinks]]` (M1), authored via the same `[[` autocomplete; no auto-resolve-by-name. | `extract_wikilinks` scans the whole note body including code fences, so links inside the ` ```timeline ` fence feed the Link Index, Backlinks, and Graph with zero new indexing code. Auto-resolve-by-name (M2) would be a separate resolver that never reaches those indexes and would mis-fire on non-note titles. |
| Timeline layout (Phase 8)           | Vertical spine (events stacked down a connecting rail), each event collapsible — date + title always visible, description expands on click (reusing SceneBlock's `grid-rows` reduced-motion expand). Supersedes the scope's "horizontal scrolling" line. | Embedded in a vertically-scrolling note column, a horizontal track forces nested horizontal scroll (a scroll-direction papercut) and cramps the multi-line, wikilink-bearing descriptions. Vertical flows with the document and gives descriptions full width; collapsible keeps a long timeline glanceable. |
| Timeline edit model (Phase 8)       | Display-by-default, edit-on-demand: events render as a read-only chronicle (wikilinks clickable); clicking an event flips it to edit fields (raw `[[…]]` text + `[[` autocomplete). Per-event up/down nudge + straight delete (no confirm; undo via Ctrl+Z through ProseMirror history). Insertion points in every gap — bottom always-visible, between-events revealed on hover/`:focus-visible`, focusable for keyboard. Fresh `/timeline` starts with one blank event in edit mode (title focused); empty state appears only after all events deleted. | A clickable link and an editable field can't be the same element, so display/edit modes are the only clean way to support wikilinks in titles. Reads as world content, not a form (the tool disappears). Every-gap insertion kills append-then-bump-up-N-times; up/down stays as a fine-reorder nudge. |
| Timeline editor node shape (Phase 8)| Atom TipTap node (like SceneBlock/ImageBlock) whose event fields are plain strings that may hold literal `[[...]]`; lightweight in-input autocomplete reusing `search_notes`; rendered clickable via `data-wiki-link` spans. True nested-ProseMirror content deferred. | Nested editable content (`timeline > event > title/description` as ProseMirror holes) is a large schema jump both prior custom blocks deliberately avoided. Literal-`[[...]]`-string fields round-trip identically and reuse the delegated click/hover handler in Editor.svelte. |
| Timeline typography (Phase 8)       | Title → Metamorphous (world voice); description → Nunito (reading prose, matches note body / search excerpts); date label → Metamorphous, small and `--primary`-tinted as an atmospheric date-stamp on the rail. | Content-ownership boundary: title and free-text date label are GM-authored world flavor; the description is read at length, where Metamorphous tires. Tinting + size keep two Metamorphous elements per event from reading heavy. |
| Timeline edit commit (Phase 8)      | Field edits commit to the ProseMirror node on blur / leaving edit mode, not per keystroke. | One Ctrl+Z reverts a whole-event edit (and delete is its own single undo step), matching the "straight delete, undo via Ctrl+Z" decision; avoids hammering the 500ms save-debounce on every key. |
| Sample Ledger persistence           | Ephemeral. The only ledger state persisted across a restart is `recent-ledgers.json` (and per-ledger `.grimoire/prefs.json`) — `get_ledger_path` is in-memory only, so there is **no cross-restart auto-reopen**; a cold start always shows the Splash. The ephemeral requirement therefore reduces to one thing: the sample open must skip the frontend `add_recent_ledger` call. It still goes through `open_ledger` (setting in-memory `state.path` so the app functions); that in-memory state is naturally discarded on restart, so "relaunch returns to the Splash" is automatic. Reset to pristine happens only on an explicit *Explore an example world* / replay; *Make this mine* is the only path to a persisted ledger. | Keeps `recents.length === 0` an honest first-run signal and the demo always-pristine ("never my messed-up sample"). Gives "throwaway sandbox you can adopt" a crisp meaning. Accepted cost: editing the sample then restarting without adopting loses the pokes — correct, since no commitment was made. |
| Sample marker & adopt affordance     | Both surfaces: (1) a persistent sidebar treatment — an "example world" identity on `LedgerSelector` plus a pinned *Make this world mine* button; (2) a one-time dismissible banner on the canvas when the sample first opens (dismissal remembered globally in app data, so repeat explorers aren't nagged). No explicit "this is temporary" warning — the throwaway expectation is carried by visual language + button copy (e.g. *"Keep this world — make it mine"*). | A persistent canvas banner would violate "the tool disappears, the world remains"; a one-time banner introduces the sample then gets out of the way. The sidebar is where ledger identity already lives, so the persistent marker + CTA belong there. Copy-over-warning keeps the tone welcoming, not cautionary. |
| Make this world mine (adopt)         | Adopt = Create New Ledger seeded with sample content. Opens a dialog reusing the Splash "creating" mode's name + location picker; name starts empty with a placeholder (forced — it's the GM's world now, not "Example World"). Copies the *current edited sandbox* (not pristine) to the chosen location, then opens it via the vanilla `openLedger` path (lands in recents, becomes persisted current ledger, marker clears). Old sandbox left as-is (next *Explore* resets it). | Explore-then-adopt means they keep what they poked at, so copy the edited sandbox. Reusing the existing name/location UI + vanilla open path means the only genuinely new backend work is one "copy directory tree to chosen destination" primitive plus the ephemeral sample open. |
| Sample Ledger replay entry points    | Two: (1) a quiet tertiary link on the *returning* Splash state — *"New to Grimoire? Explore an example world"* — below the recent list; (2) an **Explore example world** command appended to the Command Palette Commands set. No Settings entry (no Help surface to anchor it; the palette command covers on-demand access). Opening the sample while a real ledger is open is safe — it swaps the in-memory ledger to the sample (in-session) and never touches recents, exactly like switching ledgers via `LedgerSelector` (which already takes no confirmation); on restart the Splash shows, with the real ledger still in recents. | The first-time Splash door vanishes once recents exist, so returning/curious GMs need a path. The palette is how every other global action is reached (append-only Commands set); a quiet returning-Splash link catches first-timers who skipped it without competing with their real ledgers. |
| Sample Ledger delivery               | Ships as a Tauri bundle resource (`"resources": ["sample-world/**"]`), pristine source in `src-tauri/sample-world/` as plain markdown + image files, **without** `.grimoire/`. *Explore* removes any existing `app_data_dir/sample-world/`, copies the resource tree in fresh, then ephemeral-opens it; the existing idempotent Ledger setup framework regenerates all derived indexes on open. The copy is mandatory (the bundled resource dir is read-only — app bundle / Program Files), not just for resets. | Versioned with the app and delivered by Tauri's updater like any asset. Shipping without `.grimoire/` keeps the bundle clean/greppable and makes the sample a live proof of the "delete `.grimoire/` and recover from a ledger scan" criterion. `assetProtocol` scope is already `**`, so sample images render. |
| Sample Ledger content manifest       | A single small fantasy locale. ~10 notes across nested folders (demonstrates folder depth), several created from different built-in Templates (NPC/Location/Encounter/Session Log) so templates are seen in use. Notes interlinked via wikilinks (real Backlinks/Outbound), a few Tags, one Note Alias, ≥1 Stub Note. A Timeline embedded in a **worldbuilding/lore note** (timeline is a worldbuilding feature, not session-log); a separate session-log note exists without a timeline. 1 map with 2–3 pins (Pin Categories + pin→note graph edges). 2–3 **fully-built scenes**, each with **multiple layered Slots** — a music bed + an ambience overlay (e.g. tavern instrumental + rain) — showcasing the Slot mixing model, not single-track scenes. Ships several CC0/licensed audio tracks (music beds + reusable ambience loops); bundle-size cost accepted. Graph + Templates demonstrated for free. | Authoring a tight vertical slice that lights up nearly every feature is cheaper than a sprawling world and reads as charming, not overwhelming. Layered scenes are the only honest way to show what a Scene *is*. Folder depth + template-in-use demonstrate structure a flat list of notes can't. |
| Onboarding empty states              | The Sample Ledger is the primary onboarding vehicle; empty states carry the start-fresh path. Existing empty states suffice (ledger-home *"Every world begins with its first note"*, Scene Dashboard empty, Backlinks empty) except for one addition: a secondary *"…or start from a template"* affordance on the ledger-home, since a new ledger now has the 4 built-in Templates injected on open. A broader per-pane empty-state audit (graph, files sidebar, map pane) is deferred to a separate polish pass, not this feature. | Depth was scoped to "just demo + empty states" — no checklists/tours. The template affordance closes a real discovery gap (templates exist immediately but were invisible from the home); reopening every pane's empty state would balloon the feature. |
| Sample Ledger landing                | On *Explore*, the sample auto-opens a bundled world-voice orientation note (*"Start Here"*) in the active pane, with the one-time banner above it. The note teaches by doing — short prose carrying `[[wikilinks]]` into the world's notes, a nudge to press Play on a scene, a mention of the map. The empty-ledger home (*"Every world begins with its first note"*) is untouched and still shows for genuinely-empty new ledgers. Only the ephemeral sample open auto-opens a note (by known path). | The ledger-home renders whenever a ledger is open with no focused tab (gated on `!notes.isLoading`, not note count), so a populated sample would otherwise land on a "begins with its first note" screen — wrong and flat for the one moment meant to delight. A Start Here note is the single place meta/instructional copy is appropriate, and linking into the world teaches navigation by use. |
| Details Source extraction            | Per-entity Details Source modules own fetch + save invariants + save status for Details Pane bodies. Note and pin migrate together (two adapters = real seam); AnnotationDetails is already a pure controlled body, unchanged. The source subscribes to linksTick itself. Every save behind the seam reports into one status machine with retry — fixing the previously silent alias-save failure. | NotePane carried a 60-line fetch/save choreography for NoteDetails while PinDetails self-fetched with silent catches — opposite patterns for the same job, refresh invariants held by caller discipline, no test surface. Concentrating both behind one named seam makes the choreography testable and reusable across mounts. |
| Typed command seam (ADR-0009)        | tauri-specta generates `bindings.gen.ts` from Rust commands; a thin Command Wrapper applies error posture. Toolchain pinned >=1.93; export at debug-startup, not `cargo test`. Error mode (Throw vs Result) decided at implementation. | Hand-wrapping (Jan/Hopp) leaves Rust↔TS type-drift with no compile-time guarantee and rots toward partial adoption; codegen closes identity + arg-shape + type-drift at once, and is where Cap and (Svelte, same-version) Whispering converged. RC dependency accepted; hand-written wrappers remain the fallback behind the same surface. |
| Success toasts                       | Success is **silent by default**. A `toastSuccess` is justified only when the effect is **invisible** (a background op with no visible result — e.g. "Search index rebuilt", "Default templates restored") or **informational** (a side effect the user can't see — e.g. rename's "N notes updated"). Errors always toast (ADR-0010). `toastUndo` is exempt — it is the undo affordance, not a confirmation. | A visible action ("note created" → it appears) needs no announcement; a success toast there is the tool announcing itself, violating "the tool disappears, the world remains" and "restrained by default". A failure is often invisible, so it always needs surfacing. Guardrail against success-toast creep — the existing toasts already comply. |
| PDF as a SQLite entity              | Rejected — PDFs are path-addressed like Templates, not entities like Maps (see [ADR-0011](./docs/adr/0011-pdfs-path-addressed-not-entities.md)). `TabType "pdf"` carries the ledger-relative path; `tree.rs` adds `.pdf` to its curated allowlist as a plain `FileNode` (no id field added). | A PDF carries no app-authored metadata. Future linking rides the path-keyed Link Index; future search is a regenerable derived index; both want a path, not an id. A `pdfs` table would be the wrong key and canonical-looking state that violates "regenerable from a ledger scan." |
| PDF rendering                       | PDF.js (`pdfjs-dist`), Grimoire-styled minimal viewer — not the native webview `<iframe>` viewer (see [ADR-0012](./docs/adr/0012-pdfjs-over-native-webview-viewer.md)). | The native viewer is broken on Linux (WebKitGTK) and flaky on macOS (WKWebView); we ship to both. PDF.js renders identically everywhere, we own the chrome, and its text layer gives in-tab find + sets up future annotations. |
| PDF import paths                    | Two: filesystem drop-in (place a `.pdf` anywhere in the ledger, it surfaces wherever it sits) and folder-targeted HTML5 drag-and-drop onto the Files tree (drop on a folder row → that folder; drop on empty area → ledger root). Both copy bytes in; collisions auto-suffix (`Manual (2).pdf`), no prompt. | Drop-in keeps the ledger portable and tool-agnostic; drag-drop mirrors the existing image-drop pattern (`dragDropEnabled: false`, web `File` bytes written backend-side). Byte-copy guarantees nothing references a file outside the ledger. |
| PDF viewer scope (v1)               | In: continuous lazy-rendered scroll, **100% zoom by default** (not fit-width), zoom in/out/reset, page indicator with click-to-jump, find-in-document (Ctrl/⌘+F, text-layer highlight), text selection. Deferred: thumbnails, outline/bookmarks, rotate, print, annotations. | Matches the "read a rulebook under pressure" use case; find-in-doc is the highest-value interaction. Fit-width is jarring on landscape screens. Annotations are a deliberate post-core feature. |
| PDF file-tree treatment             | Distinct monochrome Lucide glyph (`BookOpen`) in `--foreground-muted` — no color, no badge (design language forbids decorative color). Full context-menu parity with other files: Open, Open in Right Pane, Rename, Delete. | A distinct glyph is the "particular indication" without breaking the monochrome system. PDFs are GM-managed files like any other; no reason to make them second-class. |
| PDF failure states                  | One unified "can't display" pane state covers missing/corrupt/not-a-PDF. Password-protected → shown as unsupported (no password prompt in v1). A Delete from the tree closes any open tabs for that PDF; external deletion falls to the error state on next render. Path-resolution call uses `api.silent.*` (pane owns its error UI). | A password-entry UI is rare-case build cost deferred cheaply. Closing tabs on self-initiated delete avoids dangling broken tabs. Silent error posture matches the details-source precedent. |
| PDF pane right rail                 | None. The PdfPane has no Details surface. | Consistent with scene/graph/empty panes having no surface. Scene-links are managed inline via the hover bubble toolbar, not a detail panel — so there is no right-rail body to add. |
| PDF annotation scope                | Only [[Scene-link]] annotations (text → Scene). Generic highlights / sticky notes are a separate future feature, not built here. | A Scene-link has a crisp definition and reuses the existing Scene/audio machinery (`audioEngine.playScene`). Generic annotation is a different model (free-text storage, its own authoring surface) and isn't the described need. |
| Scene-link anchoring                | Text-range, not a drawn box or a pin: `(page, start_offset, end_offset)` over the PDF.js text layer, plus a stored `quote`. Path-keyed canonical SQLite. | The GM's model is "highlight text, attach a Scene" (WYSIWYG-style), so the anchor must be the text the GM chose. The `quote` displays in the toolbar and flags drift if a different edition is later dropped at the same path. Rides the text layer already in scope for find-in-doc. |
| Scene-link create + discoverability | Power path: selecting text pops a `＋ Link Scene` bubble → searchable Scene picker. Discoverable path: a persistent _Link Scene_ button in the PDF toolbar (opens the picker when text is selected; shows a teaching hint — "Select text to link a Scene" — when not). First-run coachmark deferred. | The bubble only reveals itself on selection, so casual/first-time users need a visible affordance; the persistent button is durable discoverability that teaches the gesture, without one-time-state machinery. |
| Scene-link visual treatment         | Underline tinted with the linked Scene's accent color + a small trailing scene icon + a distinct active state while its Scene plays. Not a background highlight; not a single neutral color. | Underline keeps the PDF's own text readable; scene-tint is semantic identity (like pin category color, not decorative) and aids recognizability for casual users; the icon reads it as a trigger; the active state reuses the playing-indicator language. |
| Scene-link hover toolbar            | Inline bubble: ▶ Play/Stop toggle (reflects active state) · master volume (global `setMasterVolume`, no per-link stored override) · Scene name (click → open Scene editor) with a change-dropdown whose footer is _＋ New scene_ (creates an empty Scene and links it immediately) · Remove (unlinks; PDF text untouched). | Complete loop — play, adjust, re-link/create, remove — inline, no detail panel. Master volume avoids duplicating the per-slot volume authority a Scene already owns. _＋ New scene_ enables highlight-first, author-audio-later. |
| Scene-link on Scene deletion        | Cascade-delete via `ON DELETE CASCADE` on `scene_id`. The underline vanishes; PDF text untouched. | A Scene-link's whole purpose is its Scene; unlike a broken wikilink (which heals when the named note is created), a deleted Scene's id never returns, so a "broken link" state would be permanent litter. Cascade needs no special logic in `delete_scene`. |
| PDF / Scene-link build order        | Core viewer ships first (open, render, scroll, zoom, find, file-tree, import); Scene-link annotations are built last in the same feature, on top of the text layer. | Annotations depend on the text layer and the settled viewer; sequencing them last de-risks the core and lets the text-anchoring work land on a stable base. |
| YouTube as an audio source          | Out of scope — rejected. No `youtube` slot source. Slot sources stay `local` + `spotify`. | YouTube's API ToS forbids exactly what would make it fit the ambient-audio model: no audio-only/extraction (an "mp3 of audio that appeared in a video" is explicitly named as prohibited), the embedded IFrame player must stay visible at ≥200×200, and audio must not continue once the GM navigates away (no background play). A compliant "visible video panel that pauses when hidden" breaks "the tool disappears, the world remains," can't mix into crossfades as a backgrounded audio layer, and is unreliable for the actual use case (artist uploads are frequently embedding-disabled, region-locked, or DMCA-pulled; ads are un-blockable mid-scene). Revisit only if a persistent, always-visible player surface ever becomes desirable in its own right. |
