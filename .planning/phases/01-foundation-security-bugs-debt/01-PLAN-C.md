---
phase: 01-foundation-security-bugs-debt
plan: C
type: execute
wave: 2
depends_on:
  - 01-PLAN-A
files_modified:
  - src/lib/stores/audio-engine.svelte.ts
  - src/lib/stores/vault.svelte.ts
  - src/lib/stores/notes.svelte.ts
  - src/lib/stores/scenes.svelte.ts
  - src/lib/stores/maps.svelte.ts
  - src/lib/components/sidebar/AppSidebar.svelte
  - src/lib/components/sidebar/FileTree.svelte
autonomous: true
requirements:
  - FOUN-03
  - FOUN-09

must_haves:
  truths:
    - "If crossfadeTo throws before the setTimeout is scheduled, isCrossfading is released immediately and does not remain true indefinitely"
    - "After creating or deleting a note, scene, or map in the sidebar, the item count reflects the updated total without a full app reload"
  artifacts:
    - path: "src/lib/stores/audio-engine.svelte.ts"
      provides: "crossfadeTo wrapped in try/catch; isCrossfading released in catch block when no timeout was scheduled"
    - path: "src/lib/stores/vault.svelte.ts"
      provides: "openVault calls add_recent_vault with current counts after mutations (documented pattern)"
    - path: "src/lib/stores/notes.svelte.ts"
      provides: "load() exposed; notes.load() called after create/delete in AppSidebar (already done — verify and document)"
  key_links:
    - from: "src/lib/stores/audio-engine.svelte.ts crossfadeTo"
      to: "isCrossfading lock"
      via: "catch block releases isCrossfading when scenes.getSlots() throws before setTimeout"
    - from: "AppSidebar.svelte handleNewNote / handleNewMap"
      to: "notes.load() / maps.load()"
      via: "already called — confirm count derivation is correct"
---

<objective>
Fix the crossfade lock bug (FOUN-03) and ensure vault item counts update after create/delete mutations (FOUN-09).

Purpose: The isCrossfading lock can become permanently true if scenes.getSlots() throws, freezing all future audio playback. The count staleness is lower severity but degrades the sidebar experience.

Output: crossfadeTo wrapped with try/catch that releases isCrossfading on error. Confirm (and document if already correct) that the notes/maps/scenes stores expose load() and that it is called after mutations.
</objective>

<execution_context>
@C:/Users/lamonta/Code/grimoire/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/lamonta/Code/grimoire/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@C:/Users/lamonta/Code/grimoire/.planning/ROADMAP.md
@C:/Users/lamonta/Code/grimoire/.planning/phases/01-foundation-security-bugs-debt/01-RESEARCH.md

<interfaces>
<!-- Current crossfadeTo structure (audio-engine.svelte.ts line 451-563) -->
```typescript
async function crossfadeTo(newSceneId: number): Promise<void> {
    if (newSceneId === activeSceneId) return;
    if (isCrossfading) { pendingSceneId = newSceneId; return; }

    loadingSceneId = newSceneId;

    const newSlots = await scenes.getSlots(newSceneId);  // ← CAN THROW HERE

    // ... more setup ...

    isCrossfading = true;  // ← set AFTER getSlots — so if getSlots throws, isCrossfading stays false
    // Wait — need to re-read actual line order from the file

    crossfadeTimeoutId = setTimeout(() => {
        // ... cleanup ...
        isCrossfading = false;  // only release point currently
    }, fadeSec * 1000);
}
```
NOTE: The actual line order in the file is: loadingSceneId set → getSlots() called → isCrossfading = true (line 473). If getSlots() throws, isCrossfading is still false. However the research confirms the real bug: isCrossfading is set TRUE before getSlots, and only released in the setTimeout. Re-read the file carefully before making changes.

<!-- vault.svelte.ts closeVault — currently frontend-only -->
```typescript
async function closeVault(): Promise<void> {
    path = null;
    isOpen = false;
    error = null;
    // Does NOT call invoke("close_vault") — fixed in Plan E
}
```

<!-- AppSidebar.svelte — already calls notes.load() and maps.load() after mutations -->
// handleNewNote: await notes.load(); refresh();
// handleNewMap: await maps.load(); refresh();
// Count is reactive via notes.notes.length and scenes.scenes.length
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix isCrossfading lock — wrap crossfadeTo in try/catch</name>
  <files>
    src/lib/stores/audio-engine.svelte.ts
  </files>
  <read_first>
    - src/lib/stores/audio-engine.svelte.ts — read the crossfadeTo function in full (approximately lines 451-563) to confirm the exact line where isCrossfading is set to true relative to the scenes.getSlots() call
  </read_first>
  <action>
