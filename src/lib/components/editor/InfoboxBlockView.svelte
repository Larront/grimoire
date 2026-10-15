<script lang="ts">
  // The Infobox's view (#175, #176) — a titled panel of labelled facts over a thumbnail.
  //
  // Almost nothing but rows, which is why this block went first: order and the
  // hover-revealed controls are the Row List's, the `Label: value` format is the
  // Labelled Row's, every text surface is a Linked Text Field, and the plumbing back to
  // the document is the shared connector's. What is left here is the panel's own
  // business — its two columns, its thumbnail, and which edits become a document write.
  //
  // Directly editable, with no mode to enter (ADR-0016 §6): the Infobox holds no value
  // that changes during play, so there is nothing a slipped click could edit mid-fight
  // and nothing to guard with a pencil button. Every field is a field all of the time.
  //
  // The thumbnail (#176) is the panel's own ledger-relative path drawn here, not a
  // composed Image node; its alt text is also its visible caption, so the GM labels it
  // once. What is *not* here is the float: nothing in this component knows whether the
  // panel is beside the prose or stacked above it, because that is a container query on
  // the block's own column in `app.css` and never an attribute (#148).
  import { tick } from "svelte";
  import { Heading, ImagePlus, Maximize2, Plus, RefreshCw, X } from "@lucide/svelte";
  import { linkedPlainText } from "$lib/editor/linked-text";
  import ImageViewer from "$lib/components/editor/ImageViewer.svelte";
  import MissingImage from "$lib/components/editor/MissingImage.svelte";
  import RowList from "$lib/components/editor/RowList.svelte";
  import LinkedTextField from "$lib/components/editor/LinkedTextField.svelte";
  import { ledgerImage, pickLedgerImage } from "$lib/editor/ledger-image.svelte";
  import { settleRowChange, type RowChange } from "$lib/editor/row-list";
  import { blankLabelledRow, labelText, oneLine, type LabelledRow } from "$lib/editor/labelled-row";
  import type { Infobox } from "$lib/editor/infobox-block";

  // The panel's own record, taken as one prop bag rather than as four named props: the
  // connector mounts a block with its record spread over the props, so the rest element
  // *is* the record and nothing here re-lists its fields (#209). A field added to
  // `Infobox` arrives without a line changing in this file.
  let {
    onCommit,
    ...attrs
  }: Infobox & {
    onCommit: (infobox: Infobox) => void;
  } = $props();

  // The editable copy. One record rather than one mirror per field, which is what makes
  // `setAttrs` below total: an undo hands over a whole panel, so there is no field it can
  // leave behind holding a stale value for the next commit to write back.
  // svelte-ignore state_referenced_locally
  let panel = $state<Infobox>({ ...attrs });

  /** The row whose label is opening for typing, after an insert or a fresh `/infobox`. */
  let focusedRow = $state<number | null>(null);

  function commit() {
    onCommit($state.snapshot(panel) as Infobox);
  }

  // The title row is drawn when there is a title, or while one is being added. An empty
  // one used to keep a line at the top of every untitled panel, and the quiet "Add row"
  // another at the bottom — 71 of Thornhaven's 270px was space for things not shown.
  // "Add a title", "Add image" and "Add row" now float above the panel on hover or focus.
  let addingTitle = $state(false);
  let addImageButton = $state<HTMLButtonElement | null>(null);
  let announcement = $state("");

  function startTitle() {
    addingTitle = true;
  }

  // A title opened and left empty, or abandoned with Escape, commits nothing — so the line
  // goes once focus has left it, as it would have had the GM never asked. A task later,
  // so the field's own blur has committed whatever was typed first.
  function closeEmptyTitle(e: FocusEvent) {
    const row = e.currentTarget as HTMLElement;
    setTimeout(() => {
      if (!row.contains(document.activeElement)) addingTitle = false;
    }, 0);
  }

  function setTitle(next: string) {
    addingTitle = false;
    panel.title = next;
    commit();
  }

  // ── The thumbnail ───────────────────────────────────────────────────────────

  // The path's resolution, loading and not-found states included. A file moved or
  // deleted outside Grimoire leaves the panel drawing everything else: a missing
  // portrait costs the portrait and nothing else.
  const thumbnailImage = ledgerImage(() => panel.image);

  // The portrait can be shown to the table, as a note image can — the same viewer.
  let viewerOpen = $state(false);

  async function chooseImage() {
    const path = await pickLedgerImage();
    if (!path) return;
    panel.image = path;
    commit();
  }

  /**
   * The caption is the alt text, so removing the image takes it with it — a caption
   * with no image is a record the fence has nowhere to write.
   */
  async function removeImage() {
    panel.image = "";
    panel.imageAlt = "";
    commit();
    // The control pressed has gone with the image; focus goes to the way to add one back
    // rather than to the page, and the change is said, since nothing on screen asks.
    announcement = "Image removed. Ctrl+Z to undo";
    await tick();
    addImageButton?.focus();
  }

  function addRow() {
    handleRowChange([...panel.rows, blankLabelledRow()], {
      kind: "insert",
      index: panel.rows.length,
    });
  }

  // The panel's controls, sized and focused as every note block's are.
  const control =
    "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors " +
    "hover:bg-muted hover:text-foreground cursor-pointer " +
    "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";

  // ── The label column ────────────────────────────────────────────────────────
  // One column for the whole panel, as wide as its longest label up to a cap, as a wiki
  // infobox lays out — so values start at one edge and take the rest. It was 30% of each
  // row: wide where labels are short, and a `Born` beside a three-line value.
  let measurer = $state<HTMLElement | null>(null);
  let labelWidth = $state(0);
  $effect(() => {
    void panel.rows.map((r) => r.label);
    void tick().then(() => (labelWidth = measurer?.offsetWidth ?? 0));
  });

  function setImageAlt(next: string) {
    panel.imageAlt = next;
    commit();
  }

  function setRow(index: number, patch: Partial<LabelledRow>) {
    panel.rows[index] = { ...panel.rows[index], ...patch };
    focusedRow = null;
    commit();
  }

  // Order changes come from the Row List, which owns the controls and the splicing.
  // Whether one of them reaches the document is `settleRowChange`'s rule, stated once
  // there; what is left here is what this block means by focusing a row.
  function handleRowChange(next: LabelledRow[], change: RowChange) {
    panel.rows = next;
    settleRowChange(change, {
      focus: (index) => (focusedRow = index),
      commit: () => {
        focusedRow = null;
        commit();
      },
    });
  }

  export function setAttrs(next: Infobox) {
    panel = next;
    focusedRow = null;
  }

  /** A fresh insert opens its one empty row for typing. */
  export function focusRow(index: number) {
    focusedRow = index;
  }
