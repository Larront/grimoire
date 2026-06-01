import { describe, it, expect, beforeEach } from "vitest";
import { paneDetailState } from "$lib/stores/pane-detail-state.svelte";

beforeEach(() => {
  paneDetailState.reset();
});

// ── Store unit tests ──────────────────────────────────────────────────────────

describe("paneDetailState — defaults", () => {
  it("returns null selection when nothing has been stored", () => {
    const sel = paneDetailState.getMapSelection("left", 5);
    expect(sel.pinId).toBeNull();
    expect(sel.annotationId).toBeNull();
  });
});

describe("paneDetailState — set and get", () => {
  it("stores and retrieves a pin selection", () => {
    paneDetailState.setMapSelection("left", 5, { pinId: 3, annotationId: null });
    const sel = paneDetailState.getMapSelection("left", 5);
    expect(sel.pinId).toBe(3);
    expect(sel.annotationId).toBeNull();
  });

  it("stores and retrieves an annotation selection", () => {
    paneDetailState.setMapSelection("right", 7, { pinId: null, annotationId: 42 });
    const sel = paneDetailState.getMapSelection("right", 7);
    expect(sel.pinId).toBeNull();
    expect(sel.annotationId).toBe(42);
  });

  it("overwrites a previous selection", () => {
    paneDetailState.setMapSelection("left", 5, { pinId: 3, annotationId: null });
    paneDetailState.setMapSelection("left", 5, { pinId: null, annotationId: null });
    const sel = paneDetailState.getMapSelection("left", 5);
    expect(sel.pinId).toBeNull();
  });
});

describe("paneDetailState — pane independence", () => {
  it("left and right panes hold independent selections for the same mapId", () => {
    paneDetailState.setMapSelection("left", 5, { pinId: 3, annotationId: null });
    paneDetailState.setMapSelection("right", 5, { pinId: 7, annotationId: null });

    expect(paneDetailState.getMapSelection("left", 5).pinId).toBe(3);
    expect(paneDetailState.getMapSelection("right", 5).pinId).toBe(7);
  });

  it("changing right pane selection does not affect left pane", () => {
    paneDetailState.setMapSelection("left", 5, { pinId: 3, annotationId: null });
    paneDetailState.setMapSelection("right", 5, { pinId: 99, annotationId: null });
    paneDetailState.setMapSelection("right", 5, { pinId: null, annotationId: null });

    expect(paneDetailState.getMapSelection("left", 5).pinId).toBe(3);
  });

  it("different mapIds do not share state", () => {
    paneDetailState.setMapSelection("left", 5, { pinId: 3, annotationId: null });
    const sel = paneDetailState.getMapSelection("left", 7);
    expect(sel.pinId).toBeNull();
  });
});

describe("paneDetailState — reset", () => {
  it("reset clears all stored selections", () => {
    paneDetailState.setMapSelection("left", 5, { pinId: 3, annotationId: null });
    paneDetailState.setMapSelection("right", 5, { pinId: 7, annotationId: null });
    paneDetailState.reset();
    expect(paneDetailState.getMapSelection("left", 5).pinId).toBeNull();
    expect(paneDetailState.getMapSelection("right", 5).pinId).toBeNull();
  });
});
