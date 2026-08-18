<script lang="ts" generics="T">
  // The Row List (ADR-0016 §4, #173): order and the hover-revealed controls for a
  // list of rows inside a Note Block, extracted from Timeline's implementation.
  //
  // It knows nothing about what a row contains — the consumer hands in a `row`
  // snippet and this draws the move-up / move-down / delete controls over it plus
  // the insert-between gaps around it. Timeline's rows are not `Label: value` at
  // all, which is the point: the labelled-row *format* is a separate primitive.
  //
  // Deliberately controlled rather than stateful: every control hands the new
  // array back through `onChange` and the consumer writes it. Whether a change
  // becomes a document write is not this list's call — it is `settleRowChange`'s
  // rule, and each block spells the focus half of it its own way.
  import type { Snippet } from "svelte";
  import { ChevronDown, ChevronUp, X, Plus } from "@lucide/svelte";
  import type { RowChange } from "$lib/editor/row-list";

  let {
    rows,
    row,
    createRow,
    onChange,
    noun = "row",
    insertionPointClass = "",
  }: {
    /** The rows, in order. The consumer owns them; this never mutates them. */
    rows: T[];
    /** Draws one row's content, given the row and its index. */
    row: Snippet<[T, number]>;
    /** Builds the row an insert-between control adds. */
    createRow: () => T;
    /**
     * The reordered rows plus what changed. The change descriptor is what lets a
     * consumer keeping view state per index move that state with the rows —
     * `remapRowIndices` applies it.
     */
    onChange: (rows: T[], change: RowChange) => void;
    /**
     * Names the rows in the controls' accessible labels ("Move event up"). A
     * noun, not knowledge of the content: this list still cannot see inside a row.
     */
    noun?: string;
    /**
     * Classes for the insertion-point strips, so a block can align them with its
     * own content column — Timeline indents them past its spine.
     */
    insertionPointClass?: string;
  } = $props();

  // There was an `onRowFocusOut` here, reporting focus leaving a row so a consumer could
  // commit an edit once it had settled. Timeline was its only caller, for the mode it no
  // longer has (#214): every value in every block is a Linked Text Field now, and a field
  // commits its own edit on blur. A row-level hook for the same thing is a second answer
  // to a question one already has.

  let hoveredIndex = $state<number | null>(null);
  /**
   * The gap the pointer is over, tracked separately from the rows.
   *
   * Without it a gap vanishes as the pointer arrives: leaving the row that
   * revealed it fires `mouseleave` before the gap's own `mouseenter`, so the
   * control the GM was reaching for is gone by the time they get there.
   */
  let hoveredGap = $state<number | null>(null);
  /** Whether the pointer is anywhere in the list, which is what reveals `Add …`. */
  let hoveredList = $state(false);

  const groupNoun = $derived(noun.charAt(0).toUpperCase() + noun.slice(1));

  /** A gap is revealed by hovering either of the rows it sits between, or itself. */
  function gapVisible(gap: number): boolean {
    return (
      hoveredGap === gap || hoveredIndex === gap - 1 || hoveredIndex === gap
    );
  }

  /**
   * The trailing gap is the one that adds a row rather than splicing one in, so it
   * is revealed by hovering the *list* rather than a neighbouring boundary — and an
   * empty list keeps it drawn, because there is no row left to hover for it.
   *
   * It used to be permanent, which put a dashed line and a plus under every panel a
   * GM was only reading (#175 review).
   */
  const trailingVisible = $derived(
    rows.length === 0 ||
      hoveredList ||
      hoveredGap === rows.length ||
      hoveredIndex === rows.length - 1,
  );

  // The three splices, and nothing between them and the array. They lived behind a
  // module seam and had one caller each — this one — which bought a seam and no
  // decision, and left the move's "nothing happened" answer to be read back out here as
  // reference equality across it (#218). The rows are the consumer's, so each builds a
  // new array rather than touching theirs.

  function move(from: number, to: number) {
    // Nothing moved, so nothing to report. Both ends of the range and the standing-still
    // case, because `onChange` is a document write: an index off the end splices a hole
    // into the consumer's rows, and a move to where the row already is commits a fence
    // identical to the one on disk and spends an undo step on it. The two controls are
    // disabled at the ends, so this is the guard behind them rather than one a GM meets —
    // and it is what the next caller (a drag reorder, a shortcut) will arrive at.
    if (from < 0 || from >= rows.length) return;
    if (to < 0 || to >= rows.length) return;
    if (from === to) return;
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next, { kind: "move", from, to });
  }

  function remove(index: number) {
    onChange(
      rows.filter((_, i) => i !== index),
      { kind: "delete", index },
    );
  }

  function insert(index: number) {
    const next = [...rows];
    next.splice(index, 0, createRow());
    onChange(next, { kind: "insert", index });
  }
