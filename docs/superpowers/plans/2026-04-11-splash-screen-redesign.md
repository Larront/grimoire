# Splash Screen Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare "Grimoire" + "Open Vault" splash screen with a quiet, centered brand moment that shows recent vault history with preview metadata, and provides clear onboarding for first-time users.

**Architecture:** A new Rust module (`src-tauri/src/commands/recent_vaults.rs`) manages a JSON file in the Tauri app data directory to persist recent vault entries. The existing `open_vault` flow is extended to snapshot vault metadata after opening. The frontend `+page.svelte` splash screen is rewritten to fetch and display recent vaults, with two distinct states (first-time vs returning user).

**Tech Stack:** Rust (serde_json, tauri::path::PathResolver), Svelte 5, Tailwind CSS, existing shadcn-svelte Button component, Lucide icons.

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src-tauri/src/commands/recent_vaults.rs` | Read/write/remove recent vault entries from app data JSON file |
| Modify | `src-tauri/src/commands/mod.rs` | Export the new `recent_vaults` module |
| Modify | `src-tauri/src/commands/vault.rs` | After `open_vault` succeeds, snapshot counts into recent vaults registry |
| Modify | `src-tauri/src/lib.rs` | Register new Tauri commands |
| Modify | `src/routes/+page.svelte` | Rewrite splash screen UI with two states |
| Modify | `src/lib/stores/vault.svelte.ts` | After `openVault` succeeds, call `add_recent_vault` |
| Modify | `src/app.css` | Add fade-in animation keyframes for splash |

---

### Task 1: Create the Recent Vaults Rust Module

**Files:**
- Create: `src-tauri/src/commands/recent_vaults.rs`
- Modify: `src-tauri/src/commands/mod.rs`

- [ ] **Step 1: Add the `recent_vaults` module to `mod.rs`**

Read `src-tauri/src/commands/mod.rs` to see existing module declarations, then add `pub mod recent_vaults;` alongside the others.

- [ ] **Step 2: Create `recent_vaults.rs` with types and helper functions**

Create `src-tauri/src/commands/recent_vaults.rs` with the following content:

```rust
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

const MAX_RECENT_VAULTS: usize = 10;
const RECENT_VAULTS_FILE: &str = "recent-vaults.json";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RecentVault {
    pub path: String,
    pub name: String,
    pub note_count: usize,
    pub scene_count: usize,
    pub map_count: usize,
    pub last_opened: String, // ISO 8601
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct RecentVaultsFile {
    vaults: Vec<RecentVault>,
}

fn recent_vaults_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;
    Ok(data_dir.join(RECENT_VAULTS_FILE))
}

fn read_recent_vaults_file(app: &AppHandle) -> Result<RecentVaultsFile, String> {
    let path = recent_vaults_path(app)?;
    if !path.exists() {
        return Ok(RecentVaultsFile::default());
    }
    let contents = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read recent vaults: {}", e))?;
    serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse recent vaults: {}", e))
}

fn write_recent_vaults_file(app: &AppHandle, data: &RecentVaultsFile) -> Result<(), String> {
    let path = recent_vaults_path(app)?;
    let contents = serde_json::to_string_pretty(data)
        .map_err(|e| format!("Failed to serialize recent vaults: {}", e))?;
    fs::write(&path, contents)
        .map_err(|e| format!("Failed to write recent vaults: {}", e))
}
```

- [ ] **Step 3: Add the `get_recent_vaults` command**

Append to the same file:

```rust
#[tauri::command]
pub fn get_recent_vaults(app: AppHandle) -> Result<Vec<RecentVault>, String> {
    let mut data = read_recent_vaults_file(&app)?;
    // Filter out vaults whose directories no longer exist
    data.vaults.retain(|v| std::path::Path::new(&v.path).exists());
    // Write back the filtered list so removed entries don't persist
    write_recent_vaults_file(&app, &data)?;
    Ok(data.vaults)
}
```

- [ ] **Step 4: Add the `add_recent_vault` command**

Append to the same file:

```rust
#[tauri::command]
pub fn add_recent_vault(app: AppHandle, entry: RecentVault) -> Result<(), String> {
    let mut data = read_recent_vaults_file(&app)?;
    // Remove existing entry for this path (if any) so we can re-insert at front
    data.vaults.retain(|v| v.path != entry.path);
    // Insert at front (most recent first)
    data.vaults.insert(0, entry);
    // Trim to max
    data.vaults.truncate(MAX_RECENT_VAULTS);
    write_recent_vaults_file(&app, &data)
}
```

- [ ] **Step 5: Add the `remove_recent_vault` command**

Append to the same file:

```rust
#[tauri::command]
pub fn remove_recent_vault(app: AppHandle, path: String) -> Result<(), String> {
    let mut data = read_recent_vaults_file(&app)?;
    data.vaults.retain(|v| v.path != path);
    write_recent_vaults_file(&app, &data)
}
```

- [ ] **Step 6: Verify it compiles**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`

