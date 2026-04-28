# Phase 2: Foundation — Test Infrastructure - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in CONTEXT.md — this log preserves the discussion.

**Date:** 2026-04-29
**Phase:** 02-foundation-test-infrastructure
**Mode:** discuss (default)
**Areas analyzed:** Store mocking strategy, Audio engine approach, Rust test placement, AppSearch type error

---

## Areas Presented

| Area | Options Presented | User Selection |
|------|-------------------|----------------|
| Store mocking strategy | vi.mock module-level vs service wrapper | Recommended (vi.mock) |
| Audio engine approach | Mock AudioContext + Web Audio vs pure state logic only | Recommended (mock AudioContext) |
| Rust test placement | Inline #[cfg(test)] vs separate tests/ directory | Recommended (inline) |
| AppSearch type error | Fix in Phase 2 vs leave | Left (user already commented out relevant fields) |

## Discussion Notes

- User selected "take your recommendations" for all areas — no contested decisions
- AppSearch clarification: user has already commented out the problematic fields — type-checking is clean, no Phase 2 action needed
- No scope creep or deferred ideas emerged

## Carrying Forward (from prior phases)
- Vitest already decided as the frontend test framework (PROJECT.md)
- No E2E/Playwright — broad unit coverage is the target (REQUIREMENTS.md Out of Scope)
- No CI pipeline — not in Phase 2 requirements

## Claude's Discretion Items
- Exact AudioContext mock implementation
- Whether @testing-library/svelte is needed (stores are .svelte.ts, not components)
- Specific Rust setup_db() helper design
- Test assertions beyond minimum crossfade/isCrossfading coverage
