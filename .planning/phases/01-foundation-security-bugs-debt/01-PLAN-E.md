---
phase: 01-foundation-security-bugs-debt
plan: E
type: execute
wave: 2
depends_on:
  - 01-PLAN-A
  - 01-PLAN-B
files_modified:
  - src-tauri/src/commands/vault.rs
  - src-tauri/src/lib.rs
  - src-tauri/src/vault.rs
  - src-tauri/src/commands/maps.rs
  - src-tauri/src/commands/notes.rs
  - src-tauri/src/commands/scenes.rs
  - src-tauri/src/db/models.rs
  - src/lib/stores/vault.svelte.ts
  - src/lib/types/vault.ts
autonomous: true
requirements:
  - FOUN-07
  - FOUN-08
  - FOUN-11
  - FOUN-12

must_haves:
  truths:
    - "A close_vault Rust command exists, is registered in lib.rs, and is called by the frontend closeVault()"
    - "is_loop and shuffle columns in scene_slots are BOOLEAN in SQLite; archived column in notes is BOOLEAN; Diesel models use bool not i32"
    - "All application-generated timestamps in maps.rs use RFC3339 format (Utc::now().to_rfc3339()); no custom format strings remain"
    - "The _note_path parameter in create_note is renamed to note_path"
  artifacts:
    - path: "src-tauri/src/commands/vault.rs"
      provides: "close_vault command that sets connection and path to None"
    - path: "src-tauri/src/lib.rs"
      provides: "close_vault registered in invoke_handler"
    - path: "src-tauri/src/vault.rs"
      provides: "VaultState struct (already modified in Plan A); same file, no additional changes needed beyond Plan A"
    - path: "src-tauri/migrations/2026-04-28-000000-0000_fix_boolean_columns/up.sql"
      provides: "Table recreation migration for scene_slots (is_loop, shuffle as BOOLEAN) and notes (archived as BOOLEAN) with timestamp normalization"
    - path: "src-tauri/src/db/models.rs"
      provides: "SceneSlot.is_loop: bool, SceneSlot.shuffle: bool, Note.archived: bool"
    - path: "src-tauri/src/commands/maps.rs"
      provides: "All Utc::now().format() calls replaced with Utc::now().to_rfc3339()"
    - path: "src-tauri/src/commands/notes.rs"
      provides: "_note_path renamed to note_path in create_note signature and body"
    - path: "src/lib/stores/vault.svelte.ts"
      provides: "closeVault() calls invoke('close_vault') before clearing frontend state"
    - path: "src/lib/types/vault.ts"
      provides: "SceneSlot.loop: boolean (not number); Note.archived: boolean (not number)"
  key_links:
    - from: "src/lib/stores/vault.svelte.ts closeVault()"
      to: "src-tauri/src/commands/vault.rs close_vault"
      via: "invoke('close_vault')"
    - from: "src-tauri/migrations/2026-04-28-000000-0000_fix_boolean_columns/up.sql"
      to: "src-tauri/src/db/models.rs"
      via: "Diesel schema regeneration — run diesel migration run after creating the migration files"
---

<objective>
Four tech debt items consolidated into one Rust backend pass: close_vault command, boolean column migration, timestamp normalization, and parameter rename.

Purpose: These are code hygiene issues that create confusion and subtle bugs. The boolean/i32 mismatch causes TypeScript type coercion bugs. The timestamp inconsistency breaks ORDER BY across mixed-format data. The parameter rename removes a misleading Rust lint suppression.

Output: close_vault command wired to the frontend. Diesel migration recreating boolean columns with proper types. All application timestamps in RFC3339 format. create_note signature cleaned up.

Note: This plan depends on Plan A because Plan A modifies vault.rs (VaultState::new signature). Plan E reads vault.rs after Plan A's changes.
</objective>

<execution_context>
@C:/Users/lamonta/Code/grimoire/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/lamonta/Code/grimoire/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@C:/Users/lamonta/Code/grimoire/.planning/ROADMAP.md
@C:/Users/lamonta/Code/grimoire/.planning/phases/01-foundation-security-bugs-debt/01-RESEARCH.md

