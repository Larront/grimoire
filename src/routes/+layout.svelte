<script lang="ts">
  import AppShell from "$lib/components/AppShell.svelte";
  import ThemeWatcher from "$lib/components/ThemeWatcher.svelte";
  import { Toaster } from "svelte-sonner";
  import { ledger } from "../lib/stores/ledger.svelte";
  import { appPrefs } from "../lib/stores/app-prefs.svelte";
  import "../app.css";

  const { children } = $props();

  // Load persisted global prefs once at startup (fire-and-forget).
  appPrefs.load();
</script>

<ThemeWatcher />
<Toaster richColors closeButton />

{#if ledger.isOpen}
  <AppShell />
{:else}
  {@render children?.()}
{/if}
