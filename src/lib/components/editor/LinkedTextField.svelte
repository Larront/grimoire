<script lang="ts">
  // The Linked Text Field (#156, #175) — the one text surface a Note Block has for a
  // free-text value.
  //
  // Three properties, each load-bearing:
  //
  //   * **Permanently plain text, never a nested editor.** A block's value lives in a
  //     fence as characters; a rich-text surface inside one would have to invent a
  //     serialization for bold, and ADR-0016 §2's floor forbids it.
  //   * **Links are structured segments Svelte draws normally** — never an HTML string
  //     handed to `{@html}`. That deletes the escaping problem rather than
  //     consolidating two escapers that eventually disagree, which is why a value
  //     holding `<b>` shows the characters the GM typed.
  //   * **Navigation and hover preview are delegated**, not implemented. A link is
  //     drawn with the `data-wiki-link` attributes the host surface's own delegated
  //     handlers already read (`Editor.svelte`), so a link inside a block behaves
  //     exactly like a link in prose and nothing here knows how to open a note.
  //
  // **There is no per-field opt-in.** Every free-text value in every block is one of
  // these, forced by the link scanner being fence-blind: a `[[…]]` typed into a row's
  // *label* is already in the Link Index, Backlinks and the graph whether the field
  // draws it or not, so a field that showed flat text would be lying about a link
  // Grimoire has already filed.
  //
  // Editing posture is ADR-0016 §6's default — *directly editable*, with no mode to
  // enter: the drawn value is a button, clicking anywhere but a link swaps in an
  // input, and leaving it commits. Committing on blur rather than per keystroke keeps
  // one edit to one document write, and so one undo step.
  import { tick, untrack } from "svelte";
  import { splitLinkedText, wikiTargetsIn } from "$lib/editor/linked-text";
  import { linkResolver } from "$lib/stores/link-resolver.svelte";
  import { notes } from "$lib/stores/notes.svelte";
  import { api } from "$lib/api";
  import type { NoteSearchResult } from "$lib/editor/wiki-link";
  import WikiLinkSuggestion from "$lib/components/editor/WikiLinkSuggestion.svelte";

  let {
    value,
    onCommit,
    ariaLabel,
    placeholder = "",
    class: className = "",
    focused = false,
    restrict,
  }: {
    /** The value as the document holds it. The field never mutates it. */
    value: string;
    /** The edited value, once the GM leaves the field. Only called on a change. */
    onCommit: (next: string) => void;
    /** Names the field for a screen reader, drawn and editing alike. */
    ariaLabel: string;
    /** Shown in place of an empty value. Never written to the document. */
    placeholder?: string;
    /** Typography and geometry, applied to both states so nothing shifts. */
    class?: string;
    /**
     * Opens the field for typing when it turns true — how a block focuses a freshly
     * inserted row. One-shot: the GM may leave the field while it stays set.
     */
    focused?: boolean;
    /**
     * The format's own restriction on this field's characters, applied as the GM
     * types — `labelText` for a Labelled Row's label, whose colon is the separator.
     * A field with no restriction takes any single line of text.
     */
    restrict?: (raw: string) => string;
  } = $props();

  let editing = $state(false);
  let draft = $state("");
  let input = $state<HTMLInputElement>();

  const segments = $derived(splitLinkedText(value));

  // Drawing, so this takes the Link Resolver's cached read: a target whose check has
  // not landed yet stays a real link rather than flashing as a faded stub. The effect
  // below is what warms the cache for the targets *this* field draws.
  const broken = (path: string) => !linkResolver.isKnown(path);

  $effect(() => {
    const targets = wikiTargetsIn(value);
    if (!targets.length) return;
    notes.notes; // tracked: re-prime when the ledger's notes load or change
    void linkResolver.prime(targets);
  });

  function startEditing() {
    draft = value;
    editing = true;
  }

  // `focused` alone drives this — an untracked read keeps a value change from
  // re-opening a field the GM has already left.
  $effect(() => {
    if (focused) untrack(startEditing);
  });

  // The input exists only while editing, so its arrival is the cue to take focus.
  // The caret goes to the end: the GM clicked to add to a value, not to replace it.
  $effect(() => {
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });

  function commit() {
    suggestion = null;
    editing = false;
    if (draft !== value) onCommit(draft);
  }

  function cancel() {
    suggestion = null;
    draft = value;
    editing = false;
  }

  function handleInput(raw: string) {
    draft = restrict ? restrict(raw) : raw;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (suggestion && handleSuggestionKeydown(e)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  }

  // ── `[[` autocomplete ───────────────────────────────────────────────────────
  //
  // The spec's autocomplete boundary: *spotting `[[` is per-surface, everything
  // after it is one shared dropdown.* Spotting it is here, because only this field
  // knows where its caret is; the dropdown is `WikiLinkSuggestion`, the same
  // component the wikilink node's own suggestion plugin draws.

  interface FieldSuggestion {
    items: NoteSearchResult[];
    selectedIndex: number;
    x: number;
    y: number;
    /** Where the `[[` sits in the draft, so accepting replaces from there. */
    triggerStart: number;
  }

  let suggestion = $state<FieldSuggestion | null>(null);

  async function offerSuggestions(el: HTMLInputElement) {
    const caret = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, caret);
    const open = before.lastIndexOf("[[");
    // No open `[[`, or the GM already closed it: there is nothing to complete.
    if (open === -1 || before.slice(open + 2).includes("]]")) {
      suggestion = null;
      return;
    }

    const items = await api.searchNotes(before.slice(open + 2)).catch(() => []);
    const rect = el.getBoundingClientRect();
    suggestion = { items, selectedIndex: 0, x: rect.left, y: rect.bottom + 4, triggerStart: open };
  }

  /** Whether the key belonged to the dropdown. */
  function handleSuggestionKeydown(e: KeyboardEvent): boolean {
    if (!suggestion) return false;
    const count = Math.max(suggestion.items.length, 1);

    if (e.key === "ArrowDown") {
      e.preventDefault();
      suggestion.selectedIndex = (suggestion.selectedIndex + 1) % count;
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      suggestion.selectedIndex = (suggestion.selectedIndex - 1 + count) % count;
      return true;
    }
    if (e.key === "Enter" && suggestion.items.length) {
      e.preventDefault();
      accept(suggestion.items[suggestion.selectedIndex]);
      return true;
    }
    // Escape closes the dropdown and keeps the edit — one Escape, one dismissal.
    if (e.key === "Escape") {
      e.preventDefault();
      suggestion = null;
      return true;
    }
    return false;
  }

  function accept(item: NoteSearchResult) {
    if (!suggestion) return;
    const { triggerStart } = suggestion;
    const caret = input?.selectionStart ?? draft.length;
    const inserted = `[[${item.path}]]`;
    draft = draft.slice(0, triggerStart) + inserted + draft.slice(caret);
    suggestion = null;

    const next = triggerStart + inserted.length;
    tick().then(() => {
      input?.focus();
      input?.setSelectionRange(next, next);
    });
  }

  // A click that landed on a link is the link's: it bubbles to the host surface's
  // delegated navigation handler instead of opening this field for editing.
  function handleClick(e: MouseEvent) {
    if ((e.target as HTMLElement).closest("[data-wiki-link]")) return;
    startEditing();
  }