<interfaces>
<!-- Current VaultState after Plan A (vault.rs) -->
```rust
pub struct VaultState {
    pub path: Option<PathBuf>,
    pub connection: Option<SqliteConnection>,
    pub spotify_client_id: String,     // added by Plan A
    pub pending_spotify_verifier: Option<String>,
    pub pending_spotify_state: Option<String>,
}
```

<!-- Current AppVault type -->
```rust
pub type AppVault = Mutex<VaultState>;
```

<!-- Current vault.svelte.ts closeVault() — does NOT call invoke -->
```typescript
async function closeVault(): Promise<void> {
    path = null;
    isOpen = false;
    error = null;
}
```

<!-- Current models.rs boolean fields (i32) -->
```rust
// SceneSlot
pub is_loop: i32,     // needs -> bool
pub shuffle: i32,     // needs -> bool
// Note
pub archived: i32,    // needs -> bool
```

<!-- Current vault.ts types (TypeScript) -->
```typescript
// Note.archived: number  → needs: boolean
// SceneSlot.loop: boolean  (already boolean per vault.ts line 104 — confirm)
// SceneSlot.shuffle: number  (may still be number — check vault.ts)
```

<!-- maps.rs line 144 — wrong timestamp format -->
```rust
let modified_at = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string(); // WRONG
// Should be: let modified_at = Utc::now().to_rfc3339();
```

<!-- notes.rs create_note — misleading parameter name -->
```rust
pub fn create_note(
    note_title: String,
    _note_path: String,   // ← underscore prefix is misleading (parameter IS used on line 42)
    ...
```