</script>

<!-- A boundary between two rows: a hit target the height of the gap it sits in, so
     nothing is reserved for a control that is usually invisible.

     `h-2` rather than the `h-5` this shipped with. At `h-5` every boundary spent 20px
     on emptiness, which read as a loosely-spaced list rather than as rows with room to
     grow between them — five rows carried 100px of gap they never used (#175 review).
     The plus is drawn over the gap's own centre line, which is what keeps a target
     that small findable. -->
{#snippet insertionPoint(index: number, label: string, visible: boolean)}
  <button
    type="button"
    class="insertion-point w-full flex items-center gap-1 h-2 rounded transition-opacity duration-150 motion-reduce:transition-none
           focus-visible:opacity-100 focus-visible:pointer-events-auto
           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
    class:opacity-0={!visible}
    class:pointer-events-none={!visible}
    onclick={() => insert(index)}
    onmouseenter={() => (hoveredGap = index)}
    onmouseleave={() => (hoveredGap = null)}
    aria-label={label}
  >
    <span class="flex-1 border-t border-dashed border-muted-foreground/30"></span>
    <Plus size={10} class="text-muted-foreground/60 shrink-0" aria-hidden="true" />
    <span class="flex-1 border-t border-dashed border-muted-foreground/30"></span>
  </button>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="row-list"
  onmouseenter={() => (hoveredList = true)}
  onmouseleave={() => (hoveredList = false)}
>
{#each rows as item, i (i)}
  <!-- Gap before row i (hover-revealed, focus-visible) -->
  <div class={insertionPointClass}>
    {@render insertionPoint(
      i,
      i === 0 ? `Insert ${noun} at top` : `Insert ${noun} after position ${i}`,
      gapVisible(i),
    )}
  </div>

  <div
    class="row-list-row group relative flex items-start gap-2"
    role="group"
    aria-label={`${groupNoun} ${i + 1}`}
    onmouseenter={() => (hoveredIndex = i)}
    onmouseleave={() => (hoveredIndex = null)}
  >
    <!-- The controls come first in the DOM and are positioned over the row, so
         tabbing into a row reaches move / delete before the row's own fields —
         the order Timeline had when they lived inside its content column. -->

    <!-- Up / down nudge controls — revealed on hover / keyboard focus -->
    <div
      class="absolute top-0 right-6 flex flex-col opacity-0 transition-opacity duration-150 motion-reduce:transition-none
             group-hover:opacity-100 group-focus-within:opacity-100"
    >
      <button
        type="button"
        class="p-0.5 rounded text-muted-foreground hover:text-foreground cursor-pointer
               disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-muted-foreground
               focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        disabled={i === 0}
        onclick={() => move(i, i - 1)}
        aria-label={`Move ${noun} up`}
      >
        <ChevronUp size={13} />
      </button>
      <button
        type="button"
        class="p-0.5 rounded text-muted-foreground hover:text-foreground cursor-pointer
               disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-muted-foreground
               focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        disabled={i === rows.length - 1}
        onclick={() => move(i, i + 1)}
        aria-label={`Move ${noun} down`}
      >
        <ChevronDown size={13} />
      </button>
    </div>

    <!-- Delete button — revealed on hover / keyboard focus -->
    <button
      type="button"
      class="absolute top-0 right-0 p-0.5 rounded cursor-pointer text-muted-foreground hover:text-destructive
             opacity-0 transition-opacity duration-150 motion-reduce:transition-none
             group-hover:opacity-100 group-focus-within:opacity-100
             focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
      onclick={() => remove(i)}
      aria-label={`Delete ${noun}`}
    >
      <X size={13} />
    </button>

    {@render row(item, i)}
  </div>
{/each}

<!-- Trailing gap: revealed with the list, and permanent while the list is empty -->
<div class={insertionPointClass}>
  {@render insertionPoint(rows.length, `Add ${noun}`, trailingVisible)}
</div>
</div>
