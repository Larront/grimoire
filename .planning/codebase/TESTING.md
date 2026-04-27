---
title: Testing
focus: quality
date: 2026-04-28
---

# Testing

## Summary

**No frontend test suite exists.** The backend has basic Rust unit test infrastructure but very few tests written. This is an early-stage project — testing is an identified gap, not an oversight.

---

## Frontend

### Test Framework
None configured. No `vitest`, `jest`, `playwright`, or any testing library is listed in `package.json` devDependencies.

### Coverage
**Zero.** No `.test.ts`, `.spec.ts`, or `.test.svelte` files exist in `src/`.

### What Needs Tests (Priority Order)

| Area | Risk | Notes |
|------|------|-------|
| Audio engine state machine | High | `isCrossfading` lock, crossfade lifecycle, shuffle logic — complex async state with no safety net |
| MapCanvas / Leaflet integration | High | Layer lifecycle on mount/unmount, pin placement, marker cleanup |
| IPC error handling paths | Medium | Several `invoke()` callers swallow errors silently or only log to console |
| Spotify OAuth flow | Medium | Token exchange, refresh, PKCE code verifier — time-dependent, hard to test manually |
| Store lifecycle (vault open/close) | Medium | Dependent stores should reset cleanly when vault closes |
| Path traversal guards | High (security) | File operation commands in `notes.rs` and `media.rs` have no path validation tests |

### Recommended Setup (When Adding Tests)
- **Vitest** + `@testing-library/svelte` for unit/integration tests
- **Playwright** for E2E (Tauri has Playwright integration via `@tauri-apps/cli`)
- Mock Tauri `invoke()` at the store level to test store logic in isolation

---

## Backend (Rust)

### Test Framework
Standard Rust `#[cfg(test)]` inline unit tests. `tempfile = "3"` is listed as a dev-dependency (for temporary file/directory creation in tests).

### Existing Test Files
No dedicated test files found. Any tests that exist are inline `#[cfg(test)]` modules within command files. Coverage is minimal.

### Diesel / SQLite Test Pattern
The `tempfile` crate enables per-test temporary databases:

```rust
#[cfg(test)]
mod tests {
    use tempfile::NamedTempFile;
    use diesel::prelude::*;

    fn setup_db() -> SqliteConnection {
        let file = NamedTempFile::new().unwrap();
        let mut conn = SqliteConnection::establish(file.path().to_str().unwrap()).unwrap();
        // run migrations...
        conn
    }

    #[test]
    fn test_create_note() {
        let mut conn = setup_db();
        // ...
    }
}
```

### What Needs Tests (Priority Order)

| Area | Risk | Notes |
|------|------|-------|
| Path traversal in `notes.rs` / `media.rs` | High (security) | `..` escape from vault root — no guard exists |
| Boolean cast correctness (`is_loop`, `shuffle`, `archived`) | Medium | Manual `eq(0)`/`eq(1)` casts could silently break on schema change |
| Spotify token refresh logic | Medium | Expiry calculation, refresh on 401 — no tests |
| Vault open with existing DB (migration resume) | Medium | Already-migrated DB should not re-run migrations |
| `reorder_scene_slots` | Low | Order index manipulation logic |

---

## CI / Automation

No CI configuration exists (no `.github/workflows/`, no `Makefile` with test targets). All validation is manual:

```bash
bun run check      # TypeScript + Svelte type checking
bun run tauri dev  # Manual smoke test
```

---

## Adding the First Tests

When the time comes to add tests, the recommended approach is:

1. **Rust backend first** — use `tempfile` + Diesel migrations to write integration tests for command handlers against a real SQLite DB. This matches how the app actually runs.
2. **Frontend stores second** — mock `invoke()` and test store state transitions (open vault → notes load, close vault → stores reset).
3. **E2E last** — Playwright-based Tauri tests for critical user flows (open vault, create note, play scene).
