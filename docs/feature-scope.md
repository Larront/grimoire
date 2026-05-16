# Grimoire — Feature Scope & Roadmap

## What Grimoire Is

A local-first desktop application for TTRPG Game Masters. It serves two equally important purposes:

1. **Worldbuilding** — capturing lore, NPCs, locations, timelines, and maps during prep
2. **Session companion** — fast access to notes, audio scene management, and maps during live play

All data lives in a local vault directory (a folder on disk). Content is stored as Markdown files and SQLite metadata — never proprietary formats. The vault is portable across drives and machines.

---

## Scope Boundaries

**In scope:**

- Desktop (Windows, macOS, Linux via Tauri)
- Tablet (landscape and portrait)
- Local-first, single-user

**Out of scope (current):**

- Mobile
- Cloud sync or collaboration
- Multi-user / shared vaults
- Web app

---

## Phase Structure

### Phase 1 — UI Shell ✦ Foundation ✅ Complete

Establishes the structural layout the rest of the app builds on. Nothing else proceeds until the shell is correct.

**Deliverables:**

- Icon rail (Search, Files, Scenes, Settings, Audio status)
- Collapsible sidebar — docked on large screens, overlay on tablet/small
- Unified file tree (notes and maps coexist, distinguished by icon only, folder-based)
- Tab bar with persistent open tabs
- Left/right split view (max 2 panes, each with independent tab bar)
- Scenes sidebar (favorites pinned at top, folder tree below)
- Context-aware sidebar content per pillar

**Success criteria:**

- Rail is always visible at every viewport
- Sidebar collapses to icon rail on toggle
- A note and a map can be open simultaneously in split view
- File tree shows notes and maps in the same folder hierarchy

---

### Phase 2 — Scenes Redesign ✅ Complete

Elevates scenes from a functional list to the command centre they deserve to be.

**Deliverables:**

- Scenes dashboard — grid of scene cards with thumbnails
- Scene thumbnails: user-uploaded image, or color + icon generated fallback
- Dashboard playback controls: play, pause, skip, shuffle
- Individual scene page as slot configurator (existing slot editor, reskinned)
- Favorites: filled primary star, pinned in sidebar
- Playing indicator: primary pulse on active card and sidebar row

**Success criteria:**

- A GM can prep 10 scenes with distinct thumbnails in under 10 minutes
- Active scene is identifiable at a glance from any view
- Switching scenes from the dashboard triggers the existing crossfade engine

---

### Phase 3 — Test Infrastructure ✅ Complete

Locks down the foundation before the feature-building phase.

**Deliverables:**

- Vitest unit tests for all 5 stores (vault, notes, scenes, audio-engine, maps)
- Rust `#[cfg(test)]` tests for all 6 command modules (vault, notes, scenes, maps, media, spotify)
- Audio crossfade lock paths covered
- `bun run test` and `cargo test` both pass clean

**Success criteria:**

- No new feature merges until tests are green
- Crossfade state machine has test coverage

---

### Phase 4 — Images 🟢 Current

**Deliverables:**

- Insert images from the local filesystem into notes via TipTap (slash command, drag-and-drop, paste)
- Images copied to vault `images/` directory on insert
- Inline image rendering in the editor
- Relative paths stored in note content (vault-portable)
- Alt text editable inline; renders as a visible caption below the image when non-empty
- Per-image align (left/center/right) and width (percent) controls, persisted in markdown via `{align=X width=Y%}` syntax
- Click-to-zoom lightbox: toolbar button opens the image at natural size in a fullscreen overlay, Esc/click-outside to close
- Broken-image recovery: when the file behind `src` is missing, the node renders a "not found" state with a Replace action that opens the file picker and rewrites the node's `src` while preserving caption, align, and width

**Out of scope (Phase 4):**

- Dragging or pasting image URLs from a web browser (requires a server-side fetcher with allowlist, size caps, and content-sniffing — deferred to a dedicated future feature)
- Orphan cleanup when an image is removed from a note (requires cross-note reference tracking; revisit after Phase 9 introduces a link index)

