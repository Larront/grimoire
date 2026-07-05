<script lang="ts">
  import { onMount } from "svelte";
  import type {
    PDFDocumentProxy,
    PDFPageProxy,
    RenderTask,
    TextLayer as TextLayerType,
  } from "pdfjs-dist";
  import type { TextContent } from "pdfjs-dist/types/src/display/api";
  import type { ItemRange } from "$lib/pdf/pdf-find";
  import {
    offsetsFromRange,
    quoteForOffsets,
    type SceneLinkSelection,
  } from "$lib/pdf/scene-link-anchor";
  import PdfSceneLinkLayer from "./PdfSceneLinkLayer.svelte";
  import type { PdfSceneLink } from "$lib/bindings.gen";
  import type { SceneWithCount } from "$lib/types/ledger";

  interface Props {
    doc: PDFDocumentProxy;
    pageNumber: number;
    // Render scale: 1.0 == 100% (one PDF unit → one CSS px). Reactive — changing
    // it re-rasterizes the canvas and re-lays-out the text layer.
    scale: number;
    // Page-1 dimensions at scale 1, used to reserve scroll height before this
    // page's own viewport is measured. Most PDFs are uniform, so the correction
    // is invisible.
    baseWidth: number;
    baseHeight: number;
    // Shared per-page text-content cache (owned by PdfPane) so find indexing and
    // the text layer consume the identical item order — highlight offsets line up.
    getTextContent: (pageNumber: number) => Promise<TextContent>;
    // All find-match ranges that fall on this page, plus the subset belonging to
    // the currently-active match (drawn brighter and scrolled into view).
    highlightRanges: ItemRange[];
    activeRanges: ItemRange[];
    // Scene-links (issue #103): this page's links, the Scene list they tint
    // against, and callbacks for creating (on selection) and removing them.
    sceneLinks: PdfSceneLink[];
    scenesList: SceneWithCount[];
    onSceneLinkSelect: (selection: SceneLinkSelection) => void;
    onChangeSceneLink: (linkId: number, sceneId: number) => void;
    onNewSceneForLink: (linkId: number) => void;
    onRemoveSceneLink: (linkId: number) => void;
  }
  let {
    doc,
    pageNumber,
    scale,
    baseWidth,
    baseHeight,
    getTextContent,
    highlightRanges,
    activeRanges,
    sceneLinks,
    scenesList,
    onSceneLinkSelect,
    onChangeSceneLink,
    onNewSceneForLink,
    onRemoveSceneLink,
  }: Props = $props();

  let page = $state<PDFPageProxy | null>(null);
  // Own page-1-independent base dimensions, measured once the page loads.
  let ownBaseWidth = $state<number | null>(null);
  let ownBaseHeight = $state<number | null>(null);
  const displayWidth = $derived((ownBaseWidth ?? baseWidth) * scale);
  const displayHeight = $derived((ownBaseHeight ?? baseHeight) * scale);

  let canvasEl = $state<HTMLCanvasElement>();
  let textLayerEl = $state<HTMLDivElement>();
  let wrapperEl = $state<HTMLDivElement>();

  let onscreen = $state(false);
  // Bumped after a text layer finishes rendering so the highlight effect re-runs
  // against fresh divs.
  let textReady = $state(0);

  // `renderGen` is the cancellation token: every (re)render claims a new
  // generation and bails the moment a newer one supersedes it, so a scale change
  // or scroll-away mid-render never paints stale output onto the canvas.
  let renderGen = 0;
  let renderTask: RenderTask | null = null;
  let textLayer: TextLayerType | null = null;
  // $state so the scene-link overlay re-measures when the layer (re)renders or is
  // cleared — these arrays are passed to PdfSceneLinkLayer.
  let textDivs = $state<HTMLElement[]>([]);
  let itemStrings = $state<string[]>([]);
  let TextLayerCtor: typeof TextLayerType | null = null;

  // Lazy render: only rasterize a page while it is near the viewport, and drop
  // its backing store once it scrolls far away — so a 600-page rulebook never
  // holds hundreds of canvases or text layers in memory at once (issue #99).
  onMount(() => {
    let cancelled = false;

    (async () => {
      const { TextLayer } = await import("pdfjs-dist");
      if (cancelled) return;
      TextLayerCtor = TextLayer;
      const p = await doc.getPage(pageNumber);
      if (cancelled) return;
      const vp = p.getViewport({ scale: 1 });
      ownBaseWidth = vp.width;
      ownBaseHeight = vp.height;
      page = p;
      if (onscreen) void render();
    })();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          onscreen = entry.isIntersecting;
          if (entry.isIntersecting) void render();
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
      textLayer?.cancel();
      textLayer = null;
      page?.cleanup();
    };
  });

  // Re-render whenever the page becomes visible or the zoom scale changes.
  $effect(() => {
    const visible = onscreen;
    void scale; // track
    if (visible && page) void render();
    else if (!visible) clear();
  });

  // Re-apply highlights when matches change (the text layer may already be up).
  $effect(() => {
    void highlightRanges;
    void activeRanges;
    void textReady;
    if (textDivs.length) applyHighlights();
  });

  async function render() {
    if (!page || !canvasEl || !TextLayerCtor) return;
    const gen = ++renderGen;
    renderTask?.cancel();
    renderTask = null;

    const dpr = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale });
    canvasEl.width = Math.floor(viewport.width * dpr);
    canvasEl.height = Math.floor(viewport.height * dpr);
    const task = page.render({
      canvas: canvasEl,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
    });
    renderTask = task;
    try {
      await task.promise;
    } catch {
      // Cancelled (scrolled away / rescaled mid-render) or failed — leave the
      // generation guard to suppress a stale follow-up.
      if (renderTask === task) renderTask = null;
      return;
    }
    if (gen !== renderGen) return;
    renderTask = null;
    await renderTextLayer(gen);
  }

  async function renderTextLayer(gen: number) {
    if (!textLayerEl || !page || !TextLayerCtor) return;
    textLayer?.cancel();
    textLayerEl.replaceChildren();
    textDivs = [];
    itemStrings = [];

    const textContent = await getTextContent(pageNumber);
    if (gen !== renderGen) return;
    const layer = new TextLayerCtor({
      textContentSource: textContent,
      container: textLayerEl,
      viewport: page.getViewport({ scale }),
    });
    textLayer = layer;
    await layer.render();
    if (gen !== renderGen) {
      layer.cancel();
      return;
    }
    textDivs = layer.textDivs as HTMLElement[];
    itemStrings = layer.textContentItemsStr.slice();
    textReady++;
  }

  function clear() {
    renderGen++;
    renderTask?.cancel();
    renderTask = null;
    textLayer?.cancel();
    textLayer = null;
    textDivs = [];
    itemStrings = [];
    if (textLayerEl) textLayerEl.replaceChildren();
    if (canvasEl) {
      // Releasing the backing store frees GPU/CPU memory for offscreen pages.
      canvasEl.width = 0;
      canvasEl.height = 0;
    }
  }

  function activeKey(r: ItemRange): string {
    return `${r.itemIndex}:${r.from}:${r.to}`;
  }

  // Wrap the matched characters of each affected text-layer span in highlight
  // <mark>s. The spans themselves are transparent (the canvas shows the glyphs),
  // so the mark's background reads as a highlight over the rendered page.
  function applyHighlights() {
    if (!textDivs.length) return;
    const activeSet = new Set(activeRanges.map(activeKey));
    const byItem = new Map<number, { from: number; to: number; active: boolean }[]>();
    for (const r of highlightRanges) {
      const list = byItem.get(r.itemIndex) ?? [];
      list.push({ from: r.from, to: r.to, active: activeSet.has(activeKey(r)) });
      byItem.set(r.itemIndex, list);
    }

    for (let i = 0; i < textDivs.length; i++) {
      const div = textDivs[i];
      const ranges = byItem.get(i);
      if (!ranges) {
        if (div.dataset.highlighted) {
          div.textContent = itemStrings[i] ?? "";
          delete div.dataset.highlighted;
        }
        continue;
      }
      rebuildDiv(div, itemStrings[i] ?? "", ranges);
      div.dataset.highlighted = "1";
    }

    // Pull the active match into view once it has been drawn.
    const active = textLayerEl?.querySelector(".pdf-match-active");
    active?.scrollIntoView({ block: "center" });
  }

  function rebuildDiv(
    div: HTMLElement,
    original: string,
    ranges: { from: number; to: number; active: boolean }[],
  ) {
    ranges.sort((a, b) => a.from - b.from);
    const frag = document.createDocumentFragment();
    let cursor = 0;
    for (const r of ranges) {
      if (r.from > cursor) frag.append(document.createTextNode(original.slice(cursor, r.from)));
      const mark = document.createElement("span");
      mark.className = r.active ? "pdf-match pdf-match-active" : "pdf-match";
      mark.textContent = original.slice(r.from, r.to);
      frag.append(mark);
      cursor = r.to;
    }
    if (cursor < original.length) frag.append(document.createTextNode(original.slice(cursor)));
    div.replaceChildren(frag);
  }

  // Report a fresh text selection within this page's text layer as a candidate
  // Scene-link range. The offset math lives in the anchoring module; here we just
  // gate to selections that actually land on this page and pass along the rect
  // the action bubble anchors to.
  function handleTextMouseUp() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!textLayerEl || !textLayerEl.contains(range.commonAncestorContainer)) return;
    const offsets = offsetsFromRange(textDivs, range);
    if (!offsets) return;
    const rect = range.getBoundingClientRect();
    onSceneLinkSelect({
      page: pageNumber,
      start: offsets.start,
      end: offsets.end,
      quote: quoteForOffsets(itemStrings, offsets.start, offsets.end),
      rect: { left: rect.left, top: rect.top, bottom: rect.bottom, right: rect.right },
    });
  }
