<script lang="ts">
  import { X } from "@lucide/svelte";

  interface Props {
    aliases: string[];
    placeholder?: string;
    onchange?: (aliases: string[]) => void;
  }

  let {
    aliases = $bindable([]),
    placeholder = "Add an alias",
    onchange,
  }: Props = $props();

  let draft = $state("");
  let inputEl: HTMLInputElement | undefined = $state();

  const attachedKeys = $derived(new Set(aliases.map((a) => a.trim().toLowerCase())));

  function commit() {
    onchange?.(aliases);
  }

  function attach(value: string) {
    const raw = value.trim();
    if (!raw) {
      draft = "";
      return;
    }
    if (attachedKeys.has(raw.toLowerCase())) {
      draft = "";
      return;
    }
    aliases = [...aliases, raw];
    draft = "";
    commit();
  }

  function removeAt(i: number) {
    aliases = aliases.filter((_, idx) => idx !== i);
    commit();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      attach(draft);
      return;
    }
    if (e.key === "Backspace" && draft.length === 0 && aliases.length > 0) {
      e.preventDefault();
      removeAt(aliases.length - 1);
    }
  }

  function onBlur() {
    if (draft.trim()) attach(draft);
  }
</script>

<div data-slot="alias-chip-editor-wrap">
  <div
    data-slot="alias-chip-editor"
    class="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 transition-colors"
    onclick={() => inputEl?.focus()}
    role="presentation"
  >
    {#each aliases as alias, i (alias + i)}
      <span
        data-slot="alias-chip"
        class="group inline-flex items-center gap-1 rounded-[100px] bg-primary/15 px-2 py-0.5 text-xs font-medium text-foreground"
      >
        <span>{alias}</span>
        <button
          type="button"
          data-slot="alias-chip-remove"
          aria-label={`Remove alias ${alias}`}
          class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:text-primary"
          onclick={(e) => {
            e.stopPropagation();
            removeAt(i);
          }}
        >
          <X class="size-3" />
        </button>
      </span>
    {/each}
    <input
      bind:this={inputEl}
      bind:value={draft}
      data-slot="alias-chip-input"
      type="text"
      autocomplete="off"
      {placeholder}
      class="flex-1 min-w-[6ch] bg-transparent text-xs outline-none placeholder:text-muted-foreground"
      onkeydown={onKeydown}
      onblur={onBlur}
    />
  </div>
</div>
