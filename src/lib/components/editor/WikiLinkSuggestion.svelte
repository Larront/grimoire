<script lang="ts">
  import { FilePlus2, FileText } from "@lucide/svelte";
  import { placeMenu } from "$lib/utils/anchored-menu";
  import { WIKI_MENU_ID, wikiOptionId, type WikiSuggestion } from "$lib/editor/wiki-suggest";

  interface Props {
    items: WikiSuggestion[];
    selectedIndex: number;
    x: number;
    y: number;
    /** The caret's top, so a flipped menu clears the line rather than covering it. */
    anchorTop?: number;
    onSelect: (item: WikiSuggestion) => void;
    /**
     * The pointer moved onto a row: it becomes the one Enter takes, so only one row is
     * lit. Hover used to light a second row of its own, and Enter and a click disagreed.
     */
    onHover?: (index: number) => void;
    /** The note scrolled under the open menu; the caret's position should be read again. */
    onReposition?: () => void;
  }

  let { items, selectedIndex, x, y, anchorTop, onSelect, onHover, onReposition }: Props =
    $props();

  let itemRefs: (HTMLButtonElement | null)[] = [];
  let menuEl: HTMLDivElement | undefined = $state();

  $effect(() => {
    itemRefs[selectedIndex]?.scrollIntoView({ block: "nearest" });
  });

  // Measured, then placed — a two-result list and a ten-result one flip at different
  // points, and only the drawn element knows which this is. Re-placed when the caret moves.
  $effect(() => {
    items;
    if (menuEl) placeMenu(menuEl, { x, y, anchorTop });
  });

  // The note scrolling under an open menu left it hanging over whatever lines moved
  // beneath it. Its own scroll is the GM reading down the list, not the note moving.
  $effect(() => {
    if (!onReposition) return;
    const reposition = onReposition;
    const onScroll = (e: Event) => {
      if (menuEl && e.target instanceof Node && menuEl.contains(e.target)) return;
      reposition();
    };
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", onScroll, { capture: true });
  });
</script>

<!-- The rows are never Tab stops and never take focus: the GM's caret stays where they
     are typing, and that element points a screen reader at the selected row. The pointer
     moving onto a row selects it — `mousemove`, not `mouseenter`, which also fires when the
     list scrolls under a resting pointer and would fight the arrow keys.

     Above a dialog and taking the pointer regardless: the Quick Note dialog turns pointer
     events off outside itself, and this menu is portalled outside it — so a click on a row
     landed on the dialog's backdrop, which closed the dialog and filed the half-typed line. -->
<div
  bind:this={menuEl}
  id={WIKI_MENU_ID}
  class="wiki-menu pointer-events-auto fixed z-[60] w-72 max-h-[300px] overflow-y-auto overscroll-contain
         rounded-lg border border-border bg-popover p-1 shadow-float"
  data-wiki-suggest
  role="listbox"
  aria-label="Link to note"
>
  {#if items.length === 0}
    <div class="px-2 py-1.5 font-sans text-[0.8125rem] text-muted-foreground select-none">
      No notes yet
    </div>
  {:else}
    {#each items as item, i (item.kind === "note" ? item.id : `new:${item.name}`)}
      {@const selected = i === selectedIndex}
      <button
        bind:this={itemRefs[i]}
        id={wikiOptionId(i)}
        type="button"
        tabindex="-1"
        class="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left
               {selected ? 'bg-surface-selected text-foreground' : 'text-muted-foreground'}"
        role="option"
        aria-selected={selected}
        onmousemove={() => onHover?.(i)}
        onclick={() => onSelect(item)}
      >
        {#if item.kind === "note"}
          <FileText size={14} class="shrink-0 {selected ? '' : 'opacity-70'}" />
          <span class="min-w-0 flex-1 truncate font-sans text-[0.8125rem]">{item.title}</span>
          <!-- What tells two notes of one name apart, and why an alias answered: the
               folder it lives in rather than a file path, and the alias that matched. -->
          {#if item.alias || item.folder}
            <span class="max-w-[45%] shrink-0 truncate font-sans text-xs text-muted-foreground">
              {item.alias ?? item.folder}
            </span>
          {/if}
        {:else}
          <FilePlus2 size={14} class="shrink-0 {selected ? '' : 'opacity-70'}" />
          <span class="min-w-0 flex-1 truncate font-sans text-[0.8125rem]">
            New note “{item.name}”
          </span>
        {/if}
      </button>
    {/each}
  {/if}
</div>

<style>
  /* The note's own thin scrollbar, as the slash menu's. */
  .wiki-menu {
    scrollbar-width: thin;
    scrollbar-color: var(--background-border) transparent;
  }
</style>
