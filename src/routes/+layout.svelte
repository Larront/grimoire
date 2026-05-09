<script lang="ts">
  import AppShell from "$lib/components/AppShell.svelte";
  import ThemeWatcher from "$lib/components/ThemeWatcher.svelte";
  import { Toaster } from "svelte-sonner";
  import { vault } from "../lib/stores/vault.svelte";
  import "../app.css";

  const { children } = $props();
</script>

<ThemeWatcher />
<Toaster richColors closeButton />

{#if vault.isOpen}
  <AppShell />
{:else}
  {@render children?.()}
{/if}
