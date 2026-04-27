# Requirements: Grimoire

**Defined:** 2026-04-28
**Core Value:** A GM opens their vault and has immediate, reliable access to every piece of their world — and can add to it without the app getting in the way.

## v1 Requirements

Requirements for the active development roadmap. Each maps to a roadmap phase.

### Foundation

- [ ] **FOUN-01**: Spotify access token is never returned to the renderer; all Spotify API calls are made from the Rust backend
- [ ] **FOUN-02**: Vault-relative file paths are validated against the vault root before any file read/write operation
- [ ] **FOUN-03**: `crossfadeTo` releases `isCrossfading` lock via try/finally so failures never freeze audio
- [ ] **FOUN-04**: Leaflet marker and annotation layers are fully cleaned up when navigating between maps
- [ ] **FOUN-05**: Spotify OAuth event listener is unregistered after each auth flow completes
- [ ] **FOUN-06**: `isLoadingData` does not resolve until both the image load and the IPC pin/annotation fetches complete
- [ ] **FOUN-07**: A `close_vault` Rust command exists and is called by the frontend `closeVault()` to release the SQLite connection
- [ ] **FOUN-08**: Boolean columns (`is_loop`, `shuffle`, `archived`) are migrated to proper SQLite BOOLEAN type
- [ ] **FOUN-09**: Vault item counts are invalidated and refreshed after create/delete mutations
- [ ] **FOUN-10**: Spotify client ID is loaded once at startup into Tauri state, not re-read on every command
- [ ] **FOUN-11**: Timestamps are consistent RFC3339 format throughout the backend
- [ ] **FOUN-12**: `_note_path` parameter is renamed to `note_path` in the Rust command handler
- [ ] **FOUN-13**: Vitest unit tests cover all Svelte 5 stores (vault, notes, scenes, audio-engine, maps)
- [ ] **FOUN-14**: Rust unit tests cover all command handlers (notes, scenes, maps, vault, spotify, media)
- [ ] **FOUN-15**: `next` integration branch exists; branching strategy documented in CLAUDE.md per flow.md

### Images

- [ ] **IMAG-01**: User can insert an image into a note via a system file picker
- [ ] **IMAG-02**: Inserted image is automatically copied into the vault's media directory
- [ ] **IMAG-03**: Image renders inline in the TipTap editor

### Tags

- [ ] **TAG-01**: User can add one or more tags to a note from the note UI
- [ ] **TAG-02**: Tags are persisted in the database
- [ ] **TAG-03**: User can browse/filter notes by tag in the sidebar

### Templates

- [ ] **TMPL-01**: User can create a new note from a built-in template (NPC, Location, Session Log, Encounter)
- [ ] **TMPL-02**: User can save the current note as a custom template
- [ ] **TMPL-03**: User can create a new note from a saved custom template

### Timeline

- [ ] **TIME-01**: A timeline block can be inserted into a note via the `/` slash command
- [ ] **TIME-02**: User can add, edit, and remove named/dated events within a timeline block
- [ ] **TIME-03**: The timeline block is horizontally scrollable and styled with the Grimoire fantasy aesthetic

### Backlinks + Graph

- [ ] **BACK-01**: Every note page has a details panel listing all notes that link to the current note (via `[[wikilinks]]`)
- [ ] **BACK-02**: The details panel also shows the note's tags
- [ ] **BACK-03**: A `/graph` route renders all notes as a force-directed graph; nodes are clickable to navigate to that note

### Search + Command Palette

- [ ] **SRCH-01**: A global command palette opens with ⌘K / Ctrl+K from anywhere in the app
- [ ] **SRCH-02**: The palette searches note titles and content (full-text)
- [ ] **SRCH-03**: The palette enables direct navigation to scenes and maps
- [ ] **SRCH-04**: The palette surfaces app-level actions (new note, open vault, go to graph, etc.)

## v2 Requirements

Deferred to future milestones. Tracked but not in current roadmap.

### Graph (Advanced)

- **GPHX-01**: Graph view supports filtering by tags and note type
- **GPHX-02**: Graph supports zoom, pan, and search within the graph view

### Testing (Advanced)

- **TEST-01**: End-to-end tests with Playwright or WebdriverIO hitting the Tauri window

### Content Types

- **CONT-01**: Scene templates (pre-populate slots with audio tracks)
- **CONT-02**: Map templates (pre-create pin categories or default annotations)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Scene or map templates | User confirmed notes-only templates for v1 |
| Mobile app | Desktop-first; no mobile plans |
| Real-time collaboration or sync | Single-user local vault architecture |
| E2E / Playwright tests | Broad unit coverage is the target for Foundation milestone |
| Rich graph filtering (tags, types, zoom) | Simple force graph is sufficient; advanced filtering deferred to v2 |

## Traceability

Which phases cover which requirements. Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUN-01 | Phase 1 | Pending |
| FOUN-02 | Phase 1 | Pending |
| FOUN-03 | Phase 1 | Pending |
| FOUN-04 | Phase 1 | Pending |
| FOUN-05 | Phase 1 | Pending |
| FOUN-06 | Phase 1 | Pending |
| FOUN-07 | Phase 1 | Pending |
| FOUN-08 | Phase 1 | Pending |
| FOUN-09 | Phase 1 | Pending |
| FOUN-10 | Phase 1 | Pending |
| FOUN-11 | Phase 1 | Pending |
| FOUN-12 | Phase 1 | Pending |
| FOUN-13 | Phase 2 | Pending |
| FOUN-14 | Phase 2 | Pending |
| FOUN-15 | Phase 1 | Pending |
| IMAG-01 | Phase 3 | Pending |
| IMAG-02 | Phase 3 | Pending |
| IMAG-03 | Phase 3 | Pending |
| TAG-01 | Phase 4 | Pending |
| TAG-02 | Phase 4 | Pending |
| TAG-03 | Phase 4 | Pending |
| TMPL-01 | Phase 5 | Pending |
| TMPL-02 | Phase 5 | Pending |
| TMPL-03 | Phase 5 | Pending |
| TIME-01 | Phase 6 | Pending |
| TIME-02 | Phase 6 | Pending |
| TIME-03 | Phase 6 | Pending |
| BACK-01 | Phase 7 | Pending |
| BACK-02 | Phase 7 | Pending |
| BACK-03 | Phase 7 | Pending |
| SRCH-01 | Phase 8 | Pending |
| SRCH-02 | Phase 8 | Pending |
| SRCH-03 | Phase 8 | Pending |
| SRCH-04 | Phase 8 | Pending |

**Coverage:**
- v1 requirements: 30 total
- Mapped to phases: 30
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-28*
*Last updated: 2026-04-28 after initial definition*
