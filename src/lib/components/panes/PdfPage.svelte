<script lang="ts">
  import { onMount } from "svelte";
  import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";

  interface Props {
    doc: PDFDocumentProxy;
    pageNumber: number;
    scale: number;
    // Page-1 dimensions, used to reserve scroll height before this page's own
    // viewport is known. Most PDFs are uniform, so the correction is invisible.
    defaultWidth: number;
    defaultHeight: number;
  }
  let { doc, pageNumber, scale, defaultWidth, defaultHeight }: Props = $props();

  // Until this page's own viewport is measured, fall back to the page-1 guess
  // so scroll height is reserved up front.
  let measuredWidth = $state<number | null>(null);
  let measuredHeight = $state<number | null>(null);
  const width = $derived(measuredWidth ?? defaultWidth);
  const height = $derived(measuredHeight ?? defaultHeight);
  let canvasEl = $state<HTMLCanvasElement>();
  let wrapperEl = $state<HTMLDivElement>();

  let page: PDFPageProxy | null = null;
  let renderTask: RenderTask | null = null;
  let rendered = false;
  let onscreen = false;

  // Lazy render: only rasterize a page while it is near the viewport, and drop
  // its backing store once it scrolls far away — so a 600-page rulebook never
  // holds 600 canvases in memory at once (issue #99: stay responsive).
  onMount(() => {
    let cancelled = false;

    doc.getPage(pageNumber).then((p) => {
      if (cancelled) return;
      page = p;
      const vp = p.getViewport({ scale });
      measuredWidth = vp.width;
      measuredHeight = vp.height;
      if (onscreen) draw();
    });

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          onscreen = entry.isIntersecting;
          if (entry.isIntersecting) draw();
          else clear();
        }
      },
      { rootMargin: "150% 0px" },
    );
    if (wrapperEl) observer.observe(wrapperEl);

    return () => {
      cancelled = true;
      observer.disconnect();
      renderTask?.cancel();
      renderTask = null;
      page?.cleanup();
    };
  });

  function draw() {
    // `renderTask` is the in-flight mutex and `rendered` the done flag: bail if
    // a render is already running or the canvas already holds this page. This
    // stops a scroll-away-then-back from starting two render() calls on the same
    // canvas (PDF.js rejects concurrent renders on one canvas).
    if (!page || !canvasEl || renderTask || rendered) return;
    const dpr = window.devicePixelRatio || 1;
    const vp = page.getViewport({ scale });
    canvasEl.width = Math.floor(vp.width * dpr);
    canvasEl.height = Math.floor(vp.height * dpr);
    const task = page.render({
      canvas: canvasEl,
      viewport: vp,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
    });
    renderTask = task;
    task.promise.then(
      () => {
        if (renderTask === task) {
          rendered = true;
          renderTask = null;
        }
      },
      () => {
        // Cancelled (scrolled away mid-render) or failed — allow a later retry.
        if (renderTask === task) renderTask = null;
      },
    );
  }

  function clear() {
    renderTask?.cancel();
    renderTask = null;
    rendered = false;
    if (canvasEl) {
      // Releasing the backing store frees GPU/CPU memory for offscreen pages.
      canvasEl.width = 0;
      canvasEl.height = 0;
    }
  }
</script>

<div
  bind:this={wrapperEl}
  class="relative mx-auto bg-white shadow-sm ring-1 ring-black/5"
  style="width: {width}px; height: {height}px;"
>
  <canvas bind:this={canvasEl} class="block h-full w-full"></canvas>
</div>