Read the exact crossfadeTo function body first. There are two possible states to fix:

**Case A (if isCrossfading = true is set BEFORE getSlots):**
The current code sets `isCrossfading = true` and then calls `scenes.getSlots()`. If getSlots throws, isCrossfading is never released. The setTimeout is the only release point. Fix: wrap the body after `isCrossfading = true` in a try/catch, releasing in the catch:

```typescript
async function crossfadeTo(newSceneId: number): Promise<void> {
    if (newSceneId === activeSceneId) return;
    if (isCrossfading) {
        pendingSceneId = newSceneId;
        return;
    }

    loadingSceneId = newSceneId;
    isCrossfading = true;

    try {
        const newSlots = await scenes.getSlots(newSceneId);
        // ... rest of crossfade setup unchanged ...
        crossfadeTimeoutId = setTimeout(() => {
            // ... cleanup (unchanged) ...
            isCrossfading = false;
            // ...
        }, fadeSec * 1000);
    } catch (e) {
        console.error("[audio-engine] crossfadeTo failed:", e);
        isCrossfading = false;
        loadingSceneId = null;
    }
}
```

**Case B (if isCrossfading = true is set AFTER getSlots):**
After reading the file, if the actual order is: loadingSceneId → getSlots() → isCrossfading = true, then the original concern is that after isCrossfading is set and the code runs through to the setTimeout, an exception between `isCrossfading = true` and the `setTimeout(...)` call would leave it locked. Wrap the section from `isCrossfading = true` through the `setTimeout(...)` call in try/catch with the same catch handler.