</script>

<div
  bind:this={wrapperEl}
  data-page-number={pageNumber}
  class="relative mx-auto bg-white shadow-sm ring-1 ring-black/5"
  style="--total-scale-factor: {scale}; --scale-round-x: 1px; --scale-round-y: 1px; width: {displayWidth}px; height: {displayHeight}px;"
>
  <canvas bind:this={canvasEl} class="block h-full w-full"></canvas>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div bind:this={textLayerEl} class="textLayer" onmouseup={handleTextMouseUp}></div>
  <PdfSceneLinkLayer
    links={sceneLinks}
    {scenesList}
    {textDivs}
    {itemStrings}
    wrapperEl={wrapperEl}
    {scale}
    {textReady}
    onChangeScene={onChangeSceneLink}
    onNewScene={onNewSceneForLink}
    onRemove={onRemoveSceneLink}
  />
</div>

<style>
  /* Minimal port of pdf.js's text-layer rules (pdfjs-dist/web/pdf_viewer.css).
     The spans are positioned by TextLayer via inline custom properties; these
     rules give them the layout and transform those properties drive. We render
     a visible ::selection (pdf.js ships it transparent) so copy works with a
     real highlight, and our own match colours instead of the pdf.js defaults. */
  .textLayer {
    position: absolute;
    inset: 0;
    overflow: clip;
    opacity: 1;
    line-height: 1;
    text-align: initial;
    forced-color-adjust: none;
    transform-origin: 0 0;
    z-index: 1;
    --min-font-size: 1;
    --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
    --min-font-size-inv: calc(1 / var(--min-font-size));
  }

  .textLayer :global(span),
  .textLayer :global(br) {
    color: transparent;
    position: absolute;
    white-space: pre;
    cursor: text;
    transform-origin: 0% 0%;
    user-select: text;
  }

  .textLayer :global(> :not(.markedContent)),
  .textLayer :global(.markedContent span:not(.markedContent)) {
    z-index: 1;
    --font-height: 0;
    --scale-x: 1;
    --rotate: 0deg;
    font-size: calc(var(--text-scale-factor) * var(--font-height));
    transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
  }

  .textLayer :global(.markedContent) {
    display: contents;
  }

  .textLayer :global(::selection) {
    background: var(--primary-subtle, rgb(138 46 38 / 0.16));
  }

  /* Find-match highlight. Sits inside a transparent text span, so its tint
     reads over the rasterized glyphs beneath. The active match is brighter. */
  .textLayer :global(.pdf-match) {
    color: transparent;
    border-radius: 2px;
    background: color-mix(in srgb, var(--primary) 35%, transparent);
  }

  .textLayer :global(.pdf-match-active) {
    background: color-mix(in srgb, var(--primary) 70%, transparent);
  }
</style>
