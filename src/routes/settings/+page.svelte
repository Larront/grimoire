<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { userPrefersMode, setMode } from "mode-watcher";
  import * as Tabs from "$lib/components/ui/tabs";
  import { Button } from "$lib/components/ui/button";
  import { breadcrumbs } from "$lib/stores/breadcrumbs.svelte";
  import { vault } from "$lib/stores/vault.svelte";
  import { notes } from "$lib/stores/notes.svelte";
  import { scenes } from "$lib/stores/scenes.svelte";
  import {
    getSpotifyStatus,
    connectSpotify,
    disconnectSpotify,
  } from "$lib/utils/spotify-auth";
  import type { SpotifyAuthStatus } from "$lib/types/vault";
  import { LoaderCircle } from "@lucide/svelte";

  // ---- Breadcrumbs ----
  $effect(() => {
    breadcrumbs.set([{ label: "Settings" }]);
    return () => breadcrumbs.clear();
  });

  // ---- Spotify auth state ----
  let authStatus = $state<SpotifyAuthStatus | null>(null);
  let isConnecting = $state(false);
  let isAuthLoading = $state(true);

  onMount(async () => {
    try {
      authStatus = await getSpotifyStatus();
    } catch (e) {
      console.error("Failed to get Spotify auth status:", e);
    } finally {
      isAuthLoading = false;
    }
  });

  async function handleConnect() {
    isConnecting = true;
    try {
      authStatus = await connectSpotify();
    } catch (e) {
      console.error("Spotify connection failed:", e);
    } finally {
      isConnecting = false;
    }
  }

  async function handleDisconnect() {
    try {
      await disconnectSpotify();
      authStatus = null;
    } catch (e) {
      console.error("Failed to disconnect:", e);
    }
  }

  // ---- Vault info ----
  let vaultPath = $derived(vault.path ?? "No vault open");
  let noteCount = $derived(notes.notes.length);
  let sceneCount = $derived(scenes.scenes.length);
</script>

<div class="flex flex-1 flex-col overflow-y-auto">
  <div class="mx-auto w-full max-w-2xl px-8 pt-8 pb-20">
    <div class="flex flex-col gap-1 mb-8">
      <h1 class="font-heading text-3xl leading-tight tracking-tight text-foreground">
        Settings
      </h1>
      <p class="text-sm text-muted-foreground">
        Manage integrations, vault, and preferences
      </p>
    </div>

    <Tabs.Root value="integrations">
      <Tabs.List>
        <Tabs.Trigger value="integrations">Integrations</Tabs.Trigger>
        <Tabs.Trigger value="vault">Vault</Tabs.Trigger>
        <Tabs.Trigger value="preferences">Preferences</Tabs.Trigger>
      </Tabs.List>

      <!-- Integrations Tab -->
      <Tabs.Content value="integrations">
        <div class="mt-6">
          <h2
            class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4"
          >
            Spotify
          </h2>

          {#if isAuthLoading}
            <div
              class="flex items-center gap-3 p-5 rounded-xl bg-card/50 border border-border"
            >
              <LoaderCircle class="size-4 animate-spin text-muted-foreground" />
              <span class="text-sm text-muted-foreground">Loading...</span>
            </div>
          {:else if authStatus?.is_connected}
            <div
              class="flex items-center justify-between p-5 rounded-xl bg-card/50 border border-border"
            >
              <div class="flex flex-col gap-0.5">
                <span class="text-sm text-foreground font-medium">Connected</span>
                <span class="text-xs text-muted-foreground">
                  Spotify Premium required for in-app playback
                </span>
              </div>
              <Button variant="outline" size="sm" onclick={handleDisconnect}>
                Disconnect
              </Button>
            </div>
          {:else}
            <div
              class="flex flex-col gap-3 p-5 rounded-xl bg-card/50 border border-border"
            >
              <div class="flex flex-col gap-1">
                <span class="text-sm text-foreground font-medium">
                  Connect Spotify
                </span>
                <span class="text-xs text-muted-foreground">
                  Add Spotify tracks and playlists to your scenes. Requires
                  Spotify Premium.
                </span>
              </div>
              <Button
                size="sm"
                class="self-start"
                onclick={handleConnect}
                disabled={isConnecting}
              >
                {#if isConnecting}
                  <LoaderCircle class="size-3.5 animate-spin" />
                  Connecting...
                {:else}
                  Connect Spotify
                {/if}
              </Button>
              {#if isConnecting}
                <p class="text-xs text-muted-foreground">
                  Complete authorization in your browser, then return here.
                </p>
              {/if}
            </div>
          {/if}
        </div>
      </Tabs.Content>

      <!-- Vault Tab -->
      <Tabs.Content value="vault">
        <div class="mt-6 flex flex-col gap-4">
          <h2
            class="text-xs font-semibold text-muted-foreground uppercase tracking-wider"
          >
            Vault Info
          </h2>

          <div class="rounded-xl bg-card/50 border border-border divide-y divide-border">
            <div class="flex items-center justify-between px-5 py-3">
              <span class="text-sm text-muted-foreground">Path</span>
              <span class="text-sm text-foreground font-mono truncate max-w-xs">
                {vaultPath}
              </span>
            </div>
            <div class="flex items-center justify-between px-5 py-3">
              <span class="text-sm text-muted-foreground">Notes</span>
              <span class="text-sm text-foreground">{noteCount}</span>
            </div>
            <div class="flex items-center justify-between px-5 py-3">
              <span class="text-sm text-muted-foreground">Scenes</span>
              <span class="text-sm text-foreground">{sceneCount}</span>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            class="self-start"
            onclick={() => {
              vault.closeVault();
              goto("/");
            }}
          >
            Close Vault
          </Button>
        </div>
      </Tabs.Content>

      <!-- Preferences Tab -->
      <Tabs.Content value="preferences">
        <div class="mt-6 flex flex-col gap-4">
          <h2
            class="text-xs font-semibold text-muted-foreground uppercase tracking-wider"
          >
            Appearance
          </h2>

          <div class="rounded-xl bg-card/50 border border-border p-5">
            <div class="flex items-center justify-between">
              <div class="flex flex-col gap-0.5">
                <span class="text-sm text-foreground font-medium">Theme</span>
                <span class="text-xs text-muted-foreground">
                  Choose your preferred appearance
                </span>
              </div>
              <div class="flex rounded-lg border border-border overflow-hidden">
                <button
                  class="px-3 py-1.5 text-xs transition-colors {userPrefersMode.current ===
                  'dark'
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground'}"
                  onclick={() => setMode("dark")}
                >
                  Dark
                </button>
                <button
                  class="px-3 py-1.5 text-xs transition-colors {userPrefersMode.current ===
                  'light'
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground'}"
                  onclick={() => setMode("light")}
                >
                  Light
                </button>
                <button
                  class="px-3 py-1.5 text-xs transition-colors {userPrefersMode.current ===
                  'system'
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground'}"
                  onclick={() => setMode("system")}
                >
                  System
                </button>
              </div>
            </div>
          </div>
        </div>
      </Tabs.Content>
    </Tabs.Root>
  </div>
</div>
