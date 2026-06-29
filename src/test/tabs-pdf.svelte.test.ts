import { describe, it, expect, beforeEach, vi } from "vitest";
import { flushSync } from "svelte";

// The real tabs store wires persistence to localStorage whenever a ledger is
// open, so mock the ledger as open with a stable path; jsdom supplies
// localStorage. maps is imported by the store for imageless-map pruning.
vi.mock("../lib/stores/ledger.svelte", () => ({
  ledger: {
    get isOpen() {
      return true;
    },
    get path() {
      return "/ledger";
    },
  },
}));

vi.mock("../lib/stores/maps.svelte", () => ({
  maps: { pruneIfImageless: vi.fn() },
}));

import { tabs } from "../lib/stores/tabs.svelte";
import { LocalStorageTabPersistence } from "../lib/stores/tab-persistence";

const STORAGE_KEY = "grimoire:tabs:/ledger";

beforeEach(() => {
  localStorage.clear();
  tabs.closeAll("left");
  tabs.closeAll("right");
  flushSync();
});

describe("tabs store — pdf tabs are path-keyed (ADR-0011)", () => {
  it("matches an open pdf tab by path, not by id, when switching", () => {
    // Two distinct PDFs both carry id 0 — only the path distinguishes them.
    tabs.openTabForceNew({ type: "pdf", id: 0, title: "A", pdfPath: "a.pdf" });
    tabs.openTabForceNew({ type: "pdf", id: 0, title: "B", pdfPath: "b.pdf" });
    expect(tabs.left.tabs.length).toBe(2);

    // Re-opening b.pdf must switch to index 1. If matching keyed on id, both
    // id-0 tabs would collide on index 0 and this would fail.
    tabs.openTab({ type: "pdf", id: 0, title: "B", pdfPath: "b.pdf" });
    expect(tabs.left.tabs.length).toBe(2);
    expect(tabs.left.activeIndex).toBe(1);

    tabs.openTab({ type: "pdf", id: 0, title: "A", pdfPath: "a.pdf" });
    expect(tabs.left.tabs.length).toBe(2);
    expect(tabs.left.activeIndex).toBe(0);
  });

  it("does not duplicate a pdf tab when the same path is opened again", () => {
    tabs.openTab({ type: "pdf", id: 0, title: "Rulebook", pdfPath: "rulebook.pdf" });
    tabs.openTab({ type: "pdf", id: 0, title: "Rulebook", pdfPath: "rulebook.pdf" });
    const pdfTabs = tabs.left.tabs.filter((t) => t.type === "pdf");
    expect(pdfTabs.length).toBe(1);
  });

  it("persists a pdf tab's path to localStorage", () => {
    tabs.openTab({ type: "pdf", id: 0, title: "Rulebook", pdfPath: "rulebook.pdf" });
    flushSync();
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const state = JSON.parse(raw!);
    expect(state.left.tabs[0]).toMatchObject({
      type: "pdf",
      title: "Rulebook",
      pdfPath: "rulebook.pdf",
    });
  });

  it("does not attach a pdfPath to non-pdf tabs", () => {
    tabs.openTab({ type: "note", id: 7, title: "Note" });
    flushSync();
    const state = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(state.left.tabs[0]).not.toHaveProperty("pdfPath");
  });

  it("round-trips a pdf tab through the persistence layer", () => {
    const persistence = new LocalStorageTabPersistence("/other");
    persistence.save({
      left: {
        tabs: [{ type: "pdf", id: 0, title: "R", pdfPath: "r.pdf" }],
        activeIndex: 0,
      },
      right: null,
      focusedPane: "left",
    });
    const loaded = persistence.load();
    expect(loaded?.left.tabs[0]).toMatchObject({ type: "pdf", pdfPath: "r.pdf" });
  });
});

describe("tabs store — pdf files-tree operations (issue #101)", () => {
  it("opens a pdf in the right pane, creating a split when there isn't one", () => {
    tabs.openTab({ type: "pdf", id: 0, title: "Note-side", pdfPath: "a.pdf" });
    expect(tabs.right).toBeNull();

    // Open-in-right-pane targets the right pane explicitly.
    tabs.openTab({ type: "pdf", id: 0, title: "Rulebook", pdfPath: "rulebook.pdf" }, "right");

    expect(tabs.right).not.toBeNull();
    expect(tabs.right!.tabs[tabs.right!.activeIndex]).toMatchObject({
      type: "pdf",
      pdfPath: "rulebook.pdf",
    });
    expect(tabs.focusedPane).toBe("right");
    // The left pane's pdf is left in place.
    expect(tabs.left.tabs[0]).toMatchObject({ pdfPath: "a.pdf" });
  });

  it("closeTabsByPdfPath closes a pdf tab open in either pane, leaving others", () => {
    tabs.openTab({ type: "pdf", id: 0, title: "Keep", pdfPath: "keep.pdf" });
    tabs.openTabForceNew({ type: "pdf", id: 0, title: "Doomed", pdfPath: "doomed.pdf" });
    // Force the same path into the right pane too (openTab would dedupe to the
    // existing left tab) so we exercise closing across both panes.
    tabs.openTabForceNew({ type: "pdf", id: 0, title: "Doomed", pdfPath: "doomed.pdf" }, "right");
    flushSync();
    expect(tabs.left.tabs.some((t) => t.pdfPath === "doomed.pdf")).toBe(true);
    expect(tabs.right!.tabs.some((t) => t.pdfPath === "doomed.pdf")).toBe(true);

    tabs.closeTabsByPdfPath("doomed.pdf");

    // Gone from both panes; the unrelated pdf survives.
    expect(tabs.left.tabs.some((t) => t.pdfPath === "doomed.pdf")).toBe(false);
    expect(tabs.left.tabs.some((t) => t.pdfPath === "keep.pdf")).toBe(true);
    expect(tabs.right?.tabs.some((t) => t.pdfPath === "doomed.pdf") ?? false).toBe(false);
  });

  it("closeTabsByPdfPath is a no-op when the path isn't open", () => {
    tabs.openTab({ type: "pdf", id: 0, title: "Keep", pdfPath: "keep.pdf" });
    tabs.closeTabsByPdfPath("never-opened.pdf");
    expect(tabs.left.tabs.length).toBe(1);
  });

  it("updatePdfTab re-keys an open pdf tab's path and title on rename", () => {
    tabs.openTab({ type: "pdf", id: 0, title: "old-name", pdfPath: "old-name.pdf" });

    tabs.updatePdfTab("old-name.pdf", "new-name", "new-name.pdf");

    expect(tabs.left.tabs[0]).toMatchObject({
      type: "pdf",
      title: "new-name",
      pdfPath: "new-name.pdf",
    });
    // Re-opening at the new path matches the existing tab rather than duplicating.
    tabs.openTab({ type: "pdf", id: 0, title: "new-name", pdfPath: "new-name.pdf" });
    expect(tabs.left.tabs.filter((t) => t.type === "pdf").length).toBe(1);
  });

  it("updatePdfTab leaves non-matching pdf tabs untouched", () => {
    tabs.openTab({ type: "pdf", id: 0, title: "a", pdfPath: "a.pdf" });
    tabs.openTabForceNew({ type: "pdf", id: 0, title: "b", pdfPath: "b.pdf" });

    tabs.updatePdfTab("a.pdf", "renamed", "renamed.pdf");

    expect(tabs.left.tabs.find((t) => t.pdfPath === "b.pdf")).toMatchObject({ title: "b" });
  });
});
