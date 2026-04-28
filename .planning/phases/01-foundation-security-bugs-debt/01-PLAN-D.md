---
phase: 01-foundation-security-bugs-debt
plan: D
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/components/map/MapCanvas.svelte
  - src/routes/map/[id]/+page.svelte
autonomous: true
requirements:
  - FOUN-04
  - FOUN-06

must_haves:
  truths:
    - "Navigating between maps leaves no orphaned Leaflet layers — verified by reading the cleanup code and confirming it is correct"
    - "isLoadingData does not resolve to false until both the image fetch AND all three IPC calls (get_pins, get_pin_categories, get_annotations) have completed"
  artifacts:
    - path: "src/lib/components/map/MapCanvas.svelte"
      provides: "onMount cleanup comment confirming correct teardown; no orphaned layer risk from component-level Maps"
    - path: "src/routes/map/[id]/+page.svelte"
      provides: "Single Promise.all() wrapping image fetch + all three IPC calls; isLoadingData = false only after all resolve"
  key_links:
    - from: "src/routes/map/[id]/+page.svelte $effect"
      to: "isLoadingData = false"
      via: "Promise.all([get_pins, get_pin_categories, get_annotations, get_map_image_data_url]).finally()"
---

<objective>
Verify Leaflet cleanup is correct and add a documentation comment (FOUN-04), and fix the isLoadingData race where it resolves before all IPC data fetches complete (FOUN-06).

Purpose: The map loading race means the map renders before pins and annotations are ready, causing a flash of incomplete state. The Leaflet concern is verified-already-correct but needs an explanatory comment so future readers don't re-introduce a leak.

Output: A comment in MapCanvas.svelte onMount teardown explaining why no leak exists. A merged Promise.all in +page.svelte that coordinates image + IPC loading into a single completion gate.
</objective>

<execution_context>
@C:/Users/lamonta/Code/grimoire/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/lamonta/Code/grimoire/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@C:/Users/lamonta/Code/grimoire/.planning/ROADMAP.md
@C:/Users/lamonta/Code/grimoire/.planning/phases/01-foundation-security-bugs-debt/01-RESEARCH.md

<interfaces>
<!-- Current map loading $effect in +page.svelte (lines 68-99) -->
```typescript
$effect(() => {
    const m = mapData;
    if (!m) return;

    isLoadingData = true;
    // ...reset state...

    // PROBLEM: This Promise.all has no tie to isLoadingData
    Promise.all([
        invoke<Pin[]>("get_pins", { mapId: m.id }),
        invoke<PinCategory[]>("get_pin_categories"),
        invoke<MapAnnotation[]>("get_annotations", { mapId: m.id }),
    ])
    .then(([p, c, a]) => { pins = p; categories = c; annotations = a; })
    .catch(console.error);

    // PROBLEM: isLoadingData = false fires here, before get_pins etc complete
    if (m.image_path) {
        invoke<string>("get_map_image_data_url", { mapId: m.id })
            .then((url) => { imageDataUrl = url; })
            .catch(console.error)
            .finally(() => { isLoadingData = false; });  // fires without waiting for IPC
    } else {
        isLoadingData = false;
    }
});
```

<!-- MapCanvas.svelte onMount cleanup — already correct per research -->
// mapInstance?.remove() called on cleanup
// markerMap.clear() called on cleanup
// annotationLayerMap.clear() called on cleanup
// Both Maps are component-local (declared with let inside onMount or component scope)
// SvelteKit file-based routing unmounts +page.svelte on route change → triggers cleanup
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Verify Leaflet cleanup and add explanatory comment</name>
  <files>
    src/lib/components/map/MapCanvas.svelte
  </files>
  <read_first>
    - src/lib/components/map/MapCanvas.svelte — read the full onMount block to confirm: (a) mapInstance?.remove() is called on cleanup, (b) markerMap and annotationLayerMap are component-local (not module-level), (c) both Maps are cleared on cleanup
  </read_first>
  <action>
Read MapCanvas.svelte's onMount block in full. Confirm:
1. The cleanup function (returned from onMount) calls `mapInstance?.remove()`
2. `markerMap` and `annotationLayerMap` are declared inside the component (not at module scope with `let` outside onMount and outside the component function boundary)
3. Both Maps are cleared in the cleanup

If all three are confirmed, add this comment immediately above the cleanup return statement:

```typescript
// Cleanup note (FOUN-04): mapInstance.remove() tears down all Leaflet layers including
// markers and tile layers. markerMap and annotationLayerMap are component-local, so they
// are garbage collected when the component unmounts. SvelteKit file-based routing unmounts
// this component on every map-to-map navigation, so no orphaned layers accumulate.
// If this component is ever wrapped in a persistent layout container (keep-alive pattern),
// this cleanup must be re-verified.
return () => {
    mapInstance?.remove();
    markerMap.clear();
    annotationLayerMap.clear();
};
```

