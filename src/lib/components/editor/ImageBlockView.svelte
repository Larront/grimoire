<script lang="ts">
  import { ledgerImage, pickLedgerImage } from "$lib/editor/ledger-image.svelte";
  import type { ImageAttrs } from "$lib/editor/image-block";
  import { oneLine } from "$lib/editor/labelled-row";
  import LinkedTextField from "$lib/components/editor/LinkedTextField.svelte";
  import ImageViewer from "$lib/components/editor/ImageViewer.svelte";
  import MissingImage from "$lib/components/editor/MissingImage.svelte";
  import {
    AlignLeft,
    AlignCenter,
    AlignRight,
    Maximize2,
    RefreshCw,
    MoveDiagonal2,
  } from "@lucide/svelte";
  import { fade } from "svelte/transition";

  // The image's record, taken as one prop bag rather than field by field: the connector
  // mounts a block with its record spread over the props, so the rest element *is* the
  // record and nothing here re-lists it (#209). `selected` is not part of it — it is the
  // node's selected state, which the connector drives through `setSelected` below.
  let {
    selected = false,
    onUpdate,
    onCaptionUpdate,
    onSrcReplace,
    ...attrs
  }: ImageAttrs & {
    selected?: boolean;
    onUpdate: (partial: Partial<ImageAttrs>) => void;
    onCaptionUpdate: (alt: string) => void;
    onSrcReplace?: (src: string) => void;
  } = $props();

  // The editable copy — one record, which is what makes `setAttrs` total: an undo hands
  // over a whole image, so there is no field it can leave behind holding a stale value.
  // svelte-ignore state_referenced_locally
  let image = $state<ImageAttrs>({ ...attrs });
  // svelte-ignore state_referenced_locally
  let _selected = $state(selected);
  let viewerOpen = $state(false);

  // The src's resolution, loading and not-found states included — the same helper the
  // Infobox's thumbnail uses, which is what keeps one race fixed in one place.
  const file = ledgerImage(() => image.src);
  let rootEl: HTMLDivElement | undefined = $state();
  let containerEl: HTMLElement | undefined = $state();

  export function setAttrs(next: ImageAttrs) {
    image = next;
  }

  export function setSelected(val: boolean) {
    _selected = val;
  }

  // Left and right float the image beside the prose that follows, as the Infobox floats
  // (app.css, "Note images"); the node view's own element is what floats, so it carries
  // the alignment and the width. "Align right" used to slide the image to the right of a
  // full-width row and leave the text below it, beside a hole.
  $effect(() => {
    const host = rootEl?.closest<HTMLElement>("[data-image-block]");
    if (!host) return;
    host.setAttribute("data-align", image.align);
    host.style.setProperty("--image-width", image.width);
  });

  // ── The viewer ───────────────────────────────────────────────────────────────
  // Double-click, Enter or Space on the selected image, or the toolbar's button. Space
  // used to delete a selected image — the key a GM presses to "show" something.
  function openViewer() {
    if (file.url) viewerOpen = true;
  }

  $effect(() => {
    const host = rootEl?.closest<HTMLElement>("[data-image-block]");
    if (!host) return;
    host.addEventListener("image-block:open-viewer", openViewer);
    return () => host.removeEventListener("image-block:open-viewer", openViewer);
  });

  async function replaceImage() {
    // A failed copy leaves the node alone, as every other insertion route does.
    const newSrc = await pickLedgerImage();
    if (newSrc) onSrcReplace?.(newSrc);
  }

  function setAlign(align: ImageAttrs["align"]) {
    image.align = align;
    onUpdate({ align, width: image.width });
  }

  // The caption is the image's alt text, and lives inside `![…](…)`: square brackets
  // would end it early, so they are kept out — which also keeps the field's `[[` link
  // suggestions from ever opening here.
  const captionText = (raw: string) => oneLine(raw).replace(/[[\]]/g, "");

  /** The floor the drag already enforced in pixels, restated as the percentage the
      keyboard path works in. */
  const MIN_WIDTH_PCT = 10;
  const STEP_PCT = 5;

  /**
   * The keyboard half of the resize handle. Arrows step, Home/End take the ends, and
   * every branch commits through the same `onUpdate` the drag's mouseup uses, so a
   * keyboard resize is one undo step in ProseMirror exactly as a drag is.
   */
  function resizeByKey(e: KeyboardEvent) {
    const current = parseFloat(image.width) || 100;
    let next = current;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = current + STEP_PCT;
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = current - STEP_PCT;
    else if (e.key === "Home") next = MIN_WIDTH_PCT;
    else if (e.key === "End") next = 100;
    else return;

    e.preventDefault();
    e.stopPropagation();
    next = Math.round(Math.min(100, Math.max(MIN_WIDTH_PCT, next)));
    if (next === current) return;
    image.width = `${next}%`;
    onUpdate({ align: image.align, width: image.width });
  }

  // The handle sits on the side the image grows toward: the right for a left or centred
  // image, the left for one aligned right, whose right edge is fixed. A centred image
  // grows on both sides at once, so the pointer's travel counts twice — the handle used
  // to drift away from the pointer at half its speed.
  const handleOnLeft = $derived(image.align === "right");
  let resizing = $state(false);

  function startResize(e: MouseEvent) {
    e.preventDefault();
    const host = rootEl?.closest<HTMLElement>("[data-image-block]");
    // The column the width is a percentage of: the floated host's container, or this
    // block's own row when it is not floated.
    const column = (host?.parentElement ?? containerEl?.parentElement) as HTMLElement | null;
    if (!column) return;
    resizing = true;
    const startX = e.clientX;
    const startPx = column.offsetWidth * ((parseFloat(image.width) || 100) / 100);
    const direction = handleOnLeft ? -1 : 1;
    const factor = image.align === "center" ? 2 : 1;
    host?.setAttribute("data-resizing", "");

    function onMove(ev: MouseEvent) {
      if (!column) return;
      const delta = (ev.clientX - startX) * direction * factor;
      const px = Math.max(80, startPx + delta);
      image.width = `${Math.min(100, Math.round((px / column.offsetWidth) * 100))}%`;
    }

    function onUp() {
      resizing = false;
      host?.removeAttribute("data-resizing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      onUpdate({ align: image.align, width: image.width });
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const control =
    "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors " +
    "hover:bg-surface-hover hover:text-foreground cursor-pointer " +
    "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div bind:this={rootEl} class="image-block-row my-2 flex flex-col" data-align={image.align}>
  <figure bind:this={containerEl} class="image-frame relative m-0">
    {#if _selected}
      <!-- The toolbar floats above the image rather than over it, so it never hides the
           picture, a small image's whole face, or the missing state's Replace. -->
      <div
        class="absolute bottom-full left-1/2 z-10 mb-1.5 flex -translate-x-1/2 items-center gap-px
               rounded-md bg-popover p-0.5 shadow-float ring-1 ring-foreground/10"
        transition:fade={{ duration: 150 }}
      >
        <button
          type="button"
          class="{control} {image.align === 'left' ? 'text-primary' : ''}"
          aria-label="Align left"
          title="Align left — text wraps to the right"
          aria-pressed={image.align === "left"}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => setAlign("left")}
        >
          <AlignLeft size={14} />
        </button>
        <button
          type="button"
          class="{control} {image.align === 'center' ? 'text-primary' : ''}"
          aria-label="Align centre"
          title="Centre"
          aria-pressed={image.align === "center"}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => setAlign("center")}
        >
          <AlignCenter size={14} />
        </button>
        <button
          type="button"
          class="{control} {image.align === 'right' ? 'text-primary' : ''}"
          aria-label="Align right"
          title="Align right — text wraps to the left"
          aria-pressed={image.align === "right"}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => setAlign("right")}
        >
          <AlignRight size={14} />
        </button>
        <div class="mx-0.5 h-4 w-px bg-border"></div>
        {#if file.url}
          <button
            type="button"
            class={control}
            aria-label="View full size"
            title="Show full screen (double-click, or Enter)"
            data-lightbox-btn
            onmousedown={(e) => e.preventDefault()}
            onclick={openViewer}
          >
            <Maximize2 size={14} />
          </button>
        {/if}
        <!-- Always offered, not only once the file is missing: swapping a draft map for
             the final one is the common case. -->
        <button
          type="button"
          class={control}
          aria-label="Replace image"
          title="Replace image"
          onmousedown={(e) => e.preventDefault()}
          onclick={replaceImage}
        >
          <RefreshCw size={14} />
        </button>
        <!-- No trash can. A selected image answers to Backspace, and the gutter handle's
             menu deletes anything (#194, #219). -->
      </div>
    {/if}

    <div class="relative">
      {#if file.url}
        <!-- Selected is drawn on the image itself: the toolbar appearing used to be the
           only sign. -->
        <img
          src={file.url}
          alt={image.alt}
          class="block w-full cursor-pointer rounded {_selected
            ? 'outline-2 outline-offset-2 outline-primary'
            : ''}"
          draggable="false"
          onerror={file.markMissing}
          ondblclick={openViewer}
        />
      {:else if file.missing}
        <MissingImage path={image.src} onReplace={replaceImage} />
      {:else}
        <div class="aspect-[4/3] w-full animate-pulse rounded bg-card"></div>
      {/if}

      {#if _selected}
        <!-- The resize handle: a `slider`, focusable, as the drag's keyboard twin — arrows
           step it, Home and End take the ends. A grip drawn in it, and a readout while it
           moves. -->
        <div
          role="slider"
          tabindex="0"
          aria-label="Image width"
          aria-valuemin={MIN_WIDTH_PCT}
          aria-valuemax={100}
          aria-valuenow={parseFloat(image.width) || 100}
          aria-valuetext="{Math.round(parseFloat(image.width) || 100)}%"
          title="Drag to resize (or arrow keys)"
          class="absolute bottom-0 z-10 flex size-6 items-center justify-center rounded-md bg-popover
               text-muted-foreground shadow-float ring-1 ring-foreground/10 hover:text-foreground
               focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring
               {handleOnLeft
            ? 'left-0 -translate-x-1/3 translate-y-1/3 cursor-nesw-resize'
            : 'right-0 translate-x-1/3 translate-y-1/3 cursor-nwse-resize'}"
          onmousedown={startResize}
          onkeydown={resizeByKey}
        >
          <MoveDiagonal2 size={12} class={handleOnLeft ? "-scale-x-100" : ""} aria-hidden="true" />
        </div>
        {#if resizing}
          <div
            class="absolute top-2 left-1/2 z-10 -translate-x-1/2 rounded-md bg-popover px-2 py-0.5
                 font-sans text-xs tabular-nums text-foreground shadow-float ring-1 ring-foreground/10"
            aria-hidden="true"
          >
            {Math.round(parseFloat(image.width) || 100)}%
          </div>
        {/if}
      {/if}
    </div>

    <!-- The caption: a Linked Text Field like every other free text in a block — it keeps
         its wrapping when opened, Enter commits and Escape reverts. Drawn only when there
         is a caption or the image is selected, so an uncaptioned image keeps no empty
         line under it. -->
    {#if image.alt || _selected}
      <figcaption class="mt-1 text-center">
        <LinkedTextField
          value={image.alt}
          onCommit={(alt) => {
            image.alt = alt;
            onCaptionUpdate(alt);
          }}
          restrict={captionText}
          ariaLabel="Image caption"
          placeholder="Add a caption"
          class="font-sans text-sm text-center text-muted-foreground"
        />
      </figcaption>
    {/if}
  </figure>
</div>

{#if viewerOpen && file.url}
  <ImageViewer src={file.url} alt={image.alt} onClose={() => (viewerOpen = false)} />
{/if}

<style>
  /* Not floated (centred, or a narrow column): the image takes its width of the row, at
     its alignment. Floated, the node view's own element carries the width (app.css) and
     the image fills it. */
  .image-block-row[data-align="left"] {
    align-items: flex-start;
  }
  .image-block-row[data-align="center"] {
    align-items: center;
  }
  .image-block-row[data-align="right"] {
    align-items: flex-end;
  }
  /* A centred image's caption is centred under it; a floated one's reads from its edge. */
  .image-block-row[data-align="center"] figcaption :global(button),
  .image-block-row[data-align="center"] figcaption :global(input) {
    text-align: center;
  }

  .image-frame {
    width: var(--image-frame-width, var(--image-width, 100%));
    max-width: 100%;
  }
</style>
