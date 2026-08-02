<script lang="ts">
  // The Statblock's view (#177) — a name, a header of labelled rows, and sections of
  // named entries, all of it authored in place.
  //
  // Almost nothing here is the Statblock's own: order and the hover-revealed controls
  // are the Row List's at all three levels, the `Label: value` format is the Labelled
  // Row's, every text surface is a Linked Text Field, and the plumbing back to the
  // document is the shared connector's. What is left is which edits become a document
  // write, and the three-level shape the fence's grammar has.
  //
  // Directly editable, with no mode to enter — for now. ADR-0016 §6's test is the one
  // thing Statblock passes and nothing else does, but it passes it *because of pools*:
  // `43/59` puts the current value and the maximum a few pixels apart, and the slip
  // edits the creature's definition mid-fight. This ticket has no pools, so it has
  // nothing to guard; the structure-scoped mode arrives with them (#178).
  //
  // Nothing here knows what an entry *is*. A section heading and an entry name are
  // both text the GM typed, and the view draws them the same way whatever they say —
  // which is the model's refusal to know an entry's kind, made visible.
  import RowList from "$lib/components/editor/RowList.svelte";
  import LinkedTextField from "$lib/components/editor/LinkedTextField.svelte";
  import type { RowChange } from "$lib/editor/row-list";
  import { blankLabelledRow, oneLine, type LabelledRow } from "$lib/editor/labelled-row";
  import {
    blankStatblockEntry,
    blankStatblockSection,
    entryBodyText,
    statblockLabelText,
    type Statblock,
    type StatblockEntry,
    type StatblockSection,
  } from "$lib/editor/statblock-block";

  let {
    name,
    rows,
    sections,
    onCommit,
  }: {
    name: string;
    rows: LabelledRow[];
    sections: StatblockSection[];
    onCommit: (block: Statblock) => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let _name = $state(name);
  // svelte-ignore state_referenced_locally
  let _rows = $state<LabelledRow[]>(rows);
  // svelte-ignore state_referenced_locally
  let _sections = $state<StatblockSection[]>(sections);

  /**
   * The one field opening for typing, after an insert or a fresh `/statblock`. One
   * target rather than one flag per level: only ever one field is opening, and three
   * parallel states would let two of them say so at once.
   */
  type FocusTarget =
    | { level: "row"; index: number }
    | { level: "section"; index: number }
    | { level: "entry"; section: number; index: number };

  let focus = $state<FocusTarget | null>(null);

  const rowFocused = (index: number) => focus?.level === "row" && focus.index === index;
  const sectionFocused = (index: number) =>
    focus?.level === "section" && focus.index === index;
  const entryFocused = (section: number, index: number) =>
    focus?.level === "entry" && focus.section === section && focus.index === index;

  function commit() {
    onCommit({
      name: _name,
      rows: $state.snapshot(_rows) as LabelledRow[],
      sections: $state.snapshot(_sections) as StatblockSection[],
    });
  }

  function setName(next: string) {
    _name = next;
    commit();
  }

  // ── The header ──────────────────────────────────────────────────────────────

  function setRow(index: number, patch: Partial<LabelledRow>) {
    _rows[index] = { ..._rows[index], ...patch };
    focus = null;
    commit();
  }

  // Order changes come from the Row List, which owns the controls and the arithmetic.
  // What is decided here is which of them reaches the document: a move and a delete at
  // once, but a freshly inserted row is empty and serializes to nothing at all, so it
  // waits — it becomes a document write when the GM types into it. The same rule holds
  // one and two levels down, for a section and for an entry.
  function handleRowChange(next: LabelledRow[], change: RowChange) {
    _rows = next;
    focus = null;
    if (change.kind === "insert") {
      focus = { level: "row", index: change.index };
      return;
    }
    commit();
  }

  // ── Sections ────────────────────────────────────────────────────────────────

  function setHeading(index: number, heading: string) {
    _sections[index] = { ..._sections[index], heading };
    focus = null;
    commit();
  }

  function handleSectionChange(next: StatblockSection[], change: RowChange) {
    _sections = next;
    focus = null;
    if (change.kind === "insert") {
      focus = { level: "section", index: change.index };
      return;
    }
    commit();
  }

  // ── Entries ─────────────────────────────────────────────────────────────────

  function setEntry(section: number, index: number, patch: Partial<StatblockEntry>) {
    const entries = [..._sections[section].entries];
    entries[index] = { ...entries[index], ...patch };
    _sections[section] = { ..._sections[section], entries };
    focus = null;
    commit();
  }

  function handleEntryChange(section: number, next: StatblockEntry[], change: RowChange) {
    _sections[section] = { ..._sections[section], entries: next };
    focus = null;
    if (change.kind === "insert") {
      focus = { level: "entry", section, index: change.index };
      return;
    }
    commit();
  }

  export function setAttrs(attrs: Statblock) {
    _name = attrs.name;
    _rows = attrs.rows;
    _sections = attrs.sections;
    focus = null;
  }

  /** A fresh insert opens its one empty header row for typing. */
  export function focusRow(index: number) {
    focus = { level: "row", index };
  }
</script>

<!-- One header row: its label and its value, both Linked Text Fields, because a `[[…]]`
     in either is already a real link whether the field draws it or not. `pr-14` reserves
     the gutter the Row List's controls sit in. -->
{#snippet headerRow(row: LabelledRow, i: number)}
  <div
    class="flex-1 min-w-0 pr-14 grid grid-cols-[minmax(5rem,30%)_1fr] items-start gap-x-3 py-px"
  >
    <LinkedTextField
      value={row.label}
      onCommit={(label) => setRow(i, { label })}
      restrict={statblockLabelText}
      focused={rowFocused(i)}
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

<!-- One section: the GM's own heading, then its entries in their own Row List. The
     heading is theirs to invent — a system Grimoire has never heard of groups its
     entries however it likes, and nothing here validates or completes a word.
     The entry snippet is declared in here so it closes over the section's index,
     which is what a Row List nested inside a Row List needs. -->
{#snippet statblockSection(section: StatblockSection, s: number)}
  <!-- One entry: a name and a body. The name is optional — an entry with none is
       unnamed prose, which is where a system's in-block description and a section's
       preamble live, so the name field sits empty rather than being another shape. -->
  {#snippet sectionEntry(entry: StatblockEntry, i: number)}
    <div class="flex-1 min-w-0 pr-14 py-0.5">
      <LinkedTextField
        value={entry.name}
        onCommit={(next) => setEntry(s, i, { name: next })}
        restrict={statblockLabelText}
        focused={entryFocused(s, i)}
        ariaLabel={`Section ${s + 1} entry ${i + 1} name`}
        placeholder="Name (optional)"
        class="font-sans text-xs font-semibold leading-snug text-foreground"
      />
      <LinkedTextField
        value={entry.body}
        onCommit={(next) => setEntry(s, i, { body: next })}
        restrict={entryBodyText}
        multiline
        ariaLabel={`Section ${s + 1} entry ${i + 1} body`}
        placeholder="Describe it…"
        class="font-sans text-xs leading-snug text-foreground"
      />
    </div>
  {/snippet}

  <div class="flex-1 min-w-0 pr-14 pt-2">
    <LinkedTextField
      value={section.heading}
      onCommit={(heading) => setHeading(s, heading)}
      restrict={oneLine}
      focused={sectionFocused(s)}
      ariaLabel={`Section ${s + 1} heading`}
      placeholder="Section"
      class="font-heading text-xs uppercase tracking-wide leading-snug text-muted-foreground
             border-b border-border/60 pb-0.5 mb-1"
    />
    <RowList
      rows={section.entries}
      row={sectionEntry}
      noun="entry"
      createRow={blankStatblockEntry}
      onChange={(next, change) => handleEntryChange(s, next, change)}
    />
  </div>
{/snippet}

<div
  class="statblock-block group/block my-2 select-none rounded-lg border border-border bg-card/40 px-3 py-2"
  contenteditable="false"
>
  <!-- The name carries the world's voice (DESIGN.md's two-voice rule); everything
       around it is structure and stays in the tool's. Empty by default — a note about
       one creature already says its name in the note's own title. -->
  <LinkedTextField
    value={_name}
    onCommit={setName}
    restrict={oneLine}
    ariaLabel="Statblock name"
    placeholder="Unnamed statblock"
    class="font-heading text-sm leading-snug text-foreground mb-1"
  />

  {#if _rows.length === 0}
    <div class="font-sans text-xs italic text-muted-foreground mb-1">No header rows yet</div>
  {/if}

  <RowList
    rows={_rows}
    row={headerRow}
    noun="row"
    createRow={blankLabelledRow}
    onChange={handleRowChange}
  />

  <RowList
    rows={_sections}
    row={statblockSection}
    noun="section"
    createRow={blankStatblockSection}
    onChange={handleSectionChange}
  />
</div>