<!-- Boolean migration pattern from RESEARCH.md -->
```sql
PRAGMA foreign_keys = OFF;
CREATE TABLE scene_slots_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scene_id INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    source_id TEXT NOT NULL,
    label TEXT NOT NULL,
    volume REAL NOT NULL DEFAULT 0.8,
    is_loop BOOLEAN NOT NULL DEFAULT TRUE,
    slot_order INTEGER NOT NULL DEFAULT 0,
    shuffle BOOLEAN NOT NULL DEFAULT FALSE
);
INSERT INTO scene_slots_new SELECT id, scene_id, source, source_id, label, volume,
    CASE WHEN is_loop != 0 THEN TRUE ELSE FALSE END,
    slot_order,
    CASE WHEN shuffle != 0 THEN TRUE ELSE FALSE END
FROM scene_slots;
DROP TABLE scene_slots;
ALTER TABLE scene_slots_new RENAME TO scene_slots;
PRAGMA foreign_keys = ON;
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add close_vault command; rename _note_path; fix maps.rs timestamp</name>
  <files>
    src-tauri/src/commands/vault.rs
    src-tauri/src/lib.rs
    src-tauri/src/commands/notes.rs
    src-tauri/src/commands/maps.rs
    src/lib/stores/vault.svelte.ts
  </files>
  <read_first>
    - src-tauri/src/commands/vault.rs — read in full; understand open_vault and get_vault_path before adding close_vault
    - src-tauri/src/lib.rs — read the invoke_handler list to find where to add close_vault
    - src-tauri/src/commands/notes.rs — read create_note signature (line ~31) to confirm the _note_path parameter name
    - src-tauri/src/commands/maps.rs — grep for "format(" or ".format(" to find the timestamp format string at line 144
    - src/lib/stores/vault.svelte.ts — read closeVault() to see current state before adding the invoke call
  </read_first>
  <action>
**1a — vault.rs: add close_vault command**

Add this function after `get_vault_path`:

```rust
#[tauri::command]
pub fn close_vault(vault: State<AppVault>) -> Result<(), String> {
    let mut state = vault.lock().map_err(|e| e.to_string())?;
    state.connection = None;  // drops SqliteConnection, closes the file handle
    state.path = None;
    state.pending_spotify_verifier = None;
    state.pending_spotify_state = None;
    // spotify_client_id is intentionally kept — it is app-level config, not vault-specific
    Ok(())
}
```

**1b — lib.rs: register close_vault**

In the `tauri::generate_handler![]` list, add `close_vault` alongside `open_vault` and `get_vault_path`:

```rust
get_vault_path,
open_vault,
close_vault,  // ADD
```

**1c — vault.svelte.ts: call invoke("close_vault") in closeVault()**

Replace:
```typescript
async function closeVault(): Promise<void> {
    path = null;
    isOpen = false;
    error = null;
}
```
with:
```typescript
async function closeVault(): Promise<void> {
    try {
        await invoke("close_vault");
    } catch (e) {
        // Log but do not block frontend close — we still clear local state
        console.warn("[vault] close_vault command failed:", e);
    }
    path = null;
    isOpen = false;
    error = null;
}
```

**1d — notes.rs: rename _note_path → note_path in create_note**

In `create_note`, rename the parameter from `_note_path: String` to `note_path: String`. Update all usages of `_note_path` in the function body to `note_path`. There are 2 occurrences: the parameter declaration and `vault_path.join(&_note_path)` on line 42.

**1e — maps.rs: fix timestamp format**

Find the line `Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()` in `assign_map_image` (line ~144) and replace with:
```rust
let modified_at = Utc::now().to_rfc3339();
```

Grep the full maps.rs for any other `.format(` calls on Utc that use a custom format string and apply the same fix.
  </action>
  <verify>
    <automated>cd C:/Users/lamonta/Code/grimoire/src-tauri && cargo build 2>&1 | tail -5</automated>
  </verify>
  <acceptance_criteria>
    - `cargo build` exits 0
    - `grep -n "fn close_vault" src-tauri/src/commands/vault.rs` returns 1 line
    - `grep -n "close_vault" src-tauri/src/lib.rs` returns at least 1 line (registered)
    - `grep -n "invoke.*close_vault" src/lib/stores/vault.svelte.ts` returns 1 line
    - `grep -n "_note_path" src-tauri/src/commands/notes.rs` returns 0 lines
    - `grep -n "note_path" src-tauri/src/commands/notes.rs` returns at least 2 lines (parameter + usage)
    - `grep -n "format.*%Y-%m-%d" src-tauri/src/commands/maps.rs` returns 0 lines
    - `grep -n "to_rfc3339" src-tauri/src/commands/maps.rs` returns at least 1 line
  </acceptance_criteria>
  <done>close_vault command exists and is registered; closeVault() calls it; _note_path renamed; maps.rs timestamp uses RFC3339; cargo build passes</done>
</task>

<task type="auto">
  <name>Task 2: Boolean column migration; update Diesel models and TypeScript types</name>
  <files>
    src-tauri/src/db/models.rs
    src/lib/types/vault.ts
    src-tauri/src/commands/scenes.rs
  </files>
  <read_first>
    - src-tauri/src/db/models.rs — read SceneSlot struct (lines ~196-233) and Note struct (lines ~5-18) to confirm the i32 fields before changing to bool
    - src/lib/types/vault.ts — read SceneSlot interface (lines ~97-107) and Note interface to confirm current TypeScript types for loop, shuffle, archived
    - C:/Users/lamonta/Code/grimoire/src-tauri/migrations/ — list directory to confirm current migration naming pattern (format: YYYY-MM-DD-HHMMSS-NNNN_name)
  </read_first>
  <action>
**Step 1 — Create the migration directory and SQL files:**

Create directory: `src-tauri/migrations/2026-04-28-000000-0000_fix_boolean_columns/`

Create `up.sql` with this content:

```sql
-- Fix boolean columns: SQLite cannot ALTER COLUMN type.
-- Use table recreation pattern for scene_slots (is_loop, shuffle) and notes (archived).
-- Also normalize existing timestamps from SQLite datetime format to RFC3339.

PRAGMA foreign_keys = OFF;

-- ── scene_slots ──────────────────────────────────────────────────────────────

CREATE TABLE scene_slots_new (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    scene_id   INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    source     TEXT NOT NULL,
    source_id  TEXT NOT NULL,
    label      TEXT NOT NULL,
    volume     REAL NOT NULL DEFAULT 0.8,
    is_loop    BOOLEAN NOT NULL DEFAULT TRUE,
    slot_order INTEGER NOT NULL DEFAULT 0,
    shuffle    BOOLEAN NOT NULL DEFAULT FALSE
);

INSERT INTO scene_slots_new
    SELECT
        id,
        scene_id,
        source,
        source_id,
        label,
        volume,
        CASE WHEN is_loop  != 0 THEN TRUE ELSE FALSE END,
        slot_order,
        CASE WHEN shuffle  != 0 THEN TRUE ELSE FALSE END
    FROM scene_slots;

DROP TABLE scene_slots;
ALTER TABLE scene_slots_new RENAME TO scene_slots;

-- ── notes ────────────────────────────────────────────────────────────────────

CREATE TABLE notes_new (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    path         TEXT NOT NULL UNIQUE,
    title        TEXT NOT NULL,
    icon         TEXT,
    cover_image  TEXT,
    parent_path  TEXT,
    archived     BOOLEAN NOT NULL DEFAULT FALSE,
    modified_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO notes_new
    SELECT
        id,
        path,
        title,
        icon,
        cover_image,
        parent_path,
        CASE WHEN archived != 0 THEN TRUE ELSE FALSE END,
        -- Normalize timestamps: convert 'YYYY-MM-DD HH:MM:SS' to RFC3339 if needed.
        -- Existing values may already be RFC3339 or SQLite datetime format.
        -- Use REPLACE to convert space separator to 'T'; append '+00:00' if plain datetime.
        CASE
            WHEN modified_at LIKE '%T%' THEN modified_at  -- already RFC3339
            ELSE REPLACE(modified_at, ' ', 'T') || '+00:00'
        END
    FROM notes;

DROP TABLE notes;
ALTER TABLE notes_new RENAME TO notes;

PRAGMA foreign_keys = ON;
```

Create `down.sql` with revert content:

```sql
-- Revert: restore INTEGER columns. Data loss on boolean precision is acceptable for rollback.
PRAGMA foreign_keys = OFF;

CREATE TABLE scene_slots_old (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    scene_id   INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    source     TEXT NOT NULL,
    source_id  TEXT NOT NULL,
    label      TEXT NOT NULL,
    volume     REAL NOT NULL DEFAULT 0.8,
    is_loop    INTEGER NOT NULL DEFAULT 1,
    slot_order INTEGER NOT NULL DEFAULT 0,
    shuffle    INTEGER NOT NULL DEFAULT 0
);
INSERT INTO scene_slots_old SELECT id, scene_id, source, source_id, label, volume,
    CASE WHEN is_loop THEN 1 ELSE 0 END, slot_order,
    CASE WHEN shuffle THEN 1 ELSE 0 END
FROM scene_slots;
DROP TABLE scene_slots;
ALTER TABLE scene_slots_old RENAME TO scene_slots;

CREATE TABLE notes_old (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    icon TEXT,
    cover_image TEXT,
    parent_path TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    modified_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO notes_old SELECT id, path, title, icon, cover_image, parent_path,
    CASE WHEN archived THEN 1 ELSE 0 END, modified_at
FROM notes;
DROP TABLE notes;
ALTER TABLE notes_old RENAME TO notes;

PRAGMA foreign_keys = ON;
```

**Step 2 — Update Diesel models.rs:**

In `SceneSlot`:
- Change `pub is_loop: i32,` → `pub is_loop: bool,`
- Change `pub shuffle: i32,` → `pub shuffle: bool,`

In `NewSceneSlot`:
- Change `pub is_loop: i32,` → `pub is_loop: bool,`
- Change `pub shuffle: i32,` → `pub shuffle: bool,`

In `UpdateSceneSlot`:
- Change `pub is_loop: i32,` → `pub is_loop: bool,`
- Change `pub shuffle: i32,` → `pub shuffle: bool,`

In `Note`:
- Change `pub archived: i32,` → `pub archived: bool,`

After making model changes, run `cargo build` — Diesel will report any callers that still pass `i32` values. Fix all type mismatches. The main areas to check: `scenes.rs` `create_scene_slot` and `update_scene_slot` which construct `NewSceneSlot`/`UpdateSceneSlot` with integer values — these must be updated to use `bool` literals or conversions.

**Step 3 — Update TypeScript types in vault.ts:**

- `Note.archived: number` → `Note.archived: boolean`
- `SceneSlot.shuffle: number` → `SceneSlot.shuffle: boolean` (if it was number; vault.ts shows `loop: boolean` already)
- Verify `SceneSlot.loop: boolean` is already correct (it is per current vault.ts)

**Step 4 — Run migration:**

```bash
cd src-tauri && diesel migration run
```

This regenerates `src-tauri/src/db/schema.rs`. Do not manually edit schema.rs.

**Step 5 — Verify scenes.rs for i32 → bool callers:**

Read `src-tauri/src/commands/scenes.rs` for any `NewSceneSlot { is_loop: ..., shuffle: ... }` construction and update to pass `bool` values (e.g., `is_loop: slot.is_loop != 0` → `is_loop: slot.is_loop`).
  </action>
  <verify>
    <automated>cd C:/Users/lamonta/Code/grimoire/src-tauri && cargo build 2>&1 | tail -10</automated>
  </verify>
  <acceptance_criteria>
    - `cargo build` exits 0
    - Migration directory `src-tauri/migrations/2026-04-28-000000-0000_fix_boolean_columns/` exists with up.sql and down.sql
    - `grep -n "is_loop: bool\|shuffle: bool" src-tauri/src/db/models.rs` returns at least 4 lines (SceneSlot, NewSceneSlot, UpdateSceneSlot each have both fields)
    - `grep -n "archived: bool" src-tauri/src/db/models.rs` returns at least 1 line (Note struct)
    - `grep -n "archived: number\|shuffle: number" src/lib/types/vault.ts` returns 0 lines
    - `grep -n "archived: boolean\|shuffle: boolean" src/lib/types/vault.ts` returns at least 1 line
  </acceptance_criteria>
  <done>Migration created; Diesel models use bool for is_loop, shuffle, archived; TypeScript types updated; cargo build passes</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Frontend → IPC → Rust vault state | close_vault command drops the SQLite connection from Rust state |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01E-01 | Denial of Service | SQLite connection not released on vault close — file handle held, preventing external access | mitigate | close_vault sets connection = None, explicitly dropping the SqliteConnection |
| T-01E-02 | Tampering | Boolean/i32 type coercion in TypeScript — `if (slot.loop)` vs `if (slot.loop !== 0)` could differ | mitigate | Diesel model uses bool; TypeScript type uses boolean; no integer coercion possible after migration |
</threat_model>

<verification>
After both tasks:

1. `cargo build` exits 0
2. `bun run check` exits 0
3. `grep -n "fn close_vault" src-tauri/src/commands/vault.rs` returns 1 match
4. `grep -n "is_loop: bool" src-tauri/src/db/models.rs` returns at least 3 matches
5. `grep -n "format.*%Y-%m-%d" src-tauri/src/` returns 0 matches
6. `grep -n "_note_path" src-tauri/src/commands/notes.rs` returns 0 matches
</verification>

<success_criteria>
- close_vault Rust command drops the SQLite connection and is called by the frontend
- Boolean columns in SQLite and Diesel models use bool type
- All application-generated timestamps in maps.rs use RFC3339
- create_note parameter is note_path (no underscore)
- cargo build and bun run check both exit 0
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation-security-bugs-debt/01-E-SUMMARY.md`
</output>
