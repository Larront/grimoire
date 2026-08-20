<script lang="ts">
  // A capture box (#230) — one line typed, committed, and gone, with the `[[`
  // autocomplete every other free-text surface in Grimoire offers.
  //
  // **Why this is not a Linked Text Field.** That field is a *value* being
  // edited: it draws what the document holds, opens on a click, and closes when
  // the GM leaves. A capture box holds no value at all. It is always open, its
  // content is on its way somewhere else, and committing empties it for the next
  // line rather than settling. The two would have to disagree about almost every
  // state to share an implementation.
  //
  // What they *do* share is the part a GM can perceive, and that is already
  // shared: `wiki-suggest.ts` owns which keys the dropdown claims, what a query
  // returns and where the menu sits, and `WikiLinkSuggestion` draws it. Spotting
  // the `[[` is per-surface by that module's own design — only the surface knows
  // where its caret is — so this file's autocomplete is a trigger check and four
  // delegated calls.
  import { tick } from "svelte";
  import { portal } from "$lib/utils/portal";
  import {
    findWikiTrigger,
    readWikiSuggestKey,
    searchWikiTargets,
    wikiMenuAnchor,
    type NoteSearchResult,
    type WikiMenuAnchor,
  } from "$lib/editor/wiki-suggest";
  import WikiLinkSuggestion from "$lib/components/editor/WikiLinkSuggestion.svelte";

  let {
    onCommit,
    ariaLabel,
    placeholder = "",
    class: className = "",
  }: {
    /**
     * The committed line. Called on Enter with a non-empty value, never with a
     * blank one — the box clears itself either way, so a caller never has to.
     */
    onCommit: (body: string) => void | Promise<void>;
    /** Names the box for a screen reader. */
    ariaLabel: string;
    placeholder?: string;
    class?: string;
  } = $props();

  let draft = $state("");
  let input = $state<HTMLInputElement>();

  /**
   * Commit and clear. **The box keeps focus**: a GM parking two thoughts in a
   * row should not have to click back in, and clearing is what says the first
   * one landed.
   *
   * A rejected commit puts the line back. The whole premise of a capture surface
   * is not losing the thought, and a Quick Note that failed to write exists
   * nowhere else — so a clear that outlived a failed write would destroy exactly
   * what the box is for. It goes back only if the box is still empty: the GM may
   * have started the next thought while the write was in flight, and that line is
   * theirs.
   */
  async function commit() {
    const body = draft.trim();
    closeSuggestions();
    draft = "";
    if (!body) return;
    try {
      await onCommit(body);
    } catch {
      // The failure has already been reported by whoever attempted the write.
      if (!draft) draft = body;
    }
  }

  // ── `[[` autocomplete ───────────────────────────────────────────────────────

  interface BoxSuggestion extends WikiMenuAnchor {
    items: NoteSearchResult[];
    selectedIndex: number;
    /** Where the `[[` sits in the draft, so accepting replaces from there. */
    triggerStart: number;
  }

  let suggestion = $state<BoxSuggestion | null>(null);

  /**
   * Which query is the current one. The box outlives every one of its searches —
   * unlike a Linked Text Field's input, which unmounts on blur and takes its
   * pending result with it — so a slow `search_notes` that lands after the line
   * was committed would otherwise open a menu over an empty box, and the next
   * Enter would be claimed by that menu instead of committing.
   */
  let queryGeneration = 0;

  /** Close the dropdown and disown whatever search is still in flight. */
  function closeSuggestions() {
    queryGeneration++;
    suggestion = null;
  }

  async function offerSuggestions(el: HTMLInputElement) {
    const mine = ++queryGeneration;
    const trigger = findWikiTrigger(el.value, el.selectionStart ?? el.value.length);
    if (!trigger) {
      suggestion = null;
      return;
    }
    const items = await searchWikiTargets(trigger.query);
    if (mine !== queryGeneration) return;
    suggestion = {
      items,
      selectedIndex: 0,
      ...wikiMenuAnchor(el.getBoundingClientRect()),
      triggerStart: trigger.start,
    };
  }

  /** Whether the key belonged to the dropdown. */
  function handleSuggestionKeydown(e: KeyboardEvent): boolean {
    if (!suggestion) return false;
    const verdict = readWikiSuggestKey(e.key, {
      itemCount: suggestion.items.length,
      selectedIndex: suggestion.selectedIndex,
    });
    if (!verdict) return false;

    e.preventDefault();
    if (verdict.kind === "move") {
      suggestion.selectedIndex = verdict.selectedIndex;
    } else if (verdict.kind === "dismiss") {
      // The dropdown's Escape is the dropdown's alone — it closes the menu and
      // leaves the line, and never reaches whatever else Escape means here.
      e.stopPropagation();
      closeSuggestions();
    } else {
      accept(suggestion.items[verdict.selectedIndex]);
    }
    return true;
  }

  function accept(item: NoteSearchResult) {
    if (!suggestion) return;
    const { triggerStart } = suggestion;
    const caret = input?.selectionStart ?? draft.length;
    const inserted = `[[${item.path}]]`;
    draft = draft.slice(0, triggerStart) + inserted + draft.slice(caret);
    closeSuggestions();

    const next = triggerStart + inserted.length;
    tick().then(() => {
      input?.focus();
      input?.setSelectionRange(next, next);
    });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (handleSuggestionKeydown(e)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      void commit();
    }
  }
</script>

<input
  bind:this={input}
  bind:value={draft}
  data-wiki-capture
  type="text"
  aria-label={ariaLabel}
  {placeholder}
  autocomplete="off"
  class="w-full rounded-lg border border-border bg-card/60 px-3 py-2 text-sm text-foreground
         outline-none placeholder:text-muted-foreground/60
         focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary/40
         {className}"
  oninput={(e) => void offerSuggestions(e.currentTarget)}
  onkeydown={handleKeydown}
  onblur={closeSuggestions}
/>

{#if suggestion}
  <!-- `mousedown` swallowed so choosing a note with the pointer does not blur the
       box first — the blur would close the menu under the click. That is also why
       leaving the box closes it: this input, unlike a Linked Text Field's, is always
       mounted, so nothing tears a `position: fixed` menu down on its own.

       Portalled for the same reason the field's dropdown is: it is positioned in
       viewport coordinates and must not be captured by an ancestor's containment. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div use:portal onmousedown={(e) => e.preventDefault()}>
    <WikiLinkSuggestion
      items={suggestion.items}
      selectedIndex={suggestion.selectedIndex}
      x={suggestion.x}
      y={suggestion.y}
      anchorTop={suggestion.anchorTop}
      onSelect={accept}
    />
  </div>
{/if}
