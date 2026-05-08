<script lang="ts">
  import { onMount } from 'svelte';
  import { setMode, userPrefersMode } from 'mode-watcher';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { vault, type AccentPreset, type DensityLevel } from '$lib/stores/vault.svelte';
  import { appPrefs } from '$lib/stores/app-prefs.svelte';
  import {
    getSpotifyStatus,
    connectSpotify,
    disconnectSpotify,
  } from '$lib/utils/spotify-auth';
  import type { SpotifyAuthStatus } from '$lib/types/vault';
  import { LoaderCircle } from '@lucide/svelte';

  let { open = $bindable(false) }: { open: boolean } = $props();

  let authStatus = $state<SpotifyAuthStatus | null>(null);
  let isConnecting = $state(false);
  let isAuthLoading = $state(true);
  let hasLoadedSpotify = $state(false);

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
      // silent
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

  const themeSegBtn = (active: boolean) =>
    `px-3 py-1.5 text-xs transition-colors ${
      active
        ? 'bg-primary text-primary-foreground font-medium'
        : 'text-foreground-muted hover:text-foreground'
    }`;

  const densityBtn = (active: boolean) =>
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
        <h3 class="text-xs font-semibold text-foreground-muted uppercase tracking-wider">
          Appearance
        </h3>

        <!-- Theme -->
        <div class="flex items-center justify-between gap-4">
          <div class="flex flex-col gap-0.5">
            <span class="text-sm font-medium text-foreground">Theme</span>
            <span class="text-xs text-foreground-muted">Light, Dark, or System</span>
          </div>
          <div class="flex rounded-md border border-border overflow-hidden shrink-0">
            <button
              type="button"
              class={themeSegBtn(userPrefersMode.current === 'dark')}
              onclick={() => setMode('dark')}
            >Dark</button>
            <button
              type="button"
              class={themeSegBtn(userPrefersMode.current === 'light')}
              onclick={() => setMode('light')}
            >Light</button>
            <button
              type="button"
              class={themeSegBtn(userPrefersMode.current === 'system')}
              onclick={() => setMode('system')}
            >System</button>
          </div>
        </div>

        <!-- Accent -->
        <div class="flex items-center justify-between gap-4">
          <div class="flex flex-col gap-0.5">
            <span class="text-sm font-medium text-foreground">Accent</span>
            <span class="text-xs text-foreground-muted">Choose a colour preset</span>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            {#each ACCENT_PRESETS as preset (preset.value)}
              <button
                type="button"
                data-testid="accent-{preset.value}"
                aria-label={preset.label}
                aria-pressed={vault.accent === preset.value}
                onclick={() => vault.setAccent(preset.value)}
                style="background-color: {preset.color}"
                class="size-6 rounded-full ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 {vault.accent === preset.value ? 'ring-2 ring-ring ring-offset-1' : 'opacity-70 hover:opacity-100'}"
              ></button>
            {/each}
          </div>
        </div>

        <!-- Density -->
        <div class="flex items-center justify-between gap-4">
          <div class="flex flex-col gap-0.5">
            <span class="text-sm font-medium text-foreground">Density</span>
            <span class="text-xs text-foreground-muted">Layout compactness</span>
          </div>
          <div class="flex rounded-md border border-border overflow-hidden shrink-0">
            {#each DENSITY_LEVELS as level (level.value)}
              <button
                type="button"
                class={densityBtn(vault.density === level.value)}
                onclick={() => vault.setDensity(level.value)}
              >{level.label}</button>
            {/each}
          </div>
        </div>

        <!-- Reduce Motion -->
        <div class="flex items-center justify-between gap-4">
          <div class="flex flex-col gap-0.5">
            <span class="text-sm font-medium text-foreground">Reduce Motion</span>
            <span class="text-xs text-foreground-muted">Disable animations and transitions</span>
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

      <!-- ── Integrations ────────────────────────────────────────── -->
      <section class="flex flex-col gap-4">
        <h3 class="text-xs font-semibold text-foreground-muted uppercase tracking-wider">
          Integrations
        </h3>

        <!-- Spotify -->
        {#if isAuthLoading}
          <div class="flex items-center gap-3 p-4 rounded-lg bg-background-elevated border border-border">
            <LoaderCircle class="size-4 animate-spin text-foreground-muted" />
            <span class="text-sm text-foreground-muted">Loading…</span>
          </div>
        {:else if authStatus?.is_connected}
          <div class="flex items-center justify-between p-4 rounded-lg bg-background-elevated border border-border">
            <div class="flex flex-col gap-0.5">
              <span class="text-sm font-medium text-foreground">Spotify connected</span>
              <span class="text-xs text-foreground-muted">Premium required for in-app playback</span>
            </div>
            <Button variant="outline" size="sm" onclick={handleDisconnect}>Disconnect</Button>
          </div>
        {:else}
          <div class="flex flex-col gap-3 p-4 rounded-lg bg-background-elevated border border-border">
            <div class="flex flex-col gap-1">
              <span class="text-sm font-medium text-foreground">Connect Spotify</span>
              <span class="text-xs text-foreground-muted">
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

    </div>
  </Dialog.Content>
</Dialog.Root>
