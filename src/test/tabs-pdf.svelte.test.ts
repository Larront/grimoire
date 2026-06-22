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
