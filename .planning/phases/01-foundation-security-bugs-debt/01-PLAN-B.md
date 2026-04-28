---
phase: 01-foundation-security-bugs-debt
plan: B
type: execute
wave: 1
depends_on: []
files_modified:
  - src-tauri/src/commands/notes.rs
  - src-tauri/src/commands/media.rs
autonomous: true
requirements:
  - FOUN-02

must_haves:
  truths:
    - "Any note path containing `..` or resolving outside the vault root is rejected with an error before any file read or write"
    - "Media files cannot be read or written outside the vault root via path manipulation"
    - "New file creation (write to non-existent path) is guarded by canonicalizing the parent directory"
  artifacts:
    - path: "src-tauri/src/commands/notes.rs"
      provides: "validate_path() helper; path guard applied to read_note_content, write_note_content, create_note, delete_note, update_note, get_note_by_path"
    - path: "src-tauri/src/commands/media.rs"
      provides: "path guard applied to get_image_absolute_path, get_audio_absolute_path"
  key_links:
    - from: "notes.rs read_note_content / write_note_content"
      to: "filesystem"
      via: "validate_path() → canonicalize parent dir or file → starts_with(vault_root)"
---

<objective>
Add path traversal guards to all file-touching Rust commands in notes.rs and media.rs.

Purpose: Without canonicalization, a caller passing `../../etc/passwd` as a note path would cause the backend to read outside the vault directory. This is a High-severity vulnerability on any platform.

Output: A `validate_path` helper function used by every command that joins a user-supplied path with the vault root. Read operations canonicalize the file itself; write/create operations canonicalize the parent directory.
</objective>

<execution_context>
@C:/Users/lamonta/Code/grimoire/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/lamonta/Code/grimoire/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@C:/Users/lamonta/Code/grimoire/.planning/ROADMAP.md
@C:/Users/lamonta/Code/grimoire/.planning/phases/01-foundation-security-bugs-debt/01-RESEARCH.md

<interfaces>
<!-- Key pattern from RESEARCH.md Pattern 1 -->
```rust
// For existing files (read/delete):
fn validate_path(vault_root: &Path, relative: &str) -> Result<PathBuf, String> {
    let joined = vault_root.join(relative);
    let canonical = joined.canonicalize()
        .map_err(|e| format!("Invalid path: {e}"))?;
    if !canonical.starts_with(vault_root) {
        return Err("Path escapes vault root".to_string());
    }
    Ok(canonical)
}

// For new files (write/create — file doesn't exist yet):
fn validate_parent_path(vault_root: &Path, relative: &str) -> Result<PathBuf, String> {
    let joined = vault_root.join(relative);
    let parent = joined.parent().ok_or("Cannot determine parent")?;
    let canonical_parent = parent.canonicalize()
        .map_err(|e| format!("Invalid parent path: {e}"))?;
    if !canonical_parent.starts_with(vault_root) {
        return Err("Path escapes vault root".to_string());
    }
    // Return the full (non-canonical) path with validated parent
    Ok(joined)
}
```

<!-- Current notes.rs commands that need the guard -->
// read_note_content(note_path: String) — joins vault_path + note_path, reads file
// write_note_content(note_path: String, content: String) — joins and writes file
// create_note(_note_path: String) — joins vault_path + _note_path (uses parent dir)
// delete_note(note_id: i32) — joins vault_path + note.path from DB (already trusted from DB, but guard is defense-in-depth)
// update_note(note: Note) — renames file if path changed
// get_note_by_path(note_path: String) — joins vault_path + note_path

<!-- Current media.rs commands that need the guard -->
// get_image_absolute_path(relative_path: String) — joins vault_path + relative_path, returns as String
// get_audio_absolute_path(relative_path: String) — same pattern
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add path traversal guard to notes.rs</name>
  <files>
    src-tauri/src/commands/notes.rs
  </files>
  <read_first>
    - src-tauri/src/commands/notes.rs — read in full before modifying; understand every function that joins vault_path with a user-supplied path
  </read_first>
  <action>
