---
phase: 01-foundation-security-bugs-debt
plan: C
subsystem: audio, ui
tags: [svelte5, runes, audio-engine, crossfade, state-management, stores]

# Dependency graph
requires:
  - phase: 01-A
    provides: Spotify API calls moved to Rust backend; IPC bridge secured
provides:
  - crossfadeTo wrapped in try/catch; isCrossfading lock released on any error path
  - noteCount/sceneCount/mapCount derived getters on all three data stores
  - FileTree.svelte calls notes.load() and maps.load() after delete mutations
  - vault.svelte.ts documents the count pattern
affects:
  - audio playback reliability
  - sidebar item count accuracy

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Try/catch with explicit lock release: async lock variables must be released in catch, not finally, when the normal release is inside a callback"
    - "Derived count getters: expose store.noteCount / sceneCount / mapCount for explicit reactive count access alongside store.notes.length"

key-files:
  created: []
  modified:
    - src/lib/stores/audio-engine.svelte.ts
    - src/lib/stores/notes.svelte.ts
    - src/lib/stores/scenes.svelte.ts
    - src/lib/stores/maps.svelte.ts
    - src/lib/stores/vault.svelte.ts
    - src/lib/components/sidebar/FileTree.svelte

key-decisions:
  - "Move isCrossfading = true before scenes.getSlots() so the lock is held during the entire async operation, making the guard reliable"
  - "Use catch (not finally) to release isCrossfading because normal release is inside setTimeout callback — finally would fire before the timeout"
  - "Accept recent vault counts as cosmetically stale at splash screen; in-session counts are always reactive via store.load()"

patterns-established:
  - "Count invalidation pattern: call store.load() after every create/delete mutation — AppSidebar and FileTree are both required call sites"

requirements-completed:
  - FOUN-03
  - FOUN-09

# Metrics
duration: 4min
completed: 2026-04-28
---

# Phase 01-C: Crossfade Lock Fix and Vault Count Update Summary

**crossfadeTo wrapped in try/catch to release isCrossfading on error, plus noteCount/sceneCount/mapCount derived getters and FileTree delete load() fixes**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-28T19:28:57Z
- **Completed:** 2026-04-28T19:32:12Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Fixed FOUN-03: isCrossfading lock can no longer be permanently stuck if scenes.getSlots() throws or any setup step fails before setTimeout is scheduled
- Added noteCount/sceneCount/mapCount derived getters to all three data stores for explicit reactive count access
- Fixed FileTree.svelte: notes.load() and maps.load() now called after delete mutations so in-session counts update immediately
- Documented the recent-vault vs in-session count pattern in vault.svelte.ts

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix isCrossfading lock** - `6df6c09` (fix)
2. **Task 2: Verify and document vault item count update behavior** - `078580d` (feat)

**Plan metadata:** (committed with SUMMARY)

## Files Created/Modified
- `src/lib/stores/audio-engine.svelte.ts` - crossfadeTo wrapped in try/catch; isCrossfading = true moved before getSlots(); catch block releases lock and loadingSceneId
- `src/lib/stores/notes.svelte.ts` - added noteCount getter; added count invalidation pattern comment on load()
- `src/lib/stores/scenes.svelte.ts` - added sceneCount getter; added count invalidation pattern comment
- `src/lib/stores/maps.svelte.ts` - added mapCount getter; added count invalidation pattern comment
- `src/lib/stores/vault.svelte.ts` - added explanatory comment on add_recent_vault documenting count staleness behavior
- `src/lib/components/sidebar/FileTree.svelte` - added notes/maps store imports; confirmDelete now calls notes.load() after note/folder delete and maps.load() after map delete

## Decisions Made
- Move isCrossfading = true before scenes.getSlots() rather than after: this makes the lock guard reliable for the full async operation instead of just the tail
- Use catch block (not finally) to release the lock: the normal release is inside the setTimeout callback which fires after the fade duration, so a finally block would fire before that and prematurely release the lock on the happy path
- Recent vault counts (splash screen): accepted as cosmetically stale between sessions; in-session counts are always reactive; no code change needed for the splash screen behavior

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] FileTree.svelte delete handlers missing load() calls**
- **Found during:** Task 2 (FOUN-09 verification)
- **Issue:** confirmDelete in FileTree.svelte called only refresh() after deleting notes, maps, and folders — did not call notes.load() or maps.load(), so in-session counts would not update until next vault open
- **Fix:** Added notes/maps store imports; added notes.load() after note and folder deletes, maps.load() after map delete
- **Files modified:** src/lib/components/sidebar/FileTree.svelte
- **Verification:** bun run check passes; load() now called at all four mutation sites (AppSidebar create + FileTree delete)
- **Committed in:** 078580d (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 2 — missing critical functionality)
**Impact on plan:** Auto-fix directly addressed the FOUN-09 bug that the task was written to resolve. The plan's action section noted "verify by reading AppSidebar and FileTree" — the verification found the missing load() calls in FileTree. Fixing it was the correct scope-completing action.

## Issues Encountered
- Pre-existing type error in `src/lib/components/AppSearch.svelte` (SearchResult type mismatch): confirmed pre-existing before our changes. Out of scope per deviation rules — logged to deferred items.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Audio engine is robust: crossfade lock cannot permanently freeze audio playback
- In-session item counts update correctly on all create and delete mutations
- Store count getters (noteCount, sceneCount, mapCount) available for any future UI that needs explicit counts
- Ready for remaining Phase 1 plans (D, E, F)

---
*Phase: 01-foundation-security-bugs-debt*
*Completed: 2026-04-28*

## Self-Check: PASSED

Files verified:
- FOUND: src/lib/stores/audio-engine.svelte.ts
- FOUND: src/lib/stores/notes.svelte.ts
- FOUND: src/lib/stores/scenes.svelte.ts
- FOUND: src/lib/stores/maps.svelte.ts
- FOUND: src/lib/stores/vault.svelte.ts
- FOUND: src/lib/components/sidebar/FileTree.svelte

Commits verified:
- FOUND: 6df6c09 (fix crossfadeTo try/catch)
- FOUND: 078580d (count getters + delete load fixes)
