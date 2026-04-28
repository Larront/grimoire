---
phase: 01-foundation-security-bugs-debt
plan: E
subsystem: database
tags: [rust, diesel, sqlite, svelte5, tauri, migrations, boolean, rfc3339]

requires:
  - phase: 01-A
    provides: VaultState with spotify_client_id; vault.rs structure used by close_vault
  - phase: 01-B
    provides: validate_path helpers in notes.rs/scenes.rs (context only)

provides:
  - close_vault Tauri command that drops SQLite connection and vault path from Rust state
  - Boolean columns in SQLite (is_loop, shuffle, archived) via Diesel migration
  - Diesel models using bool for SceneSlot.is_loop, SceneSlot.shuffle, Note.archived
  - TypeScript types using boolean for SceneSlot.shuffle, Note.archived
  - All application-generated timestamps in maps.rs use RFC3339 format
  - create_note parameter renamed from _note_path to note_path

affects:
  - scenes playback state (SceneSlot.is_loop, SceneSlot.shuffle type change)
  - notes list (Note.archived type change)
  - vault lifecycle (close_vault must be called before re-opening a different vault)

tech-stack:
  added: []
  patterns:
    - "Table recreation pattern for SQLite column type changes (PRAGMA foreign_keys OFF/ON, CREATE new, INSERT SELECT, DROP old, RENAME)"
    - "Diesel schema.rs primary key override: manually set id -> Integer when SQLite introspection generates Nullable<Integer> for AUTOINCREMENT tables"

key-files:
  created:
    - src-tauri/migrations/2026-04-28-000000-0000_fix_boolean_columns/up.sql
    - src-tauri/migrations/2026-04-28-000000-0000_fix_boolean_columns/down.sql
  modified:
    - src-tauri/src/commands/vault.rs
    - src-tauri/src/lib.rs
    - src-tauri/src/commands/notes.rs
    - src-tauri/src/commands/maps.rs
    - src/lib/stores/vault.svelte.ts
    - src-tauri/src/db/models.rs
    - src-tauri/src/db/schema.rs
    - src-tauri/src/commands/scenes.rs
    - src/lib/types/vault.ts

key-decisions:
  - "close_vault keeps spotify_client_id on VaultState — it is app-level config (from env var), not vault-specific data"
  - "schema.rs primary keys manually set to Integer after Diesel SQLite introspection generated Nullable<Integer> for AUTOINCREMENT tables created via table recreation migration"
  - "SceneWithCount.favorited remains i32 — Scene.favorited is an integer toggle field (not a boolean), not in scope for this plan"

patterns-established:
  - "Table recreation migration pattern: all future SQLite column type changes use CREATE new / INSERT SELECT / DROP / RENAME"
  - "schema.rs is auto-generated but primary key nullability must be verified after migrations that recreate tables"

requirements-completed:
  - FOUN-07
  - FOUN-08
  - FOUN-11
  - FOUN-12

duration: 25min
completed: 2026-04-29
---

# Phase 01 Plan E: Tech Debt — close_vault, boolean migration, timestamp normalization Summary

**close_vault Tauri command drops SQLite on vault close; Diesel migration fixes BOOLEAN columns in scene_slots and notes; maps.rs timestamps normalized to RFC3339; create_note parameter lint cleaned up**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-04-29T00:00:00Z
- **Completed:** 2026-04-29T00:25:00Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- close_vault Rust command releases the SQLite file handle and clears vault state; frontend now calls it before clearing local state
- Diesel migration recreates scene_slots (is_loop, shuffle) and notes (archived) with BOOLEAN columns; data is preserved via CASE WHEN conversion
- All Diesel model structs (SceneSlot, NewSceneSlot, UpdateSceneSlot, Note) use `bool` instead of `i32`; TypeScript counterparts updated to `boolean`
- maps.rs assign_map_image now uses `Utc::now().to_rfc3339()` — consistent with RFC3339 format used everywhere else
- create_note `_note_path` parameter renamed to `note_path`; the underscore suppression was misleading since the parameter is actively used

## Task Commits

1. **Task 1: Add close_vault command; rename _note_path; fix maps.rs timestamp** - `e01634b` (feat)
2. **Task 2: Boolean column migration; update Diesel models and TypeScript types** - `b9a8b01` (feat)

