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

### Phase 1 — UI Shell ✦ Foundation

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

### Phase 2 — Scenes Redesign

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

### Phase 3 — Test Infrastructure

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

### Phase 4 — Images

**Deliverables:**

- Insert images from the local filesystem into notes via TipTap
- Images copied to vault `media/` directory on insert
- Inline image rendering in the editor
- Relative paths stored in note content (vault-portable)

**Success criteria:**

- Drop an image into a note, it appears inline, vault remains portable

---

### Phase 5 — Tags

**Deliverables:**

- Tag notes from the editor or sidebar context menu
- Tags persisted in SQLite
- Tag list visible in the Files sidebar (below folder tree or as a filter section)
- Click a tag to filter the file tree to tagged notes
- Tag display on note detail / hover

**Success criteria:**

- A GM can tag all "NPC" notes and filter to them in one click

---

### Phase 6 — Search

The Search rail slot is already reserved. This phase wires it up.

**Deliverables:**

- Search rail opens a sidebar search panel (not a modal)
- Full-text search across note titles and content
- Results show file name + excerpt with match highlighted
- Click result opens note in main content area (or focused pane)
- Keyboard navigation through results (↑ ↓ Enter)
- Ctrl+K / ⌘K as global shortcut to focus search

**Success criteria:**

- Type 3 characters, results appear within 200ms
- Works across a vault with 200+ notes

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

- Note detail panel (toggled sidebar or bottom panel): shows all inbound wikilinks to the current note
- Tags displayed in the detail panel
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
