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
  // array back through `onChange` and the consumer writes it. A block decides for
  // itself which order changes become a document write (Timeline commits a move
  // and a delete immediately, but leaves a freshly inserted blank row uncommitted
  // until the GM finishes typing in it), and that decision cannot live here.
  import type { Snippet } from "svelte";
  import { ChevronDown, ChevronUp, X, Plus } from "@lucide/svelte";
  import {
    moveRow,
    insertRowAt,
    deleteRowAt,
    type RowChange,
  } from "$lib/editor/row-list";

  let {
    rows,
    row,
    createRow,
    onChange,
    noun = "row",
    insertionPointClass = "",
    onRowFocusOut,
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
    /**
     * Focus left somewhere inside a row. The row's own element comes with it, so a
     * consumer can ask where focus actually landed before committing an edit.
     */
    onRowFocusOut?: (index: number, rowEl: HTMLElement) => void;
  } = $props();

  let hoveredIndex = $state<number | null>(null);

  const groupNoun = $derived(noun.charAt(0).toUpperCase() + noun.slice(1));

  /** A gap is revealed by hovering either of the rows it sits between. */
  function gapVisible(gap: number): boolean {
    return hoveredIndex === gap - 1 || hoveredIndex === gap;
  }

  function move(from: number, to: number) {
    const next = moveRow(rows, from, to);
    if (next === rows) return; // off either end: nothing moved, nothing to report
    onChange(next, { kind: "move", from, to });
  }

  function remove(index: number) {
    onChange(deleteRowAt(rows, index), { kind: "delete", index });
  }

  function insert(index: number) {
    onChange(insertRowAt(rows, index, createRow()), { kind: "insert", index });
  }
</script>

{#snippet insertionPoint(index: number, label: string, visible: boolean)}
  <button
    type="button"
    class="insertion-point w-full flex items-center gap-1 h-5 rounded transition-opacity duration-150 motion-reduce:transition-none
           focus-visible:opacity-100 focus-visible:pointer-events-auto
           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
    class:opacity-0={!visible}
    class:pointer-events-none={!visible}
    onclick={() => insert(index)}
    aria-label={label}
  >
    <span class="flex-1 border-t border-dashed border-muted-foreground/30"></span>
    <Plus size={11} class="text-muted-foreground/60 shrink-0" aria-hidden="true" />
    <span class="flex-1 border-t border-dashed border-muted-foreground/30"></span>
  </button>
{/snippet}

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
    onfocusout={(e) => onRowFocusOut?.(i, e.currentTarget as HTMLElement)}
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

<!-- Trailing gap: always visible -->
<div class={insertionPointClass}>
  {@render insertionPoint(rows.length, `Add ${noun}`, true)}
</div>
