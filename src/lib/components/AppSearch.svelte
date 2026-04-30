<script lang="ts">
  import { FileText, Key, MapIcon, Search } from "@lucide/svelte";
  import * as Command from "$lib/components/ui/command";
  import type { Map as VaultMap, Note } from "$lib/types/vault";
  import { notes } from "$lib/stores/notes.svelte";
  import { maps } from "$lib/stores/maps.svelte";

  interface SearchResult {
    entity: VaultMap | Note;
    type: "note" | "map";
  }

  let open = $state(false);
  // let results = $derived<SearchResult[]>([
  //   ...notes.notes.map((note) => ({ entity: note, type: "note" })),
  //   ...maps.maps.map((map) => ({ entity: map, type: "map" })),
  // ]);

  const isMac = $derived(
    typeof navigator !== "undefined" && /mac/i.test(navigator.platform),
  );

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "k" && (isMac ? e.metaKey : e.ctrlKey)) {
      e.preventDefault();
      open = true;
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<Command.Dialog bind:open>
  <Command.Input placeholder="Type a command or search..." />
  <Command.List>
    <!-- {#if results.length === 0}
      <Command.Empty>No results found.</Command.Empty>
    {/if}
    <Command.Group heading="Pages">
      {#each results as result (result.entity.id)}
        <Command.Item>
          {#if result.type === "note"}
            <FileText class="size-4 shrink-0 text-muted-foreground" />
          {:else}
            <MapIcon class="size-4 shrink-0 text-muted-foreground" />
          {/if}
          {result.entity.title}
        </Command.Item>
      {/each}
    </Command.Group> -->
  </Command.List>
</Command.Dialog>
<div
  class="relative flex items-center justify-between gap-3 mx-3 mb-1 mt-2 h-7 px-2.5
         bg-muted text-muted-foreground rounded-lg text-xs font-normal
         cursor-pointer whitespace-nowrap select-none
         hover:bg-sidebar-accent hover:text-foreground transition-colors duration-100"
>
  <span class="flex items-center gap-1.5">
    <Search class="w-3.5 h-3.5 shrink-0" />
    Search vault…
  </span>
  <kbd
    class="pointer-events-none inline-flex h-4 select-none items-center gap-0.5
           rounded border border-border bg-sidebar px-1 font-mono text-[10px] opacity-60"
  >
    <span>{isMac ? "\u2318" : "Ctrl"} + K</span>
  </kbd>
</div>
