// Scene-links for the open PDFs, keyed by ledger-relative path (ADR-0011 — a PDF
// is path-addressed, so its one piece of canonical state hangs off the path).
// A split view can hold two PdfPanes on different paths, so links are stored per
// path rather than as a single active set.
//
// The store holds the raw rows; a pane filters them against the live Scene list
// so a Scene-link whose Scene was just deleted vanishes immediately — the DB row
// is cascade-removed (FK `ON DELETE CASCADE`), and re-loading the path returns
// the already-pruned set.

import { api } from "$lib/api";
import { ledger } from "./ledger.svelte";
import type { PdfSceneLink } from "$lib/bindings.gen";
import { SvelteMap } from "svelte/reactivity";

function createPdfSceneLinksStore() {
  const byPath = new SvelteMap<string, PdfSceneLink[]>();

  /** Fetch (or re-fetch) a PDF's links into the store. */
  async function load(pdfPath: string): Promise<void> {
    const links = await api.silent.getPdfSceneLinks(pdfPath);
    byPath.set(pdfPath, links);
  }

  /** The links currently loaded for a path (empty until `load`). */
  function linksForPath(pdfPath: string): PdfSceneLink[] {
    return byPath.get(pdfPath) ?? [];
  }

  /** Create a link, appending the persisted row to the path's set. */
  async function create(
    pdfPath: string,
    page: number,
    startOffset: number,
    endOffset: number,
    quote: string,
    sceneId: number,
  ): Promise<PdfSceneLink> {
    const link = await api.silent.createPdfSceneLink(
      pdfPath,
      page,
      startOffset,
      endOffset,
      quote,
      sceneId,
    );
    byPath.set(pdfPath, [...(byPath.get(pdfPath) ?? []), link]);
    return link;
  }

  /** Remove a link by id from a path's set. */
  async function remove(pdfPath: string, id: number): Promise<void> {
    await api.silent.deletePdfSceneLink(id);
    byPath.set(
      pdfPath,
      (byPath.get(pdfPath) ?? []).filter((l) => l.id !== id),
    );
  }

  $effect.root(() => {
    $effect(() => {
      if (!ledger.isOpen) byPath.clear();
    });
  });

  return { load, linksForPath, create, remove };
}

export const pdfSceneLinks = createPdfSceneLinksStore();
