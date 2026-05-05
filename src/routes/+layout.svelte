<script lang="ts">
  import AppShell from "$lib/components/AppShell.svelte";
  import ThemeWatcher from "$lib/components/ThemeWatcher.svelte";
  import { vault } from "../lib/stores/vault.svelte";
  import "../app.css";

  const { children } = $props();
</script>

<ThemeWatcher />

{#if vault.isOpen}
  <AppShell>{@render children?.()}</AppShell>
{:else}
  {@render children?.()}
{/if}
