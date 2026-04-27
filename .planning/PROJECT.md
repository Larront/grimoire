# Grimoire

## What This Is

Grimoire is a Tauri 2 desktop worldbuilding app for tabletop RPG game masters. Users open a "vault" (a directory on their filesystem) to manage interconnected Notes (Markdown with rich blocks), Scenes (layered ambient audio slots), and Maps (annotated images with pins). The product serves two modes: deep creative worldbuilding and fast in-session reference — the UI must serve both without friction.

## Core Value

A GM opens their vault and has immediate, reliable access to every piece of their world — and can add to it without the app getting in the way.

## Requirements

### Validated

These capabilities exist in the current codebase and are considered working and committed.

- ✓ Vault open/close lifecycle — existing (v0.x)
- ✓ Notes: create, read, edit, delete Markdown notes via TipTap — existing (v0.x)
- ✓ Wikilink `[[...]]` syntax in editor — existing (v0.x)
- ✓ Scenes: create/manage scenes with layered audio slots — existing (v0.x)
- ✓ Maps: view annotated images with pins and pin categories — existing (v0.x)
- ✓ Media file copying into vault — existing (v0.x)
- ✓ Spotify OAuth + playback integration — existing (v0.x)
- ✓ Sidebar navigation with file tree and context menus — existing (v0.x)

### Active

- [ ] [Foundation] Resolve all High-severity security concerns (Spotify token in renderer, path traversal in file ops)
- [ ] [Foundation] Fix all known bugs (crossfade lock leak, Leaflet layer accumulation, Spotify OAuth listener leak, isLoadingData race)
- [ ] [Foundation] Resolve tech debt (close_vault Rust command, bool column migrations, stale counts, timestamp format, Spotify client ID state)
- [ ] [Foundation] Vitest unit test suite covering all Svelte 5 stores and Rust command handlers
- [ ] [Foundation] Implement git flow: `next` integration branch, `feature/*` branching, hotfix protocol, issue-closing commit keywords
- [ ] [Images] User can insert an image from anywhere on their system into a note; image is copied to vault media directory
- [ ] [Tags] Notes can be tagged; tags are visible and editable on the note
- [ ] [Tags] Notes can be filtered/browsed by tag in the sidebar
- [ ] [Templates] User can create a note from a built-in template (NPC, Location, Session Log, Encounter)
- [ ] [Templates] User can save any note as a custom template and use it later
- [ ] [Timeline] A "timeline" TipTap block can be embedded in a note; fantasy-styled, horizontally scrollable, events can be added/edited
- [ ] [Backlinks] A details panel on every note lists all notes that link to the current note, and shows the note's tags
- [ ] [Backlinks] A dedicated graph view (`/graph`) renders all notes as a force-directed graph; nodes are clickable to navigate
- [ ] [Search] Global command palette (⌘K) surfaces note search, navigation to scenes/maps, and app-level actions

### Out of Scope

- Scene or map templates — user confirmed notes only
- Mobile app — desktop-first, no mobile plans
- Real-time collaboration or sync — single-user local vault
- E2E / Playwright tests — broad unit coverage is the target, not e2e
- Rich graph filtering (tags, types, zoom) — simple force graph is sufficient for v1

## Context

- **Codebase map** is complete in `.planning/codebase/` — read ARCHITECTURE.md and CONCERNS.md before planning each phase
- **Wikilink parsing** is partially implemented in `src/lib/editor/wiki-link.ts` — backlinks milestone can build on this
- **`@tiptap/extension-image`** is already a dependency — images milestone has a foundation
- **`@tauri-apps/plugin-dialog`** is available — can be used for the image file picker
- **Security debt is High severity** — path traversal and Spotify token exposure must be resolved in the first milestone before any new surface area is added
- **No frontend test suite exists** — Vitest is the natural choice given the Vite/Bun setup
- **Git flow** is documented in `flow.md` at the repo root — the foundation milestone implements it

## Constraints

- **Tech stack:** Tauri 2 + SvelteKit (Svelte 5 runes) + Rust/Diesel/SQLite — no deviations; all features must fit this architecture
- **Rune-based stores only:** No Svelte 4 primitives (`writable`, `readable`, `derived`) — use `$state`/`$derived` throughout
- **Asset protocol:** Large files (images, audio) must use `convertFileSrc()` + asset protocol, not IPC byte transfer
- **Milestone sequencing:** Tags milestone must precede Backlinks (tags appear in the backlinks panel); security fixes must precede new feature surface area

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Cleanup milestone first | Security vulnerabilities and fragile state exist; adding features on a cracked foundation compounds risk | — Pending |
| Tags as standalone milestone | Tagging has its own DB schema, UI, and filtering scope — too large to bundle into Backlinks | — Pending |
| Timeline as TipTap custom node | Keeps timelines embedded in note context, consistent with the block-based editor model | — Pending |
| Backlinks panel + separate /graph route | Per-note panel for in-context reference; graph view for global exploration — different interaction modes | — Pending |
| Vitest for frontend testing | Aligns with Vite/Bun toolchain; no additional runtime needed | — Pending |
| Git flow: main/next/feature/* | Documented in flow.md; supports batching features into releases with a stable main | — Pending |
| Images copied to vault on insert | Keeps vault self-contained; consistent with how audio media is handled | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-28 after initialization*