</script>

{#if editing}
  <input
    bind:this={input}
    type="text"
    value={draft}
    {placeholder}
    aria-label={ariaLabel}
    class="w-full bg-transparent border-b border-border outline-none focus-visible:border-primary {className}"
    oninput={(e) => {
      handleInput(e.currentTarget.value);
      void offerSuggestions(e.currentTarget);
    }}
    onblur={commit}
    onkeydown={handleKeydown}
  />
{:else}
  <button
    type="button"
    aria-label={ariaLabel}
    class="w-full text-left rounded border-b border-transparent whitespace-pre-wrap break-words
           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1
           {className}"
    onclick={handleClick}
  >
    {#if value}
      {#each segments as segment, i (i)}
        {#if segment.kind === "text"}{segment.text}{:else}<span
            data-wiki-link
            data-path={segment.path}
            data-title={segment.title}
            data-broken={broken(segment.path) ? "" : undefined}>{segment.title}</span
          >{/if}
      {/each}
    {:else}
      <span class="text-muted-foreground/60 italic">{placeholder}</span>
    {/if}
  </button>
{/if}

{#if suggestion}
  <!-- `mousedown` is swallowed so choosing a note with the pointer does not blur the
       input first — a blur would commit the edit and unmount the dropdown under the
       click. The dropdown itself is `position: fixed`, so this wrapper adds no box. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div onmousedown={(e) => e.preventDefault()}>
    <WikiLinkSuggestion
      items={suggestion.items}
      selectedIndex={suggestion.selectedIndex}
      x={suggestion.x}
      y={suggestion.y}
      onSelect={accept}
    />
  </div>
{/if}
