<script lang="ts">
  import AppShell from "$lib/components/AppShell.svelte";
  import ThemeWatcher from "$lib/components/ThemeWatcher.svelte";
  import { Toaster } from "svelte-sonner";
  import { ledger } from "../lib/stores/ledger.svelte";
  import { appPrefs } from "../lib/stores/app-prefs.svelte";
  import { checkForUpdates } from "$lib/updater";
  import "../app.css";

  const { children } = $props();

  // Load persisted global prefs once at startup (fire-and-forget).
  appPrefs.load();

  // Check for a new release on startup (no-ops outside the Tauri runtime).
  checkForUpdates();
</script>

<ThemeWatcher />
<Toaster richColors closeButton />

{#if ledger.isOpen}
  <AppShell />
{:else}
  {@render children?.()}
{/if}
