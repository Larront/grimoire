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
  import { tick, type Snippet } from "svelte";
  import { ArrowDown, ArrowUp, Plus, Trash2 } from "@lucide/svelte";
  import type { RowChange } from "$lib/editor/row-list";
  import { isTypingIn } from "$lib/utils/keyboard";

  let {
    rows,
    row,
    createRow,
    onChange,
    noun = "row",
    rowName,
    addClass = "",
  }: {
    /** The rows, in order. The consumer owns them; this never mutates them. */
    rows: T[];
    /** Draws one row's content, given the row and its index. */
    row: Snippet<[T, number]>;
    /** Builds the row an insert control adds. */
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
     * What a row is called, in words — "The Library Is Sealed". The consumer's to say,
     * because only it can see inside a row. It names the row's group, so a screen reader
     * entering a row hears which one it is rather than "Event 3", and the announcement
     * after a move or a delete says what moved.
     */
    rowName?: (row: T, index: number) => string;
    /** Classes for the trailing Add control, so a block can align it with its content. */
    addClass?: string;
  } = $props();

  // There was an `onRowFocusOut` here, reporting focus leaving a row so a consumer could
  // commit an edit once it had settled. Timeline was its only caller, for the mode it no
  // longer has (#214): every value in every block is a Linked Text Field now, and a field
  // commits its own edit on blur. A row-level hook for the same thing is a second answer
  // to a question one already has.

  const groupNoun = $derived(noun.charAt(0).toUpperCase() + noun.slice(1));

  let list = $state<HTMLElement | null>(null);
  /** What the last move or delete did, said once, politely. */
  let announcement = $state("");

  function nameOf(index: number): string {
    const name = rowName?.(rows[index], index)?.trim();
    return name ? `“${name}”` : `${groupNoun} ${index + 1}`;
  }

  function rowElement(index: number): HTMLElement | null {
    return list?.querySelector<HTMLElement>(`[data-row-index="${index}"]`) ?? null;
  }

  // Focus follows the row, not the position. Rows are drawn by index, so after a move the
  // control the GM pressed belongs to a different row: a second Enter on Move up swapped
  // the pair straight back, and after a delete focus sat on the next row's Delete, one
  // key from losing that one too.
  async function focusControl(index: number, action: string) {
    await tick();
    const el = rowElement(index);
    const control = el?.querySelector<HTMLButtonElement>(`[data-row-action="${action}"]`);
    if (control && !control.disabled) {
      control.focus();
      return;
    }
    // At an end the move it repeated is disabled; the other one is the way back.
    const other = action === "up" ? "down" : "up";
    el?.querySelector<HTMLButtonElement>(`[data-row-action="${other}"]`)?.focus();
  }

  async function focusRowContent(index: number) {
    await tick();
    const el = rowElement(index);
    const field = el?.querySelector<HTMLElement>(
      "[data-row-content] button, [data-row-content] input, [data-row-content] textarea",
    );
    if (field) field.focus();
    else list?.querySelector<HTMLElement>("[data-row-add]")?.focus();
  }

  // The three splices, and nothing between them and the array. They lived behind a
  // module seam and had one caller each — this one — which bought a seam and no
  // decision, and left the move's "nothing happened" answer to be read back out here as
  // reference equality across it (#218). The rows are the consumer's, so each builds a
  // new array rather than touching theirs.

  function move(from: number, to: number, refocus?: string) {
    // Nothing moved, so nothing to report. Both ends of the range and the standing-still
    // case, because `onChange` is a document write: an index off the end splices a hole
    // into the consumer's rows, and a move to where the row already is commits a fence
    // identical to the one on disk and spends an undo step on it. The two controls are
    // disabled at the ends, so this is the guard behind them rather than one a GM meets —
    // and it is what a shortcut arrives at.
    if (from < 0 || from >= rows.length) return;
    if (to < 0 || to >= rows.length) return;
    if (from === to) return;
    const name = nameOf(from);
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next, { kind: "move", from, to });
    announcement = `Moved ${name} to position ${to + 1} of ${rows.length}`;
    if (refocus) void focusControl(to, refocus);
  }

  function remove(index: number) {
    const name = nameOf(index);
    const remaining = rows.length - 1;
    onChange(
      rows.filter((_, i) => i !== index),
      { kind: "delete", index },
    );
    announcement = `Deleted ${name}. Ctrl+Z to undo`;
    void focusRowContent(Math.min(index, remaining - 1));
  }

  function insert(index: number) {
    const next = [...rows];
    next.splice(index, 0, createRow());
    onChange(next, { kind: "insert", index });
  }

  // Alt+↑ / Alt+↓ move the row the focus is in, from anywhere in it but a field being
  // typed into — the keyboard's way to carry a row several places without a press per
  // step on a control that, before focus followed the row, moved a different one.
  function handleRowKeydown(e: KeyboardEvent, index: number) {
    if (!e.altKey || e.ctrlKey || e.metaKey || isTypingIn(e.target)) return;
    // Alt+Enter: a new row below this one — the keyboard's way to the insert the pointer
    // gets from the gap.
    if (e.key === "Enter") {
      e.preventDefault();
      insert(index + 1);
      return;
    }
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const to = e.key === "ArrowUp" ? index - 1 : index + 1;
    // Focus goes to the same control or field in the moved row — the date the GM was on
    // stays the date they are on.
    const focusables = [...(rowElement(index)?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    const ordinal = focusables.indexOf(e.target as HTMLElement);
    move(index, to);
    if (ordinal !== -1) void focusNth(to, ordinal);
  }

  const FOCUSABLE = "button:not([disabled]), input, textarea";

  async function focusNth(index: number, ordinal: number) {
    await tick();
    const focusables = rowElement(index)?.querySelectorAll<HTMLElement>(FOCUSABLE);
    focusables?.[Math.min(ordinal, focusables.length - 1)]?.focus();
  }

  const control =
    "flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors " +
    "hover:bg-muted hover:text-foreground cursor-pointer " +
    "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-muted-foreground " +
    "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";
</script>

<!-- An insert point between two rows: hovering the gap draws a line exactly where the
     new row will go, with a plus at the block's chosen spot on it (a timeline puts it on
     its spine). Only the plus inserts — the gap itself is not a target, which is what
     kept the old full-width strips planting rows on a stray click. Not a Tab stop: the
     keyboard inserts with Alt+Enter from the row above, and the list ends with Add. -->
{#snippet gap(index: number)}
  <div class="row-list-gap relative h-0">
    <div class="group/gap absolute inset-x-0 -top-3 z-10 h-3">
      <span
        class="pointer-events-none absolute right-0 top-1/2 border-t border-dashed border-primary/70
               opacity-0 transition-opacity duration-150 motion-reduce:transition-none group-hover/gap:opacity-100"
        style="left: var(--row-insert-x, 0px)"
      ></span>
      <button
        type="button"
        tabindex="-1"
        class="absolute top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full
               bg-popover text-primary opacity-0 shadow-float ring-1 ring-primary/50 transition-opacity duration-150
               motion-reduce:transition-none group-hover/gap:opacity-100 cursor-pointer"
        style="left: calc(var(--row-insert-x, 0px) - 0.625rem)"
        onclick={() => insert(index)}
        aria-label={`Insert ${noun} here`}
        title={`Insert ${noun} here`}
      >
        <Plus size={12} strokeWidth={2.5} />
      </button>
    </div>
  </div>
{/snippet}

<!-- The rows. Each row's own controls — Move up, Move down, Delete — sit in a gutter at
     its right, in the flow, so they never cover what the row says; revealed on hover or
     focus. -->
<div class="row-list" bind:this={list}>
  {#each rows as item, i (i)}
    {@render gap(i)}

    <!-- The keydown is Alt+arrows and Alt+Enter bubbling up from the row's own controls
         and fields; the group is not itself a target. -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="row-list-row group relative flex items-start gap-2"
      role="group"
      data-row-index={i}
      aria-label={rowName?.(item, i)?.trim()
        ? `${groupNoun} ${i + 1}: ${rowName(item, i).trim()}`
        : `${groupNoun} ${i + 1}`}
      onkeydown={(e) => handleRowKeydown(e, i)}
    >
      <div class="contents" data-row-content>
        {@render row(item, i)}
      </div>

      <div
        class="flex shrink-0 items-center opacity-0 transition-opacity duration-150 motion-reduce:transition-none
               group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <button
          type="button"
          class={control}
          data-row-action="up"
          disabled={i === 0}
          onclick={() => move(i, i - 1, "up")}
          aria-label={`Move ${noun} up`}
          title="Move up (Alt+↑)"
        >
          <ArrowUp size={13} />
        </button>
        <button
          type="button"
          class={control}
          data-row-action="down"
          disabled={i === rows.length - 1}
          onclick={() => move(i, i + 1, "down")}
          aria-label={`Move ${noun} down`}
          title="Move down (Alt+↓)"
        >
          <ArrowDown size={13} />
        </button>
        <button
          type="button"
          class="{control} hover:text-destructive"
          data-row-action="delete"
          onclick={() => remove(i)}
          aria-label={`Delete ${noun}`}
          title={`Delete ${noun}`}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  {/each}

  <!-- Adding at the end: a labelled button rather than a dashed line with a plus. Quiet
       until the list is hovered or focused, and always shown while the list is empty —
       there is no row to hover for it then. -->
  <div class={addClass}>
    <button
      type="button"
      data-row-add
      class="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground
             transition-[opacity,color] duration-150 motion-reduce:transition-none
             hover:bg-muted hover:text-foreground focus-visible:opacity-100
             focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring
             {rows.length === 0 ? '' : 'row-list-add-quiet'}"
      onclick={() => insert(rows.length)}
      aria-label={`Add ${noun}`}
    >
      <Plus size={13} aria-hidden="true" />
      Add {noun}
    </button>
  </div>

  <p class="sr-only" aria-live="polite">{announcement}</p>
</div>

<style>
  /* Quiet while the GM is only reading; there when the list is hovered or worked in. */
  .row-list-add-quiet {
    opacity: 0;
  }

  .row-list:hover .row-list-add-quiet,
  .row-list:focus-within .row-list-add-quiet {
    opacity: 1;
  }
</style>
