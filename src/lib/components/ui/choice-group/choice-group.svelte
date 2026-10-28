<script lang="ts" generics="T extends string">
  // One choice of a few, shown side by side — a setting's segmented control (2026-10 design
  // review). Settings drew these as separate pressed buttons, three Tab stops each, which a
  // screen reader announced as unrelated toggles. A radio group is one Tab stop; the arrow
  // keys move the choice, as they do in every radio group.
  import type { Snippet } from "svelte";

  let {
    options,
    value,
    onChange,
    label,
    option,
    class: className = "",
    optionClass = () => "",
  }: {
    options: readonly { value: T; label: string }[];
    value: T;
    onChange: (value: T) => void;
    /** The group's name, said with each choice. */
    label: string;
    /** How one choice is drawn, where it is not its label in a segment. */
    option?: Snippet<[{ value: T; label: string }, boolean]>;
    class?: string;
    optionClass?: (selected: boolean) => string;
  } = $props();

  let buttons: (HTMLButtonElement | null)[] = [];

  // With nothing chosen yet, Tab still has to reach the group: the first choice holds
  // the stop, as in any radio group.
  const noneChosen = $derived(!options.some((o) => o.value === value));

  function onKeydown(e: KeyboardEvent, i: number) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = (i + step + options.length) % options.length;
    onChange(options[next].value);
    buttons[next]?.focus();
  }
</script>

<div role="radiogroup" aria-label={label} class={className}>
  {#each options as item, i (item.value)}
    {@const selected = item.value === value}
    <button
      bind:this={buttons[i]}
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={option ? item.label : undefined}
      tabindex={selected || (noneChosen && i === 0) ? 0 : -1}
      class={optionClass(selected)}
      onclick={() => onChange(item.value)}
      onkeydown={(e) => onKeydown(e, i)}
    >
      {#if option}
        {@render option(item, selected)}
      {:else}
        {item.label}
      {/if}
    </button>
  {/each}
</div>
