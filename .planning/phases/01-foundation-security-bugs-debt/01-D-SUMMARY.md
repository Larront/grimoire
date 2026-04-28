---
phase: 01-foundation-security-bugs-debt
plan: D
subsystem: maps
tags: [bug-fix, lifecycle, leaflet, loading-state, race-condition]
dependency_graph:
  requires: []
  provides: [FOUN-04, FOUN-06]
  affects:
    - src/lib/components/map/MapCanvas.svelte
    - src/routes/map/[id]/+page.svelte
tech_stack:
  added: []
  patterns:
    - Promise.all coordination for parallel async data loading
key_files:
  created: []
  modified:
    - src/lib/components/map/MapCanvas.svelte
    - src/routes/map/[id]/+page.svelte
decisions:
  - Merged ipcFetches and imageFetch into a single outer Promise.all rather than chaining them, ensuring isLoadingData gates both data streams with minimal code change
metrics:
  duration: ~10 minutes
  completed: 2026-04-28
---

# Phase 1 Plan D: Map Lifecycle — Leaflet Cleanup Comment and isLoadingData Race Fix Summary

**One-liner:** Documented correct Leaflet teardown in MapCanvas (FOUN-04) and fixed isLoadingData resolving before all IPC fetches complete via a merged Promise.all (FOUN-06).

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Verify Leaflet cleanup and add explanatory comment | 6a0ebb2 | src/lib/components/map/MapCanvas.svelte |
| 2 | Fix isLoadingData race — merge image and IPC fetches | 486b266 | src/routes/map/[id]/+page.svelte |

## What Was Built

### Task 1 — FOUN-04: Leaflet Cleanup Comment

Verified all three cleanup invariants in `MapCanvas.svelte`'s `onMount` return:
1. `mapInstance?.remove()` — tears down all Leaflet layers including markers and tile layers
2. `markerMap` and `annotationLayerMap` are component-local (declared in component function scope, not module scope)
3. Both Maps are cleared in the cleanup function

Added an explanatory comment immediately above the cleanup `return` statement documenting why no orphaned layer risk exists, and noting the caveat if the component is ever wrapped in a keep-alive pattern.

### Task 2 — FOUN-06: isLoadingData Race Fix

Replaced the disconnected loading pattern with a single outer `Promise.all` that coordinates both the IPC fetches (pins, pin categories, annotations) and the image fetch. Previously, `isLoadingData = false` fired after only the image fetch resolved, leaving the map interactive before pins and annotations were available — causing a flash of empty state on navigation.

New pattern:
```typescript
const ipcFetches = Promise.all([get_pins, get_pin_categories, get_annotations]);
const imageFetch = m.image_path ? get_map_image_data_url : Promise.resolve(null);

Promise.all([ipcFetches, imageFetch])
    .then(([[p, c, a], url]) => { /* assign all */ })
    .catch(console.error)
    .finally(() => { isLoadingData = false; });
```

When `image_path` is null, `imageFetch` resolves immediately with `null`, preserving the existing no-image behavior.

## Deviations from Plan

None — plan executed exactly as written. The `AppSearch.svelte` type error found during `bun run check` is pre-existing and unrelated to this plan's changes (confirmed by verifying the error existed before any modifications).

## Deferred Items

| Item | Reason |
|------|--------|
| `AppSearch.svelte` type error (`string` not assignable to `"map" \| "note"`) | Pre-existing, out of scope for this plan |

## Self-Check: PASSED

- `src/lib/components/map/MapCanvas.svelte` — modified, comment present at line 433
- `src/routes/map/[id]/+page.svelte` — modified, single `isLoadingData = false` at line 98
- Commit `6a0ebb2` — verified in git log
- Commit `486b266` — verified in git log