If any of the three conditions are NOT met (e.g., markerMap is at module scope), fix the scoping issue: move the Map declarations inside the component function or inside onMount, ensuring they are component-local.
  </action>
  <verify>
    <automated>cd C:/Users/lamonta/Code/grimoire && bun run check 2>&1 | tail -5</automated>
  </verify>
  <acceptance_criteria>
    - `bun run check` exits 0
    - `grep -n "FOUN-04\|keep-alive\|Cleanup note" src/lib/components/map/MapCanvas.svelte` returns at least 1 line
    - `grep -n "mapInstance.*remove\|markerMap\.clear\|annotationLayerMap\.clear" src/lib/components/map/MapCanvas.svelte` returns at least 3 lines (all three cleanup calls)
  </acceptance_criteria>
  <done>onMount cleanup is confirmed correct and has an explanatory comment; bun run check passes</done>
</task>

<task type="auto">
  <name>Task 2: Fix isLoadingData race — merge image and IPC fetches into one Promise.all</name>
  <files>
    src/routes/map/[id]/+page.svelte
  </files>
  <read_first>
    - src/routes/map/[id]/+page.svelte — read the $effect block (approximately lines 68-99) to understand the exact current structure before rewriting it
  </read_first>
  <action>
Replace the current loading $effect block with a version that wraps ALL async work in a single `Promise.all`, setting `isLoadingData = false` only after everything completes:

```typescript
$effect(() => {
    const m = mapData;
    if (!m) return;

    isLoadingData = true;
    selectedPin = null;
    selectedAnnotation = null;
    imageDataUrl = null;
    placingMode = false;
    annotationMode = null;

    const ipcFetches = Promise.all([
        invoke<Pin[]>("get_pins", { mapId: m.id }),
        invoke<PinCategory[]>("get_pin_categories"),
        invoke<MapAnnotation[]>("get_annotations", { mapId: m.id }),
    ]);

    const imageFetch = m.image_path
        ? invoke<string>("get_map_image_data_url", { mapId: m.id })
        : Promise.resolve(null);

    Promise.all([ipcFetches, imageFetch])
        .then(([[p, c, a], url]) => {
            pins = p;
            categories = c;
            annotations = a;
            imageDataUrl = url;
        })
        .catch(console.error)
        .finally(() => {
            isLoadingData = false;
        });
});
```

This ensures `isLoadingData` stays `true` until both the image AND the pins/categories/annotations have loaded (or an error has occurred). The loading spinner shown in the template (`{#if maps.isLoading || isLoadingData}`) will correctly cover the full data-fetch cycle.
  </action>
  <verify>
    <automated>cd C:/Users/lamonta/Code/grimoire && bun run check 2>&1 | tail -5</automated>
  </verify>
  <acceptance_criteria>
    - `bun run check` exits 0
    - `grep -n "Promise.all" src/routes/map/\[id\]/+page.svelte` returns at least 2 lines (the outer Promise.all wrapping both ipcFetches and imageFetch, plus the inner one)
    - `grep -n "isLoadingData = false" src/routes/map/\[id\]/+page.svelte` returns exactly 1 line (in the .finally() callback — not duplicated)
    - `grep -n "\.finally" src/routes/map/\[id\]/+page.svelte` returns 1 line in the loading effect
  </acceptance_criteria>
  <done>isLoadingData is not set to false until both image and IPC fetches complete; bun run check passes</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Frontend component lifecycle | Leaflet layers managed in component scope; no cross-component leak vectors |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01D-01 | Denial of Service | Leaflet layer accumulation causing memory growth and visual artifacts | accept | Research confirmed cleanup is already correct; comment documents the invariant |
| T-01D-02 | Tampering | User interacts with map while pins/annotations are still loading | mitigate | isLoadingData gates the entire canvas; UI shows spinner until all data ready |
</threat_model>

<verification>
After both tasks:

1. `bun run check` exits 0
2. `grep -n "isLoadingData = false" src/routes/map/\[id\]/+page.svelte` returns exactly 1 match (in .finally())
3. `grep -n "FOUN-04\|Cleanup note" src/lib/components/map/MapCanvas.svelte` returns a match
</verification>

<success_criteria>
- MapCanvas.svelte onMount cleanup has an explanatory comment confirming no layer leak
- Map page isLoadingData = false only after image + all three IPC fetches complete
- No flash of empty pin/annotation state when navigating to a map
- `bun run check` exits 0
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation-security-bugs-debt/01-D-SUMMARY.md`
</output>
