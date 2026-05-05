<script lang="ts">
  import AppShell from "$lib/components/AppShell.svelte";
  import AccentWatcher from "$lib/components/AccentWatcher.svelte";
  import { ModeWatcher } from "mode-watcher";
  import { vault } from "../lib/stores/vault.svelte";
  import "../app.css";

  const { children } = $props();
</script>

<ModeWatcher defaultMode="dark" />
<AccentWatcher />

{#if vault.isOpen}
  <AppShell>{@render children?.()}</AppShell>
{:else}
  {@render children?.()}
{/if}
