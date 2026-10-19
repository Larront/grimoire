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
  import { onDestroy, tick } from "svelte";
  import { portal } from "$lib/utils/portal";
  import { createFieldWikiSuggest } from "$lib/editor/wiki-field-suggest.svelte";
  import WikiLinkSuggestion from "$lib/components/editor/WikiLinkSuggestion.svelte";

  let {
    onCommit,
    ariaLabel,
    placeholder = "",
    commitOnTeardown = false,
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
    /**
     * Commit whatever is in the box when it goes away.
     *
     * Off by default, because a box that lives as long as its surface does is
     * left rather than dismissed: the pane's box is still there when the GM comes
     * back, and a half-typed line in it is a line still being typed. A box that
     * *is* the surface has no such continuity — take the [[Quick Notes Dialog]]
     * away and the line goes with it, and a dismissal that discarded the thought
     * would defeat the one promise the feature makes (#231).
     *
     * This is a backstop and not the plan: an owner that knows a way out is coming
     * should call `commit` before taking the box away, because only then can a
     * rejected write put the line back where the GM can still see it. What this
     * catches is the way out nobody announced.
     */
    commitOnTeardown?: boolean;
    class?: string;
  } = $props();

  let draft = $state("");
  let input = $state<HTMLInputElement>();

  /**
   * Take the caret. For an owner whose surface *is* this box — a dialog opened by
   * a keystroke — where the GM asked for the box and should be able to start
   * typing. Exported rather than done on mount so the owner chooses the moment:
   * a focus trap opening around the box will move the caret itself, and the last
   * word has to be the owner's.
   */
  export function focus() {
    input?.focus();
  }

  onDestroy(() => {
    if (commitOnTeardown) void commit();
  });

  /**
   * Commit and clear. **The box keeps focus**: a GM parking two thoughts in a
   * row should not have to click back in, and clearing is what says the first
   * one landed.
   *
   * Exported so an owner can commit the line on a way out this box cannot see —
   * a dismissal, a window closing, a ledger being switched — where there is no
   * Enter coming. It answers **whether the box is now empty**, so an owner about
   * to take the box away can tell whether doing so would take a thought with it.
   *
   * A rejected commit puts the line back. The whole premise of a capture surface
   * is not losing the thought, and a Quick Note that failed to write exists
   * nowhere else — so a clear that outlived a failed write would destroy exactly
   * what the box is for. It goes back only if the box is still empty: the GM may
   * have started the next thought while the write was in flight, and that line is
   * theirs.
   */
  export async function commit(): Promise<boolean> {
    const body = draft.trim();
    wiki.close();
    draft = "";
    if (!body) return true;
    try {
      await onCommit(body);
    } catch {
      // The failure has already been reported by whoever attempted the write.
      if (!draft) draft = body;
    }
    return !draft;
  }

  // ── `[[` autocomplete ───────────────────────────────────────────────────────

  // The menu, shared with a block's Linked Text Field. The box outlives every one of its
  // searches — unlike a field's input, which unmounts on blur — so the helper's guard
  // against a slow search landing late matters most here: one landing after the line was
  // committed would open a menu over an empty box and claim the next Enter.
  const wiki = createFieldWikiSuggest({
    input: () => input,
    value: () => draft,
    setValue: (next) => (draft = next),
  });

  function handleKeydown(e: KeyboardEvent) {
    if (wiki.keydown(e)) return;
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
  oninput={(e) => void wiki.offer(e.currentTarget)}
  onkeydown={handleKeydown}
  onblur={wiki.close}
/>

{#if wiki.current}
  <!-- `mousedown` swallowed so choosing a note with the pointer does not blur the
       box first — the blur would close the menu under the click. That is also why
       leaving the box closes it: this input, unlike a Linked Text Field's, is always
       mounted, so nothing tears a `position: fixed` menu down on its own.

       Portalled for the same reason the field's dropdown is: it is positioned in
       viewport coordinates and must not be captured by an ancestor's containment. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div use:portal onmousedown={(e) => e.preventDefault()}>
    <WikiLinkSuggestion
      items={wiki.current.items}
      selectedIndex={wiki.current.selectedIndex}
      x={wiki.current.x}
      y={wiki.current.y}
      anchorTop={wiki.current.anchorTop}
      onSelect={wiki.accept}
      onHover={wiki.hover}
      onReposition={wiki.reposition}
    />
  </div>
{/if}