Add two private helper functions at the top of notes.rs, after the existing imports and before `resolve_note_filename`:

```rust
use std::path::{Path, PathBuf};

/// Validates that `relative` resolves to a path inside `vault_root`.
/// Use for reading/deleting existing files — the file must exist for canonicalize().
fn validate_path(vault_root: &Path, relative: &str) -> Result<PathBuf, String> {
    let joined = vault_root.join(relative);
    let canonical = joined
        .canonicalize()
        .map_err(|e| format!("Invalid path: {e}"))?;
    if !canonical.starts_with(vault_root) {
        return Err("Path escapes vault root".to_string());
    }
    Ok(canonical)
}

/// Validates that the PARENT of `relative` resolves inside `vault_root`.
/// Use for creating/writing new files — the file itself may not exist yet.
fn validate_parent_path(vault_root: &Path, relative: &str) -> Result<PathBuf, String> {
    let joined = vault_root.join(relative);
    let parent = joined.parent().ok_or("Cannot determine parent directory")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|e| format!("Invalid parent path: {e}"))?;
    if !canonical_parent.starts_with(vault_root) {
        return Err("Path escapes vault root".to_string());
    }
    Ok(joined) // parent is validated; return the full (not yet existing) file path
}
```

Apply the guards to each command:

**`read_note_content`:** Replace `let full_path = vault_path.join(&note_path);` with:
```rust
let full_path = validate_path(&vault_path, &note_path)?;
```

**`write_note_content`:** Replace `let full_path = vault_path.join(&note_path);` with:
```rust
let full_path = validate_parent_path(&vault_path, &note_path)?;
```

**`create_note`:** The function uses `vault_path.join(&_note_path)` to find the parent dir. The path already goes through `resolve_note_filename` which builds a new path from the parent. Guard the parent derivation:
```rust
let initial_full_path = validate_parent_path(&vault_path, &_note_path)?;
// Use initial_full_path.parent() instead of vault_path.join(&_note_path).parent()
```
The rest of the function already strips and re-joins, so the guard on entry is sufficient.

**`delete_note`:** The path comes from the DB (already trusted), but add defense-in-depth. Replace:
```rust
let full_path = vault_path.join(&note.path);
```
with:
```rust
let full_path = validate_path(&vault_path, &note.path)
    .unwrap_or_else(|_| vault_path.join(&note.path)); // if file doesn't exist, use joined path
if full_path.exists() {
    fs::remove_file(&full_path).map_err(|e| e.to_string())?;
}
```
Actually for delete: the file should exist (it was in the DB). Use `validate_path` directly and let it error if the path is invalid. Replace with:
```rust
let full_path = validate_path(&vault_path, &note.path)?;
```

**`update_note` (path rename):** The old path comes from DB (trusted), the new path comes from the note struct passed in. Guard the new path:
```rust
if old_note.path != note.path {
    let old_full = validate_path(&vault_path, &old_note.path)?;
    let new_full = validate_parent_path(&vault_path, &note.path)?;
    // rest of rename logic unchanged
}
```

**`get_note_by_path`:** Replace:
```rust
let full_path = vault_path.join(&note_path);
```
with:
```rust
let full_path = validate_path(&vault_path, &note_path)?;
```
  </action>
  <verify>
    <automated>cd C:/Users/lamonta/Code/grimoire/src-tauri && cargo build 2>&1 | tail -5</automated>
  </verify>
  <acceptance_criteria>
    - `cargo build` exits 0
    - `grep -n "validate_path\|validate_parent_path" src-tauri/src/commands/notes.rs` returns at least 7 lines (2 fn definitions + 5 usages)
    - `grep -n "vault_path\.join" src-tauri/src/commands/notes.rs` returns 0 lines in the command bodies (only allowed in helper internals)
    - `grep -n "fn validate_path\|fn validate_parent_path" src-tauri/src/commands/notes.rs` returns exactly 2 lines
  </acceptance_criteria>
  <done>Both helper functions exist; all 5 file-touching commands in notes.rs guard user-supplied paths; cargo build passes</done>
</task>

