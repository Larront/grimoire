<!--
  @component
  An image shown to the table: the whole window, the image fitted to it, the note out
  of sight behind. The Image block and the Infobox's portrait both open it.

  It is for the players as much as the GM, so it fits the screen rather than opening at
  the file's own size — a small handout no longer sat tiny in the middle of the window,
  and a large map no longer ran off the bottom with its scale bar. Clicking the image
  toggles to its actual size, scrollable, for the detail a GM wants to point at. The
  caption is not drawn: it is the GM's note about the image, and may say what the
  players should not yet know.

  The backdrop is solid Iron Deep rather than the modal scrim (DESIGN.md §4): the scrim
  dims a note so a dialog can sit over it, and this has to hide the note, which is the
  GM's prep.

  The app's one hand-rolled modal — everything else routes through the shadcn dialog —
  so its focus handling is written out: focus goes in, Tab stays in, and closing returns
  focus to whatever had it.
-->
<script lang="ts">
  import { portal } from "$lib/utils/portal";
  import { X } from "@lucide/svelte";

  let {
    src,
    alt = "",
    onClose,
  }: {
    /** The image's URL, already resolved. */
    src: string;
    /** What the image is, for its name; not drawn. */
    alt?: string;
    onClose: () => void;
  } = $props();

  let viewer: HTMLDivElement | undefined = $state();
  let actualSize = $state(false);
  const returnFocusTo = document.activeElement as HTMLElement | null;

  function close() {
    onClose();
    returnFocusTo?.focus?.();
  }

  /** Tab-cycle within the open viewer. */
  function trapTab(e: KeyboardEvent) {
    if (!viewer) return;
    const focusable = viewer.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0] ?? viewer;
    const last = focusable[focusable.length - 1] ?? viewer;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === viewer)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  $effect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "Tab") {
        trapTab(e);
      }
    }
    window.addEventListener("keydown", onKey);
    (viewer?.querySelector<HTMLElement>("[data-viewer-close]") ?? viewer)?.focus();
    return () => window.removeEventListener("keydown", onKey);
  });

  function onBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={viewer}
  use:portal
  role="dialog"
  aria-modal="true"
  aria-label={alt.trim() || "Image"}
  tabindex="-1"
  data-image-lightbox
  class="image-viewer fixed inset-0 z-[10000] overflow-auto"
  onclick={onBackdropClick}
>
  <button
    type="button"
    class="fixed top-4 right-4 z-10 flex size-9 items-center justify-center rounded-md bg-popover
           text-foreground shadow-float ring-1 ring-foreground/10 transition-colors hover:bg-muted
           focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
    aria-label="Close"
    title="Close (Esc)"
    data-viewer-close
    data-lightbox-close
    onclick={close}
  >
    <X size={18} />
  </button>
  <div
    class="flex min-h-full w-full items-center justify-center {actualSize ? 'p-8' : 'h-full p-6'}"
    onclick={onBackdropClick}
  >
    <!-- The image toggles fit and actual size for the pointer; the keyboard has Close
         and Escape, and scrolls an actual-size image with the arrows. -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <img
      {src}
      {alt}
      data-lightbox-img
      draggable="false"
      class="block select-none {actualSize
        ? 'max-w-none cursor-zoom-out'
        : 'h-full w-full object-contain cursor-zoom-in'}"
      onclick={() => (actualSize = !actualSize)}
    />
  </div>
</div>

<style>
  .image-viewer {
    /* Solid: even 4% let white text through, readable enough to spoil a reveal. */
    background: var(--background-subtle);
  }
</style>