**Plan metadata:** (committed with SUMMARY.md)

## Files Created/Modified

- `src-tauri/migrations/2026-04-28-000000-0000_fix_boolean_columns/up.sql` - Migration recreating scene_slots and notes with BOOLEAN columns + timestamp normalization
- `src-tauri/migrations/2026-04-28-000000-0000_fix_boolean_columns/down.sql` - Revert migration restoring INTEGER columns
- `src-tauri/src/commands/vault.rs` - close_vault command added after get_vault_path
- `src-tauri/src/lib.rs` - close_vault registered in invoke_handler
- `src-tauri/src/commands/notes.rs` - _note_path renamed to note_path in create_note
- `src-tauri/src/commands/maps.rs` - assign_map_image timestamp uses to_rfc3339()
- `src/lib/stores/vault.svelte.ts` - closeVault() calls invoke("close_vault") before clearing state
- `src-tauri/src/db/models.rs` - SceneSlot.is_loop, SceneSlot.shuffle, Note.archived changed to bool
- `src-tauri/src/db/schema.rs` - Bool for is_loop/shuffle/archived; primary key nullability corrected
- `src-tauri/src/commands/scenes.rs` - NewSceneSlot/UpdateSceneSlot callers pass bool directly; test literals updated

## Decisions Made

- `spotify_client_id` is intentionally preserved in close_vault — it is an app-level env var loaded at startup, not vault-specific data.
- schema.rs primary key fix was a Rule 1 auto-fix: Diesel SQLite introspection generates `Nullable<Integer>` for `INTEGER PRIMARY KEY AUTOINCREMENT` columns in tables created via CREATE TABLE (as opposed to Diesel's own migration). The fix is to manually set `id -> Integer` in schema.rs for affected tables.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Nullable<Integer> primary key types in schema.rs after migration**
- **Found during:** Task 2 (boolean column migration)
- **Issue:** After `diesel migration run`, schema.rs generated `id -> Nullable<Integer>` for the recreated scene_slots, notes, scenes, and spotify_auth tables. This caused 30 compile errors (type mismatch, CompatibleType not satisfied) because all Diesel model structs use `pub id: i32` and `Identifiable` requires a non-nullable primary key.
- **Fix:** Manually corrected `id -> Nullable<Integer>` to `id -> Integer` in schema.rs for all four affected tables. This is correct: SQLite `INTEGER PRIMARY KEY` is never null; the Diesel SQLite introspector incorrectly infers nullability for tables created outside of its own migration tooling.
- **Files modified:** `src-tauri/src/db/schema.rs`
- **Verification:** `cargo build` succeeds after correction
- **Committed in:** `b9a8b01` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Required for build to succeed. Diesel SQLite schema introspection limitation; documented pattern for future migrations that recreate tables.

## Issues Encountered

- Diesel SQLite introspection infers `Nullable<Integer>` for AUTOINCREMENT primary keys when tables are created via raw SQL migration (table recreation pattern). This is a known Diesel limitation for SQLite. Future migrations using this pattern must manually verify and fix primary key types in schema.rs.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Vault lifecycle is now clean: open and close both have Rust-backed commands
- Boolean type parity between Rust (Diesel) and TypeScript eliminates integer coercion bugs in scene slot playback
- RFC3339 timestamp consistency enables correct ORDER BY across all map records
- Plan F (remaining tech debt items) can proceed without concern about these issues

## Self-Check: PASSED

- FOUND: src-tauri/migrations/2026-04-28-000000-0000_fix_boolean_columns/up.sql
- FOUND: src-tauri/migrations/2026-04-28-000000-0000_fix_boolean_columns/down.sql
- FOUND: src-tauri/src/commands/vault.rs (close_vault command added)
- FOUND: src-tauri/src/lib.rs (close_vault registered)
- FOUND: src-tauri/src/db/models.rs (bool fields)
- FOUND: src-tauri/src/db/schema.rs (Bool columns, corrected Integer PKs)
- FOUND: src/lib/stores/vault.svelte.ts (invoke close_vault)
- FOUND: src/lib/types/vault.ts (boolean types)
- FOUND: .planning/phases/01-foundation-security-bugs-debt/01-E-SUMMARY.md
- FOUND: e01634b (Task 1 commit)
- FOUND: b9a8b01 (Task 2 commit)
