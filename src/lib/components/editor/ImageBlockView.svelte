<script lang="ts">
  import { ledgerImage, pickLedgerImage } from "$lib/editor/ledger-image.svelte";
  import { portal } from "$lib/utils/portal";
  import {
    AlignLeft,
    AlignCenter,
    AlignRight,
    GripVertical,
    Maximize2,
    Trash2,
    X,
  } from "@lucide/svelte";
  import { fade } from "svelte/transition";

  let {
    src,
    alt,
    align,
    width,
    selected = false,
    onUpdate,
    onCaptionUpdate,
    onSrcReplace,
    onRemove,
    onGrab,
  }: {
    src: string;
    alt: string;
    align: string;
    width: string;
    selected?: boolean;
    onUpdate: (attrs: { align: string; width: string }) => void;
    onCaptionUpdate: (alt: string) => void;
    onSrcReplace?: (src: string) => void;
    /**
     * Selects the whole image as one thing. Image is the block that could already be
     * selected by clicking it — the connector lets its mousedown through on purpose — so
     * this is the same gesture the other blocks now have, in the same place.
     */
    onGrab?: () => void;
    /** Takes the image out of the note. The file in `ledger/images/` is left alone. */
    onRemove?: () => void;
  } = $props();

  // Internal mutable copies — NodeView calls setAttrs / setSelected to update these
  // svelte-ignore state_referenced_locally
  let _align = $state(align);
  // svelte-ignore state_referenced_locally
  let _width = $state(width);
  // svelte-ignore state_referenced_locally
  let _src = $state(src);
  // svelte-ignore state_referenced_locally
  let _alt = $state(alt);
  // svelte-ignore state_referenced_locally
  let _selected = $state(selected);
  let _lightboxOpen = $state(false);

  // The src's resolution, loading and not-found states included — the same helper the
  // Infobox's thumbnail uses, which is what keeps one race fixed in one place.
  const file = ledgerImage(() => _src);
  let containerEl: HTMLDivElement | undefined = $state();

  export function setAttrs(attrs: {
    align: string;
    width: string;
    src: string;
    alt: string;
  }) {
    _align = attrs.align;
    _width = attrs.width;
    _src = attrs.src;
    _alt = attrs.alt;
  }

  export function setSelected(val: boolean) {
    _selected = val;
  }

  const alignMap: Record<string, string> = {
    left: "flex-start",
    center: "center",
    right: "flex-end",
  };

  function closeLightbox() {
    _lightboxOpen = false;
  }

  async function replaceImage() {
    // A failed copy leaves the node alone, as every other insertion route does.
    const newSrc = await pickLedgerImage();
    if (newSrc) onSrcReplace?.(newSrc);
  }

  function onBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) closeLightbox();
  }

  $effect(() => {
    if (!_lightboxOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeLightbox();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Resize state — tracked here AND in the extension's stopEvent closure
  // via a 'resizing' data attribute on the dom root
  let isDragging = false;
  let dragStartX = 0;
  let dragStartWidthPx = 0;

  function startResize(e: MouseEvent) {
    e.preventDefault();
    isDragging = true;
    dragStartX = e.clientX;
    const parent = containerEl?.parentElement;
    dragStartWidthPx = parent
      ? parent.offsetWidth * (parseFloat(_width) / 100)
      : 200;
    // Signal to stopEvent in the extension that a resize is in progress
    containerEl
      ?.closest("[data-image-block]")
      ?.setAttribute("data-resizing", "");

    function onMove(e: MouseEvent) {
      if (!isDragging || !containerEl?.parentElement) return;
      const delta = e.clientX - dragStartX;
      const newPx = Math.max(80, dragStartWidthPx + delta);
      const pct = Math.min(
        100,
        Math.round((newPx / containerEl.parentElement.offsetWidth) * 100),
      );
      _width = `${pct}%`;
    }

    function onUp() {
      isDragging = false;
      containerEl
        ?.closest("[data-image-block]")
        ?.removeAttribute("data-resizing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      onUpdate({ align: _align, width: _width });
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="my-2 flex flex-col"
  style="align-items: {alignMap[_align] ?? 'center'};"
>
  <div bind:this={containerEl} class="relative" style="width: {_width};">
    {#if _selected}
      <!-- Floating toolbar — bottom-center, overlaying the image -->
      <div
        class="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-0.5
               rounded border border-border bg-card/90 backdrop-blur-sm shadow-md px-1 py-0.5"
        transition:fade={{ duration: 120 }}
      >
        <button
          draggable="true"
          data-block-grip
          class="p-1 rounded hover:bg-muted text-muted-foreground/60 hover:text-foreground
                 transition-colors cursor-grab active:cursor-grabbing"
          aria-label="Select image"
          onmousedown={onGrab}
        >
          <GripVertical class="size-3.5" />
        </button>
        <button
          class="p-1 rounded hover:bg-muted text-muted-foreground/60 hover:text-foreground
                 transition-colors {_align === 'left' ? 'text-primary' : ''}"
          aria-label="Align left"
          aria-pressed={_align === "left"}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => {
            _align = "left";
            onUpdate({ align: "left", width: _width });
          }}
        >
          <AlignLeft size={14} />
        </button>
        <button
          class="p-1 rounded hover:bg-muted text-muted-foreground/60 hover:text-foreground
                 transition-colors {_align === 'center' ? 'text-primary' : ''}"
          aria-label="Align center"
          aria-pressed={_align === "center"}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => {
            _align = "center";
            onUpdate({ align: "center", width: _width });
          }}
        >
          <AlignCenter size={14} />
        </button>
        <button
          class="p-1 rounded hover:bg-muted text-muted-foreground/60 hover:text-foreground
                 transition-colors {_align === 'right' ? 'text-primary' : ''}"
          aria-label="Align right"
          aria-pressed={_align === "right"}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => {
            _align = "right";
            onUpdate({ align: "right", width: _width });
          }}
        >
          <AlignRight size={14} />
        </button>
        <div class="w-px h-4 bg-border mx-0.5"></div>
        <button
          class="p-1 rounded hover:bg-muted text-muted-foreground/60 hover:text-foreground
                 transition-colors"
          aria-label="View full size"
          data-lightbox-btn
          onmousedown={(e) => e.preventDefault()}
          onclick={() => {
            _lightboxOpen = true;
          }}
        >
          <Maximize2 size={14} />
        </button>
        {#if onRemove}
          <!-- Backspace already removes a selected image — this toolbar only shows
               while the node *is* selected — so this button is discoverability rather
               than capability, and it is here because the other blocks now carry one
               and a GM should not have to know which blocks answer to the keyboard. -->
          <button
            class="p-1 rounded hover:bg-muted text-muted-foreground/60 hover:text-destructive
                   transition-colors"
            aria-label="Remove image"
            onmousedown={(e) => e.preventDefault()}
            onclick={onRemove}
          >
            <Trash2 size={14} />
          </button>
        {/if}
      </div>
    {/if}

    {#if file.url}
      <img
        src={file.url}
        alt={_alt}
        class="block w-full rounded"
        draggable="false"
        onerror={file.markMissing}
      />
    {:else if file.missing}
      <div
        class="flex flex-col items-center justify-center gap-2 w-full min-h-20 py-3 rounded
               border border-border/60 bg-card text-muted-foreground/60 text-xs font-sans"
      >
        <span>Image not found: {_src}</span>
        <button
          type="button"
          data-replace-btn
          class="rounded border border-border/60 bg-background px-2 py-0.5 text-xs
                 text-foreground hover:bg-muted focus:outline-none
                 focus-visible:ring-2 focus-visible:ring-primary"
          onmousedown={(e) => e.preventDefault()}
          onclick={replaceImage}
        >
          Replace…
        </button>
      </div>
    {:else}
      <div class="w-full h-20 rounded bg-card animate-pulse"></div>
    {/if}

    {#if _selected}
      <!-- Bottom-right resize handle -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        role="separator"
        class="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize
               bg-card border border-border rounded-tl z-10"
        aria-label="Resize image"
        onmousedown={startResize}
      ></div>
    {/if}
  </div>

  {#if _selected}
    <input
      type="text"
      value={_alt}
      placeholder="Add caption…"
      aria-label="Image caption"
      data-caption-input
      class="mt-1 w-full text-sm text-center font-sans
             text-foreground bg-transparent border-b border-border/60
             placeholder:text-muted-foreground/50 outline-none
             focus:border-primary"
      style="max-width: {_width};"
      oninput={(e) => {
        _alt = (e.target as HTMLInputElement).value;
      }}
      onblur={() => onCaptionUpdate(_alt)}
      onmousedown={(e) => e.stopPropagation()}
    />
  {:else}
    <!-- Reserve the input's footprint (mt-1 + text-sm line-height + border-b)
         so selecting an image doesn't shift surrounding text. -->
    <p
      class="mt-1 w-full text-sm text-center font-sans border-b border-transparent text-muted-foreground"
      style="max-width: {_width}; min-height: 1.25rem; margin-bottom: 0;"
      data-caption
      aria-hidden={!_alt}
    >
      {_alt || " "}
    </p>
  {/if}
</div>

{#if _lightboxOpen && file.url}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    use:portal
    role="dialog"
    aria-modal="true"
    aria-label="Image viewer"
    tabindex="-1"
    data-image-lightbox
    class="fixed inset-0 z-[10000] overflow-auto bg-black/80"
    onclick={onBackdropClick}
  >
    <button
      type="button"
      class="fixed top-3 right-3 z-10 rounded-full bg-card/90 p-1.5 text-foreground
             shadow-md hover:bg-card focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      aria-label="Close image viewer"
      data-lightbox-close
      onclick={closeLightbox}
    >
      <X size={18} />
    </button>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="min-h-full w-full flex items-center justify-center p-8"
      onclick={onBackdropClick}
    >
      <img
        src={file.url}
        alt={_alt}
        data-lightbox-img
        class="max-w-none block"
        draggable="false"
      />
    </div>
  </div>
{/if}
