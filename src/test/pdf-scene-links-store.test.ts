import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PdfSceneLink } from "../lib/bindings.gen";

// The store talks to the backend through api.silent.* and clears itself when the
// ledger closes. Mock both: the api so we control the persisted rows, the ledger
// so the store's $effect.root has a stable `isOpen` to read.
const createPdfSceneLink = vi.fn();
const updatePdfSceneLink = vi.fn();
const deletePdfSceneLink = vi.fn();
const getPdfSceneLinks = vi.fn();

vi.mock("../lib/api", () => ({
  api: {
    silent: {
      createPdfSceneLink: (...a: unknown[]) => createPdfSceneLink(...a),
      updatePdfSceneLink: (...a: unknown[]) => updatePdfSceneLink(...a),
      deletePdfSceneLink: (...a: unknown[]) => deletePdfSceneLink(...a),
      getPdfSceneLinks: (...a: unknown[]) => getPdfSceneLinks(...a),
    },
  },
}));

vi.mock("../lib/stores/ledger.svelte", () => ({
  ledger: { get isOpen() { return true; } },
}));

import { pdfSceneLinks } from "../lib/stores/pdf-scene-links.svelte";

function link(id: number, sceneId: number): PdfSceneLink {
  return {
    id,
    pdf_path: "rulebook.pdf",
    page: 1,
    start_offset: 0,
    end_offset: 5,
    quote: "Hello",
    scene_id: sceneId,
    created_at: "2026-06-25",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("pdfSceneLinks.update — re-link wiring", () => {
  it("calls updatePdfSceneLink with (id, sceneId) and swaps the row in the path's set", async () => {
    // Seed the path with one link tied to Scene 1.
    createPdfSceneLink.mockResolvedValueOnce(link(10, 1));
    await pdfSceneLinks.create("rulebook.pdf", 1, 0, 5, "Hello", 1);
    expect(pdfSceneLinks.linksForPath("rulebook.pdf")[0].scene_id).toBe(1);

    // Re-link it to Scene 2.
    updatePdfSceneLink.mockResolvedValueOnce(link(10, 2));
    const updated = await pdfSceneLinks.update("rulebook.pdf", 10, 2);

    expect(updatePdfSceneLink).toHaveBeenCalledWith(10, 2);
    expect(updated.scene_id).toBe(2);
    const rows = pdfSceneLinks.linksForPath("rulebook.pdf");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(10);
    expect(rows[0].scene_id).toBe(2);
  });

  it("leaves other links on the path untouched when one is re-linked", async () => {
    createPdfSceneLink.mockResolvedValueOnce(link(20, 1));
    createPdfSceneLink.mockResolvedValueOnce(link(21, 3));
    await pdfSceneLinks.create("rulebook.pdf", 1, 0, 5, "Hello", 1);
    await pdfSceneLinks.create("rulebook.pdf", 2, 0, 5, "Hello", 3);

    updatePdfSceneLink.mockResolvedValueOnce(link(20, 9));
    await pdfSceneLinks.update("rulebook.pdf", 20, 9);

    const byId = new Map(pdfSceneLinks.linksForPath("rulebook.pdf").map((l) => [l.id, l.scene_id]));
    expect(byId.get(20)).toBe(9);
    expect(byId.get(21)).toBe(3);
  });
});