<task type="auto">
  <name>Task 2: Add path traversal guard to media.rs</name>
  <files>
    src-tauri/src/commands/media.rs
  </files>
  <read_first>
    - src-tauri/src/commands/media.rs — read in full to see which commands return paths derived from user-supplied relative_path
  </read_first>
  <action>
The two commands that return paths derived from user input are `get_image_absolute_path` and `get_audio_absolute_path`. Both call `vault_path.join(&relative_path)` and return the result as a String without canonicalization.

Add the same `validate_path` helper to media.rs (copy the function — it's private to the module):

```rust
use std::path::{Path, PathBuf};

fn validate_path(vault_root: &Path, relative: &str) -> Result<PathBuf, String> {
    let joined = vault_root.join(relative);
    let canonical = joined
        .canonicalize()
        .map_err(|e| format!("Invalid path: {e}"))?;
    if !canonical.starts_with(vault_root) {
        return Err("Path escapes vault root".to_string());
    }
    Ok(canonical)
}
```

**`get_image_absolute_path`:** Replace:
```rust
vault_path
    .join(&relative_path)
    .to_str()
    .map(|s| s.to_string())
    .ok_or("Path contains invalid UTF-8".to_string())
```
with:
```rust
let canonical = validate_path(vault_path, &relative_path)?;
canonical.to_str()
    .map(|s| s.to_string())
    .ok_or("Path contains invalid UTF-8".to_string())
```

**`get_audio_absolute_path`:** Apply the same replacement. Read the full function signature first — it likely follows the same `vault_path.join(&relative_path)` pattern as `get_image_absolute_path`.

The write-path commands (`copy_image_file`, `save_image_bytes`, `copy_audio_file`) write to a fixed subdirectory (`images/` or `audio/`) derived from the vault path, not from user-supplied relative paths. These do not need the guard.
  </action>
  <verify>
    <automated>cd C:/Users/lamonta/Code/grimoire/src-tauri && cargo build 2>&1 | tail -5</automated>
  </verify>
  <acceptance_criteria>
    - `cargo build` exits 0
    - `grep -n "validate_path" src-tauri/src/commands/media.rs` returns at least 3 lines (1 fn definition + 2 usages in get_image_absolute_path and get_audio_absolute_path)
    - `grep -n "\.join.*relative_path.*\.to_str\|\.join.*relative_path.*to_string" src-tauri/src/commands/media.rs` returns 0 lines (replaced by validate_path)
  </acceptance_criteria>
  <done>Both get_image_absolute_path and get_audio_absolute_path guard the relative_path parameter; cargo build passes</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Renderer → IPC → Rust file commands | User-supplied path strings cross the IPC bridge and are joined with the vault root |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01B-01 | Information Disclosure | `read_note_content` with path `../../etc/passwd` | mitigate | `validate_path()` canonicalizes and rejects any path outside vault root |
| T-01B-02 | Tampering | `write_note_content` with path `../../.bashrc` | mitigate | `validate_parent_path()` canonicalizes parent dir; rejects if outside vault root |
| T-01B-03 | Information Disclosure | `get_image_absolute_path` / `get_audio_absolute_path` returning paths outside vault | mitigate | `validate_path()` applied before returning the absolute path |
| T-01B-04 | Information Disclosure | Symlink attack — symlink inside vault pointing outside | mitigate | `canonicalize()` resolves symlinks before `starts_with()` check |
</threat_model>

<verification>
After both tasks:

1. `cargo build` exits 0
2. `grep -rn "validate_path\|validate_parent_path" src-tauri/src/commands/` returns results in notes.rs and media.rs
3. `grep -n "vault_path\.join" src-tauri/src/commands/notes.rs` returns 0 lines (no unguarded joins in command bodies)
</verification>

<success_criteria>
- Path containing `..` passed to any file-touching command returns `Err("Path escapes vault root")`
- New file creation guards the parent directory (not the non-existent file)
- All file-touching commands in notes.rs and media.rs use validate_path/validate_parent_path
- `cargo build` exits 0
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation-security-bugs-debt/01-B-SUMMARY.md`
</output>
