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
  import { ImagePlus, RefreshCw, X } from "@lucide/svelte";
  import RowList from "$lib/components/editor/RowList.svelte";
  import LinkedTextField from "$lib/components/editor/LinkedTextField.svelte";
  import { ledgerImage, pickLedgerImage } from "$lib/editor/ledger-image.svelte";
  import { settleRowChange, type RowChange } from "$lib/editor/row-list";
  import {
    blankLabelledRow,
    labelText,
    oneLine,
    type LabelledRow,
  } from "$lib/editor/labelled-row";
  import type { Infobox } from "$lib/editor/infobox-block";

  let {
    title,
    image,
    imageAlt,
    rows,
    onCommit,
  }: {
    title: string;
    image: string;
    imageAlt: string;
    rows: LabelledRow[];
    onCommit: (infobox: Infobox) => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let _title = $state(title);
  // svelte-ignore state_referenced_locally
  let _image = $state(image);
  // svelte-ignore state_referenced_locally
  let _imageAlt = $state(imageAlt);
  // svelte-ignore state_referenced_locally
  let _rows = $state<LabelledRow[]>(rows);

  /** The row whose label is opening for typing, after an insert or a fresh `/infobox`. */
  let focusedRow = $state<number | null>(null);

  function commit() {
    onCommit({
      title: _title,
      image: _image,
      imageAlt: _imageAlt,
      rows: $state.snapshot(_rows) as LabelledRow[],
    });
  }

  function setTitle(next: string) {
    _title = next;
    commit();
  }

  // ── The thumbnail ───────────────────────────────────────────────────────────

  // The path's resolution, loading and not-found states included. A file moved or
  // deleted outside Grimoire leaves the panel drawing everything else: a missing
  // portrait costs the portrait and nothing else.
  const thumbnailImage = ledgerImage(() => _image);

  async function chooseImage() {
    const path = await pickLedgerImage();
    if (!path) return;
    _image = path;
    commit();
  }

  /**
   * The caption is the alt text, so removing the image takes it with it — a caption
   * with no image is a record the fence has nowhere to write.
   */
  function removeImage() {
    _image = "";
    _imageAlt = "";
    commit();
  }

  function setImageAlt(next: string) {
    _imageAlt = next;
    commit();
  }

  function setRow(index: number, patch: Partial<LabelledRow>) {
    _rows[index] = { ..._rows[index], ...patch };
    focusedRow = null;
    commit();
  }

  // Order changes come from the Row List, which owns the controls and the splicing.
  // Whether one of them reaches the document is `settleRowChange`'s rule, stated once
  // there; what is left here is what this block means by focusing a row.
  function handleRowChange(next: LabelledRow[], change: RowChange) {
    _rows = next;
    settleRowChange(change, {
      focus: (index) => (focusedRow = index),
      commit: () => {
        focusedRow = null;
        commit();
      },
    });
  }

  export function setAttrs(attrs: Infobox) {
    _title = attrs.title;
    _image = attrs.image;
    _imageAlt = attrs.imageAlt;
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
     `pr-14` reserves the gutter they sit in.

     Deliberately tight — a summary panel is read as a table, and a label sitting a
     third of a column away from the value it names has to be traced across (#175
     review). The label column is a minimum plus a percentage rather than a fixed
     width, so `Population` and `Ruler` still line up. -->
{#snippet infoboxRow(row: LabelledRow, i: number)}
  <div
    class="flex-1 min-w-0 pr-14 grid grid-cols-[minmax(3.5rem,30%)_1fr] items-start gap-x-2"
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
        alt={_imageAlt}
        class="block w-full rounded"
        draggable="false"
        onerror={thumbnailImage.markMissing}
      />
    {:else if thumbnailImage.missing}
      <div
        data-infobox-image-missing
        class="flex flex-col items-center justify-center gap-1.5 w-full min-h-16 rounded px-2 py-2
               border border-dashed border-border/60 bg-card font-sans text-xs text-muted-foreground/60"
      >
        <span class="text-center break-all">Image not found: {_image}</span>
        <button
          type="button"
          data-infobox-image-replace
          class="rounded border border-border/60 bg-background px-2 py-0.5 text-xs text-foreground
                 cursor-pointer hover:bg-muted focus-visible:outline-none focus-visible:ring-2
                 focus-visible:ring-primary focus-visible:ring-offset-2"
          onclick={chooseImage}
        >
          Replace…
        </button>
      </div>
    {:else}
      <div class="w-full h-16 rounded bg-card animate-pulse"></div>
    {/if}

    <!-- Hover-revealed, like the Row List's own controls: a summary panel the GM is
         reading should not carry buttons they are not reaching for. -->
    <div
      class="absolute top-1 right-1 flex items-center gap-0.5 rounded border border-border
             bg-card/90 px-0.5 py-0.5 opacity-0 transition-opacity duration-150
             motion-reduce:transition-none group-hover/thumb:opacity-100
             group-focus-within/thumb:opacity-100"
    >
      <button
        type="button"
        class="p-0.5 rounded cursor-pointer text-muted-foreground hover:text-foreground
               focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        aria-label="Replace image"
        onclick={chooseImage}
      >
        <RefreshCw size={13} />
      </button>
      <button
        type="button"
        class="p-0.5 rounded cursor-pointer text-muted-foreground hover:text-destructive
               focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        aria-label="Remove image"
        onclick={removeImage}
      >
        <X size={13} />
      </button>
    </div>

    <!-- The alt text doubles as the caption, so the GM labels it once. A Linked Text
         Field like every other free text in a block: a `[[…]]` typed here is already
         in the Link Index whether this drew it or not. -->
    <figcaption class="mt-0.5">
      <LinkedTextField
        value={_imageAlt}
        onCommit={setImageAlt}
        restrict={oneLine}
        ariaLabel="Image caption"
        placeholder="Add a caption…"
        class="font-sans text-[0.7rem] leading-snug text-muted-foreground"
      />
    </figcaption>
  </figure>
{/snippet}

<div
  class="infobox-block group/panel my-2 select-none rounded-lg border border-border bg-card/40 px-3 py-2"
  contenteditable="false"
>
  {#if _image}
    {@render thumbnail()}
  {/if}

  <!-- The title row, and the panel's own "Add image" offer beside it.
       The title is the GM's name for the panel, so it carries the world's voice
       (DESIGN.md's two-voice rule); the rows around it are structure and stay in the
       tool's. Empty by default — a panel sitting under a note's own heading should not
       have to say the same thing twice.

       The control sits *in* this row rather than above the title, which is where the
       "Add image" offer used to be: a full-width dashed button reserved a strip of
       vertical space in every panel that had no image, so the emptiest panels looked
       the most cluttered (#175 review). Here it costs part of a line that was going
       to be drawn anyway, and nothing when it is not being reached for.

       It used to have a trash can for company — the panel's only way out, because a
       sealed block holds every click and Backspace had no node to take. The gutter
       handle's menu deletes anything now (#194), so the panel no longer draws its own. -->
  <div class="mb-1 flex items-start gap-1">
    <LinkedTextField
      value={_title}
      onCommit={setTitle}
      restrict={oneLine}
      ariaLabel="Infobox title"
      placeholder="Untitled panel"
      class="min-w-0 flex-1 font-heading text-sm leading-snug text-foreground"
    />
    <div
      class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150
             motion-reduce:transition-none group-hover/panel:opacity-100
             group-focus-within/panel:opacity-100"
    >
      {#if !_image}
        <button
          type="button"
          class="rounded p-0.5 cursor-pointer text-muted-foreground hover:text-foreground
                 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1
                 focus-visible:ring-primary"
          aria-label="Add image"
          onclick={chooseImage}
        >
          <ImagePlus size={13} aria-hidden="true" />
        </button>
      {/if}
    </div>
  </div>

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
