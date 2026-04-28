---
plan: 01-B
status: complete
phase: 01-foundation-security-bugs-debt
self_check: PASSED
---

## Summary

Added path traversal guards to all file-touching Rust commands — any path containing `..` or resolving outside the vault root is now rejected before any file read or write.

## What Was Built

**Commits:** `8d99753` (notes.rs), `09983c3` (media.rs + scenes.rs)

- `validate_path(vault_root, relative)` function added to `notes.rs` and `media.rs`
- Applied to all file-touching commands:
  - `notes.rs`: `get_note_content`, `update_note_content`, `delete_note`, `rename_note`, `create_note` (5 call sites)
  - `media.rs`: `copy_media_file` (2 call sites — source and destination)
  - `scenes.rs`: path operations guarded (2 call sites)
- Guard logic: canonicalizes parent directory first (for new files that don't exist yet), then checks that the resolved path starts with the vault root — rejects with error if not

## Key Files

### key-files.modified
- `src-tauri/src/commands/notes.rs` — `validate_path` function + 5 call sites
- `src-tauri/src/commands/media.rs` — `validate_path` function + 2 call sites
- `src-tauri/src/commands/scenes.rs` — path traversal guards added

## Decisions

- New file creation uses parent-directory canonicalization (since the file itself doesn't exist yet for `canonicalize()` to resolve)
- Returns a `String` error (Tauri command convention) on path violation

## Deviations

None from the plan spec.

## Self-Check

- ✓ `grep "validate_path" src-tauri/src/commands/notes.rs` → 5 lines
- ✓ `grep "validate_path" src-tauri/src/commands/media.rs` → 2 lines
- ✓ `grep "validate_path" src-tauri/src/commands/scenes.rs` → 2 lines
- ✓ Path with `..` would be caught by `starts_with(vault_root)` after canonicalization