**Success criteria:**

- Drop an image into a note, it appears inline, vault remains portable
- Caption appears below the image and survives a vault reload

---

### Phase 5 — Tags

**Deliverables:**

- Tag notes from the Details Pane (right rail) chip editor; app command palette as secondary entry point
- Tag pins via the existing floating `PinDetailPanel` (tag chip editor added to the panel)
- Pin Category selector added to `PinDetailPanel` alongside tag editing
- Tags persisted in markdown frontmatter for notes (vault-portable); SQLite for pins (no markdown backing)
- SQLite tag index regenerable from a vault scan
- Tag autocomplete from vault-global tag list when editing chips
- Details Pane content (notes only): Tags chip editor, Folder breadcrumb (display-only), Modified relative time

**Out of scope (Phase 5):**

- Tag list / facet in the Files sidebar — tags are discovered via Search (Phase 6) and the graph (Phase 9), not via a sidebar list
- Click-a-tag-to-filter the file tree — no sidebar list, no filter affordance
- Rail engagement on map and scene panes — Phase 5 Details Pane is notes-only

**Success criteria:**

- A GM can tag a note in two clicks from the Details Pane
- Closing and reopening the vault preserves tags (frontmatter round-trip)
- Deleting `.grimoire/index.db` and reopening the vault recovers all tags

---

### Phase 6 — Search

Search is hosted in the existing command palette (`AppSearch.svelte`). Both the Search rail icon and Ctrl/⌘+K open it. The palette becomes the single canonical surface for vault search, tag discovery, and command execution.

**Deliverables:**

- Tantivy-backed search engine (see [ADR-0004](./adr/0004-tantivy-search-engine.md)), single index over notes / maps / scenes; tags as a facet on notes
- Command palette grouped into five fixed sections, in this order: **Commands → Tags → Notes → Maps → Scenes**
- Search filter syntax: `tag:npc` filters by tag; multiple `tag:` filters compose with **OR**; free-text terms compose with `tag:` filters as **AND** (filter then search)
- Selecting a Tag result rewrites the input to apply that tag as a filter (does not open a new view)
- `tag:npc` alone (no free text) lists notes carrying that tag, MRU-ordered — the Phase 5 tag-discovery promise
- Note rows render title (Metamorphous) + single excerpt (Nunito, ~120 chars centred on first body match, match span in `--primary`); a `N matches` chip appears when match count > 1
- Frontmatter is not indexed and not used as excerpt source — tags are surfaced through the Tags group, not via excerpt text
- Maps / Scenes / Commands render as single-line rows (no excerpts)
- Per-group caps: Commands 3, Tags 5, Notes 6, Maps 3, Scenes 3, with a "Show N more in [group]" expand-in-place row when capped
- When only one group matches, that group's cap relaxes (Notes ~15) before showing the expand row
- Empty query state: a **Recent** section (cross-entity MRU, ~5 items) above the Commands section. Recent is the only place where grouping is mixed by entity type
- Initial Commands set (append-only as later phases ship): *Create new note*, *Create new scene*, *Create new map*, *Add tag to current note*, *Open Settings*, *Toggle theme*, *Switch vault…*, *Rebuild search index*
- Search fires from char 2 with 80ms debounce; perf target <150ms on 200+ note vaults
- Fuzzy matching is on by default with tiered Levenshtein distance: 0 for queries < 4 chars, 1 for 4–7, 2 for 8+
- Archived notes are excluded from results by default. Opt-in via `archived:true` (only archived) or `archived:any` (include archived)
- Opening a result:
  - **Plain Enter** — opens in the active pane; reuses an existing tab in either pane if the entity is already open
  - **Ctrl/⌘+Enter** — forces a new tab in the active pane
  - **Shift+Enter** — opens in the opposite pane (creates split if not yet split)
