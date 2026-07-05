<script lang="ts">
  import { setMode, userPrefersMode } from 'mode-watcher';
  import { api } from '$lib/api';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { Button } from '$lib/components/ui/button';
  import { Tabs } from 'bits-ui';
  import { ledger, type AccentPreset, type DensityLevel } from '$lib/stores/ledger.svelte';
  import { appPrefs } from '$lib/stores/app-prefs.svelte';
  import { templates } from '$lib/stores/templates.svelte';
  import { toastSuccess, toastError } from '$lib/toast';
  import { searchPalette } from '$lib/stores/search.svelte';
  import {
    getSpotifyStatus,
    connectSpotify,
    disconnectSpotify,
  } from '$lib/utils/spotify-auth';
  import type { SpotifyAuthStatus } from '$lib/types/ledger';
  import { LoaderCircle } from '@lucide/svelte';

  let { open = $bindable(false) }: { open: boolean } = $props();

  let section = $state('appearance');

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
      restoreDialogOpen = false;
    } catch (e) {
      // Surface the failure — a silent close would leave the GM believing the
      // defaults were reset when they weren't. The confirm dialog still closes
      // (bits-ui Action), but the toast makes the failure visible so they can retry.
      console.error('restore templates failed:', e);
      toastError("Couldn't restore templates. Please try again.");
    } finally {
      isRestoring = false;
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
      // silent — the common case is the user closing the browser tab
    } finally {
      isConnecting = false;
    }
  }

  async function handleDisconnect() {
    try {
      await disconnectSpotify();
      authStatus = null;
    } catch (e) {
      console.error('spotify disconnect failed:', e);
      toastError("Couldn't disconnect Spotify. Please try again.");
    }
  }

  const ACCENT_PRESETS: { value: AccentPreset; label: string; color: string }[] = [
    { value: 'accent-crimson', label: 'Crimson', color: '#c2483d' },
    { value: 'accent-arcane',  label: 'Arcane',  color: '#9b6bbf' },
    { value: 'accent-verdant', label: 'Verdant', color: '#5c9e6e' },
    { value: 'accent-ice',     label: 'Ice',     color: '#5b9ec9' },
    { value: 'accent-amber',   label: 'Amber',   color: '#c49a3c' },
  ];

  const THEME_MODES: { value: 'dark' | 'light' | 'system'; label: string }[] = [
    { value: 'dark',   label: 'Dark'   },
    { value: 'light',  label: 'Light'  },
    { value: 'system', label: 'System' },
  ];

  const DENSITY_LEVELS: { value: DensityLevel; label: string }[] = [
    { value: 'cozy',     label: 'Cozy'     },
    { value: 'balanced', label: 'Balanced' },
    { value: 'dense',    label: 'Dense'    },
  ];

  const SECTIONS: { value: string; label: string }[] = [
    { value: 'appearance',   label: 'Appearance'   },
    { value: 'content',      label: 'Content'      },
    { value: 'integrations', label: 'Integrations' },
    { value: 'about',        label: 'About'        },
  ];

  const segmentedBtn = (active: boolean) =>
    `px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
      active
        ? 'bg-primary text-primary-foreground font-medium'
        : 'text-foreground-muted hover:text-foreground'
    }`;
</script>

