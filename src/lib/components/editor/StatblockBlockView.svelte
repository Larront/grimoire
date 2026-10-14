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
  //   * **View mode makes the playable values live** — arithmetic on a pool's current
  //     half, a tick on a mark — and draws everything else as text.
  //   * **Behind the pencil**: labels, maximums, every other value, section headings,
  //     entry names and prose, and every add / remove / reorder control.
  //
  // It survives for exactly one reason. With both halves of `43/59` as adjacent hit
  // targets four pixels apart, a mis-click edits the creature's *definition* mid-fight.
  // Scoping the mode to structure makes that **impossible** rather than merely
  // unlikely: in view mode the maximum is not a target at all.
  //
  // The same argument closed the other values. View mode used to open any non-playable
  // value as a text field on one click, so a free-text `Conditions:` row needed no mode
  // round-trip; but Armor Class sat 2px under the HP button, and a hit aimed a little low
  // wrote "15-12" into the AC and left HP where it was, silently. A value that changes in
  // play is written as a pool or a mark track — `Conditions: [ ] Prone [ ] Charmed` — and
  // everything else is definition. Raw-fence editing was built and cut too: a wall of
  // monospace mid-note, and `[[` autocomplete re-implemented in a textarea.
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
    UnfoldHorizontal,
  } from "@lucide/svelte";
  import { tick } from "svelte";
  import RowList from "$lib/components/editor/RowList.svelte";
  import { linkedPlainText } from "$lib/editor/linked-text";
  import SavePresetDialog from "$lib/components/editor/SavePresetDialog.svelte";
  import { serializeStatblock } from "$lib/editor/statblock-block";
  import LinkedTextField from "$lib/components/editor/LinkedTextField.svelte";
  import { settleRowChange, type RowChange } from "$lib/editor/row-list";
  import { blankLabelledRow, oneLine, type LabelledRow } from "$lib/editor/labelled-row";
  import {
    applyArithmetic,
    classifyValue,
    isPlayable,
    parseArithmetic,
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
  } from "$lib/editor/statblock-block";

  // The creature's record, taken as one prop bag rather than as four named props: the
  // connector mounts a block with its record spread over the props, so the rest element
  // *is* the record and nothing here re-lists its fields (#209). A fifth attribute arrives
  // without a line changing in this file.
  let {
    onCommit,
    ...attrs
  }: Statblock & {
    onCommit: (block: Statblock) => void;
  } = $props();

  // The editable copy. One record rather than one mirror per field, which is what makes
  // `setAttrs` below total: an undo hands over a whole creature, so there is no field it
  // can leave behind holding a stale value for the next commit to write back — the silent
  // loss #209 named.
  // svelte-ignore state_referenced_locally
  let block = $state<Statblock>({ ...attrs });

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
  const sectionFocused = (index: number) => focus?.level === "section" && focus.index === index;
  const entryFocused = (section: number, index: number) =>
    focus?.level === "entry" && focus.section === section && focus.index === index;

  function commit() {
    onCommit($state.snapshot(block) as Statblock);
  }

  /**
   * Width is the one drawing decision that reaches the document, so it commits like a
   * value rather than toggling like collapse. It stays in view chrome all the same: it
   * cannot touch what the creature *is*, so ADR-0016 §6's mis-click argument has nothing
   * to protect here, and a GM tiling an encounter mid-session should not have to open the
   * structure mode to do it.
   */
  function toggleWidth() {
    block.width = block.width === "narrow" ? "comfortable" : "narrow";
    commit();
  }

  function setName(next: string) {
    block.name = next;
    commit();
  }

  // ── The mode ────────────────────────────────────────────────────────────────

  function startEditing() {
    collapsed = false;
    editing = true;
  }

  let pencil = $state<HTMLButtonElement | null>(null);

  // Leaving the mode puts focus on the pencil that reopens it. The Done button it was
  // pressed on leaves the page with the mode, and focus used to go to the document body.
  async function stopEditing() {
    editing = false;
    await tick();
    pencil?.focus();
  }

  /** Escape leaves the mode, unless a field underneath has already claimed the key. */
  function handleKeydown(e: KeyboardEvent) {
    if (e.key !== "Escape" || e.defaultPrevented || !editing) return;
    void stopEditing();
  }

  // Collapsing while the structure is open would hide the controls the GM is using and
  // leave no way back to them, so it closes the mode on the way past.
  function toggleCollapsed() {
    collapsed = !collapsed;
    if (collapsed) editing = false;
  }

  // ── The header ──────────────────────────────────────────────────────────────

  function setRow(index: number, patch: Partial<LabelledRow>) {
    block.rows[index] = { ...block.rows[index], ...patch };
    focus = null;
    commit();
  }

  // Order changes come from the Row List, which owns the controls and the splicing.
  // Whether one of them reaches the document is `settleRowChange`'s rule, stated once
  // there and the same at all three depths; what differs here is only which level of the
  // creature the focus names.
  function handleRowChange(next: LabelledRow[], change: RowChange) {
    block.rows = next;
    focus = null;
    settleRowChange(change, {
      focus: (index) => (focus = { level: "row", index }),
      commit,
    });
  }

  // ── Play ────────────────────────────────────────────────────────────────────
  //
  // Every gesture here ends in `setRow`, which is the ticket's central claim made
  // structural: a hit is a row's value changing, written into the fence by the same
  // path a typed label takes. There is nowhere else for it to go.

  /** The row whose pool is open for arithmetic, and what has been typed into it. */
  let poolRow = $state<number | null>(null);
  let poolDraft = $state("");
  /** Enter pressed on something that is not a number: the input stays, and says so. */
  let poolRefused = $state(false);

  /** Each pool's button, by row, so a hit committed from the keyboard can return to it. */
  let poolButtons = $state<Record<number, HTMLButtonElement | null>>({});

  /** The last change, said to assistive tech: "The Lurker HP 56 of 68". */
  let announcement = $state("");

  // The words a control is named by. "Row 1 current value" was every creature's HP in an
  // encounter; the creature's name and the GM's own label are what tell them apart.
  const creature = $derived(linkedPlainText(block.name).trim());
  function rowName(index: number): string {
    const label = linkedPlainText(block.rows[index]?.label ?? "").trim() || `Row ${index + 1}`;
    return creature ? `${creature} ${label}` : label;
  }

  /** What Enter will do, drawn beside the input while the GM types. */
  function poolPreview(current: number): string {
    const parsed = parseArithmetic(poolDraft);
    if (parsed.kind === "invalid") return "Not a number";
    if (parsed.kind === "empty") return "";
    return `→ ${applyArithmetic(current, poolDraft)}`;
  }

  // The block's own controls, sized and focused as every note block's are (28px, the
  // app's outline ring), with a tooltip each: they are icons only.
  const control =
    "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors " +
    "hover:bg-muted hover:text-foreground cursor-pointer " +
    "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";

  /** The arithmetic input exists only while it is open, so its arrival is its cue. */
  function takeFocus(el: HTMLInputElement) {
    el.focus();
  }

  function openPool(index: number) {
    poolDraft = "";
    poolRefused = false;
    poolRow = index;
  }

  // Back to the pool's own button after Enter or Escape, so a second hit is one more
  // Enter away and Ctrl+Z still has somewhere to go. Leaving by clicking elsewhere goes
  // where the click went.
  async function returnToPool(index: number) {
    await tick();
    poolButtons[index]?.focus();
  }

  function commitPool(index: number, fromKeyboard = false) {
    // Enter commits and closes the input, which in some browsers blurs it on the way
    // out. Without this the hit would land twice, and the second one is invisible.
    if (poolRow !== index) return;
    const value = classifyValue(block.rows[index].value);
    // Junk is refused out loud from the keyboard — the input stays open saying so —
    // because closing on it looked exactly like a hit that landed. Clicking away from
    // junk is the GM moving on, and drops it.
    if (fromKeyboard && parseArithmetic(poolDraft).kind === "invalid") {
      poolRefused = true;
      return;
    }
    poolRow = null;
    if (fromKeyboard) void returnToPool(index);
    if (value.kind !== "pool") return;
    const next = applyArithmetic(value.current, poolDraft);
    // An empty input, junk, or arithmetic landing where it started: nothing changed, so
    // nothing is written and no undo step is spent.
    if (next === value.current) return;
    announcement = `${rowName(index)} ${next} of ${value.max}`;
    setRow(index, { value: serializePool(value, next) });
  }

  function toggleMark(index: number, mark: number) {
    const value = classifyValue(block.rows[index].value);
    if (value.kind !== "track") return;
    const marks: Mark[] = value.marks.map((m, i) =>
      i === mark ? { ...m, checked: !m.checked } : m,
    );
    const changed = marks[mark];
    announcement = `${rowName(index)} ${changed.label || `mark ${mark + 1}`} ${
      changed.checked ? "ticked" : "cleared"
    }`;
    setRow(index, { value: serializeTrack(marks, value.spaced) });
  }

  // A mark's label is part of its target: the word "Frightened" beside a box is what the
  // GM aims at. A link inside the label stays the link's.
  function toggleFromLabel(e: MouseEvent, index: number, mark: number) {
    if ((e.target as HTMLElement).closest("[data-wiki-link]")) return;
    toggleMark(index, mark);
  }

  /** What a collapsed statblock keeps: the rows a GM can play on, in their order. */
  const playableRows = $derived(
    block.rows.map((row, index) => ({ row, index })).filter(({ row }) => isPlayable(row.value)),
  );

  // ── Sections ────────────────────────────────────────────────────────────────

  function setHeading(index: number, heading: string) {
    block.sections[index] = { ...block.sections[index], heading };
    focus = null;
    commit();
  }

  function handleSectionChange(next: StatblockSection[], change: RowChange) {
    block.sections = next;
    focus = null;
    settleRowChange(change, {
      focus: (index) => (focus = { level: "section", index }),
      commit,
    });
  }

  // ── Entries ─────────────────────────────────────────────────────────────────

  function setEntry(section: number, index: number, patch: Partial<StatblockEntry>) {
    const entries = [...block.sections[section].entries];
    entries[index] = { ...entries[index], ...patch };
    block.sections[section] = { ...block.sections[section], entries };
    focus = null;
    commit();
  }

  function handleEntryChange(section: number, next: StatblockEntry[], change: RowChange) {
    block.sections[section] = { ...block.sections[section], entries: next };
    focus = null;
    settleRowChange(change, {
      focus: (index) => (focus = { level: "entry", section, index }),
      commit,
    });
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
      name: block.name,
      rows: $state.snapshot(block.rows) as LabelledRow[],
      sections: $state.snapshot(block.sections) as StatblockSection[],
      // Width travels with the shape, because it is part of what the GM is keeping: a
      // preset made from a narrowed creature stamps narrowed creatures, which is what
      // building a preset off one member of a tiled encounter is for.
      width: block.width,
    });
    savingPreset = true;
  }

  export function setAttrs(next: Statblock) {
    // The whole record, width included — width is document state, so an undo of a
    // narrowing has to redraw the card and not just rewrite the fence underneath it. It
    // is still read through `asStatblockWidth`, because a card pasted from elsewhere may
    // carry a word this version has no drawing for.
    block = { ...next, width: asStatblockWidth(next.width) };
    focus = null;
    poolRow = null;
    poolRefused = false;
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
    class="{edit ? 'statblock-field ' : ''}font-heading text-sm
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
    <span class="inline-flex flex-wrap items-baseline gap-x-0.5 font-sans text-xs text-foreground">
      {#if poolRow === i}
        <!-- Arithmetic: signed is a delta, unsigned is absolute, empty is a no-op, and
             nothing clamps. No dice — a GM rolls their own and types the number. What
             Enter will do is drawn beside it as the GM types: "68 → 56" for -12, and
             "→ 12" for a bare 12, which is how "unsigned sets it" shows before it lands. -->
        <input
          type="text"
          inputmode="numeric"
          data-pool-row={i}
          use:takeFocus
          bind:value={poolDraft}
          oninput={() => (poolRefused = false)}
          aria-label="{rowName(i)}, {value.current} of {value.max}. Type -12 to take 12, +5 to add 5, or a number to set it"
          aria-invalid={poolRefused}
          aria-describedby="statblock-pool-hint-{i}"
          placeholder={String(value.current)}
          class="statblock-pool-input w-14 bg-transparent border-b outline-none text-right
                 font-sans text-xs tabular-nums text-foreground
                 {poolRefused ? 'border-destructive' : 'border-primary'}"
          onblur={() => commitPool(i)}
          onkeydown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitPool(i, true);
            } else if (e.key === "Escape") {
              e.preventDefault();
              poolRow = null;
              void returnToPool(i);
            }
          }}
        />
      {:else}
        <!-- A chip, so it reads as a thing to press before the pointer finds it, and a
             28px target drawn at the text's size: the padding is the hit area, cancelled
             by an equal negative margin so the row does not grow. Its neighbours are
             text now, so the reach above and below lands on nothing it could mis-edit. -->
        <button
          bind:this={poolButtons[i]}
          type="button"
          data-pool-row={i}
          aria-label="{rowName(i)}, {value.current} of {value.max}"
          title="Take damage (-12), heal (+5), or set (30)"
          class="statblock-pool -my-1.5 -mx-1 cursor-pointer px-1 py-1.5 tabular-nums
                 focus-visible:outline-none"
          onclick={() => openPool(i)}><span class="statblock-pool-face">{value.current}</span></button
        >
      {/if}
      <!-- The maximum is drawn, never targeted. That is the whole mis-click argument:
           there is no control here to slip onto. -->
      <span class="text-muted-foreground tabular-nums">{value.separator}{value.max}</span>
      {#if poolRow === i}
        <span
          id="statblock-pool-hint-{i}"
          class="ml-1.5 tabular-nums {poolRefused ? 'text-destructive' : 'text-muted-foreground'}"
          >{poolPreview(value.current)}</span
        >
      {/if}
    </span>
  {:else if value.kind === "track"}
    <!-- Inline and wrapping, not stacked: a run of marks is one reading, and a column
         of checkboxes would make three boxes look like three rows. -->
    <span class="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {#each value.marks as mark, m (m)}
        <!-- One mark and its word stay together on a line: a run wraps between marks,
             never between a box and the label it is ticking. -->
        <span class="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
          <button
            type="button"
            aria-pressed={mark.checked}
            data-mark="{i}-{m}"
            aria-label="{rowName(i)} {mark.label ? linkedPlainText(mark.label) : `mark ${m + 1}`}"
            class="statblock-mark"
            onclick={() => toggleMark(i, m)}
          >
            <!-- Always drawn, hidden while unticked: an empty box took its baseline from
                 its own bottom edge and a ticked one from the icon inside it, so ticking
                 the first box moved the row's label 2.5px. -->
            <Check
              size={11}
              strokeWidth={3}
              aria-hidden="true"
              class={mark.checked ? "" : "invisible"}
            />
          </button>
          {#if mark.label}
            <!-- A label is free text the GM typed, so `[x] Cursed by [[Vecna]]` is a
                 live link here exactly as it is behind the pencil (ADR-0016 §8). And it is
                 the mark's target too, for the pointer — the button is the keyboard's, and
                 names the label, so this is not a second stop. -->
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <span class="cursor-pointer" onclick={(e) => toggleFromLabel(e, i, m)}>
              <LinkedTextField
                value={mark.label}
                readonly
                ariaLabel={`${rowName(i)} mark ${m + 1} label`}
                class="font-sans text-xs leading-snug text-foreground"
              />
            </span>
          {/if}
        </span>
      {/each}
    </span>
  {:else}
    <!-- Everything else, including a bare integer, is definition, and reads as text: it
         is edited behind the pencil. It used to open on one click, and Armor Class sat
         2px under the HP button. No placeholder either — "Value" in an empty row is the
         form describing itself to a GM reading the creature. -->
    <LinkedTextField
      value={row.value}
      readonly
      ariaLabel={`${rowName(i)} value`}
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
     which is where the maximum becomes reachable at all. The Row List's controls sit
     beside it, in a gutter of their own. -->
{#snippet headerRow(row: LabelledRow, i: number)}
  <div class="flex-1 min-w-0 grid grid-cols-[minmax(5rem,30%)_1fr] items-start gap-x-3 py-px">
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
    <div class="flex-1 min-w-0 py-0.5">
      {@render entryFields(entry, s, i, true)}
    </div>
  {/snippet}

  <div class="flex-1 min-w-0 pt-2">
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
  class="statblock-block group/block relative my-2 select-none rounded-lg border
         border-border bg-card/40 px-3 py-2"
  class:statblock-editing={editing}
  data-width={block.width}
  contenteditable="false"
  onkeydown={handleKeydown}
>
  <!-- The block's own controls: collapse, width, preset, and the way into and out of the
       mode. Everything here is the *statblock's* business and nothing else's — a delete
       is not, so there is no trash can, the way there is none on an infobox or a
       timeline. The gutter handle's menu deletes anything (#194), and a block drawing
       chrome its siblings deleted is the drift ADR-0016 §8 exists to prevent (#219). -->
  <div
    class="absolute top-1 right-1 z-10 flex items-center gap-0.5 opacity-0 transition-opacity
           duration-150 motion-reduce:transition-none group-hover/block:opacity-100
           focus-within:opacity-100"
    class:opacity-100={editing}
  >
    <button
      type="button"
      class={control}
      aria-label={collapsed ? "Expand statblock" : "Collapse statblock"}
      title={collapsed ? "Expand" : "Collapse to what's played"}
      aria-expanded={!collapsed}
      onclick={toggleCollapsed}
    >
      <ChevronDown
        size={14}
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
      class={control}
      aria-label={block.width === "narrow" ? "Widen statblock" : "Narrow statblock"}
      title={block.width === "narrow" ? "Widen" : "Narrow, to sit beside others in an encounter"}
      onclick={toggleWidth}
    >
      {#if block.width === "narrow"}
        <UnfoldHorizontal size={14} />
      {:else}
        <FoldHorizontal size={14} />
      {/if}
    </button>
    <button
      type="button"
      class={control}
      aria-label="Save shape as preset"
      title="Save shape as preset"
      onclick={saveShapeAsPreset}
    >
      <Bookmark size={14} />
    </button>
    {#if editing}
      <button
        type="button"
        class="{control} text-primary"
        aria-label="Done editing statblock"
        title="Done"
        onclick={stopEditing}
      >
        <Check size={14} />
      </button>
    {:else}
      <button
        bind:this={pencil}
        type="button"
        class={control}
        aria-label="Edit statblock structure"
        title="Edit"
        onclick={startEditing}
      >
        <Pencil size={14} />
      </button>
    {/if}
  </div>

  <!-- The name, with the gutter the control row above sits in reserved on its right so a
       long name never runs under the icons. One number rather than one per mode, because
       the two modes now draw the same *count*: the trash the mode used to add went with
       the rest of the per-block delete chrome (#219), so edit mode's collapse, width,
       preset and tick are four buttons against view mode's collapse, width, preset and
       pencil. Four 28px controls and their gaps are 7.5rem. -->
  <LinkedTextField
    value={block.name}
    onCommit={setName}
    restrict={oneLine}
    readonly={!editing}
    ariaLabel="Statblock name"
    placeholder="Unnamed statblock"
    class="statblock-field font-heading text-sm leading-snug text-foreground mb-1 pr-[7.5rem]"
  />

  {#if !collapsed && block.rows.length === 0}
    <div class="font-sans text-xs italic text-muted-foreground mb-1">No header rows yet</div>
  {/if}

  {#if collapsed}
    <div class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      {#each playableRows as { row, index } (index)}
        <!-- `shrink-0`: an item in a wrapping row could otherwise shrink to its narrowest
             word, which stacked a row's two boxes one above the other. -->
        <span class="inline-flex shrink-0 items-baseline gap-1.5">
          {@render rowLabel(row, index, false)}
          {@render playValue(row, index)}
        </span>
      {/each}
    </div>
  {:else if editing}
    <RowList
      rows={block.rows}
      row={headerRow}
      noun="row"
      createRow={blankLabelledRow}
      onChange={handleRowChange}
    />

    <RowList
      rows={block.sections}
      row={statblockSection}
      noun="section"
      createRow={blankStatblockSection}
      onChange={handleSectionChange}
    />
  {:else}
    <!-- A creature with no sections — the common shape in a tiled fight — is its stats
         alone: no empty second column, and no divider ruling off nothing. -->
    <div class="statblock-split" class:statblock-split-solo={block.sections.length === 0}>
      <div class="statblock-stats">
        {#each block.rows as row, i (i)}
          {@render viewRow(row, i)}
        {/each}
      </div>
      {#if block.sections.length > 0}
        <div class="statblock-reference">
          {#each block.sections as section, s (s)}
            <div class="pt-2">
              {@render sectionHeading(section, s, false)}
              {#each section.entries as entry, i (i)}
                <div class="py-0.5">{@render entryFields(entry, s, i, false)}</div>
              {/each}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<SavePresetDialog bind:open={savingPreset} fence={capturedFence} suggestedName={block.name} />
<!-- What the last hit or tick did, said once, politely. -->
<p class="sr-only" aria-live="polite">{announcement}</p>

<style>
  /* The mode, made visible without a banner. Two signals, both of them the state
     itself rather than a label describing it: input chrome appears under every value,
     and the block's frame turns dashed accent.

     The frame is 1px in both modes and only changes colour and style, so entering the
     mode does not nudge the block. It used to be a 3px left rail, which made the
     statblock the one Note Block wearing a side stripe; every block now shares one
     frame (DESIGN.md §4, "in the page"). */
  .statblock-block.statblock-editing {
    border-style: dashed;
    border-color: var(--primary);
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

  .statblock-split-solo {
    grid-template-columns: minmax(0, 1fr);
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

  /* A pool's current value: a chip at the text's size, so it reads as a thing to press
     at rest rather than only under a hovering pointer. The button around it is the 28px
     target; the face is what is drawn. */
  .statblock-pool-face {
    display: inline-block;
    min-width: 1.5rem;
    padding: 0 0.25rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-structural);
    background: color-mix(in oklab, var(--background) 50%, transparent);
    text-align: center;
    transition: border-color 150ms ease-out;
  }

  .statblock-pool:hover .statblock-pool-face {
    border-color: var(--foreground-muted);
  }

  .statblock-pool:focus-visible .statblock-pool-face {
    outline: 2px solid var(--ring);
    outline-offset: 1px;
  }

  /* One mark: a 16px box, read as a line of boxes rather than a stack of form controls,
     with a border a glance can find (Ember Muted, well over 3:1; Iron Border was 1.3:1).
     `::after` reaches 4px past it on every side, so the target is 24px. */
  .statblock-mark {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
    border: 1px solid var(--foreground-muted);
    border-radius: var(--radius-structural);
    color: var(--background);
    cursor: pointer;
    transition: background-color 150ms ease-out;
  }

  .statblock-mark::after {
    content: "";
    position: absolute;
    inset: -4px;
  }

  @media (prefers-reduced-motion: reduce) {
    .statblock-mark {
      transition: none;
    }
  }

  /* Ticked fills with the text's own colour. Crimson is kept for what is playing, active
     or selected; a box ticked for a spent legendary action is none of those, and a fight
     with conditions and spell slots on four creatures was a field of accent. */
  .statblock-mark[aria-pressed="true"] {
    background: var(--foreground);
    border-color: var(--foreground);
  }

  .statblock-mark:hover {
    border-color: var(--foreground);
  }

  .statblock-mark:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
</style>