</script>

<!-- One row: its label and its value, both Linked Text Fields, because a `[[…]]` in
     either is already a real link whether the field draws it or not. The Row List
     draws the move / delete controls beside this, in a gutter of their own, and the
     insert points between rows.

     Deliberately tight — a summary panel is read as a table, and a label sitting a
     third of a column away from the value it names has to be traced across (#175
     review). The label column is the panel's, sized to its longest label (capped), so
     `Population` and `Ruler` line up and values take the rest. Both fields keep their
     wrapping while edited, and a long unbroken value wraps rather than running out. -->
{#snippet infoboxRow(row: LabelledRow, i: number)}
  <div class="infobox-row flex-1 min-w-0 grid items-start gap-x-2">
    <LinkedTextField
      value={row.label}
      onCommit={(label) => setRow(i, { label })}
      restrict={labelText}
      focused={focusedRow === i}
      ariaLabel={`Row ${i + 1} label`}
      placeholder="Label"
      wrap
      class="font-sans text-xs leading-snug text-muted-foreground"
    />
    <LinkedTextField
      value={row.value}
      onCommit={(value) => setRow(i, { value })}
      restrict={oneLine}
      ariaLabel={`Row ${i + 1} value`}
      placeholder="Value"
      wrap
      class="font-sans text-xs leading-snug text-foreground [overflow-wrap:anywhere]"
    />
  </div>
{/snippet}

<!-- The thumbnail: the file, its caption, and the controls that change it. Wrapped in
     `.infobox-thumb`, which is the hook the stylesheet caps at the panel's floated
     width — stacked, the image holds that size rather than growing with the panel,
     because these are files a GM dropped in rather than hero art. -->
{#snippet thumbnail()}
  <figure class="infobox-thumb group/thumb relative mb-2">
    {#if thumbnailImage.url}
      <img
        data-infobox-image
        src={thumbnailImage.url}
        alt={panel.imageAlt}
        class="block w-full cursor-pointer rounded"
        draggable="false"
        onerror={thumbnailImage.markMissing}
        ondblclick={() => (viewerOpen = true)}
      />
    {:else if thumbnailImage.missing}
      <div data-infobox-image-missing>
        <MissingImage path={panel.image} onReplace={chooseImage} compact />
      </div>
    {:else}
      <div class="w-full h-16 rounded bg-card animate-pulse"></div>
    {/if}

    <!-- Hover-revealed: a summary panel the GM is reading should not carry buttons they
         are not reaching for. Controls over the GM's imagery take the floating level
         (DESIGN.md §4), at the 28px every block's controls use. -->
    <div
      class="absolute top-1 right-1 flex items-center gap-px rounded-md bg-popover p-0.5 shadow-float
             ring-1 ring-foreground/10 opacity-0 transition-opacity duration-150
             motion-reduce:transition-none group-hover/thumb:opacity-100
             group-focus-within/thumb:opacity-100"
    >
      {#if thumbnailImage.url}
        <button
          type="button"
          class={control}
          aria-label="View full size"
          title="Show full screen (or double-click)"
          onclick={() => (viewerOpen = true)}
        >
          <Maximize2 size={14} />
        </button>
        <button
          type="button"
          class={control}
          aria-label="Replace image"
          title="Replace image"
          onclick={chooseImage}
        >
          <RefreshCw size={14} />
        </button>
      {/if}
      <button
        type="button"
        class="{control} hover:text-destructive"
        aria-label="Remove image"
        title="Remove image (and its caption)"
        onclick={removeImage}
      >
        <X size={14} />
      </button>
    </div>

    <!-- The alt text doubles as the caption, so the GM labels it once. A Linked Text
         Field like every other free text in a block: a `[[…]]` typed here is already
         in the Link Index whether this drew it or not. -->
    <figcaption class="mt-0.5">
      <LinkedTextField
        value={panel.imageAlt}
        onCommit={setImageAlt}
        restrict={oneLine}
        ariaLabel="Image caption"
        placeholder="Add a caption…"
        class="font-sans text-[0.7rem] leading-snug text-muted-foreground"
      />
    </figcaption>
  </figure>
  {#if viewerOpen && thumbnailImage.url}
    <ImageViewer
      src={thumbnailImage.url}
      alt={panel.imageAlt}
      onClose={() => (viewerOpen = false)}
    />
  {/if}
{/snippet}

<div
  class="infobox-block group/panel relative my-2 select-none rounded-lg border border-border bg-card/40 px-3 py-2"
  contenteditable="false"
  role="group"
  aria-label={linkedPlainText(panel.title).trim() || "Infobox"}
  style="--infobox-label-w: {labelWidth ? `${labelWidth + 2}px` : '30%'}"
>
  <!-- The panel's own offers — a title, an image, a row — float above it on hover or
       focus, rather than keeping lines inside it for buttons that are hidden. -->
  <div
    class="absolute right-1 bottom-full z-10 mb-1 flex items-center gap-px rounded-md bg-popover p-0.5
           shadow-float ring-1 ring-foreground/10 opacity-0 transition-opacity duration-150
           motion-reduce:transition-none pointer-events-none group-hover/panel:pointer-events-auto
           group-hover/panel:opacity-100 group-focus-within/panel:pointer-events-auto
           group-focus-within/panel:opacity-100"
  >
    {#if !panel.title && !addingTitle}
      <button
        type="button"
        class={control}
        aria-label="Add a title"
        title="Add a title"
        onclick={startTitle}
      >
        <Heading size={14} />
      </button>
    {/if}
    {#if !panel.image}
      <button
        bind:this={addImageButton}
        type="button"
        class={control}
        aria-label="Add image"
        title="Add image"
        onclick={chooseImage}
      >
        <ImagePlus size={14} />
      </button>
    {/if}
    <button
      type="button"
      class={control}
      aria-label="Add row"
      title="Add row (or Alt+Enter on a row)"
      onclick={addRow}
    >
      <Plus size={14} />
    </button>
  </div>

  {#if panel.image}
    {@render thumbnail()}
  {/if}

  <!-- The title is the GM's name for the panel, so it carries the world's voice
       (DESIGN.md's two-voice rule); the rows around it are structure and stay in the
       tool's. Empty by default — a panel sitting under a note's own heading should not
       have to say the same thing twice — and then not drawn at all. -->
  {#if panel.title || addingTitle}
    <div class="mb-1" onfocusout={closeEmptyTitle}>
      <LinkedTextField
        value={panel.title}
        onCommit={setTitle}
        restrict={oneLine}
        focused={addingTitle}
        ariaLabel="Infobox title"
        placeholder="Title"
        wrap
        class="font-heading text-sm leading-snug text-foreground"
      />
    </div>
  {/if}

  {#if panel.rows.length === 0}
    <div class="font-sans text-xs text-muted-foreground mb-1">No rows yet</div>
  {/if}

  <!-- Rows offer their moves and delete through one menu each: the panel is ~300px when
       it floats, and a strip of three controls on every row took 80px of it. -->
  <RowList
    rows={panel.rows}
    row={infoboxRow}
    noun="row"
    controls="menu"
    showAdd={false}
    rowName={(row) => linkedPlainText(row.label)}
    createRow={blankLabelledRow}
    onChange={handleRowChange}
  />

  <!-- Measures the labels for the shared label column: every label, laid out at its own
       width, out of sight. -->
  <div
    bind:this={measurer}
    class="pointer-events-none invisible absolute top-0 left-0 grid w-max font-sans text-xs leading-snug"
    aria-hidden="true"
  >
    {#each panel.rows as row, i (i)}
      <span>{linkedPlainText(row.label) || "Label"}</span>
    {/each}
  </div>

  <p class="sr-only" aria-live="polite">{announcement}</p>
</div>

<style>
  .infobox-block {
    /* Rows sit a little apart, so a label that wraps reads as one label and not as the
       next row's; the Row List puts its insert point in this space and nowhere else. */
    --row-gap: 0.25rem;
    /* The insert plus sits in the panel's left padding, clear of the labels. */
    --row-insert-x: -0.375rem;
  }

  .infobox-block :global(.infobox-row) {
    grid-template-columns: minmax(3rem, min(var(--infobox-label-w, 30%), 45%)) minmax(0, 1fr);
  }
</style>
