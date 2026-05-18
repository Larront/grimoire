<script lang="ts" module>
  // Allowlist: letters, digits, hyphen, underscore, slash. Case is preserved
  // for display; duplicate detection lowercases via normalizeTag.
  // Whitespace and any other punctuation is rejected at the input boundary.
  export const TAG_ALLOWED = /^[a-z0-9\-_/]+$/i;

  export function normalizeTag(value: string): string {
    return value.trim().toLowerCase();
  }

  export function isValidTagChar(ch: string): boolean {
    return /^[a-zA-Z0-9\-_/]$/.test(ch);
  }
</script>

<script lang="ts">
  import { X } from "@lucide/svelte";

  interface Props {
    tags: string[];
    placeholder?: string;
    suggestions?: string[];
    onchange?: (tags: string[]) => void;
  }

  let {
    tags = $bindable([]),
    placeholder = "Add a tag",
    suggestions = [],
    onchange,
  }: Props = $props();

  let draft = $state("");
  let inputEl: HTMLInputElement | undefined = $state();

  // Already-attached tags are filtered out of the dropdown so a GM can't
  // re-attach the same tag.
  const attachedKeys = $derived(new Set(tags.map(normalizeTag)));

  const matchingSuggestions = $derived.by(() => {
    const key = normalizeTag(draft);
    if (!key) return [];
    return suggestions
      .filter((s) => {
        const nk = normalizeTag(s);
        return nk.includes(key) && !attachedKeys.has(nk);
      })
      .sort((a, b) => normalizeTag(a).localeCompare(normalizeTag(b)));
  });

  // Show "Create new tag: X" only when the draft is a valid tag value AND
  // no suggestion matches it exactly (case-insensitive) AND it's not
  // already attached.
  const showCreateNew = $derived.by(() => {
    const raw = draft.trim();
    const key = normalizeTag(raw);
    if (!key || !TAG_ALLOWED.test(raw)) return false;
    if (attachedKeys.has(key)) return false;
    return !suggestions.some((s) => normalizeTag(s) === key);
  });

  function commit() {
    onchange?.(tags);
  }

  function attach(value: string) {
    const raw = value.trim();
    if (!raw || !TAG_ALLOWED.test(raw)) {
      draft = "";
      return;
    }
    const key = normalizeTag(raw);
    if (attachedKeys.has(key)) {
      draft = "";
      return;
    }
    tags = [...tags, raw];
    draft = "";
    commit();
  }

  function tryAdd() {
    if (!draft.trim()) return;
    attach(draft);
  }

  function removeAt(i: number) {
    tags = tags.filter((_, idx) => idx !== i);
    commit();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      // Prefer first matching suggestion if present; otherwise create new.
      if (matchingSuggestions.length > 0) {
        attach(matchingSuggestions[0]);
      } else {
        tryAdd();
      }
      return;
    }
    if (e.key === "Backspace" && draft.length === 0 && tags.length > 0) {
      e.preventDefault();
      removeAt(tags.length - 1);
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (!isValidTagChar(e.key)) {
        e.preventDefault();
      }
    }
  }

  function onPaste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData("text") ?? "";
    if (!text) return;
    e.preventDefault();
    const candidate = text.trim();
    if (TAG_ALLOWED.test(candidate)) {
      draft = (draft + candidate).slice(0, 64);
    }
  }
</script>

<div data-slot="tag-chip-editor-wrap" class="relative">
  <div
    data-slot="tag-chip-editor"
    class="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 transition-colors"
    onclick={() => inputEl?.focus()}
    role="presentation"
  >
    {#each tags as tag, i (tag + i)}
      <span
        data-slot="tag-chip"
        class="group inline-flex items-center gap-1 rounded-[100px] bg-primary/15 px-2 py-0.5 text-xs font-medium text-foreground"
      >
        <span>{tag}</span>
        <button
          type="button"
          data-slot="tag-chip-remove"
          aria-label={`Remove tag ${tag}`}
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
      data-slot="tag-chip-input"
      type="text"
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
      {placeholder}
      class="flex-1 min-w-[6ch] bg-transparent text-xs outline-none placeholder:text-muted-foreground"
      onkeydown={onKeydown}
      onpaste={onPaste}
      onblur={tryAdd}
    />
  </div>
  {#if draft.trim() && (matchingSuggestions.length > 0 || showCreateNew)}
    <div
      data-slot="tag-chip-dropdown"
      class="absolute left-0 right-0 top-full mt-1 z-10 max-h-48 overflow-y-auto rounded-md border border-input bg-popover text-popover-foreground shadow-md"
    >
      {#each matchingSuggestions as suggestion (suggestion)}
        <button
          type="button"
          data-slot="tag-chip-suggestion"
          class="block w-full text-left px-2 py-1 text-xs hover:bg-primary/15 focus:bg-primary/15 focus:outline-none"
          onmousedown={(e) => {
            e.preventDefault();
            attach(suggestion);
          }}
        >
          {suggestion}
        </button>
      {/each}
      {#if showCreateNew}
        <button
          type="button"
          data-slot="tag-chip-create-new"
          class="block w-full text-left px-2 py-1 text-xs border-t border-input hover:bg-primary/15 focus:bg-primary/15 focus:outline-none"
          onmousedown={(e) => {
            e.preventDefault();
            attach(draft);
          }}
        >
          Create new tag: <span class="font-medium">{draft.trim()}</span>
        </button>
      {/if}
    </div>
  {/if}
</div>
