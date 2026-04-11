# Splash Screen Redesign

## Summary

Redesign the initial application screen from a bare "Grimoire" title + "Open Vault" button into a quiet, centered brand moment with functional utility: recent vault history, vault preview metadata, and a clear first-time user onboarding flow.

## Design Direction

**Mood:** Quiet and centered — like opening a book in a dim library. The Grimoire title floats in darkness with a subtle warm radial glow. Everything below it is understated and purposeful.

**Layout:** Single centered column. Title as hero element, content flows vertically below. No split panels or sidebars.

**Palette:** Uses the existing warm oklch palette (hue ~25-50). No cool navy/teal.

## Two States

### First-Time User (No Recent Vaults)

Shown when there are zero entries in the recent vaults list.

1. **Title block** — "Grimoire" in Metamorphous at ~52px, primary color (`oklch(0.68 0.10 25)` in dark mode), centered. A thin decorative rule below (~48px wide, semi-transparent primary).
2. **Subtle radial glow** — Behind the title, a warm radial gradient that fades into the background. Purely atmospheric, not distracting.
3. **Welcome copy** — One line in Nunito, muted foreground: "A worldbuilding vault for your campaigns, lore, maps, and sessions."
4. **Two action paths** (stacked vertically, ~280px wide):
   - **Primary (filled):** "Create New Vault" — primary background, dark text. Subtitle: "Start fresh with an empty vault." Plus icon.
   - **Secondary (outlined):** "Open Existing Folder" — muted background with border. Subtitle: "Choose a folder with your notes and files." Folder icon.

### Returning User (Has Recent Vaults)

Shown when at least one vault exists in history.

1. **Title block** — Same Grimoire title, slightly smaller (~44px) to give more room to the vault list.
2. **Subtle radial glow** — Same as first-time, positioned higher.
3. **"Recent Vaults" section** — Labeled with a small uppercase tracking label (`font-size: 9px, letter-spacing: 2px`). Below it, a stacked list:
   - Each row shows: **vault name** (Nunito 13px semibold), **stats line** (note count, scene count, map count — only show counts > 0), **last edited timestamp** (relative, right-aligned).
   - Rows separated by subtle bottom borders (`oklch(1 0.01 30 / 6%)`).
   - Clicking a vault row opens that vault directly.
   - Hover state: subtle background highlight.
   - Max ~5 recent vaults shown. If more exist, a "Show all" link at the bottom.
4. **Action buttons** — Below the vault list, two subtle outlined buttons side-by-side: "Open Other Vault" (primary text color) and "Create New Vault" (muted text color).

## Vault Preview Metadata

Each recent vault entry displays:
- **Name:** Derived from the directory name (last path segment).
- **Note count:** Number of `.md` files tracked in the vault's SQLite database.
- **Scene count:** Number of scenes in the database.
- **Map count:** Number of maps in the database. 
- **Last edited:** Timestamp of the most recent modification across all tracked content.

This metadata is gathered at the time a vault is opened/closed and stored in the recent vaults registry. It is NOT fetched live from the vault's database on the splash screen (that would require opening the DB for each vault).

## Backend: Recent Vaults Registry

No recent-vault tracking exists today. We need a lightweight persistence mechanism outside any individual vault.

### Storage

A JSON file at the Tauri app data directory: `<app_data_dir>/recent-vaults.json`.

Structure:
```json
{
  "vaults": [
    {
      "path": "/home/user/campaigns/erathia",
      "name": "erathia",
      "note_count": 12,
      "scene_count": 3,
      "map_count": 2,
      "last_opened": "2026-04-11T14:30:00Z"
    }
  ]
}
```

- `path`: Absolute path to the vault directory.
- `name`: Last segment of the path (for display).
- `note_count`, `scene_count`, `map_count`: Snapshot counts captured when the vault was last opened.
- `last_opened`: ISO 8601 timestamp of when the vault was last opened.

Maximum 10 entries. Oldest entries are evicted when the limit is reached.

### New Tauri Commands

1. **`get_recent_vaults`** — Reads `recent-vaults.json` and returns the list. Filters out entries whose paths no longer exist on disk. Takes `app_handle: tauri::AppHandle` to resolve the app data directory.

2. **`add_recent_vault`** — Called internally when a vault is successfully opened. Gathers current note/scene/map counts from the just-opened database, upserts the entry in the recent vaults list, and writes the file.

3. **`remove_recent_vault`** — Removes a vault entry by path (for a future "remove from recents" context action — not in initial scope but the command should exist).

Note: "Create New Vault" on the frontend uses the same `open_vault` command — it opens a directory picker dialog and `open_vault` already creates the directory if it doesn't exist. No separate `create_vault` Rust command is needed; the distinction is purely UX (different button label and copy).

### Integration with `open_vault`

After `open_vault` succeeds, the frontend calls `add_recent_vault` (or `open_vault` itself calls it internally — implementation detail). The counts are snapshotted at that moment.

## Frontend Changes

### File: `src/routes/+page.svelte`

The existing `{#if vault.isOpen}...{:else}...{/if}` structure remains. The `{:else}` block (splash screen) is replaced entirely.

**New splash screen logic:**
1. On mount, call `get_recent_vaults` to fetch the list.
2. If the list is empty, render the first-time user state.
3. If the list has entries, render the returning user state.
4. Clicking a recent vault row calls `vault.openVault(path)` with the stored path.
5. "Open Other Vault" calls `vault.openVault()` (no args — triggers file dialog, same as today).
6. "Create New Vault" triggers a directory picker dialog, then calls `vault.openVault(path)` — same as opening an existing vault, since `open_vault` already creates the directory if needed.

### Animations

- **Title fade-in:** The Grimoire title fades in and shifts up slightly on mount (~300ms, ease-out).
- **Content stagger:** The welcome text / vault list and action buttons fade in with a slight delay after the title (~150ms stagger between groups).
- **Vault row hover:** Subtle background transition (~150ms).

No complex animations. The mood is quiet.

### Loading States

- While `get_recent_vaults` is loading: Show the title immediately, show a subtle skeleton or nothing below it (the call should be near-instant since it's reading a local JSON file).
- While a vault is opening: The clicked row (or button) shows a spinner. Other rows are not disabled but are visually muted.

### Error Handling

- If a recent vault's path no longer exists on disk, `get_recent_vaults` filters it out server-side. The user never sees a broken entry.
- If `open_vault` fails: Show an inline error message below the vault list, styled in the destructive color. Auto-dismiss after 5 seconds or on next action.
- If `create_vault` dialog is cancelled: No-op, return to splash.

## Out of Scope

- Vault deletion/management from the splash screen (beyond "remove from recents")
- Vault search/filtering (not needed for ≤10 entries)
- Vault thumbnails or rich previews
- Light mode tuning (dark-first; light mode inherits the layout and uses existing token overrides)
- Keyboard navigation (can be added later)
