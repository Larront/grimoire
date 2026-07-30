<script lang="ts">
  import { BLOCK_ICONS } from "$lib/components/editor/block-icons";
  import type { SlashCommandSuggestionState } from "$lib/editor/slash-command";

  interface Props {
    state: SlashCommandSuggestionState;
  }

  let { state }: Props = $props();

  let itemRefs: (HTMLButtonElement | null)[] = [];

  $effect(() => {
    itemRefs[state.selectedIndex]?.scrollIntoView({ block: "nearest" });
  });
</script>

<div
  class="fixed z-50 min-w-[200px] max-h-[300px] overflow-y-auto
         rounded-lg border border-border bg-popover py-1
         shadow-xl shadow-black/30"
  style="left: {state.x}px; top: {state.y}px;"
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
      {#if Icon}
        <Icon size={14} class="shrink-0 opacity-70" />
      {/if}
      <span class="font-sans text-[0.8125rem]">{item.label}</span>
    </button>
  {/each}
</div>