Expected: Warnings about unused imports/functions are fine (commands aren't registered yet). No errors.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands/recent_vaults.rs src-tauri/src/commands/mod.rs
git commit -m "feat: add recent vaults registry module"
```

---

### Task 2: Register Commands and Wire Up `open_vault`

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands/vault.rs`

- [ ] **Step 1: Register new commands in `lib.rs`**

Add the imports and command registrations. In the `use commands::` block at the top, add:

```rust
use commands::recent_vaults::*;
```

In the `invoke_handler` macro, add these three commands (e.g. after the `open_vault` line):

```rust
get_recent_vaults,
add_recent_vault,
remove_recent_vault,
```

- [ ] **Step 2: Add vault metadata snapshot to `open_vault`**

In `src-tauri/src/commands/vault.rs`, we need to gather note/scene/map counts after the vault is opened. The `open_vault` function already has an active `conn`. Add count queries before returning.

Add these imports at the top of `vault.rs`:

```rust
use crate::db::schema::{notes, scenes, maps};
```

Then modify `open_vault` to return counts alongside the path. Change the function to:

```rust
#[derive(serde::Serialize)]
pub struct OpenVaultResult {
    pub path: String,
    pub note_count: i64,
    pub scene_count: i64,
    pub map_count: i64,
}

#[tauri::command]
pub fn open_vault(path: String, vault: State<AppVault>) -> Result<OpenVaultResult, String> {
    let vault_path = PathBuf::from(&path);

    if !vault_path.exists() {
        std::fs::create_dir_all(&vault_path)
            .map_err(|e| format!("Failed to create vault directory: {}", e))?;
    }

    let mut conn = establish_connection(&vault_path)?;
    seed_default_categories(&mut conn)?;

    let note_count: i64 = notes::table
        .count()
        .get_result(&mut conn)
        .unwrap_or(0);
    let scene_count: i64 = scenes::table
        .count()
        .get_result(&mut conn)
        .unwrap_or(0);
    let map_count: i64 = maps::table
        .count()
        .get_result(&mut conn)
        .unwrap_or(0);

    let mut state = vault.lock().map_err(|_| "Vault lock poisoned")?;
    state.path = Some(vault_path);
    state.connection = Some(conn);

    Ok(OpenVaultResult {
        path,
        note_count,
        scene_count,
        map_count,
    })
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`

Expected: No errors. The frontend will need updating (it currently expects a `String` return from `open_vault`), but that's Task 4.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/commands/vault.rs
git commit -m "feat: register recent vault commands, return metadata from open_vault"
```

---

### Task 3: Update the Vault Store to Record Recent Vaults

**Files:**
- Modify: `src/lib/stores/vault.svelte.ts`

- [ ] **Step 1: Update `openVault` to handle the new return type and record recent vaults**

The `open_vault` command now returns `{ path, note_count, scene_count, map_count }` instead of a plain string. Update the store to handle this and call `add_recent_vault` after a successful open.

Replace the entire content of `src/lib/stores/vault.svelte.ts` with:

```typescript
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

interface OpenVaultResult {
  path: string;
  note_count: number;
  scene_count: number;
  map_count: number;
}

export interface RecentVault {
  path: string;
  name: string;
  note_count: number;
  scene_count: number;
  map_count: number;
  last_opened: string;
}

function createVaultStore() {
  let path = $state<string | null>(null);
  let isOpen = $state(false);
  let isLoading = $state(false);
  let error = $state<string | null>(null);

  async function openVault(selectedPath?: string): Promise<boolean> {
    isLoading = true;
    error = null;

    try {
      const vaultPath =
        selectedPath ??
        (await open({
          directory: true,
          title: "Open Vault Folder",
        }));

      if (!vaultPath || typeof vaultPath !== "string") {
        isLoading = false;
        return false;
      }

      const result = await invoke<OpenVaultResult>("open_vault", {
        path: vaultPath,
      });

      path = result.path;
      isOpen = true;

      // Record in recent vaults (fire-and-forget)
      const name = result.path.split(/[\\/]/).pop() ?? "Untitled";
      invoke("add_recent_vault", {
        entry: {
          path: result.path,
          name,
          note_count: result.note_count,
          scene_count: result.scene_count,
          map_count: result.map_count,
          last_opened: new Date().toISOString(),
        },
      }).catch(console.error);

      return true;
    } catch (e) {
      error = String(e);
      console.log(error);
      return false;
    } finally {
      isLoading = false;
    }
  }

  async function closeVault(): Promise<void> {
    path = null;
    isOpen = false;
    error = null;
  }

  async function checkExistingVault(): Promise<void> {
    try {
      const existingPath = await invoke<string | null>("get_vault_path");
      if (existingPath) {
        path = existingPath;
        isOpen = true;
      }
    } catch {
      // No vault open — normal on first launch
    }
  }

  return {
    get path() {
      return path;
    },
    get isOpen() {
      return isOpen;
    },
    get isLoading() {
      return isLoading;
    },
    get error() {
      return error;
    },
    openVault,
    closeVault,
    checkExistingVault,
  };
}

export const vault = createVaultStore();
```

- [ ] **Step 2: Verify types compile**

Run: `bun run check 2>&1 | tail -10`

Expected: No type errors related to vault store. There may be errors in `+page.svelte` since it still references the old splash screen code — that's fixed in Task 4.

- [ ] **Step 3: Commit**

```bash
git add src/lib/stores/vault.svelte.ts
git commit -m "feat: update vault store to handle metadata and record recent vaults"
```

---

### Task 4: Rewrite the Splash Screen UI

**Files:**
- Modify: `src/routes/+page.svelte`
- Modify: `src/app.css`

- [ ] **Step 1: Add splash animation keyframes to `app.css`**

Add the following at the end of `src/app.css`, before the closing of the file (after the `.tiptap a:hover` rule):

```css
/* ── Splash screen animations ────────────────────────────────── */

@keyframes splash-fade-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.splash-fade {
  animation: splash-fade-in 300ms ease-out both;
}

.splash-fade-delay-1 {
  animation: splash-fade-in 300ms ease-out 150ms both;
}

.splash-fade-delay-2 {
  animation: splash-fade-in 300ms ease-out 300ms both;
}
```

- [ ] **Step 2: Rewrite `+page.svelte` with the new splash screen**

Replace the entire content of `src/routes/+page.svelte` with:

```svelte
<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { vault, type RecentVault } from "$lib/stores/vault.svelte";
  import { notes } from "$lib/stores/notes.svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { Folder, Plus, LoaderCircle } from "@lucide/svelte";

  let recentVaults = $state<RecentVault[]>([]);
  let isLoadingRecents = $state(true);
  let openingPath = $state<string | null>(null);
  let errorMsg = $state<string | null>(null);

  const vaultName = $derived(vault.path?.split(/[\\/]/).pop() ?? "My Vault");

  // Load recent vaults on mount
  $effect(() => {
    if (!vault.isOpen) {
      invoke<RecentVault[]>("get_recent_vaults")
        .then((vaults) => {
          recentVaults = vaults;
        })
        .catch(console.error)
        .finally(() => {
          isLoadingRecents = false;
        });
    }
  });

  async function handleOpenRecent(vaultPath: string) {
    openingPath = vaultPath;
    errorMsg = null;
    try {
      await vault.openVault(vaultPath);
    } catch (e) {
      errorMsg = String(e);
    } finally {
      openingPath = null;
    }
  }

  async function handleOpenOther() {
    openingPath = "__dialog__";
    errorMsg = null;
    try {
      await vault.openVault();
    } catch (e) {
      errorMsg = String(e);
    } finally {
      openingPath = null;
    }
  }

  async function handleCreateNew() {
    // Same as open — open_vault creates the directory if it doesn't exist
    openingPath = "__dialog__";
    errorMsg = null;
    try {
      await vault.openVault();
    } catch (e) {
      errorMsg = String(e);
    } finally {
      openingPath = null;
    }
  }

  function formatRelativeTime(isoString: string): string {
    const diff = Date.now() - new Date(isoString).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 5) return `${weeks}w ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
  }

  function formatVaultStats(v: RecentVault): string {
    const parts: string[] = [];
    if (v.note_count > 0) parts.push(`${v.note_count} note${v.note_count !== 1 ? "s" : ""}`);
    if (v.scene_count > 0) parts.push(`${v.scene_count} scene${v.scene_count !== 1 ? "s" : ""}`);
    if (v.map_count > 0) parts.push(`${v.map_count} map${v.map_count !== 1 ? "s" : ""}`);
    return parts.join(" · ") || "Empty vault";
  }

  const VAULT_PROMPTS = [
    "Every map begins as a blank page. Every legend begins with a first line.",
    "The world doesn't build itself. Your notes do.",
    "Great stories start somewhere. This one starts here.",
    "Even dragons have origins. Where does yours begin?",
    "Kingdoms rise from a single idea. What's yours?",
    "History is written by those who show up. Start your world.",
  ];

  const vaultPrompt =
    VAULT_PROMPTS[Math.floor(Math.random() * VAULT_PROMPTS.length)];
</script>

{#if vault.isOpen}
  <!-- ── Vault home ─────────────────────────────────────────────── -->
  <div class="h-full overflow-y-auto">
    <div
      class="flex flex-col gap-12 w-full max-w-lg py-16 px-10 mx-auto reveal"
    >
      <div class="flex flex-col gap-1.5">
        <h1
          class="font-display text-[2.25rem] font-semibold tracking-[-0.01em]
                 text-foreground leading-tight"
        >
          {vaultName}
        </h1>
        <p class="font-sans text-sm text-foreground-muted">
          Your worldbuilding vault
        </p>
      </div>

      {#if notes.isLoading}
        <div class="flex items-center gap-2 text-foreground-faint">
          <LoaderCircle class="w-4 h-4 animate-spin" />
          <span class="font-sans text-sm">Loading vault…</span>
        </div>
      {:else}
        <div class="flex flex-col gap-4">
          <span
            class="font-sans text-[10px] uppercase tracking-widest text-foreground-faint"
          >
            Continue writing
          </span>
          <p
            class="font-display text-base italic text-foreground-muted leading-relaxed"
          >
            {vaultPrompt}
          </p>
        </div>
      {/if}
    </div>
  </div>
{:else}
  <!-- ── Splash screen ──────────────────────────────────────────── -->
  <div
    class="flex flex-col items-center justify-center min-h-screen overflow-hidden relative"
  >
    <!-- Radial glow -->
    <div
      class="pointer-events-none absolute top-[30%] left-1/2 -translate-x-1/2 -translate-y-1/2
             w-[500px] h-[300px]"
      style="background: radial-gradient(ellipse, oklch(0.30 0.03 40 / 30%), transparent 70%)"
    ></div>

    <!-- Title -->
    <div class="text-center relative z-10 splash-fade">
      <h1 class="font-heading text-[52px] text-primary tracking-[1px]">
        Grimoire
      </h1>
      <div
        class="w-12 h-px mx-auto mt-3.5"
        style="background: linear-gradient(90deg, transparent, oklch(from var(--primary) l c h / 40%), transparent)"
      ></div>
    </div>

    {#if isLoadingRecents}
      <!-- Minimal loading — title is visible, content loads beneath -->
    {:else if recentVaults.length === 0}
      <!-- ── First-time user ──────────────────────────────────── -->
      <p
        class="font-sans text-sm text-muted-foreground mt-7 text-center max-w-[280px]
               leading-relaxed relative z-10 splash-fade-delay-1"
      >
        A worldbuilding vault for your campaigns, lore, maps, and sessions.
      </p>

      <div class="flex flex-col gap-2.5 mt-8 w-[280px] relative z-10 splash-fade-delay-2">
        <Button
          onclick={handleCreateNew}
          class="justify-start gap-2.5 h-auto py-3 px-4"
          disabled={openingPath !== null}
        >
          {#if openingPath === "__dialog__"}
            <LoaderCircle class="w-4 h-4 animate-spin" />
          {:else}
            <Plus class="w-4 h-4" />
          {/if}
          <div class="text-left">
            <div class="text-sm font-bold">Create New Vault</div>
            <div class="text-[10px] opacity-70 font-normal">Start fresh with an empty vault</div>
          </div>
        </Button>

        <Button
          variant="secondary"
          onclick={handleOpenOther}
          class="justify-start gap-2.5 h-auto py-3 px-4"
          disabled={openingPath !== null}
        >
          <Folder class="w-4 h-4" />
          <div class="text-left">
            <div class="text-sm font-semibold">Open Existing Folder</div>
            <div class="text-[10px] opacity-70 font-normal">Choose a folder with your notes and files</div>
          </div>
        </Button>
      </div>
    {:else}
      <!-- ── Returning user ───────────────────────────────────── -->
      <div class="w-[320px] mt-8 relative z-10 splash-fade-delay-1">
        <span
          class="font-sans text-[9px] uppercase tracking-[2px] text-muted-foreground mb-2.5 block"
        >
          Recent Vaults
        </span>

        <div class="flex flex-col">
          {#each recentVaults as v (v.path)}
            <button
              class="flex items-center justify-between py-2.5 px-3 rounded-md
                     border-b border-border/30 text-left
                     hover:bg-muted/50 transition-colors duration-150
                     disabled:opacity-50"
              disabled={openingPath !== null}
              onclick={() => handleOpenRecent(v.path)}
            >
              <div class="min-w-0 flex-1">
                {#if openingPath === v.path}
                  <div class="flex items-center gap-2">
                    <LoaderCircle class="w-3.5 h-3.5 animate-spin text-primary" />
                    <span class="font-sans text-[13px] font-semibold text-foreground">
                      {v.name}
                    </span>
                  </div>
                {:else}
                  <div class="font-sans text-[13px] font-semibold text-foreground truncate">
                    {v.name}
                  </div>
                {/if}
                <div class="font-sans text-[10px] text-muted-foreground mt-0.5">
                  {formatVaultStats(v)}
                </div>
              </div>
              <div class="font-sans text-[10px] text-muted-foreground/60 ml-3 shrink-0">
                {formatRelativeTime(v.last_opened)}
              </div>
            </button>
          {/each}
        </div>
      </div>

      <!-- Action buttons -->
      <div class="flex gap-3 mt-6 relative z-10 splash-fade-delay-2">
        <Button
          variant="outline"
          size="sm"
          onclick={handleOpenOther}
          class="text-[11px] text-primary"
          disabled={openingPath !== null}
        >
          Open Other Vault
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onclick={handleCreateNew}
          class="text-[11px] text-muted-foreground"
          disabled={openingPath !== null}
        >
          Create New Vault
        </Button>
      </div>
    {/if}

    <!-- Error message -->
    {#if errorMsg}
      <p class="font-sans text-xs text-destructive mt-4 text-center max-w-[300px] relative z-10">
        {errorMsg}
      </p>
    {/if}
  </div>
{/if}
```

- [ ] **Step 3: Verify frontend compiles**

Run: `bun run check 2>&1 | tail -10`

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/+page.svelte src/app.css
git commit -m "feat: redesign splash screen with recent vaults and first-time user flow"
```

---

### Task 5: Visual Testing and Polish

**Files:**
- Possibly tweak: `src/routes/+page.svelte`, `src/app.css`

- [ ] **Step 1: Start the full Tauri dev app**

Run: `bun run tauri dev`

Wait for the window to appear. You should see the splash screen (first-time user state since no vaults have been opened yet).

- [ ] **Step 2: Test the first-time user flow**

Verify:
- The "Grimoire" title renders in Metamorphous font, primary color, with the decorative rule below
- The welcome copy appears below the title
- "Create New Vault" is the primary (filled) button, "Open Existing Folder" is secondary
- The subtle radial glow is visible behind the title
- The fade-in animation plays on load (title first, then text, then buttons)
- Clicking "Open Existing Folder" opens a directory picker dialog
- Clicking "Create New Vault" opens a directory picker dialog

- [ ] **Step 3: Test the returning user flow**

Open a vault using either button. Close and reopen the app (or reload). Verify:
- The splash now shows the "Recent Vaults" list
- The vault you just opened appears with its name, stats (may show "Empty vault" for a new one), and "Just now" or similar timestamp
- Clicking the vault row opens it directly without showing a dialog
- "Open Other Vault" and "Create New Vault" buttons appear below the list
- The spinner shows on the clicked row while the vault is loading

- [ ] **Step 4: Test error and edge cases**

- Cancel the directory picker dialog — should return to splash with no error
- If a vault from the recent list was deleted from disk, it should not appear (filtered server-side)
- Open multiple different vaults to verify the list grows and most-recent is first

- [ ] **Step 5: Visual polish check**

Verify in dark mode (the primary experience):
- Colors match the warm palette (no navy/teal)
- Typography uses Metamorphous for the title, Nunito for everything else
- Spacing feels balanced — title isn't cramped, vault list has breathing room
- The overall mood is "quiet and centered" — like opening a book in a dim library

- [ ] **Step 6: Commit any polish adjustments**

```bash
git add -u
git commit -m "fix: splash screen visual polish"
```

Only commit this if changes were needed. Skip if everything looks correct.
