<script lang="ts">
  import { FileText } from "@lucide/svelte";
  import type { NoteSearchResult } from "$lib/editor/wiki-link";

  interface Props {
    items: NoteSearchResult[];
    selectedIndex: number;
    x: number;
    y: number;
    onSelect: (item: NoteSearchResult) => void;
  }

  let { items, selectedIndex, x, y, onSelect }: Props = $props();

  let itemRefs: (HTMLButtonElement | null)[] = [];

  $effect(() => {
    itemRefs[selectedIndex]?.scrollIntoView({ block: "nearest" });
  });
</script>

<div
  class="fixed z-50 min-w-[240px] max-h-[240px] overflow-y-auto
         rounded-lg border border-border bg-popover py-1
         shadow-xl shadow-black/30"
  style="left: {x}px; top: {y}px;"
  role="listbox"
  aria-label="Link to note"
>
  {#if items.length === 0}
    <div class="px-3 py-2 font-sans text-sm text-muted-foreground/60 select-none">
      No notes found
    </div>
  {:else}
    {#each items as item, i (item.id)}
      <button
        bind:this={itemRefs[i]}
        class="flex items-start gap-2.5 w-full px-3 py-2 text-left transition-colors
               {i === selectedIndex
                 ? 'bg-muted text-foreground'
                 : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}"
        role="option"
        aria-selected={i === selectedIndex}
        onclick={() => onSelect(item)}
      >
        <FileText size={13} class="mt-0.5 shrink-0 opacity-60" />
        <div class="min-w-0">
          <div class="font-sans text-[0.8125rem] font-medium truncate">{item.title}</div>
          <div class="font-sans text-[0.7rem] text-muted-foreground/60 truncate">{item.path}</div>
        </div>
      </button>
    {/each}
  {/if}
</div>
