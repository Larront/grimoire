<script lang="ts">
  // The Statblock's view (#177, #178) — a name, a header of labelled rows, and sections
  // of named entries, authored in place and then **played on**.
  //
  // Almost nothing here is the Statblock's own: order and the hover-revealed controls
  // are the Row List's at all three levels, the `Label: value` format is the Labelled
  // Row's, every text surface is a Linked Text Field, and the plumbing back to the
  // document is the shared connector's — including ADR-0016 §6's *every mutation is one
  // undo*, which is what keeps Ctrl+Z after a hit from healing the goblin instead of
  // undoing the sentence typed just before it.
  //
  // **The one mode in the whole pattern, and it is scoped to structure rather than to
  // values** (ADR-0016 §6, #153):
  //
  //   * **View mode makes every value live**, and the syntax picks the *kind* of input:
  //     arithmetic on a pool's current half, a tick on a mark, a plain text input on
  //     anything else. A value is never merely readable.
  //   * **Behind the pencil**: labels, maximums, section headings, entry names and
  //     prose, and every add / remove / reorder control.
  //
  // It survives for exactly one reason. With both halves of `43/59` as adjacent hit
  // targets four pixels apart, a mis-click edits the creature's *definition* mid-fight.
  // Scoping the mode to structure makes that **impossible** rather than merely
  // unlikely: in view mode the maximum is not a target at all. Three cheaper postures
  // were built and cut — no mode (the mis-click), view-shows-only-playable-values (a
  // free-text `Conditions:` row cost a mode round-trip), and raw-fence editing (a wall
  // of monospace mid-note, and `[[` autocomplete re-implemented in a textarea).
  //
  // Told apart by **input chrome appearing plus a dashed accent rail** — no banner. A
  // banner would say what the block already shows.
  //
  // **Mode and collapse never serialize.** Document state is what the GM carries to
  // another device; view state is how this pane happens to be showing it.
  //
  // **Width does serialize**, and the line between it and the collapse is that same
  // sentence read carefully. Collapsing is how this pane is showing the block right now.
  // Narrowing is a decision *about* the block: it is how the GM laid out an encounter, so
  // that three creatures tile inside the callout holding them, and a layout that reset on
  // reopening the note was never laid out. It lives on the fence rather than in the body,
  // where the GM's own lines are.
  //
  // Nothing here knows what an entry *is*, and nothing knows what a mark *means*. A
  // section heading, an entry name and a condition label are all text the GM typed.
  import {
    Bookmark,
    Check,
    ChevronDown,
    FoldHorizontal,
    Pencil,
    Trash2,
    UnfoldHorizontal,
  } from "@lucide/svelte";
  import RowList from "$lib/components/editor/RowList.svelte";
  import SavePresetDialog from "$lib/components/editor/SavePresetDialog.svelte";
  import { serializeStatblock } from "$lib/editor/statblock-block";
  import LinkedTextField from "$lib/components/editor/LinkedTextField.svelte";
  import type { RowChange } from "$lib/editor/row-list";
  import { blankLabelledRow, oneLine, type LabelledRow } from "$lib/editor/labelled-row";
  import {
    applyArithmetic,
    classifyValue,
    isPlayable,
    serializePool,
    serializeTrack,
    type Mark,
  } from "$lib/editor/statblock-play";
  import {
    asStatblockWidth,
    blankStatblockEntry,
    blankStatblockSection,
    entryBodyText,
    statblockLabelText,
    type Statblock,
    type StatblockEntry,
    type StatblockSection,
    type StatblockWidth,
  } from "$lib/editor/statblock-block";

  let {
    name,
    rows,
    sections,
    width,
    onCommit,
    onRemove,
  }: {
    name: string;
    rows: LabelledRow[];
    sections: StatblockSection[];
    width: StatblockWidth;
    onCommit: (block: Statblock) => void;
    /** Takes the whole block out of the note. Offered in edit mode only — see below. */
    onRemove?: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let _name = $state(name);
  // svelte-ignore state_referenced_locally
  let _rows = $state<LabelledRow[]>(rows);
  // svelte-ignore state_referenced_locally
  let _sections = $state<StatblockSection[]>(sections);
  // svelte-ignore state_referenced_locally
  let _width = $state<StatblockWidth>(width);

  /**
   * View state, both of it. Neither is ever handed to `onCommit`, and `setAttrs` leaves
   * both alone — a statblock the GM collapsed stays collapsed when an undo elsewhere in
   * the note redraws it, and a fence read on another device opens playable.
   */
  let editing = $state(false);
  let collapsed = $state(false);

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
      width: _width,
    });
  }

  /**
   * Width is the one drawing decision that reaches the document, so it commits like a
   * value rather than toggling like collapse. It stays in view chrome all the same: it
   * cannot touch what the creature *is*, so ADR-0016 §6's mis-click argument has nothing
   * to protect here, and a GM tiling an encounter mid-session should not have to open the
   * structure mode to do it.
   */
  function toggleWidth() {
    _width = _width === "narrow" ? "comfortable" : "narrow";
    commit();
  }

  function setName(next: string) {
    _name = next;
    commit();
  }

  // ── The mode ────────────────────────────────────────────────────────────────

  function startEditing() {
    collapsed = false;
    editing = true;
  }

  /** Escape leaves the mode, unless a field underneath has already claimed the key. */
  function handleKeydown(e: KeyboardEvent) {
    if (e.key !== "Escape" || e.defaultPrevented || !editing) return;
    editing = false;
  }

  // Collapsing while the structure is open would hide the controls the GM is using and
  // leave no way back to them, so it closes the mode on the way past.
  function toggleCollapsed() {
    collapsed = !collapsed;
    if (collapsed) editing = false;
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

  // ── Play ────────────────────────────────────────────────────────────────────
  //
  // Every gesture here ends in `setRow`, which is the ticket's central claim made
  // structural: a hit is a row's value changing, written into the fence by the same
  // path a typed label takes. There is nowhere else for it to go.

  /** The row whose pool is open for arithmetic, and what has been typed into it. */
  let poolRow = $state<number | null>(null);
  let poolDraft = $state("");

  /** The arithmetic input exists only while it is open, so its arrival is its cue. */
  function takeFocus(el: HTMLInputElement) {
    el.focus();
  }

  function openPool(index: number) {
    poolDraft = "";
    poolRow = index;
  }

  function commitPool(index: number) {
    // Enter commits and closes the input, which in some browsers blurs it on the way
    // out. Without this the hit would land twice, and the second one is invisible.
    if (poolRow !== index) return;
    const value = classifyValue(_rows[index].value);
    poolRow = null;
    if (value.kind !== "pool") return;
    const next = applyArithmetic(value.current, poolDraft);
    // An empty input, junk, or arithmetic landing where it started: nothing changed, so
    // nothing is written and no undo step is spent.
    if (next === value.current) return;
    setRow(index, { value: serializePool(value, next) });
  }

  function toggleMark(index: number, mark: number) {
    const value = classifyValue(_rows[index].value);
    if (value.kind !== "track") return;
    const marks: Mark[] = value.marks.map((m, i) =>
      i === mark ? { ...m, checked: !m.checked } : m,
    );
    setRow(index, { value: serializeTrack(marks) });
  }

  /** What a collapsed statblock keeps: the rows a GM can play on, in their order. */
  const playableRows = $derived(
    _rows.map((row, index) => ({ row, index })).filter(({ row }) => isPlayable(row.value)),
  );

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

  // ── Saving the shape ────────────────────────────────────────────────────────
  //
  // The block is the only place a preset is authored from (#179). What travels is the
  // fence exactly as this block would write it — captured at the moment the dialog
  // opens, so what the GM previews is what they saw a keystroke earlier.

  let savingPreset = $state(false);
  let capturedFence = $state("");

  function saveShapeAsPreset() {
    capturedFence = serializeStatblock({
      name: _name,
      rows: $state.snapshot(_rows) as LabelledRow[],
      sections: $state.snapshot(_sections) as StatblockSection[],
      // Width travels with the shape, because it is part of what the GM is keeping: a
      // preset made from a narrowed creature stamps narrowed creatures, which is what
      // building a preset off one member of a tiled encounter is for.
      width: _width,
    });
    savingPreset = true;
  }

  export function setAttrs(attrs: Statblock) {
    _name = attrs.name;
    _rows = attrs.rows;
    _sections = attrs.sections;
    // Width is document state, so it comes back with the rest of it — an undo of a
    // narrowing has to redraw the card, not just rewrite the fence underneath it.
    _width = asStatblockWidth(attrs.width);
    focus = null;
    poolRow = null;
  }

  /**
   * A fresh insert opens its one empty header row for typing — and so opens the mode,
   * because an empty statblock has nothing to play on and everything to author.
   */
  export function focusRow(index: number) {
    editing = true;
    collapsed = false;
    focus = { level: "row", index };
  }
</script>

<!-- ─── The fields, once each ─────────────────────────────────────────────────
     Every text surface the block has, declared once and drawn in both modes. `edit`
     decides only whether the GM can reach it — the typography, the placeholder and the
     accessible name are the same either way, which is what keeps the two modes from
     drifting into two designs. -->
{#snippet rowLabel(row: LabelledRow, i: number, edit: boolean)}
  <LinkedTextField
    value={row.label}
    onCommit={(label) => setRow(i, { label })}
    restrict={statblockLabelText}
    focused={edit && rowFocused(i)}
    readonly={!edit}
    ariaLabel={`Row ${i + 1} label`}
    placeholder="Label"
    class="{edit ? 'statblock-field ' : ''}font-sans text-xs leading-snug text-muted-foreground"
  />
{/snippet}

{#snippet sectionHeading(section: StatblockSection, s: number, edit: boolean)}
  <LinkedTextField
    value={section.heading}
    onCommit={(heading) => setHeading(s, heading)}
    restrict={oneLine}
    focused={edit && sectionFocused(s)}
    readonly={!edit}
    ariaLabel={`Section ${s + 1} heading`}
    placeholder="Section"
    class="{edit ? 'statblock-field ' : ''}font-heading text-xs uppercase tracking-wide
           leading-snug text-muted-foreground border-b border-border/60 pb-0.5 mb-1"
  />
{/snippet}

<!-- One entry: a name and a body. The name is optional — an entry with none is unnamed
     prose, which is where a system's in-block description and a section's preamble
     live, so the name field sits empty rather than being another shape. -->
{#snippet entryFields(entry: StatblockEntry, s: number, i: number, edit: boolean)}
  <!-- An unnamed entry reads as prose, so in view mode it is drawn as prose: no name
       line at all. The placeholder is an authoring affordance and belongs behind the
       pencil — left in view mode it puts the words "Name (optional)" into the middle of
       the creature's lore, which is the tool describing its own form to a GM who is
       reading the world. -->
  {#if edit || entry.name?.trim()}
    <LinkedTextField
      value={entry.name}
      onCommit={(next) => setEntry(s, i, { name: next })}
      restrict={statblockLabelText}
      focused={edit && entryFocused(s, i)}
      readonly={!edit}
      ariaLabel={`Section ${s + 1} entry ${i + 1} name`}
      placeholder="Name (optional)"
      class="{edit ? 'statblock-field ' : ''}font-sans text-xs font-semibold leading-snug
             text-foreground"
    />
  {/if}
  <LinkedTextField
    value={entry.body}
    onCommit={(next) => setEntry(s, i, { body: next })}
    restrict={entryBodyText}
    multiline
    readonly={!edit}
    ariaLabel={`Section ${s + 1} entry ${i + 1} body`}
    placeholder="Describe it…"
    class="{edit ? 'statblock-field ' : ''}font-sans text-xs leading-snug text-foreground"
  />
{/snippet}

<!-- ─── Playing ───────────────────────────────────────────────────────────────
     A row's value in view mode. The syntax decides which input the GM gets, and
     every branch is one: a value is never merely readable here. -->
{#snippet playValue(row: LabelledRow, i: number)}
  {@const value = classifyValue(row.value)}
  {#if value.kind === "pool"}
    <span class="inline-flex items-baseline gap-0.5 font-sans text-xs text-foreground">
      {#if poolRow === i}
        <!-- Arithmetic: signed is a delta, unsigned is absolute, empty is a no-op, and
             nothing clamps. No dice — a GM rolls their own and types the number. -->
        <input
          type="text"
          use:takeFocus
          bind:value={poolDraft}
          aria-label={`Row ${i + 1} current value`}
          placeholder={String(value.current)}
          class="w-12 bg-transparent border-b border-primary outline-none text-right
                 font-sans text-xs tabular-nums text-foreground"
          onblur={() => commitPool(i)}
          onkeydown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitPool(i);
            } else if (e.key === "Escape") {
              e.preventDefault();
              poolRow = null;
            }
          }}
        />
      {:else}
        <button
          type="button"
          aria-label={`Row ${i + 1} current value`}
          class="rounded px-1 -mx-1 tabular-nums hover:bg-primary/10 cursor-pointer
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          onclick={() => openPool(i)}>{value.current}</button
        >
      {/if}
      <!-- The maximum is drawn, never targeted. That is the whole mis-click argument:
           there is no control here to slip onto. -->
      <span class="text-muted-foreground tabular-nums">{value.separator}{value.max}</span>
    </span>
  {:else if value.kind === "track"}
    <!-- Inline and wrapping, not stacked: a run of marks is one reading, and a column
         of checkboxes would make three boxes look like three rows. -->
    <span class="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {#each value.marks as mark, m (m)}
        <span class="inline-flex items-center gap-1">
          <button
            type="button"
            aria-pressed={mark.checked}
            aria-label={mark.label
              ? `Row ${i + 1} mark ${m + 1}: ${mark.label}`
              : `Row ${i + 1} mark ${m + 1}`}
            class="statblock-mark"
            onclick={() => toggleMark(i, m)}
          >
            {#if mark.checked}
              <Check size={9} strokeWidth={3} aria-hidden="true" />
            {/if}
          </button>
          {#if mark.label}
            <!-- A label is free text the GM typed, so `[x] Cursed by [[Vecna]]` is a
                 live link here exactly as it is behind the pencil (ADR-0016 §8). -->
            <LinkedTextField
              value={mark.label}
              readonly
              ariaLabel={`Row ${i + 1} mark ${m + 1} label`}
              class="font-sans text-xs leading-snug text-foreground"
            />
          {/if}
        </span>
      {/each}
    </span>
  {:else}
    <!-- Everything else, including a bare integer: a plain text input, one click. It is
         how a `Conditions:` row the GM wrote as prose stays editable without a mode
         round-trip, and how a marker no system has a name for gets kept. -->
    <LinkedTextField
      value={row.value}
      onCommit={(next) => setRow(i, { value: next })}
      restrict={oneLine}
      ariaLabel={`Row ${i + 1} value`}
      placeholder="Value"
      class="font-sans text-xs leading-snug text-foreground"
    />
  {/if}
{/snippet}

<!-- One header row in view mode: the label is drawn, the value is played. -->
{#snippet viewRow(row: LabelledRow, i: number)}
  <div class="grid grid-cols-[minmax(5rem,30%)_1fr] items-baseline gap-x-3 py-px">
    {@render rowLabel(row, i, false)}
    {@render playValue(row, i)}
  </div>
{/snippet}

<!-- ─── Authoring ─────────────────────────────────────────────────────────────
     One header row behind the pencil: its label and its whole value, the second of
     which is where the maximum becomes reachable at all. `pr-14` reserves the gutter
     the Row List's controls sit in. -->
{#snippet headerRow(row: LabelledRow, i: number)}
  <div
    class="flex-1 min-w-0 pr-14 grid grid-cols-[minmax(5rem,30%)_1fr] items-start gap-x-3 py-px"
  >
    {@render rowLabel(row, i, true)}
    <LinkedTextField
      value={row.value}
      onCommit={(value) => setRow(i, { value })}
      restrict={oneLine}
      ariaLabel={`Row ${i + 1} value`}
      placeholder="Value"
      class="statblock-field font-sans text-xs leading-snug text-foreground"
    />
  </div>
{/snippet}

<!-- One section: the GM's own heading, then its entries in their own Row List. The
     heading is theirs to invent — a system Grimoire has never heard of groups its
     entries however it likes, and nothing here validates or completes a word.
     The entry snippet is declared in here so it closes over the section's index,
     which is what a Row List nested inside a Row List needs. -->
{#snippet statblockSection(section: StatblockSection, s: number)}
  {#snippet sectionEntry(entry: StatblockEntry, i: number)}
    <div class="flex-1 min-w-0 pr-14 py-0.5">
      {@render entryFields(entry, s, i, true)}
    </div>
  {/snippet}

  <div class="flex-1 min-w-0 pr-14 pt-2">
    {@render sectionHeading(section, s, true)}
    <RowList
      rows={section.entries}
      row={sectionEntry}
      noun="entry"
      createRow={blankStatblockEntry}
      onChange={(next, change) => handleEntryChange(s, next, change)}
    />
  </div>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="statblock-block group/block relative my-2 select-none rounded-lg border border-l-[3px]
         border-border bg-card/40 px-3 py-2"
  class:statblock-editing={editing}
  data-width={_width}
  contenteditable="false"
  onkeydown={handleKeydown}
>
  <div
    class="absolute top-1 right-1 z-10 flex items-center gap-0.5 opacity-0 transition-opacity
           duration-150 motion-reduce:transition-none group-hover/block:opacity-100
           focus-within:opacity-100"
    class:opacity-100={editing}
  >
    <button
      type="button"
      class="rounded p-0.5 text-muted-foreground hover:text-foreground cursor-pointer
             focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
      aria-label={collapsed ? "Expand statblock" : "Collapse statblock"}
      aria-expanded={!collapsed}
      onclick={toggleCollapsed}
    >
      <ChevronDown
        size={13}
        class="transition-transform duration-150 motion-reduce:transition-none {collapsed
          ? '-rotate-90'
          : ''}"
      />
    </button>
    <!-- Width, which is how the GM lays an encounter out: narrow the creatures in a
         fight and they tile inside the callout holding them. Saved with the block, so
         the arrangement is still there next session. -->
    <button
      type="button"
      class="rounded p-0.5 text-muted-foreground hover:text-foreground cursor-pointer
             focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
      aria-label={_width === "narrow" ? "Widen statblock" : "Narrow statblock"}
      onclick={toggleWidth}
    >
      {#if _width === "narrow"}
        <UnfoldHorizontal size={13} />
      {:else}
        <FoldHorizontal size={13} />
      {/if}
    </button>
    <button
      type="button"
      class="rounded p-0.5 text-muted-foreground hover:text-foreground cursor-pointer
             focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
      aria-label="Save shape as preset"
      onclick={saveShapeAsPreset}
    >
      <Bookmark size={13} />
    </button>
    {#if editing}
      {#if onRemove}
        <button
          type="button"
          class="rounded p-0.5 text-muted-foreground hover:text-destructive cursor-pointer
                 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          aria-label="Remove statblock"
          onclick={onRemove}
        >
          <Trash2 size={13} />
        </button>
      {/if}
      <button
        type="button"
        class="rounded p-0.5 text-primary hover:text-foreground cursor-pointer
               focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        aria-label="Done editing statblock"
        onclick={() => (editing = false)}
      >
        <Check size={13} />
      </button>
    {:else}
      <button
        type="button"
        class="rounded p-0.5 text-muted-foreground hover:text-foreground cursor-pointer
               focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        aria-label="Edit statblock structure"
        onclick={startEditing}
      >
        <Pencil size={13} />
      </button>
    {/if}
  </div>

  <LinkedTextField
    value={_name}
    onCommit={setName}
    restrict={oneLine}
    readonly={!editing}
    ariaLabel="Statblock name"
    placeholder="Unnamed statblock"
    class="statblock-field font-heading text-sm leading-snug text-foreground mb-1
           {editing ? 'pr-24' : 'pr-20'}"
  />

  {#if !collapsed && _rows.length === 0}
    <div class="font-sans text-xs italic text-muted-foreground mb-1">No header rows yet</div>
  {/if}

  {#if collapsed}
    <div class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      {#each playableRows as { row, index } (index)}
        <span class="inline-flex items-baseline gap-1.5">
          {@render rowLabel(row, index, false)}
          {@render playValue(row, index)}
        </span>
      {/each}
    </div>
  {:else if editing}
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
  {:else}
    <div class="statblock-split">
      <div class="statblock-stats">
        {#each _rows as row, i (i)}
          {@render viewRow(row, i)}
        {/each}
      </div>
      <div class="statblock-reference">
        {#each _sections as section, s (s)}
          <div class="pt-2">
            {@render sectionHeading(section, s, false)}
            {#each section.entries as entry, i (i)}
              <div class="py-0.5">{@render entryFields(entry, s, i, false)}</div>
            {/each}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<SavePresetDialog bind:open={savingPreset} fence={capturedFence} suggestedName={_name} />

<style>
  /* The mode, made visible without a banner. Two signals, both of them the state
     itself rather than a label describing it: input chrome appears under every value,
     and the block's left rail turns dashed accent.

     The rail is 3px wide in both modes and only changes colour and style, so entering
     the mode does not nudge the whole block sideways. */
  .statblock-block.statblock-editing {
    border-left-style: dashed;
    border-left-color: var(--primary);
  }

  /* Input chrome: an underline under every value the mode has opened. The class is
     only ever applied inside the editing branch, so the ancestor is not the condition —
     it is what keeps the rule scoped, since `.statblock-field` lands on an element a
     child component owns and Svelte cannot scope that on its own. */
  .statblock-editing :global(.statblock-field) {
    border-bottom-color: var(--border);
  }

  /* ─── The view-mode reading ─────────────────────────────────────────────────
     Header rows in a rail, the GM's own sections beside them. A creature read
     mid-session is a reference card, not a document: the numbers being played on
     hold one column and the prose that explains them holds the other, so neither
     pushes the other off the first glance.

     The block sizes to its content rather than to the pane — a wide window is not
     a reason to stretch one creature across it. `inline-size` containment is what
     makes the fold below answer to the block's own width instead of the viewport's,
     so a narrowed card stacks its columns rather than squeezing them into slivers. */
  /* Both widths come from app.css, where the callout that tiles a fight reads the same
     two numbers to size its columns. One of each number, or the tiling mis-sizes. */
  .statblock-block {
    container-type: inline-size;
    container-name: statblock;
    max-width: var(--statblock-comfortable);
  }

  /* Narrow is the width a GM picks to tile an encounter, so it is sized to fold the
     split below rather than to a taste about line length: two of these fit a wide
     callout, and each one stacks its own columns instead of squeezing them. */
  .statblock-block[data-width="narrow"] {
    max-width: var(--statblock-narrow);
  }

  .statblock-split {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 2.4fr);
    column-gap: 1.25rem;
    align-items: start;
    padding-top: 0.25rem;
  }

  /* A hairline, not a filled gutter: the two columns are one card's two readings,
     and a heavier divider would make them read as two cards. */
  .statblock-reference {
    border-left: 1px solid var(--border);
    padding-left: 1.25rem;
  }

  /* The first section already sits against the name's baseline, so it does not pay
     the inter-section gap the ones below it need. */
  .statblock-reference > div:first-child {
    padding-top: 0;
  }

  @container statblock (max-width: 34rem) {
    .statblock-split {
      grid-template-columns: minmax(0, 1fr);
      row-gap: 0.75rem;
    }

    .statblock-reference {
      border-left: none;
      border-top: 1px solid var(--border);
      padding-left: 0;
      padding-top: 0.75rem;
    }
  }

  /* One mark. Sized to the text it sits in rather than to a form control: a run of
     these is read as a line of boxes, not as a stack of checkboxes. */
  .statblock-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 0.85rem;
    height: 0.85rem;
    flex-shrink: 0;
    border: 1px solid var(--border);
    border-radius: 0.1875rem;
    color: var(--primary-foreground);
    cursor: pointer;
    transition: background-color 150ms ease-out;
  }

  @media (prefers-reduced-motion: reduce) {
    .statblock-mark {
      transition: none;
    }
  }

  .statblock-mark[aria-pressed="true"] {
    background: var(--primary);
    border-color: var(--primary);
  }

  .statblock-mark:hover {
    border-color: var(--primary);
  }

  .statblock-mark:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
</style>
