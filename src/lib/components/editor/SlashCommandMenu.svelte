<script lang="ts">
  import { BLOCK_ICONS } from "$lib/components/editor/block-icons";
  import { placeMenu } from "$lib/utils/anchored-menu";
  import {
    SLASH_MENU_ID,
    slashOptionId,
    type SlashCommandItem,
    type SlashCommandSuggestionState,
  } from "$lib/editor/slash-command";

  interface Props {
    state: SlashCommandSuggestionState;
  }

  let { state }: Props = $props();

  let itemRefs: (HTMLButtonElement | null)[] = [];
  // Plain `let`, not `$state`: the prop beside it is called `state`, which makes `$state`
  // read as a store subscription on it. Nothing needs it reactive — `bind:this` has run
  // by the time an effect does, and the effect below re-runs on the item list anyway.
  let menuEl: HTMLDivElement | undefined;

  $effect(() => {
    itemRefs[state.selectedIndex]?.scrollIntoView({ block: "nearest" });
  });

  // Placed after the items are drawn rather than from the caret alone: the menu's
  // height is its filtered list's, so `/` at the foot of a long note flips above the
  // caret while `/statb` a line higher does not. Reads `items` to re-place whenever
  // the list — and so the height — changes, and the position so a scroll re-places it.
  $effect(() => {
    state.items;
    state.y;
    if (menuEl) placeMenu(menuEl, state);
  });

  // The note scrolling under an open menu left it hanging over whatever lines moved
  // beneath it. Its own scroll is the GM reading down the list, not the note moving.
  $effect(() => {
    const onScroll = (e: Event) => {
      if (menuEl && e.target instanceof Node && menuEl.contains(e.target)) return;
      state.reposition();
    };
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", onScroll, { capture: true });
  });

  /** The rows under each heading, for the bare `/`; one run of rows once anything is typed. */
  const sections = $derived.by(() => {
    const out: { group: SlashCommandItem["group"] | null; rows: { item: SlashCommandItem; i: number }[] }[] = [];
    state.items.forEach((item, i) => {
      const group = state.grouped ? item.group : null;
      const last = out[out.length - 1];
      if (last && last.group === group) last.rows.push({ item, i });
      else out.push({ group, rows: [{ item, i }] });
    });
    return out;
  });

  const headingId = (group: string) => `${SLASH_MENU_ID}-${group.replace(/\s+/g, "-").toLowerCase()}`;
</script>

<!-- The rows are not Tab stops and never take focus: the GM's caret stays in the note,
     and the editor points a screen reader at the selected row (`aria-activedescendant`).
     The pointer moving onto a row selects it — `mousemove`, not `mouseenter`, which also
     fires when the list scrolls under a resting pointer and would fight the arrow keys. -->
{#snippet row(item: SlashCommandItem, i: number)}
  {@const Icon = BLOCK_ICONS[item.icon]}
  {@const selected = i === state.selectedIndex}
  <button
    bind:this={itemRefs[i]}
    id={slashOptionId(i)}
    type="button"
    tabindex="-1"
    class="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left
           {selected ? 'bg-surface-selected text-foreground' : 'text-muted-foreground'}"
    role="option"
    aria-selected={selected}
    onmousemove={() => state.select(i)}
    onclick={() => state.command(item)}
  >
    <!-- Unguarded: an item's icon name is typed as one that exists (#220), so there is
         no undefined to draw around — a typo does not compile. -->
    <Icon size={14} class="shrink-0 {selected ? 'text-foreground' : 'opacity-70'}" />
    <span class="min-w-0 flex-1 truncate font-sans text-[0.8125rem]">{item.label}</span>
    {#if item.hint}
      <span class="shrink-0 font-sans text-xs text-muted-foreground">{item.hint}</span>
    {/if}
  </button>
{/snippet}

<div
  bind:this={menuEl}
  id={SLASH_MENU_ID}
  class="slash-menu fixed z-50 w-60 max-h-[300px] overflow-y-auto overscroll-contain
         rounded-lg border border-border bg-popover p-1 shadow-float"
  role="listbox"
  aria-label="Insert a block"
>
  {#if state.items.length === 0}
    <div class="px-2 py-1.5 font-sans text-[0.8125rem] text-muted-foreground select-none" role="presentation">
      No blocks match “{state.query.trim()}”
    </div>
  {:else}
    {#each sections as section, s (section.group ?? `ranked-${s}`)}
      {#if section.group}
        <!-- The palette's group heading: 12px, sentence case, Ember Muted. These were 11px
             uppercase at 60% — 3:1 on the menu, under the 4.5:1 a label needs. -->
        <div role="group" aria-labelledby={headingId(section.group)}>
          <div
            id={headingId(section.group)}
            class="px-2 pt-2 pb-1 font-sans text-xs font-medium text-muted-foreground select-none"
          >
            {section.group}
          </div>
          {#each section.rows as { item, i } (`${item.group}/${item.label}/${item.hint ?? ""}`)}
            {@render row(item, i)}
          {/each}
        </div>
      {:else}
        {#each section.rows as { item, i } (`${item.group}/${item.label}/${item.hint ?? ""}`)}
          {@render row(item, i)}
        {/each}
      {/if}
    {/each}
  {/if}
</div>

<style>
  /* The note's own thin scrollbar, not the platform's with arrow buttons drawn inside a
     rounded menu. */
  .slash-menu {
    scrollbar-width: thin;
    scrollbar-color: var(--background-border) transparent;
  }
</style>
