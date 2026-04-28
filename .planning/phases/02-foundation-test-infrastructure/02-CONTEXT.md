# Phase 2: Foundation — Test Infrastructure - Context

**Gathered:** 2026-04-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Establish a repeatable test harness that catches regressions in all Svelte 5 stores and Rust command handlers before they reach production. Covers: Vitest unit tests for all five stores, `cargo test` unit tests for all six command handler modules, and the `bun run test` / `cargo test` scripts to run them. No E2E tests, no CI pipeline — unit coverage only.

</domain>

<decisions>
## Implementation Decisions

### Svelte store mocking strategy
- **D-01:** Use `vi.mock('@tauri-apps/api/core', ...)` in each test file to intercept `invoke()` and `convertFileSrc()` calls. No service wrapper or dependency injection — stores stay unchanged. Each test file declares the mocks it needs inline.

### Audio engine test approach
- **D-02:** Mock `AudioContext` and Web Audio API nodes (`GainNode`, `AnalyserNode`, `AudioBufferSourceNode`) globally in the Vitest setup file — Web Audio is not available in jsdom. Test the `isCrossfading` lock and crossfade lifecycle by controlling when mock promises resolve and reject. Test state machine behavior, not audio output.
- **D-03:** The success criteria require at least one test each for the crossfade path and the `isCrossfading` lock release. That is the minimum bar — add more if error paths are naturally covered by the mock setup.

### Rust test placement
- **D-04:** Inline `#[cfg(test)]` modules inside each command file (co-located, idiomatic Rust). Use `tempfile::NamedTempFile` + Diesel migrations to create a real in-memory/temp SQLite DB per test — no mocked connections. Each test is self-contained.

### AppSearch type error
- **D-05:** Not part of Phase 2. The user has already commented out the relevant fields in `AppSearch.svelte`. Type-checking is clean. No further action needed this phase.

### Vitest setup
- **D-06:** Add `vitest` as a dev dependency. Configure `vitest.config.ts` with `environment: 'jsdom'` and the `@sveltejs/vite-plugin-svelte` plugin to handle `.svelte.ts` rune files. Add a Vitest setup file for global mocks (AudioContext, window.matchMedia). `bun run test` runs `vitest run` (single-pass CI mode); `bun run test:watch` runs `vitest` (interactive watch mode).

### Claude's Discretion
- Exact AudioContext mock implementation (vi.fn() stubs for each node type)
- Whether to use `@testing-library/svelte` or raw Vitest imports for stores (stores are `.svelte.ts` not `.svelte` components — raw imports are likely sufficient)
- Specific Rust migration setup helper function (shared `setup_db()` or per-test)
- Which assertions to write for each store beyond the required crossfade/isCrossfading coverage

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Test gap analysis
- `.planning/codebase/TESTING.md` — existing test coverage gaps, priority order, recommended Vitest setup, Rust `tempfile` + Diesel DB pattern

### Requirements
- `.planning/REQUIREMENTS.md` FOUN-13 — Vitest tests must cover all five stores (vault, notes, scenes, audio-engine, maps)
- `.planning/REQUIREMENTS.md` FOUN-14 — Rust tests must cover all six command handler modules (notes, scenes, maps, vault, spotify, media)

### Key source files
- `src/lib/stores/audio-engine.svelte.ts` — 506-line store; contains crossfade logic and `isCrossfading` lock that success criteria require coverage for
- `src/lib/stores/vault.svelte.ts` — 119-line store; vault open/close lifecycle that drives all other stores
- `src-tauri/Cargo.toml` — `tempfile = "3"` already in dev-dependencies; Diesel migration runner available

### Phase success criteria
- `ROADMAP.md` Phase 2 section — three measurable success criteria including specific coverage requirements for crossfade and `isCrossfading`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `tempfile` crate already in `src-tauri/Cargo.toml` dev-dependencies — Rust DB setup pattern is ready to use
- `@sveltejs/vite-plugin-svelte` is already in the project (required by SvelteKit) — Vitest can reuse it
- Diesel migration runner (`diesel_migrations::embed_migrations!`) is available for per-test DB setup

### Established Patterns
- All stores import `invoke` and `convertFileSrc` from `@tauri-apps/api/core` at the top level — vi.mock at module level intercepts cleanly
- Rust commands all receive `state: State<'_, VaultState>` — tests can construct a `VaultState` with a temp DB connection directly
- Svelte 5 stores are `.svelte.ts` singletons (not class instances) — test setup needs to reset module state between tests (`vi.resetModules()` or export a reset function)

### Integration Points
- `vault.svelte.ts` open/close triggers `$effect` reactivity in notes, scenes, maps stores — tests for those stores need vault state to be set first
- `audio-engine.svelte.ts` depends on `vault.svelte.ts` and `scenes.svelte.ts` — audio engine tests need both mocked or initialized

</code_context>

<specifics>
## Specific Ideas

- User confirmed AppSearch.svelte type error is already resolved (fields commented out) — no action needed in Phase 2
- "Take your recommendations" — no strong preferences on implementation details; planner has full discretion on test organization beyond the locked decisions above

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 02-foundation-test-infrastructure*
*Context gathered: 2026-04-29*
