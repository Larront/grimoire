# Roadmap: Grimoire

## Overview

Grimoire is a Tauri 2 desktop worldbuilding app for tabletop RPG game masters. The existing codebase delivers vault management, notes, scenes, maps, and Spotify integration. This roadmap covers the next phase of development: first resolving security vulnerabilities, bugs, and tech debt (Foundation), establishing a test harness, then delivering eight distinct feature capabilities — images in notes, tagging, templates, timeline blocks, backlinks + graph view, and a global command palette.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation — Security, Bugs & Debt** - Resolve all high-severity security issues, known bugs, and tech debt before any new surface area is added
- [ ] **Phase 2: Foundation — Test Infrastructure** - Establish Vitest and Rust unit test suites covering all stores and command handlers
- [ ] **Phase 3: Images** - User can insert images from their filesystem directly into notes
- [ ] **Phase 4: Tags** - Notes can be tagged, persisted, and filtered by tag in the sidebar
- [ ] **Phase 5: Templates** - User can create notes from built-in or custom templates
- [ ] **Phase 6: Timeline** - A horizontally scrollable timeline block can be embedded in any note
- [ ] **Phase 7: Backlinks + Graph** - Every note shows its inbound wikilinks and tags; a graph view renders all note connections
- [ ] **Phase 8: Search + Command Palette** - A global ⌘K command palette enables note search, navigation, and app-level actions

## Phase Details

### Phase 1: Foundation — Security, Bugs & Debt
**Goal**: The codebase is secure, stable, and clean — no known security vulnerabilities, no reproducing bugs, no misleading debt — before any new feature work begins
**Depends on**: Nothing (first phase)
**Requirements**: FOUN-01, FOUN-02, FOUN-03, FOUN-04, FOUN-05, FOUN-06, FOUN-07, FOUN-08, FOUN-09, FOUN-10, FOUN-11, FOUN-12, FOUN-15
**Success Criteria** (what must be TRUE):
  1. Spotify access token never crosses the IPC bridge to the renderer — all Spotify API calls are made from Rust
  2. Any path containing `..` or escaping the vault root is rejected before any file read or write
  3. Audio crossfade cannot permanently freeze: `isCrossfading` is always released even when an error occurs mid-crossfade
  4. Navigating between maps leaves no orphaned Leaflet layers; repeated map-to-map navigation shows no visual artifacts or memory growth
  5. Vault item counts update immediately after a create or delete without requiring a full reload
**Plans**: 6 plans
Plans:

**Wave 1** *(independent — can run in parallel)*
- [ ] 01-PLAN-A.md — Spotify token security: move API calls to Rust, fix OAuth unlisten, cache client ID (FOUN-01, FOUN-05, FOUN-10)
- [ ] 01-PLAN-B.md — Path traversal guard: validate user-supplied paths in notes.rs and media.rs (FOUN-02)
- [ ] 01-PLAN-D.md — Leaflet cleanup verification + isLoadingData race fix (FOUN-04, FOUN-06)
- [ ] 01-PLAN-F.md — Git workflow: next branch + CLAUDE.md documentation (FOUN-15)

**Wave 2** *(blocked on Wave 1 completion)*
- [ ] 01-PLAN-C.md — Crossfade lock fix and vault item count update (FOUN-03, FOUN-09) *(depends on A: audio-engine.svelte.ts)*
- [ ] 01-PLAN-E.md — Rust backend debt: close_vault, boolean migration, RFC3339 timestamps, _note_path rename (FOUN-07, FOUN-08, FOUN-11, FOUN-12) *(depends on A: VaultState, B: notes.rs)*

Cross-cutting constraints:
- All Spotify API calls go through Rust (no renderer fetch to api.spotify.com)
- Path validation (`validate_path`) applied to all file-touching Rust commands
**UI hint**: no

### Phase 2: Foundation — Test Infrastructure
**Goal**: A repeatable test harness exists that catches regressions in all Svelte 5 stores and Rust command handlers before they reach production
**Depends on**: Phase 1
**Requirements**: FOUN-13, FOUN-14
**Success Criteria** (what must be TRUE):
  1. Running `bun run test` (or equivalent) executes Vitest unit tests for all five Svelte 5 stores: vault, notes, scenes, audio-engine, maps
  2. Running `cargo test` executes Rust unit tests for all six command handler modules: notes, scenes, maps, vault, spotify, media
  3. The audio engine crossfade and `isCrossfading` lock paths are covered by at least one test each