**The key invariant to implement regardless of current order:**
- `isCrossfading = true` is set exactly once near the top of the function (or after getSlots if that's the existing order)
- A `catch` block ALWAYS sets `isCrossfading = false` and `loadingSceneId = null` when an error prevents the timeout from being scheduled
- The `setTimeout` callback continues to set `isCrossfading = false` as the normal completion path
- Do NOT use `finally` — the normal release is inside setTimeout, so finally would fire before the timeout and incorrectly release the lock on the happy path

After implementing: verify the catch block sets both `isCrossfading = false` AND `loadingSceneId = null`.
  </action>
  <verify>
    <automated>cd C:/Users/lamonta/Code/grimoire && bun run check 2>&1 | tail -5</automated>
  </verify>
  <acceptance_criteria>
    - `bun run check` exits 0
    - `grep -n "catch" src/lib/stores/audio-engine.svelte.ts | grep -i "crossfade\|isCrossfading"` OR the catch block is visible in the crossfadeTo function body
    - `grep -n "isCrossfading = false" src/lib/stores/audio-engine.svelte.ts` returns at least 2 lines (one in the catch block, one in the setTimeout callback)
    - `grep -n "finally" src/lib/stores/audio-engine.svelte.ts` — if any `finally` is added for crossfadeTo, it is NOT used as the release point (catch handles it)
  </acceptance_criteria>
  <done>crossfadeTo has a catch block that releases isCrossfading and loadingSceneId; bun run check passes</done>
</task>

<task type="auto">
  <name>Task 2: Verify and document vault item count update behavior (FOUN-09)</name>
  <files>
    src/lib/stores/notes.svelte.ts
    src/lib/stores/scenes.svelte.ts
    src/lib/stores/maps.svelte.ts
    src/lib/stores/vault.svelte.ts
    src/lib/components/sidebar/AppSidebar.svelte
    src/lib/components/sidebar/FileTree.svelte
  </files>
  <read_first>
    - src/lib/stores/notes.svelte.ts — confirm load() is exported and notes.length is $derived or direct
    - src/lib/stores/scenes.svelte.ts — confirm load() is exported
    - src/lib/stores/maps.svelte.ts — confirm load() is exported
    - src/lib/stores/vault.svelte.ts — read openVault and closeVault to understand the recent vault count flow
    - src/lib/components/sidebar/AppSidebar.svelte — confirm handleNewNote and handleNewMap call load() after mutations
  </read_first>
  <action>
The research identified two count surfaces:

1. **In-session store counts** (`notes.notes.length`, `scenes.scenes.length`, `maps.maps.length`): These update reactively whenever `load()` is called. The sidebar already calls `notes.load()` and `maps.load()` after create. Scenes create/delete also call `scenes.load()`. These are already correct.

2. **Recent vault counts** (in the splash screen recent vaults list): `vault.svelte.ts` `openVault()` calls `add_recent_vault` with the initial note/scene/map counts from `open_vault` result. These go stale after mutations.

**Fix for the recent vault counts:**

In `vault.svelte.ts`, `openVault()` currently calls `add_recent_vault` once. This is the only place the recent vault entry is written. After create/delete mutations, the sidebar already calls `notes.load()` — but it does NOT update the recent vault entry.

The fix: Export a `refreshRecentVaultCounts` function from `vault.svelte.ts` that calls `add_recent_vault` with the current counts:

```typescript
async function refreshRecentVaultCounts(noteCnt: number, sceneCnt: number, mapCnt: number): Promise<void> {
    if (!path) return;
    const name = path.split(/[\\/]/).pop() ?? "Untitled";
    invoke("add_recent_vault", {
        entry: {
            path,
            name,
            note_count: noteCnt,
            scene_count: sceneCnt,
            map_count: mapCnt,
            last_opened: new Date().toISOString(),
        },
    }).catch(console.error);
}
```

Then in `AppSidebar.svelte`, after `handleNewNote` and `handleNewMap` (which already call `notes.load()` and `maps.load()`), also call `vault.refreshRecentVaultCounts(notes.notes.length, scenes.scenes.length, maps.maps.length)`.

However, checking the research more carefully: the recent vault counts on the splash screen are only loaded when the vault is NOT open — they refresh the next time the user opens the vault. The sidebar mutations happen when the vault IS open. The in-session counts are already correct. The only visible staleness is on the splash screen for the NEXT session, and at that point `open_vault` returns fresh counts anyway.

**Decision**: The reactive in-session counts via `notes.notes.length` etc. are already correct (AppSidebar already calls `notes.load()` after create). The recent vault counts go stale but are refreshed on next `open_vault`. No code change is required for the in-session count display.

**Action**: Add an explanatory comment in `vault.svelte.ts` near the `add_recent_vault` call explaining this:

```typescript
// Item counts in this entry are set at open time and refreshed on the next open_vault call.
// In-session counts are derived reactively from notes.notes.length, scenes.scenes.length,
// and maps.maps.length — these update immediately after store.load() calls in the sidebar.
invoke("add_recent_vault", { ... })
```

Also add a comment in `notes.svelte.ts` noting that `load()` is the public API for count invalidation:

```typescript
// Called after any create/delete mutation to keep the count reactive.
// AppSidebar calls notes.load() after handleNewNote and delete operations.
async function load() { ... }
```

And add a `noteCount` derived getter to the return object for explicit access:
```typescript
return {
    get noteCount() { return notes.length; },
    // ... existing getters
};
```

Similarly for `scenes.svelte.ts`, expose `get sceneCount() { return scenes.length; }` and `maps.svelte.ts` expose `get mapCount() { return maps.length; }`.

Verify by reading AppSidebar.svelte and FileTree.svelte to confirm delete operations also call load() after deletion. If any delete handler does NOT call load(), add it.
  </action>
  <verify>
    <automated>cd C:/Users/lamonta/Code/grimoire && bun run check 2>&1 | tail -5</automated>
  </verify>
  <acceptance_criteria>
    - `bun run check` exits 0
    - `grep -n "noteCount\|get noteCount" src/lib/stores/notes.svelte.ts` returns at least 1 line
    - `grep -n "sceneCount\|get sceneCount" src/lib/stores/scenes.svelte.ts` returns at least 1 line
    - `grep -n "mapCount\|get mapCount" src/lib/stores/maps.svelte.ts` returns at least 1 line
    - `grep -n "notes\.load\|maps\.load\|scenes\.load" src/lib/components/sidebar/AppSidebar.svelte` returns at least 2 lines (create handlers already call load)
  </acceptance_criteria>
  <done>noteCount/sceneCount/mapCount derived getters exist on stores; AppSidebar calls load() after all create/delete mutations; bun run check passes</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Audio engine internal state | isCrossfading is a boolean lock internal to the store; no external input required |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01C-01 | Denial of Service | `isCrossfading` lock permanently set if `scenes.getSlots()` throws | mitigate | catch block releases lock; audio engine recoverable from any scene load failure |
| T-01C-02 | Denial of Service | Stale vault counts mislead user about vault contents | accept | Counts are cosmetic on the splash screen; in-session counts are always reactive |
</threat_model>

<verification>
After both tasks:

1. `bun run check` exits 0
2. `grep -n "isCrossfading = false" src/lib/stores/audio-engine.svelte.ts` returns at least 2 matches
3. `grep -n "catch" src/lib/stores/audio-engine.svelte.ts` includes a match inside crossfadeTo
4. Derived count getters exist on all three stores
</verification>

<success_criteria>
- crossfadeTo has a catch block that releases isCrossfading and loadingSceneId on any error
- Audio playback is not permanently frozen by a failed scene load
- Vault item counts update immediately in-session after create/delete mutations
- `bun run check` exits 0
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation-security-bugs-debt/01-C-SUMMARY.md`
</output>
