<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "$lib/api";
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { BookOpen, LoaderCircle } from "@lucide/svelte";
  import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
  import type { PDFDocumentProxy, PDFDocumentLoadingTask } from "pdfjs-dist";
  import PdfPage from "./PdfPage.svelte";

  interface Props {
    pdfPath: string;
    pdfTitle: string;
  }
  let { pdfPath, pdfTitle }: Props = $props();

  // 100% zoom: PDF.js scale 1.0 maps one PDF unit (1/72") to one CSS px (ADR-0012).
  const SCALE = 1.0;
  // US-Letter fallback dimensions until page 1's true viewport is measured.
  const DEFAULT_WIDTH = 612;
  const DEFAULT_HEIGHT = 792;

  type Status = "loading" | "ready" | "error";
  let status = $state<Status>("loading");
  let doc = $state<PDFDocumentProxy | null>(null);
  let numPages = $state(0);
  let defaultWidth = $state(DEFAULT_WIDTH);
  let defaultHeight = $state(DEFAULT_HEIGHT);

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
        const viewport = firstPage.getViewport({ scale: SCALE });
        defaultWidth = viewport.width;
        defaultHeight = viewport.height;
        numPages = loaded.numPages;
        doc = loaded;
        status = "ready";
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
      // destroy() lives on the loading task; it aborts the worker and frees the
      // document, covering both the still-loading and loaded cases.
      task?.destroy();
    };
  });
</script>

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
  <div
    data-pdf-scroll
    aria-label={`PDF: ${pdfTitle}`}
    class="h-[calc(100svh_-_var(--tab-bar-h)_-_1px)] overflow-y-auto bg-muted/40"
  >
    <div class="flex flex-col items-center gap-4 px-4 py-6">
      {#each Array(numPages) as _, i (i)}
        <PdfPage {doc} pageNumber={i + 1} scale={SCALE} {defaultWidth} {defaultHeight} />
      {/each}
    </div>
  </div>
{/if}