**Plans**: TBD

### Phase 3: Images
**Goal**: Users can enrich notes with images from anywhere on their system; images are embedded inline in the editor and kept inside the vault
**Depends on**: Phase 1
**Requirements**: IMAG-01, IMAG-02, IMAG-03
**Success Criteria** (what must be TRUE):
  1. User can open a system file picker from within the note editor and select an image file
  2. The selected image is automatically copied into the vault's media directory without any manual action
  3. The image renders inline inside the TipTap editor immediately after insertion
**Plans**: TBD
**UI hint**: yes

### Phase 4: Tags
**Goal**: Users can categorize notes with tags and quickly find all notes belonging to a given tag
**Depends on**: Phase 1
**Requirements**: TAG-01, TAG-02, TAG-03
**Success Criteria** (what must be TRUE):
  1. User can add one or more tags to any note from the note UI, and tags appear on the note immediately
  2. Tags survive closing and reopening the vault — they are persisted in the database
  3. User can click a tag in the sidebar to see only notes with that tag
**Plans**: TBD
**UI hint**: yes

### Phase 5: Templates
**Goal**: Users can skip blank-page friction by creating notes from curated built-in templates or their own saved templates
**Depends on**: Phase 1
**Requirements**: TMPL-01, TMPL-02, TMPL-03
**Success Criteria** (what must be TRUE):
  1. User can create a new note pre-populated with an NPC, Location, Session Log, or Encounter structure from the built-in template list
  2. User can save the current note as a named custom template
  3. User can create a new note from any previously saved custom template
**Plans**: TBD
**UI hint**: yes

### Phase 6: Timeline
**Goal**: Users can embed a visual, editable timeline block directly inside a note to track in-world events in sequence
**Depends on**: Phase 1
**Requirements**: TIME-01, TIME-02, TIME-03
**Success Criteria** (what must be TRUE):
  1. User can insert a timeline block via the `/` slash command inside any note
  2. User can add, edit, and remove named and dated events within a timeline block without leaving the note
  3. The timeline block scrolls horizontally for long event sequences and is styled with the Grimoire fantasy aesthetic
**Plans**: TBD
**UI hint**: yes

### Phase 7: Backlinks + Graph
**Goal**: Users can see at a glance which notes reference the current note, what tags it carries, and how the entire vault is connected at a global level
**Depends on**: Phase 4
**Requirements**: BACK-01, BACK-02, BACK-03
**Success Criteria** (what must be TRUE):
  1. Every note page shows a details panel listing all other notes that link to it via `[[wikilinks]]`
  2. The same details panel shows the note's current tags (requires Phase 4 tags to be present)
  3. Navigating to `/graph` shows all notes as a force-directed graph where clicking any node navigates to that note
**Plans**: TBD
**UI hint**: yes

### Phase 8: Search + Command Palette
**Goal**: Users can reach any note, scene, map, or app action from anywhere in the app with a single keystroke
**Depends on**: Phase 1
**Requirements**: SRCH-01, SRCH-02, SRCH-03, SRCH-04
**Success Criteria** (what must be TRUE):
  1. Pressing ⌘K (Mac) or Ctrl+K (Windows/Linux) from anywhere in the app opens the command palette
  2. Typing in the palette searches note titles and content full-text and shows matching results
  3. User can navigate directly to any scene or map from the palette without going through the sidebar
  4. User can trigger app-level actions (new note, open vault, go to graph) from the palette
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation — Security, Bugs & Debt | 0/6 | Not started | - |
| 2. Foundation — Test Infrastructure | 0/TBD | Not started | - |
| 3. Images | 0/TBD | Not started | - |
| 4. Tags | 0/TBD | Not started | - |
| 5. Templates | 0/TBD | Not started | - |
| 6. Timeline | 0/TBD | Not started | - |
| 7. Backlinks + Graph | 0/TBD | Not started | - |
| 8. Search + Command Palette | 0/TBD | Not started | - |
