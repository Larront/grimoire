<script lang="ts">
  import { Search } from "@lucide/svelte";
  import { searchPalette } from "$lib/stores/search.svelte";

  const isMac = $derived(
    typeof navigator !== "undefined" && /mac/i.test(navigator.platform),
  );
</script>

<div
  data-testid="app-search-bar"
  role="button"
  tabindex="0"
  aria-label="Open search"
  class="relative flex items-center justify-between gap-3 mx-3 mb-1 mt-2 h-(--row-h) px-(--pad-x)
         bg-muted text-muted-foreground rounded-lg text-(--font-ui) font-normal
         cursor-pointer whitespace-nowrap select-none
         hover:bg-sidebar-accent hover:text-foreground transition-colors duration-100"
  onclick={() => (searchPalette.open = true)}
  onkeydown={(e) => e.key === "Enter" && (searchPalette.open = true)}
>
  <span class="flex items-center gap-1.5 min-w-0">
    <Search class="w-3.5 h-3.5 shrink-0" />
    <span class="truncate">Search ledger…</span>
  </span>
  <kbd
    class="pointer-events-none inline-flex h-4 shrink-0 select-none items-center gap-0.5
           rounded border border-border bg-sidebar px-1 font-mono text-[10px] opacity-60"
  >
    <span>{isMac ? "⌘" : "Ctrl"} + K</span>
  </kbd>
</div>
