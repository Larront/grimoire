<script lang="ts">
  import { ledgerImage, pickLedgerImage } from "$lib/editor/ledger-image.svelte";
  import type { ImageAttrs } from "$lib/editor/image-block";
  import { portal } from "$lib/utils/portal";
  import { AlignLeft, AlignCenter, AlignRight, Maximize2, X } from "@lucide/svelte";
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
  let _lightboxOpen = $state(false);

  // The src's resolution, loading and not-found states included — the same helper the
  // Infobox's thumbnail uses, which is what keeps one race fixed in one place.
  const file = ledgerImage(() => image.src);
  let containerEl: HTMLDivElement | undefined = $state();

  export function setAttrs(next: ImageAttrs) {
    image = next;
  }

  export function setSelected(val: boolean) {
    _selected = val;
  }

  const alignMap: Record<string, string> = {
    left: "flex-start",
    center: "center",
    right: "flex-end",
  };

  /*
    The lightbox is the app's one hand-rolled modal — everything else routes through the
    shadcn dialog, which brings its own focus handling. This is that handling, written
    out, because `role="dialog"` and `aria-modal` are claims about behaviour rather than
    behaviour: without them Tab walked straight out of the viewer into the note behind
    it, and closing dropped focus on `<body>`, which on this editor means the caret is
    gone and the next keystroke goes nowhere.

    WHAT GETS FOCUS BACK IS WHATEVER HAD IT, not the button that opened this. The trigger
    calls `preventDefault` on mousedown precisely so it never takes focus — that is what
    keeps the ProseMirror selection alive while the toolbar is used — so the element to
    return to is the editor the GM was typing in, and restoring "the trigger" would be
    restoring something that was deliberately never focused.
  */
  let lightboxEl: HTMLDivElement | undefined = $state();
  let returnFocusTo: HTMLElement | null = null;

  function openLightbox() {
    returnFocusTo = document.activeElement as HTMLElement | null;
    _lightboxOpen = true;
  }

  function closeLightbox() {
    _lightboxOpen = false;
    returnFocusTo?.focus?.();
    returnFocusTo = null;
  }

  /** Tab-cycle within the open viewer. */
  function trapTab(e: KeyboardEvent) {
    if (e.key !== "Tab" || !lightboxEl) return;
    const focusable = lightboxEl.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    // The viewer holds a single control today, so both edges of the cycle are the same
    // element and the wrap is a no-op that still has to happen: without it Tab leaves.
    const first = focusable[0] ?? lightboxEl;
    const last = focusable[focusable.length - 1] ?? lightboxEl;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === lightboxEl)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
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
      } else if (e.key === "Tab") {
        trapTab(e);
      }
    }
    window.addEventListener("keydown", onKey);
    // Into the viewer rather than left behind it. `tick`-free: the portalled node is in
    // the document by the time this effect runs, since the effect depends on the same
    // flag that renders it.
    (lightboxEl?.querySelector<HTMLElement>("[data-lightbox-close]") ?? lightboxEl)?.focus();
    return () => window.removeEventListener("keydown", onKey);
  });

  /** The floor the drag already enforced in pixels, restated as the percentage the
      keyboard path works in. Below roughly this the caption input outgrows its image. */
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
    dragStartWidthPx = parent ? parent.offsetWidth * (parseFloat(image.width) / 100) : 200;
    // Signal to stopEvent in the extension that a resize is in progress
    containerEl?.closest("[data-image-block]")?.setAttribute("data-resizing", "");

    function onMove(e: MouseEvent) {
      if (!isDragging || !containerEl?.parentElement) return;
      const delta = e.clientX - dragStartX;
      const newPx = Math.max(80, dragStartWidthPx + delta);
      const pct = Math.min(100, Math.round((newPx / containerEl.parentElement.offsetWidth) * 100));
      image.width = `${pct}%`;
    }

    function onUp() {
      isDragging = false;
      containerEl?.closest("[data-image-block]")?.removeAttribute("data-resizing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      onUpdate({ align: image.align, width: image.width });
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="my-2 flex flex-col" style="align-items: {alignMap[image.align] ?? 'center'};">
  <div bind:this={containerEl} class="relative" style="width: {image.width};">
    {#if _selected}
      <!-- Floating toolbar — bottom-center, overlaying the image -->
      <div
        class="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-0.5
               rounded border border-border bg-card/90 backdrop-blur-sm px-1 py-0.5"
        transition:fade={{ duration: 120 }}
      >
        <button
          class="p-1 rounded hover:bg-muted text-muted-foreground/60 hover:text-foreground
                 transition-colors {image.align === 'left' ? 'text-primary' : ''}"
          aria-label="Align left"
          aria-pressed={image.align === "left"}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => {
            image.align = "left";
            onUpdate({ align: "left", width: image.width });
          }}
        >
          <AlignLeft size={14} />
        </button>
        <button
          class="p-1 rounded hover:bg-muted text-muted-foreground/60 hover:text-foreground
                 transition-colors {image.align === 'center' ? 'text-primary' : ''}"
          aria-label="Align center"
          aria-pressed={image.align === "center"}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => {
            image.align = "center";
            onUpdate({ align: "center", width: image.width });
          }}
        >
          <AlignCenter size={14} />
        </button>
        <button
          class="p-1 rounded hover:bg-muted text-muted-foreground/60 hover:text-foreground
                 transition-colors {image.align === 'right' ? 'text-primary' : ''}"
          aria-label="Align right"
          aria-pressed={image.align === "right"}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => {
            image.align = "right";
            onUpdate({ align: "right", width: image.width });
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
          onclick={openLightbox}
        >
          <Maximize2 size={14} />
        </button>
        <!-- No trash can. It was here for discoverability rather than capability — a
             selected image already answers to Backspace — on the argument that the other
             blocks carried one. They no longer do: the gutter handle's menu deletes
             anything (#194), and this was the last block still drawing its own (#219). -->
      </div>
    {/if}

    {#if file.url}
      <img
        src={file.url}
        alt={image.alt}
        class="block w-full rounded"
        draggable="false"
        onerror={file.markMissing}
      />
    {:else if file.missing}
      <div
        class="flex flex-col items-center justify-center gap-2 w-full min-h-20 py-3 rounded
               border border-border/60 bg-card text-muted-foreground/60 text-xs font-sans"
      >
        <span>Image not found: {image.src}</span>
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
      <!-- Bottom-right resize handle.

           A `slider`, not a `separator`, and focusable. It was mouse-only: `role`
           described what it looked like rather than what it does, and a GM working from
           the keyboard could select an image but never resize one — the width attribute
           had no other route in the UI at all. Arrow keys step it, Home and End take the
           two ends, and `aria-valuenow` reports the percentage the drag also writes. -->
      <div
        role="slider"
        tabindex="0"
        aria-label="Image width"
        aria-valuemin={MIN_WIDTH_PCT}
        aria-valuemax={100}
        aria-valuenow={parseFloat(image.width) || 100}
        aria-valuetext="{Math.round(parseFloat(image.width) || 100)}%"
        class="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize
               bg-card border border-border rounded-tl z-10"
        onmousedown={startResize}
        onkeydown={resizeByKey}
      ></div>
    {/if}
  </div>

  {#if _selected}
    <input
      type="text"
      value={image.alt}
      placeholder="Add caption…"
      aria-label="Image caption"
      data-caption-input
      class="mt-1 w-full text-sm text-center font-sans
             text-foreground bg-transparent border-b border-border/60
             placeholder:text-muted-foreground/50 outline-none
             focus:border-primary"
      style="max-width: {image.width};"
      oninput={(e) => {
        image.alt = (e.target as HTMLInputElement).value;
      }}
      onblur={() => onCaptionUpdate(image.alt)}
      onmousedown={(e) => e.stopPropagation()}
    />
  {:else}
    <!-- Reserve the input's footprint (mt-1 + text-sm line-height + border-b)
         so selecting an image doesn't shift surrounding text. -->
    <p
      class="mt-1 w-full text-sm text-center font-sans border-b border-transparent text-muted-foreground"
      style="max-width: {image.width}; min-height: 1.25rem; margin-bottom: 0;"
      data-caption
      aria-hidden={!image.alt}
    >
      {image.alt || " "}
    </p>
  {/if}
</div>

{#if _lightboxOpen && file.url}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={lightboxEl}
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
    <div class="min-h-full w-full flex items-center justify-center p-8" onclick={onBackdropClick}>
      <img
        src={file.url}
        alt={image.alt}
        data-lightbox-img
        class="max-w-none block"
        draggable="false"
      />
    </div>
  </div>
{/if}