- Opening a note from a query with free-text terms places the cursor on the matched span and plays a ~600ms highlight pulse on the matched text (`--primary-subtle`)
- Section headers are skipped during keyboard navigation (↑ ↓ moves across group boundaries directly)
- Tantivy index lives at `vault/.grimoire/search-index/`; updated incrementally on every note write; fully rebuildable via the *Rebuild search index* command and on vault open if missing or stale

**Out of scope (Phase 6):**

- Pins as search results — pins live inside maps; their natural discovery surface is the Phase 9 graph. Pin tag editing remains in the floating `PinDetailPanel`.
- Folder results — folders are not standalone navigation targets; "reveal in Files sidebar" is a different gesture and not in scope
- Search-results preview-on-hover in the pane behind the palette — surfaces too many edge cases (scroll state, dirty editor state) for the value
- Per-group sort options (modified-date vs relevance) — BM25 is the only ranking; no user-facing sort toggle
- Plugin / contextual / user-defined commands — Commands set is a fixed curated list; extensibility deferred
- Tag rename and delete bulk operations — still deferred (Phase 5 boundary holds)

**Success criteria:**

- Type 2 characters, results appear within 150ms on a 200+ note vault
- "Captian Ash" (transposed typo) returns the *Captain Ash* note
- `tag:npc` with no free text lists every NPC-tagged note, most-recently-modified first
- Selecting the Search rail icon, pressing Ctrl/⌘+K, and clicking *Add tag to current note* in the palette all reach the same surface
- Deleting `vault/.grimoire/` and reopening the vault recovers all search results from a vault scan

---

### Phase 7 — Templates

**Deliverables:**

- Built-in templates: NPC, Location, Session Log, Encounter
- Create a note from a template (prompt on new note creation, or command palette option)
- Save any existing note as a custom template
- Custom templates stored in vault `.grimoire/templates/`

**Success criteria:**

- Creating a new NPC note from template takes one action
- Custom templates survive vault moves (relative paths)

---

### Phase 8 — Timeline

**Deliverables:**

- `/timeline` slash command in TipTap inserts a timeline block
- Add, edit, remove events inline within the block
- Events have: date label, title, optional description
- Horizontal scrolling for long timelines
- Fantasy-appropriate styling within the warm design system

**Success criteria:**

- A session log note can have a campaign timeline embedded inline
- Timeline renders correctly in both light and dark mode

---

### Phase 9 — Backlinks + Graph

Depends on Phase 5 (Tags) being complete — the graph uses tags as a clustering signal.

**Deliverables:**

- Details Pane gains a Backlinks section: all inbound wikilinks to the current note
- Outbound links section in the Details Pane
- Note aliases — alternative names usable in wikilink resolution, edited in the Details Pane, stored in frontmatter
- `/graph` route: force-directed graph of all notes
  - Nodes: notes and maps
  - Edges: wikilinks between notes
  - Clusters: by tag
  - Click node to open in main content area

**Success criteria:**

- Open any note, see what links to it in one click
- Graph renders a vault with 100+ notes without performance issues

---

## Features Deferred (Not In Scope)

These are valid ideas but explicitly not planned:

- **Dice roller** — out of scope; other tools handle this better
- **Initiative tracker** — combat management is a separate tool problem
- **Character sheets** — too structured; fights the freeform note model
- **Real-time collaboration** — conflicts with local-first vault model
- **Mobile app** — may revisit after tablet is solid
- **Export to PDF** — future consideration post-Phase 9
- **Scene scheduling / queuing** — future enhancement to Phase 2

---

## Existing Foundation (Complete)

**Phase 0 — Foundation Security & Debt** (complete as of branch `next`)

- Spotify token never crosses IPC bridge
- Path traversal guards on all file-touching commands
- Crossfade lock always released on error
- Leaflet cleanup correct
- close_vault command, boolean column migration, RFC3339 timestamps
- Git workflow established (main / next / feature/\*)
