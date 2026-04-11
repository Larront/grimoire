# Spotify Connection & Settings Page

## Overview

Add a Settings page where users can connect/disconnect their Spotify account, view vault info, and manage preferences. Additionally, surface a contextual Spotify connection prompt in the scene workflow when users try to add a Spotify track without being connected.

The Rust backend for Spotify OAuth (PKCE flow, token storage, auto-refresh, revocation) is already fully implemented. The audio engine already supports Spotify playback. This work is frontend-only.

## Settings Page

### Route & Navigation

- **Route:** `/settings` — a single `+page.svelte`, no nested routes.
- **Sidebar entry:** A gear icon button in the `AppSidebar` footer, next to the vault name. Navigates to `/settings`.
- **Breadcrumbs:** Shows "Settings" via the existing breadcrumb system.

### Tab Structure

The page uses a tab bar with three tabs. Tab state is local component state (`$state<string>`), not URL parameters — switching tabs does not change the URL.

**Tabs:**

1. **Integrations** (default active tab)
2. **Vault**
3. **Preferences**

Tabs will be built using a shadcn-svelte `Tabs` component, which needs to be added to the project via `npx shadcn-svelte@next add tabs`.

### Integrations Tab — Spotify

Two visual states:

**Disconnected:**
- Card with heading "Connect Spotify"
- Subtext: "Add Spotify tracks and playlists to your scenes. Requires Spotify Premium."
- "Connect Spotify" button triggers OAuth flow
- While connecting: button shows "Connecting..." (disabled), subtext changes to "Complete authorization in your browser, then return here."
- Toast on success ("Spotify connected") or failure via `svelte-sonner`

**Connected:**
- Card shows "Connected" status with "Disconnect" button
- Subtext: "Spotify Premium required for in-app playback"
- Disconnect calls `spotify_revoke`, resets local state, shows toast

Auth status is fetched on mount via `spotify_get_auth_status`. This is page-level state, not a global store.

### Vault Tab

- **Vault path** — read from the existing `vault` store
- **Note count** — derived from the notes store list length
- **Scene count** — derived from the scenes store list length
- **Close Vault button** — navigates to `/` and triggers vault close

### Preferences Tab

- **Theme toggle** (dark/light/system) — uses `mode-watcher`'s `setMode`, same logic currently in the sidebar footer
- The theme toggle is removed from the sidebar footer; the gear icon takes its place

## Scene Workflow — Contextual Prompt

### Location

Inside the existing "Add Track" dialog on `/scene/[id]` (`+page.svelte`). The dialog already has `local` / `spotify` tabs (lines 602-619 of the current file). The Spotify tab content area (currently lines 650-662) is the insertion point.

### Behavior

When the user selects the "Spotify" tab in the Add Track dialog:

1. Check Spotify auth status via `spotify_get_auth_status`
2. **If not connected:** Replace the Spotify URI input with an inline connection card:
   - Heading: "Connect Spotify to add tracks"
   - Subtext: "Link your Spotify Premium account to add tracks and playlists to your scenes."
   - "Connect Spotify" button — triggers OAuth flow
   - Small "or go to Settings → Integrations" link
   - On successful connection, the card transitions to the normal Spotify URI input so the user continues without leaving the dialog
3. **If connected:** Show the existing Spotify URI input as-is

### Auth status caching

The auth check happens once when the Spotify tab is first selected in the dialog. If the user connects via the inline prompt, the local state updates immediately without re-fetching.

## Shared OAuth Utility

The OAuth flow logic (start auth, listen for callback, exchange code, disconnect) is used in both the settings page and the scene dialog. Extract it into a shared utility:

**File:** `src/lib/utils/spotify-auth.ts`

**Exports:**
- `connectSpotify(): Promise<SpotifyAuthStatus>` — starts OAuth flow, listens for callback, exchanges code, returns status. Handles the full lifecycle: `spotify_start_auth_flow` → open browser → listen for `spotify-auth-callback` event → `spotify_exchange_code`.
- `disconnectSpotify(): Promise<void>` — calls `spotify_revoke`
- `getSpotifyStatus(): Promise<SpotifyAuthStatus | null>` — calls `spotify_get_auth_status`

Both consumers call these functions and handle their own UI state (loading, toasts, etc.).

## Files Changed

### New files
- `src/routes/settings/+page.svelte` — settings page with tabbed layout
- `src/lib/utils/spotify-auth.ts` — shared OAuth flow utility
- `src/lib/components/ui/tabs/` — shadcn-svelte tabs component (generated)

### Modified files
- `src/lib/components/sidebar/AppSidebar.svelte` — add gear icon in footer, remove theme toggle
- `src/routes/scene/[id]/+page.svelte` — add contextual Spotify connection prompt in the Add Track dialog's Spotify tab

### Not touched
- Rust backend (all commands exist)
- Database/migrations (no schema changes)
- Audio engine (already handles Spotify playback)

## UI Components

Uses existing shadcn-svelte components: `Button`, `Input`, `AlertDialog`. Adds `Tabs` from shadcn-svelte. Cards are hand-styled with Tailwind to match the existing scene page patterns (rounded-lg, bg-card/50, border-border).
