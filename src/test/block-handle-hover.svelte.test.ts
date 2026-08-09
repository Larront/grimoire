// The grip surviving the reach for it (#190).
//
// The one behaviour here that is not bookkeeping: the editor reports the pointer leaving
// the prose, and moving onto the grip *is* leaving the prose, so the naive hide takes the
// grip away in the gap between that leave and the grip's own enter. The gap is a real
// ordering between two real events, and the only way to assert it is to drive the clock
// between them — which is what these do.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createBlockHandleHover, HANDLE_HIDE_MS } from "$lib/editor/block-handle-hover.svelte";
import type { BlockTarget } from "$lib/editor/block-handle";

// The hover holds a target and never looks inside it; these stand for two blocks.
const paragraph = {
  pos: 4,
  node: { type: { name: "paragraph" } },
} as unknown as BlockTarget;
const statblock = {
  pos: 20,
  node: { type: { name: "statblockBlock" } },
} as unknown as BlockTarget;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the grip's hover", () => {
  it("shows the block the pointer is over", () => {
    const hover = createBlockHandleHover();
    hover.point(paragraph);

    expect(hover.target).toBe(paragraph);
  });

  it("follows the pointer from block to block without blinking", () => {
    const hover = createBlockHandleHover();
    hover.point(paragraph);
    hover.point(statblock);

    expect(hover.target).toBe(statblock);
  });

  it("survives the pointer moving onto the grip itself", () => {
    // The whole point. The leave arrives first and the enter a moment later, and between
    // them a GM's hand is already on the way to a grip that must still be there.
    const hover = createBlockHandleHover();
    hover.point(paragraph);
    hover.point(null);
    hover.hold(true);
    vi.advanceTimersByTime(HANDLE_HIDE_MS * 5);

    expect(hover.target).toBe(paragraph);
  });

  it("hides when the pointer leaves the prose for anywhere else", () => {
    const hover = createBlockHandleHover();
    hover.point(paragraph);
    hover.point(null);

    // Still there while the grip could yet claim it...
    expect(hover.target).toBe(paragraph);
    vi.advanceTimersByTime(HANDLE_HIDE_MS);
    expect(hover.target).toBeNull();
  });

  it("hides once the pointer leaves the grip too", () => {
    const hover = createBlockHandleHover();
    hover.point(paragraph);
    hover.point(null);
    hover.hold(true);
    hover.hold(false);
    vi.advanceTimersByTime(HANDLE_HIDE_MS);

    expect(hover.target).toBeNull();
  });

  it("stays when the pointer goes back to the prose before the hide lands", () => {
    const hover = createBlockHandleHover();
    hover.point(paragraph);
    hover.point(null);
    vi.advanceTimersByTime(HANDLE_HIDE_MS - 20);
    hover.point(statblock);
    vi.advanceTimersByTime(HANDLE_HIDE_MS);

    expect(hover.target).toBe(statblock);
  });

  it("follows a block the GM moved, and cancels the hide that was pending", () => {
    // A keyboard reorder: the grip has focus, so it is held, and the block it holds has a
    // new position the moment the move lands.
    const hover = createBlockHandleHover();
    hover.point(paragraph);
    hover.point(null);
    hover.hold(true);
    hover.retarget(statblock);
    vi.advanceTimersByTime(HANDLE_HIDE_MS * 5);

    expect(hover.target).toBe(statblock);
  });

  it("drops a target whose positions are stale — a scroll, or an edit", () => {
    const hover = createBlockHandleHover();
    hover.point(paragraph);
    hover.invalidate();

    expect(hover.target).toBeNull();
  });

  it("keeps a held grip through an edit, because the edit is its own move", () => {
    const hover = createBlockHandleHover();
    hover.point(paragraph);
    hover.hold(true);
    hover.invalidate();

    expect(hover.target).toBe(paragraph);
  });

  it("stays up when the keyboard raised it, with nothing holding it but the request", () => {
    // `Mod-Shift-h` has no pointer behind it, so there is nothing to keep the grip alive
    // the way a hovering hand does — the grab has to hold it itself.
    const hover = createBlockHandleHover();
    hover.grab(paragraph);
    vi.advanceTimersByTime(HANDLE_HIDE_MS * 5);

    expect(hover.target).toBe(paragraph);
    expect(hover.grabbed).toBe(true);
  });

  it("stops asking for focus once the grip has taken it", () => {
    const hover = createBlockHandleHover();
    hover.grab(paragraph);
    hover.grabHandled();

    expect(hover.grabbed).toBe(false);
    expect(hover.target).toBe(paragraph);
  });

  it("comes down at once when a gesture lands, not after the hide delay", () => {
    // A drop rewrites the document, so every position the handle holds now describes a
    // note that no longer exists. Waiting even 120ms leaves a grip on screen pointing at
    // whichever block has moved into that spot.
    const hover = createBlockHandleHover();
    hover.point(paragraph);
    hover.hold(true);
    hover.release();

    expect(hover.target).toBeNull();
  });

  it("does not come back up after a release, held or not", () => {
    const hover = createBlockHandleHover();
    hover.grab(paragraph);
    hover.release();
    vi.advanceTimersByTime(HANDLE_HIDE_MS * 5);

    expect(hover.target).toBeNull();
    expect(hover.grabbed).toBe(false);
  });

  it("cancels a pending hide on teardown, so nothing fires into a destroyed editor", () => {
    const hover = createBlockHandleHover();
    hover.point(paragraph);
    hover.point(null);
    hover.destroy();

    expect(vi.getTimerCount()).toBe(0);
  });
});
