<script lang="ts">
  import { setMode, userPrefersMode } from 'mode-watcher';
  import { api } from '$lib/api';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { Button } from '$lib/components/ui/button';
  import { ledger, type AccentPreset, type DensityLevel } from '$lib/stores/ledger.svelte';
  import { appPrefs } from '$lib/stores/app-prefs.svelte';
  import { templates } from '$lib/stores/templates.svelte';
  import { toastSuccess } from '$lib/toast';
  import { searchPalette } from '$lib/stores/search.svelte';
  import {
    getSpotifyStatus,
    connectSpotify,
    disconnectSpotify,
  } from '$lib/utils/spotify-auth';
  import type { SpotifyAuthStatus } from '$lib/types/ledger';
  import { LoaderCircle } from '@lucide/svelte';

  let { open = $bindable(false) }: { open: boolean } = $props();

  // App version for the About footer — resolved from the Tauri runtime so it
  // can never drift from the shipped bundle (issue #117).
  let appVersion = $state<string | null>(null);
  $effect(() => {
    if (open && appVersion === null && '__TAURI_INTERNALS__' in window) {
      import('@tauri-apps/api/app')
        .then(({ getVersion }) => getVersion())
        .then((v) => { appVersion = v; })
        .catch(() => {});
    }
  });

  function openExternal(url: string) {
    import('@tauri-apps/plugin-opener')
      .then(({ openUrl }) => openUrl(url))
      .catch(() => {});
  }

  let authStatus = $state<SpotifyAuthStatus | null>(null);
  let isConnecting = $state(false);
  let isAuthLoading = $state(true);
  let hasLoadedSpotify = $state(false);

  let restoreDialogOpen = $state(false);
  let isRestoring = $state(false);

  async function handleRestoreTemplates() {
    isRestoring = true;
    try {
      await api.restoreBuiltinTemplates();
      await templates.load();
      toastSuccess('Default templates restored');
    } catch (e) {
      console.error("restore templates failed:", e);
    } finally {
      isRestoring = false;
      restoreDialogOpen = false;
    }
  }

  $effect(() => {
    if (open && !hasLoadedSpotify) {
      hasLoadedSpotify = true;
      getSpotifyStatus()
        .then((s) => { authStatus = s; })
        .catch(() => {})
        .finally(() => { isAuthLoading = false; });
    }
  });

  async function handleConnect() {
    isConnecting = true;
    try {
      authStatus = await connectSpotify();
    } catch {
      // silent — user closed the browser tab
    } finally {
      isConnecting = false;
    }
  }

  async function handleDisconnect() {
    try {
      await disconnectSpotify();
      authStatus = null;
    } catch {
    }
  }

  const ACCENT_PRESETS: { value: AccentPreset; label: string; color: string }[] = [
    { value: 'accent-crimson', label: 'Crimson', color: '#c2483d' },
    { value: 'accent-arcane',  label: 'Arcane',  color: '#9b6bbf' },
    { value: 'accent-verdant', label: 'Verdant', color: '#5c9e6e' },
    { value: 'accent-ice',     label: 'Ice',     color: '#5b9ec9' },
    { value: 'accent-amber',   label: 'Amber',   color: '#c49a3c' },
  ];

  const DENSITY_LEVELS: { value: DensityLevel; label: string }[] = [
    { value: 'cozy',     label: 'Cozy'     },
    { value: 'balanced', label: 'Balanced' },
    { value: 'dense',    label: 'Dense'    },
  ];

  const segmentedBtn = (active: boolean) =>
    `px-3 py-1.5 text-xs transition-colors ${
      active
        ? 'bg-primary text-primary-foreground font-medium'
        : 'text-foreground-muted hover:text-foreground'
    }`;
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-md overflow-y-auto max-h-[90vh]">
    <Dialog.Header>
      <Dialog.Title>Settings</Dialog.Title>
    </Dialog.Header>

    <div class="flex flex-col gap-6 py-2">

      <!-- ── Appearance ──────────────────────────────────────────── -->
      <section class="flex flex-col gap-4">
        <h3 class="text-(--font-ui) font-semibold text-foreground-muted uppercase tracking-wider">
          Appearance
        </h3>

        <!-- Theme -->
        <div class="flex items-center justify-between gap-4">
          <div class="flex flex-col gap-0.5">
            <span class="text-(--font-body) font-medium text-foreground">Theme</span>
            <span class="text-(--font-ui) text-foreground-muted">Light, Dark, or System</span>
          </div>
          <div class="flex rounded-md border border-border overflow-hidden shrink-0">
            <button
              type="button"
              class={segmentedBtn(userPrefersMode.current === 'dark')}
              onclick={() => setMode('dark')}
            >Dark</button>
            <button
              type="button"
              class={segmentedBtn(userPrefersMode.current === 'light')}
              onclick={() => setMode('light')}
            >Light</button>
            <button
              type="button"
              class={segmentedBtn(userPrefersMode.current === 'system')}
              onclick={() => setMode('system')}
            >System</button>
          </div>
        </div>

        <!-- Accent -->
        <div class="flex items-center justify-between gap-4">
          <div class="flex flex-col gap-0.5">
            <span class="text-(--font-body) font-medium text-foreground">Accent</span>
            <span class="text-(--font-ui) text-foreground-muted">Choose a colour preset</span>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            {#each ACCENT_PRESETS as preset (preset.value)}
              <button
                type="button"
                data-testid="accent-{preset.value}"
                aria-label={preset.label}
                aria-pressed={ledger.accent === preset.value}
                onclick={() => ledger.setAccent(preset.value)}
                style="background-color: {preset.color}"
                class="size-6 rounded-full ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 {ledger.accent === preset.value ? 'ring-2 ring-ring ring-offset-1' : 'opacity-70 hover:opacity-100'}"
              ></button>
            {/each}
          </div>
        </div>

        <!-- Density -->
        <div class="flex items-center justify-between gap-4">
          <div class="flex flex-col gap-0.5">
            <span class="text-(--font-body) font-medium text-foreground">Density</span>
            <span class="text-(--font-ui) text-foreground-muted">Layout compactness</span>
          </div>
          <div class="flex rounded-md border border-border overflow-hidden shrink-0">
            {#each DENSITY_LEVELS as level (level.value)}
              <button
                type="button"
                class={segmentedBtn(ledger.density === level.value)}
                onclick={() => ledger.setDensity(level.value)}
              >{level.label}</button>
            {/each}
          </div>
        </div>

        <!-- Reduce Motion -->
        <div class="flex items-center justify-between gap-4">
          <div class="flex flex-col gap-0.5">
            <span class="text-(--font-body) font-medium text-foreground">Reduce Motion</span>
            <span class="text-(--font-ui) text-foreground-muted">Disable animations and transitions</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={appPrefs.reduceMotion}
            aria-label="Reduce Motion"
            data-testid="reduce-motion-toggle"
            onclick={() => appPrefs.setReduceMotion(!appPrefs.reduceMotion)}
            class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background {appPrefs.reduceMotion ? 'bg-primary' : 'bg-input'}"
          >
            <span
              class="pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform {appPrefs.reduceMotion ? 'translate-x-4' : 'translate-x-0'}"
            ></span>
          </button>
        </div>
      </section>

      <!-- ── Editing ───────────────────────────────────────────── -->
      <section class="flex flex-col gap-4">
        <h3 class="text-(--font-ui) font-semibold text-foreground-muted uppercase tracking-wider">
          Editing
        </h3>

        <!-- Confirm before updating links on rename -->
        <div class="flex items-center justify-between gap-4">
          <div class="flex flex-col gap-0.5">
            <span class="text-(--font-body) font-medium text-foreground">Confirm before updating links on rename</span>
            <span class="text-(--font-ui) text-foreground-muted">Ask before rewriting wikilinks when a note is renamed</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={appPrefs.confirmRenameLinks}
            aria-label="Confirm before updating links on rename"
            data-testid="confirm-rename-links-toggle"
            onclick={() => appPrefs.setConfirmRenameLinks(!appPrefs.confirmRenameLinks)}
            class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background {appPrefs.confirmRenameLinks ? 'bg-primary' : 'bg-input'}"
          >
            <span
              class="pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform {appPrefs.confirmRenameLinks ? 'translate-x-4' : 'translate-x-0'}"
            ></span>
          </button>
        </div>
      </section>

      <!-- ── Templates ──────────────────────────────────────────── -->
      <section class="flex flex-col gap-4">
        <h3 class="text-(--font-ui) font-semibold text-foreground-muted uppercase tracking-wider">
          Templates
        </h3>

        <div class="flex items-center justify-between gap-4">
          <div class="flex flex-col gap-0.5">
            <span class="text-(--font-body) font-medium text-foreground">Restore default templates</span>
            <span class="text-(--font-ui) text-foreground-muted">Reset the four built-in templates to their original content. Custom templates are left untouched.</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            class="shrink-0"
            data-testid="restore-templates-btn"
            onclick={() => (restoreDialogOpen = true)}
          >Restore</Button>
        </div>
      </section>

      <!-- ── Tags ──────────────────────────────────────────────── -->
      <section class="flex flex-col gap-4">
        <h3 class="text-(--font-ui) font-semibold text-foreground-muted uppercase tracking-wider">
          Tags
        </h3>
        <div class="flex items-center justify-between gap-4">
          <div class="flex flex-col gap-0.5">
            <span class="text-(--font-body) font-medium text-foreground">Manage tags…</span>
            <span class="text-(--font-ui) text-foreground-muted">View all tags with usage counts</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            class="shrink-0"
            data-testid="open-tag-manager-btn"
            onclick={() => { open = false; searchPalette.tagManagerOpen = true; }}
          >Open</Button>
        </div>
      </section>

      <!-- ── Integrations ────────────────────────────────────────── -->
      <section class="flex flex-col gap-4">
        <h3 class="text-(--font-ui) font-semibold text-foreground-muted uppercase tracking-wider">
          Integrations
        </h3>

        <!-- Spotify -->
        {#if isAuthLoading}
          <div class="flex items-center gap-3 p-4 rounded-lg bg-background-elevated border border-border">
            <LoaderCircle class="size-4 animate-spin text-foreground-muted" />
            <span class="text-(--font-body) text-foreground-muted">Loading…</span>
          </div>
        {:else if authStatus?.is_connected}
          <div class="flex items-center justify-between p-4 rounded-lg bg-background-elevated border border-border">
            <div class="flex flex-col gap-0.5">
              <span class="text-(--font-body) font-medium text-foreground">Spotify connected</span>
              <span class="text-(--font-ui) text-foreground-muted">Premium required for in-app playback</span>
            </div>
            <Button variant="outline" size="sm" onclick={handleDisconnect}>Disconnect</Button>
          </div>
        {:else}
          <div class="flex flex-col gap-3 p-4 rounded-lg bg-background-elevated border border-border">
            <div class="flex flex-col gap-1">
              <span class="text-(--font-body) font-medium text-foreground">Connect Spotify</span>
              <span class="text-(--font-ui) text-foreground-muted">
                Add tracks and playlists to your scenes. Requires Spotify Premium.
              </span>
            </div>
            <Button size="sm" class="self-start" onclick={handleConnect} disabled={isConnecting}>
              {#if isConnecting}
                <LoaderCircle class="size-3.5 animate-spin" />
                Connecting…
              {:else}
                Connect Spotify
              {/if}
            </Button>
          </div>
        {/if}
      </section>

      <!-- ── About ──────────────────────────────────────────────── -->
      <section
        data-testid="about-section"
        class="flex flex-col gap-1.5 border-t border-border pt-4"
      >
        <div class="flex items-center justify-between gap-4">
          <span class="text-(--font-ui) text-foreground-muted">
            Grimoire {appVersion ? `v${appVersion}` : ''}
          </span>
          <button
            type="button"
            class="text-(--font-ui) text-foreground-muted underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            onclick={() => openExternal('https://github.com/Larront/grimoire/issues')}
          >Report a bug</button>
        </div>
        <span class="text-(--font-ui) text-foreground-faint">
          Free software under
          <button
            type="button"
            class="underline-offset-2 hover:text-foreground-muted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            onclick={() => openExternal('https://www.gnu.org/licenses/gpl-3.0.html')}
          >GPL-3.0</button>
          · source on
          <button
            type="button"
            class="underline-offset-2 hover:text-foreground-muted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            onclick={() => openExternal('https://github.com/Larront/grimoire')}
          >GitHub</button>
        </span>
        <span class="text-(--font-ui) text-foreground-faint">
          Sample audio by Kevin MacLeod (incompetech.com, CC-BY 4.0) and CC0 contributors.
        </span>
      </section>

    </div>
  </Dialog.Content>
</Dialog.Root>

<!-- ── Restore default templates confirmation ───────────────────────────── -->
<AlertDialog.Root bind:open={restoreDialogOpen}>
  <AlertDialog.Portal>
    <AlertDialog.Overlay />
    <AlertDialog.Content>
      <AlertDialog.Header>
        <AlertDialog.Title>Restore default templates?</AlertDialog.Title>
        <AlertDialog.Description>
          This overwrites the four built-in templates (NPC, Location, Session Log,
          Encounter) with their original content. Any custom templates you've
          created are left untouched.
        </AlertDialog.Description>
      </AlertDialog.Header>
      <AlertDialog.Footer>
        <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
        <AlertDialog.Action
          data-testid="restore-templates-confirm"
          disabled={isRestoring}
          onclick={handleRestoreTemplates}
        >
          {#if isRestoring}
            <LoaderCircle class="size-3.5 animate-spin" />
            Restoring…
          {:else}
            Restore
          {/if}
        </AlertDialog.Action>
      </AlertDialog.Footer>
    </AlertDialog.Content>
  </AlertDialog.Portal>
</AlertDialog.Root>
