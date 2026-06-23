<script lang="ts">
  import { onMount, tick } from "svelte";
  import { api } from "$lib/api";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { convertFileSrc } from "@tauri-apps/api/core";
  import {
    BookOpen,
    LoaderCircle,
    ZoomIn,
    ZoomOut,
    Search,
    ChevronUp,
    ChevronDown,
    X,
    Link2,
    Plus,
  } from "@lucide/svelte";
  import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
  import type { PDFDocumentProxy, PDFDocumentLoadingTask } from "pdfjs-dist";
  import type { TextContent, TextItem } from "pdfjs-dist/types/src/display/api";
  import { buildPageIndex, findMatches, rangesForMatch, type ItemRange } from "$lib/pdf/pdf-find";
  import PdfPage from "./PdfPage.svelte";
  import ScenePicker from "./ScenePicker.svelte";
  import type { SceneLinkSelection } from "$lib/pdf/scene-link-anchor";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { scenes } from "$lib/stores/scenes.svelte";
  import { pdfSceneLinks } from "$lib/stores/pdf-scene-links.svelte";
  import type { PdfSceneLink } from "$lib/bindings.gen";

  interface Props {
    pdfPath: string;
    pdfTitle: string;
    pane: "left" | "right";
  }
  let { pdfPath, pdfTitle, pane }: Props = $props();

  // US-Letter fallback dimensions until page 1's true viewport is measured.
  const DEFAULT_WIDTH = 612;
  const DEFAULT_HEIGHT = 792;

  // Discrete zoom stops, in scale factor. 1.0 == 100% and is the initial state
  // (issue #100). Zoom in/out steps between neighbouring stops; reset returns to 1.
  const ZOOM_STEPS = [0.5, 0.67, 0.8, 1.0, 1.25, 1.5, 2.0, 3.0];

  type Status = "loading" | "ready" | "error";
  let status = $state<Status>("loading");
  let doc = $state<PDFDocumentProxy | null>(null);
  let numPages = $state(0);
  let baseWidth = $state(DEFAULT_WIDTH);
  let baseHeight = $state(DEFAULT_HEIGHT);

  let scale = $state(1.0);
  let currentPage = $state(1);
  let scrollEl = $state<HTMLDivElement>();

  // ── Find-in-document ──────────────────────────────────────────────────────
  let findOpen = $state(false);
  let query = $state("");
  let findInputEl = $state<HTMLInputElement | null>(null);
  // One entry per match, in document order; `ranges` are the per-item highlight
  // ranges on `page`. Built progressively as pages are indexed so the count
  // grows live and the first match can be navigated to immediately.
  let matches = $state<{ page: number; ranges: ItemRange[] }[]>([]);
  let activeMatch = $state(0);

  // Per-page text cache shared with PdfPage's text layer, so find indexing and
  // rendered spans agree on item order (highlight offsets line up).
  const textCache = new Map<number, Promise<TextContent>>();
  function getTextContent(n: number): Promise<TextContent> {
    let cached = textCache.get(n);
    if (!cached) {
      cached = doc!.getPage(n).then((p) => p.getTextContent());
      textCache.set(n, cached);
    }
    return cached;
  }

  // PdfPane is keyed by path in PaneContent, so pdfPath is stable for an
  // instance — load once on mount, tear the document down on unmount. The
  // path-resolution call uses api.silent.* because this pane owns its error UI.
  onMount(() => {
    let destroyed = false;
    let task: PDFDocumentLoadingTask | null = null;

    (async () => {
      try {
        const absolute = await api.silent.getPdfAbsolutePath(pdfPath);
        const url = convertFileSrc(absolute);
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        task = pdfjs.getDocument({ url });
        const loaded = await task.promise;
        if (destroyed) return;
        const firstPage = await loaded.getPage(1);
        const viewport = firstPage.getViewport({ scale: 1 });
        baseWidth = viewport.width;
        baseHeight = viewport.height;
        numPages = loaded.numPages;
        doc = loaded;
        status = "ready";
        // Load this PDF's Scene-links so underlines re-render on (re)open (#103).
        // Fire-and-forget: the store uses api.silent, which already logs.
        void pdfSceneLinks.load(pdfPath).catch(() => {});
      } catch (error) {
        if (destroyed) return;
        // Missing, corrupt, not-a-PDF, and password-protected all resolve to the
        // single unified "can't display" state (issue #99; no password entry).
        console.error("pdf load failed:", error);
        status = "error";
      }
    })();

    return () => {
      destroyed = true;
      task?.destroy();
    };
  });

  // ── Zoom ──────────────────────────────────────────────────────────────────
  function zoomIn() {
    const next = ZOOM_STEPS.find((s) => s > scale + 0.001);
    if (next !== undefined) setScale(next);
  }
  function zoomOut() {
    const prev = [...ZOOM_STEPS].reverse().find((s) => s < scale - 0.001);
    if (prev !== undefined) setScale(prev);
  }
  function resetZoom() {
    setScale(1.0);
  }
  // Keep the page the GM is reading anchored across a zoom change instead of
  // letting scrollTop drift as every page above grows or shrinks.
  function setScale(next: number) {
    const root = scrollEl;
    const anchor = currentPage;
    scale = next;
    if (!root) return;
    void tick().then(() => {
      const el = root.querySelector<HTMLElement>(`[data-page-number="${anchor}"]`);
      if (el) root.scrollTop = el.offsetTop - 8;
    });
  }

  // ── Page indicator + jump ───────────────────────────────────────────────────
  function updateCurrentPage() {
    const root = scrollEl;
    if (!root) return;
    const top = root.scrollTop + 8;
    let current = 1;
    for (const el of root.querySelectorAll<HTMLElement>("[data-page-number]")) {
      if (el.offsetTop <= top) current = Number(el.dataset.pageNumber);
      else break;
    }
    currentPage = current;
  }

  let jumpEditing = $state(false);
  let jumpValue = $state("");
  function beginJump() {
    jumpValue = String(currentPage);
    jumpEditing = true;
  }
  function commitJump() {
    const target = Math.min(Math.max(1, Number(jumpValue) || 1), numPages);
    jumpEditing = false;
    scrollToPage(target);
  }
  function scrollToPage(n: number) {
    const root = scrollEl;
    const el = root?.querySelector<HTMLElement>(`[data-page-number="${n}"]`);
    if (root && el) root.scrollTop = el.offsetTop - 8;
  }

  // ── Find ────────────────────────────────────────────────────────────────────
  // Highlight ranges grouped by page, recomputed when matches change.
  const highlightsByPage = $derived.by(() => {
    const map = new Map<number, ItemRange[]>();
    for (const m of matches) {
      const list = map.get(m.page) ?? [];
      list.push(...m.ranges);
      map.set(m.page, list);
    }
    return map;
  });
  const activeMatchEntry = $derived(matches[activeMatch] ?? null);
  const EMPTY: ItemRange[] = [];

  // Re-run the search whenever the query changes while find is open. `token`
  // supersedes any in-flight scan so a fast typist never sees stale results.
  let searchToken = 0;
  $effect(() => {
    const q = query;
    void findOpen;
    if (!doc || !findOpen) return;
    runSearch(q, ++searchToken);
  });

  async function runSearch(q: string, token: number) {
    matches = [];
    activeMatch = 0;
    if (!q) return;
    let jumped = false;
    const found: { page: number; ranges: ItemRange[] }[] = [];
    for (let p = 1; p <= numPages; p++) {
      const tc = await getTextContent(p);
      if (token !== searchToken) return; // superseded by a newer query
      const items = tc.items
        .filter((it): it is TextItem => "str" in it)
        .map((it) => it.str);
      const index = buildPageIndex(items);
      for (const match of findMatches(index, q)) {
        found.push({ page: p, ranges: rangesForMatch(index, match) });
      }
      if (found.length !== matches.length) matches = found.slice();
      if (!jumped && found.length) {
        jumped = true;
        gotoMatch(0);
      }
    }
  }

  function gotoMatch(i: number) {
    if (!matches.length) return;
    activeMatch = (i + matches.length) % matches.length;
    revealPage(matches[activeMatch].page);
  }

  // Bring a match's page within range only if it is largely offscreen — far
  // pages must scroll into view so they lazily render, but a match already on
  // screen is left for PdfPage's highlight effect to centre, avoiding a jump to
  // page top and back.
  function revealPage(n: number) {
    const root = scrollEl;
    const el = root?.querySelector<HTMLElement>(`[data-page-number="${n}"]`);
    if (!root || !el) return;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top > root.scrollTop + root.clientHeight || bottom < root.scrollTop) {
      root.scrollTop = top - 8;
    }
  }

  function openFind() {
    findOpen = true;
    void tick().then(() => {
      findInputEl?.focus();
      findInputEl?.select();
    });
  }
  function closeFind() {
    findOpen = false;
    query = "";
    matches = [];
    activeMatch = 0;
  }

  function onFindKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      gotoMatch(activeMatch + (e.shiftKey ? -1 : 1));
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeFind();
    }
  }

  // Ctrl/Cmd+F opens find — but only for the focused pane, so a split view with
  // a PDF in each pane routes the shortcut to the one the GM is working in.
  function onWindowKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
      if (status !== "ready" || tabs.focusedPane !== pane) return;
      e.preventDefault();
      openFind();
    }
  }

  // ── Scene-links ─────────────────────────────────────────────────────────────
  // The store holds every link for this path; a link whose Scene was deleted is
  // filtered out here so its underline vanishes the instant the Scene is gone
  // (the DB row is already cascade-removed — issue #103). Links are grouped by
  // page for the per-page overlay.
  const scenesById = $derived(new Map(scenes.scenes.map((s) => [s.id, s])));
  const visibleLinks = $derived(
    pdfSceneLinks.linksForPath(pdfPath).filter((l) => scenesById.has(l.scene_id)),
  );
  const linksByPage = $derived.by(() => {
    const map = new Map<number, PdfSceneLink[]>();
    for (const link of visibleLinks) {
      const list = map.get(link.page) ?? [];
      list.push(link);
      map.set(link.page, list);
    }
    return map;
  });
  const EMPTY_LINKS: PdfSceneLink[] = [];

  // A pending selection drives the "+ Link Scene" action bubble; opening the
  // picker freezes it (so clicking around the picker can't clear it).
  let pendingSelection = $state<SceneLinkSelection | null>(null);
  let pickerOpen = $state(false);
  let showLinkHint = $state(false);
  let hintTimer: ReturnType<typeof setTimeout> | null = null;

  function onSceneLinkSelect(selection: SceneLinkSelection) {
    pendingSelection = selection;
    pickerOpen = false;
  }

  // The persistent toolbar button: opens the picker if text is selected, else
  // teaches the gesture with a transient hint (CONTEXT: discoverable path).
  function onLinkSceneButton() {
    if (pendingSelection) {
      pickerOpen = true;
      showLinkHint = false;
    } else {
      showLinkHint = true;
      if (hintTimer) clearTimeout(hintTimer);
      hintTimer = setTimeout(() => (showLinkHint = false), 2600);
    }
  }

  async function linkScene(sceneId: number) {
    const sel = pendingSelection;
    if (!sel) return;
    pickerOpen = false;
    pendingSelection = null;
    window.getSelection()?.removeAllRanges();
    try {
      await pdfSceneLinks.create(pdfPath, sel.page, sel.start, sel.end, sel.quote, sceneId);
    } catch (error) {
      console.error("create scene-link failed:", error);
    }
  }

  async function removeSceneLink(linkId: number) {
    try {
      await pdfSceneLinks.remove(pdfPath, linkId);
    } catch (error) {
      console.error("remove scene-link failed:", error);
    }
  }

  // The action bubble/picker are viewport-anchored to the selection rect, so a
  // scroll detaches them — dismiss on scroll unless the picker is open.
  function dismissSelectionOnScroll() {
    if (!pickerOpen) {
      pendingSelection = null;
    }
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if status === "loading"}
  <div class="flex flex-1 items-center justify-center">
    <LoaderCircle class="size-5 animate-spin text-muted-foreground" />
  </div>
{:else if status === "error"}
  <div class="flex flex-1 items-center justify-center p-6">
    <div class="flex max-w-sm flex-col items-center text-center">
      <BookOpen class="size-10 text-muted-foreground/40" strokeWidth={1.5} />
      <p class="mt-4 text-sm font-medium text-foreground">Can't display this PDF</p>
      <p class="mt-1 text-xs text-muted-foreground/70">
        The file may be missing, corrupt, or password-protected.
      </p>
    </div>
  </div>
{:else if doc}
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- Viewer toolbar -->
    <div
      class="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-background px-2 text-xs"
    >
      <!-- Page indicator + jump -->
      {#if jumpEditing}
        <!-- svelte-ignore a11y_autofocus -->
        <Input
          class="h-6 w-12 px-1.5 text-center text-xs tabular-nums"
          type="text"
          inputmode="numeric"
          bind:value={jumpValue}
          onkeydown={(e: KeyboardEvent) => {
            if (e.key === "Enter") commitJump();
            else if (e.key === "Escape") jumpEditing = false;
          }}
          onblur={commitJump}
          aria-label="Jump to page"
          autofocus
        />
        <span class="text-muted-foreground">/ {numPages}</span>
      {:else}
        <Button
          variant="ghost"
          size="sm"
          class="tabular-nums text-muted-foreground"
          onclick={beginJump}
          aria-label="Current page, click to jump"
        >
          {currentPage} <span class="text-muted-foreground/60">/ {numPages}</span>
        </Button>
      {/if}

      <div class="flex-1"></div>

      <!-- Link Scene (discoverable path): opens the picker when text is selected,
           teaches the gesture otherwise. -->
      <div class="relative">
        <Button
          variant="ghost"
          size="sm"
          class="gap-1.5 text-muted-foreground"
          aria-label="Link a Scene to selected text"
          onclick={onLinkSceneButton}
        >
          <Link2 class="size-3.5" />
          Link Scene
        </Button>
        {#if showLinkHint}
          <div
            class="absolute right-0 top-full z-20 mt-1 w-max rounded-md border border-border bg-popover px-2 py-1 text-xs text-muted-foreground shadow-md"
            role="status"
          >
            Select text to link a Scene
          </div>
        {/if}
      </div>

      <div class="mx-1 h-4 w-px bg-border"></div>

      <!-- Find toggle -->
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Find in document"
        aria-pressed={findOpen}
        onclick={() => (findOpen ? closeFind() : openFind())}
      >
        <Search />
      </Button>

      <div class="mx-1 h-4 w-px bg-border"></div>

      <!-- Zoom -->
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Zoom out"
        disabled={scale <= ZOOM_STEPS[0] + 0.001}
        onclick={zoomOut}
      >
        <ZoomOut />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        class="min-w-12 tabular-nums text-muted-foreground"
        onclick={resetZoom}
        aria-label="Reset zoom to 100%"
      >
        {Math.round(scale * 100)}%
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Zoom in"
        disabled={scale >= ZOOM_STEPS[ZOOM_STEPS.length - 1] - 0.001}
        onclick={zoomIn}
      >
        <ZoomIn />
      </Button>
    </div>

    <!-- Scroll surface -->
    <div
      bind:this={scrollEl}
      onscroll={() => {
        updateCurrentPage();
        dismissSelectionOnScroll();
      }}
      data-pdf-scroll
      aria-label={`PDF: ${pdfTitle}`}
      class="relative min-h-0 flex-1 overflow-y-auto bg-muted/40"
    >
      <!-- Find bar floats over the page surface, top-right -->
      {#if findOpen}
        <div
          class="sticky top-0 z-10 ml-auto flex w-fit items-center gap-1 rounded-b-lg bg-background/95 p-1.5 shadow-md ring-1 ring-border backdrop-blur"
          style="margin-right: 1rem;"
        >
          <Input
            bind:ref={findInputEl}
            bind:value={query}
            onkeydown={onFindKeydown}
            type="text"
            placeholder="Find in document"
            aria-label="Find in document"
            class="h-7 w-48 text-xs"
          />
          <span class="min-w-12 text-right text-xs tabular-nums text-muted-foreground">
            {matches.length ? `${activeMatch + 1}/${matches.length}` : query ? "0/0" : ""}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Previous match"
            disabled={!matches.length}
            onclick={() => gotoMatch(activeMatch - 1)}
          >
            <ChevronUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Next match"
            disabled={!matches.length}
            onclick={() => gotoMatch(activeMatch + 1)}
          >
            <ChevronDown />
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label="Close find" onclick={closeFind}>
            <X />
          </Button>
        </div>
      {/if}

      <div class="flex flex-col items-center gap-4 px-4 py-6">
        {#each Array(numPages) as _, i (i)}
          <PdfPage
            {doc}
            pageNumber={i + 1}
            {scale}
            {baseWidth}
            {baseHeight}
            {getTextContent}
            highlightRanges={highlightsByPage.get(i + 1) ?? EMPTY}
            activeRanges={activeMatchEntry?.page === i + 1 ? activeMatchEntry.ranges : EMPTY}
            sceneLinks={linksByPage.get(i + 1) ?? EMPTY_LINKS}
            scenesList={scenes.scenes}
            {onSceneLinkSelect}
            onRemoveSceneLink={removeSceneLink}
          />
        {/each}
      </div>
    </div>

    <!-- Selection action bubble + Scene picker. Both are viewport-anchored to the
         selection rect (fixed), so they float over the scroll surface and are
         dismissed when the selection clears or the page scrolls. -->
    {#if pendingSelection && !pickerOpen}
      <div
        class="fixed z-30"
        style="left: {pendingSelection.rect.left}px; top: {Math.max(8, pendingSelection.rect.top - 40)}px;"
      >
        <Button
          variant="default"
          size="sm"
          class="gap-1.5 shadow-md"
          onclick={() => (pickerOpen = true)}
        >
          <Plus class="size-3.5" />
          Link Scene
        </Button>
      </div>
    {/if}

    {#if pendingSelection && pickerOpen}
      <div
        class="fixed z-30"
        style="left: {pendingSelection.rect.left}px; top: {Math.min(pendingSelection.rect.bottom + 6, (typeof window !== 'undefined' ? window.innerHeight : 800) - 280)}px;"
      >
        <ScenePicker onSelect={linkScene} />
      </div>
      <!-- Click-away closes the picker without linking. -->
      <button
        type="button"
        class="fixed inset-0 z-20 cursor-default"
        aria-label="Dismiss Scene picker"
        onclick={() => {
          pickerOpen = false;
          pendingSelection = null;
        }}
      ></button>
    {/if}
  </div>
{/if}