<!-- A label/description pair, shared by every settings row. -->
{#snippet field(title: string, description: string)}
  <div class="flex flex-col gap-0.5">
    <span class="text-(--font-body) font-medium text-foreground">{title}</span>
    <span class="text-(--font-ui) text-foreground-muted">{description}</span>
  </div>
{/snippet}

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-2xl w-full h-[80vh] max-h-[560px] flex flex-col p-0 gap-0 overflow-hidden">
    <Dialog.Header class="px-5 pt-5 pb-3 border-b border-border shrink-0 text-left">
      <Dialog.Title>Settings</Dialog.Title>
      <Dialog.Description class="sr-only">
        Manage appearance, content, integrations, and application information.
      </Dialog.Description>
    </Dialog.Header>

    <Tabs.Root bind:value={section} orientation="vertical" class="flex flex-row flex-1 min-h-0">
      <!-- ── Section rail ─────────────────────────────────────────── -->
      <Tabs.List
        class="flex flex-col gap-0.5 shrink-0 w-44 border-r border-border p-3 overflow-y-auto"
      >
        {#each SECTIONS as s (s.value)}
          <Tabs.Trigger
            value={s.value}
            data-testid="settings-tab-{s.value}"
            class="flex items-center h-(--row-h) px-3 rounded-md text-(--font-body) text-left text-foreground-muted transition-colors hover:text-foreground hover:bg-foreground/[0.04] data-[state=active]:bg-primary/[0.12] data-[state=active]:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            {s.label}
          </Tabs.Trigger>
        {/each}
      </Tabs.List>

      <!-- ── Panel ────────────────────────────────────────────────── -->
      <div class="flex-1 min-h-0 overflow-y-auto px-5 py-4">

        <!-- Appearance -->
        <Tabs.Content value="appearance" class="outline-none">
          <div class="flex flex-col divide-y divide-border">
            <!-- Theme -->
            <div class="flex items-center justify-between gap-4 py-3 first:pt-0">
              {@render field('Theme', 'Light, Dark, or System')}
              <div
                role="group"
                aria-label="Theme"
                class="flex rounded-md border border-border divide-x divide-border overflow-hidden shrink-0"
              >
                {#each THEME_MODES as mode (mode.value)}
                  <button
                    type="button"
                    aria-pressed={userPrefersMode.current === mode.value}
                    class={segmentedBtn(userPrefersMode.current === mode.value)}
                    onclick={() => setMode(mode.value)}
                  >{mode.label}</button>
                {/each}
              </div>
            </div>

            <!-- Accent -->
            <div class="flex items-center justify-between gap-4 py-3">
              {@render field('Accent', 'Choose a colour preset')}
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
            <div class="flex items-center justify-between gap-4 py-3">
              {@render field('Density', 'Layout compactness')}
              <div
                role="group"
                aria-label="Density"
                class="flex rounded-md border border-border divide-x divide-border overflow-hidden shrink-0"
              >
                {#each DENSITY_LEVELS as level (level.value)}
                  <button
                    type="button"
                    aria-pressed={ledger.density === level.value}
                    class={segmentedBtn(ledger.density === level.value)}
                    onclick={() => ledger.setDensity(level.value)}
                  >{level.label}</button>
                {/each}
              </div>
            </div>

            <!-- Reduce Motion -->
            <div class="flex items-center justify-between gap-4 py-3">
              {@render field('Reduce Motion', 'Disable animations and transitions')}
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
                  class="pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-lg ring-0 {appPrefs.reduceMotion ? 'translate-x-4' : 'translate-x-0'} {appPrefs.reduceMotion ? '' : 'transition-transform'}"
                ></span>
              </button>
            </div>
          </div>
        </Tabs.Content>

        <!-- Content -->
        <Tabs.Content value="content" class="outline-none">
          <div class="flex flex-col divide-y divide-border">
            <!-- Confirm before updating links on rename -->
            <div class="flex items-center justify-between gap-4 py-3 first:pt-0">
              {@render field('Confirm before updating links on rename', 'Ask before rewriting wikilinks when a note is renamed')}
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
                  class="pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-lg ring-0 {appPrefs.confirmRenameLinks ? 'translate-x-4' : 'translate-x-0'} {appPrefs.confirmRenameLinks ? '' : 'transition-transform'}"
                ></span>
              </button>
            </div>

            <!-- Restore built-in templates -->
            <div class="flex items-center justify-between gap-4 py-3">
              {@render field('Built-in templates', 'Reset the four built-in templates to their original content. Custom templates are left untouched.')}
              <Button
                variant="outline"
                size="sm"
                class="shrink-0"
                data-testid="restore-templates-btn"
                onclick={() => (restoreDialogOpen = true)}
              >Restore defaults</Button>
            </div>

            <!-- Tags -->
            <div class="flex items-center justify-between gap-4 py-3">
              {@render field('Tags', 'View all tags with usage counts')}
              <Button
                variant="outline"
                size="sm"
                class="shrink-0"
                data-testid="open-tag-manager-btn"
                onclick={() => { open = false; searchPalette.tagManagerOpen = true; }}
              >Manage</Button>
            </div>
          </div>
        </Tabs.Content>

        <!-- Integrations -->
        <Tabs.Content value="integrations" class="outline-none">
          <div class="flex flex-col divide-y divide-border">
            {#if isAuthLoading}
              <div class="flex items-center justify-between gap-4 py-3 first:pt-0">
                {@render field('Spotify', 'Checking connection…')}
                <LoaderCircle class="size-4 shrink-0 animate-spin text-foreground-muted" />
              </div>
            {:else if authStatus?.is_connected}
              <div class="flex items-center justify-between gap-4 py-3 first:pt-0">
                {@render field('Spotify', 'Connected · Premium required for in-app playback')}
                <Button variant="outline" size="sm" class="shrink-0" onclick={handleDisconnect}>Disconnect</Button>
              </div>
            {:else}
              <div class="flex items-center justify-between gap-4 py-3 first:pt-0">
                {@render field('Spotify', 'Add tracks and playlists to your scenes. Requires Spotify Premium.')}
                <Button size="sm" class="shrink-0" onclick={handleConnect} disabled={isConnecting}>
                  {#if isConnecting}
                    <LoaderCircle class="size-3.5 animate-spin" />
                    Connecting…
                  {:else}
                    Connect
                  {/if}
                </Button>
              </div>
            {/if}
          </div>
        </Tabs.Content>

        <!-- About -->
        <Tabs.Content value="about" class="outline-none" data-testid="about-section">
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between gap-4">
              <span class="text-(--font-body) text-foreground">
                Grimoire {appVersion ? `v${appVersion}` : ''}
              </span>
              <button
                type="button"
                class="text-(--font-ui) text-foreground-muted underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                onclick={() => openExternal('https://github.com/Larront/grimoire/issues')}
              >Report a bug</button>
            </div>
            <span class="text-(--font-ui) text-foreground-muted">
              Free software under
              <button
                type="button"
                class="underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                onclick={() => openExternal('https://www.gnu.org/licenses/gpl-3.0.html')}
              >GPL-3.0</button>
              · source on
              <button
                type="button"
                class="underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                onclick={() => openExternal('https://github.com/Larront/grimoire')}
              >GitHub</button>
            </span>
            <span class="text-(--font-ui) text-foreground-muted">
              Sample audio by Kevin MacLeod (incompetech.com, CC-BY 4.0) and CC0 contributors.
            </span>
          </div>
        </Tabs.Content>

      </div>
    </Tabs.Root>
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
