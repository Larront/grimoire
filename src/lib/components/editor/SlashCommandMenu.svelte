<script lang="ts">
  import { BLOCK_ICONS } from "$lib/components/editor/block-icons";
  import { placeMenu } from "$lib/utils/anchored-menu";
  import type { SlashCommandSuggestionState } from "$lib/editor/slash-command";

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
  // the list — and so the height — changes.
  $effect(() => {
    state.items;
    if (menuEl) placeMenu(menuEl, state);
  });
</script>

<div
  bind:this={menuEl}
  class="fixed z-50 min-w-[200px] max-h-[300px] overflow-y-auto
         rounded-lg border border-border bg-popover py-1
         shadow-xl shadow-black/30"
  role="listbox"
  aria-label="Slash commands"
>
  <!-- Keyed by group and label: "Quote" names both a plain blockquote under Text
       and a quote callout under Callout, and a label alone would collide. -->
  {#each state.items as item, i (`${item.group}/${item.label}`)}
    {#if i === 0 || item.group !== state.items[i - 1].group}
      <div
        class="px-3 pt-2.5 pb-0.5 font-heading text-[0.6rem] uppercase tracking-widest
               text-muted-foreground/60 select-none pointer-events-none"
        aria-hidden="true"
      >
        {item.group}
      </div>
    {/if}
    {@const Icon = BLOCK_ICONS[item.icon]}
    <button
      bind:this={itemRefs[i]}
      class="flex items-center gap-2.5 w-full px-3 py-1.5 text-left transition-colors
             {i === state.selectedIndex
        ? 'bg-muted text-foreground'
        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}"
      role="option"
      aria-selected={i === state.selectedIndex}
      onclick={() => state.command(item)}
    >
      <!-- Unguarded: an item's icon name is typed as one that exists (#220), so there is
           no undefined to draw around — a typo does not compile. -->
      <Icon size={14} class="shrink-0 opacity-70" />
      <span class="font-sans text-[0.8125rem]">{item.label}</span>
    </button>
  {/each}
</div>
