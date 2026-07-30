<script lang="ts">
  // The Infobox's view (#175) — a titled panel of labelled facts.
  //
  // Nothing but rows, which is why this block went first: order and the hover-revealed
  // controls are the Row List's, the `Label: value` format is the Labelled Row's, every
  // text surface is a Linked Text Field, and the plumbing back to the document is the
  // shared connector's. What is left here is the panel's own business — its two columns,
  // and which edits become a document write.
  //
  // Directly editable, with no mode to enter (ADR-0016 §6): the Infobox holds no value
  // that changes during play, so there is nothing a slipped click could edit mid-fight
  // and nothing to guard with a pencil button. Every field is a field all of the time.
  //
  // This ticket draws the panel full width. The thumbnail and the float that makes it
  // read like a wiki page's summary box are the next one's.
  import RowList from "$lib/components/editor/RowList.svelte";
  import LinkedTextField from "$lib/components/editor/LinkedTextField.svelte";
  import type { RowChange } from "$lib/editor/row-list";
  import {
    blankLabelledRow,
    labelText,
    oneLine,
    type LabelledRow,
  } from "$lib/editor/labelled-row";
  import type { Infobox } from "$lib/editor/infobox-block";

  let {
    title,
    rows,
    onCommit,
  }: {
    title: string;
    rows: LabelledRow[];
    onCommit: (infobox: Infobox) => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let _title = $state(title);
  // svelte-ignore state_referenced_locally
  let _rows = $state<LabelledRow[]>(rows);

  /** The row whose label is opening for typing, after an insert or a fresh `/infobox`. */
  let focusedRow = $state<number | null>(null);

  function commit() {
    onCommit({ title: _title, rows: $state.snapshot(_rows) as LabelledRow[] });
  }

  function setTitle(next: string) {
    _title = next;
    commit();
  }

  function setRow(index: number, patch: Partial<LabelledRow>) {
    _rows[index] = { ..._rows[index], ...patch };
    focusedRow = null;
    commit();
  }

  // Order changes come from the Row List, which owns the controls and the arithmetic.
  // What is decided here is which of them reaches the document: a move and a delete at
  // once, but a freshly inserted row is empty and serializes to nothing at all, so it
  // waits — it becomes a document write when the GM types into it.
  function handleRowChange(next: LabelledRow[], change: RowChange) {
    _rows = next;
    if (change.kind === "insert") {
      focusedRow = change.index;
      return;
    }
    focusedRow = null;
    commit();
  }

  export function setAttrs(attrs: Infobox) {
    _title = attrs.title;
    _rows = attrs.rows;
    focusedRow = null;
  }

  /** A fresh insert opens its one empty row for typing. */
  export function focusRow(index: number) {
    focusedRow = index;
  }
</script>

<!-- One row: its label and its value, both Linked Text Fields, because a `[[…]]` in
     either is already a real link whether the field draws it or not. The Row List
     draws the move / delete controls over this and the insert-between gaps around it;
     `pr-14` reserves the gutter they sit in. -->
{#snippet infoboxRow(row: LabelledRow, i: number)}
  <div
    class="flex-1 min-w-0 pr-14 grid grid-cols-[minmax(4rem,34%)_1fr] items-start gap-x-3 py-px"
  >
    <LinkedTextField
      value={row.label}
      onCommit={(label) => setRow(i, { label })}
      restrict={labelText}
      focused={focusedRow === i}
      ariaLabel={`Row ${i + 1} label`}
      placeholder="Label"
      class="font-sans text-xs leading-snug text-muted-foreground"
    />
    <LinkedTextField
      value={row.value}
      onCommit={(value) => setRow(i, { value })}
      restrict={oneLine}
      ariaLabel={`Row ${i + 1} value`}
      placeholder="Value"
      class="font-sans text-xs leading-snug text-foreground"
    />
  </div>
{/snippet}

<div
  class="infobox-block my-2 select-none rounded-lg border border-border bg-card/40 px-3 py-2"
  contenteditable="false"
>
  <!-- The title is the GM's name for the panel, so it carries the world's voice
       (DESIGN.md's two-voice rule); the rows around it are structure and stay in the
       tool's. Empty by default — a panel sitting under a note's own heading should not
       have to say the same thing twice. -->
  <LinkedTextField
    value={_title}
    onCommit={setTitle}
    restrict={oneLine}
    ariaLabel="Infobox title"
    placeholder="Untitled panel"
    class="font-heading text-sm leading-snug text-foreground mb-1"
  />

  {#if _rows.length === 0}
    <div class="font-sans text-xs italic text-muted-foreground mb-1">No rows yet</div>
  {/if}

  <RowList
    rows={_rows}
    row={infoboxRow}
    noun="row"
    createRow={blankLabelledRow}
    onChange={handleRowChange}
  />
</div>
