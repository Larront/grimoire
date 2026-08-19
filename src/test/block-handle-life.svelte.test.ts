// The grip surviving the reach for it (#190), and the clock that makes that true.
//
// The one behaviour here that is not bookkeeping: the editor reports the pointer leaving
// the prose, and moving onto the grip *is* leaving the prose, so the naive hide takes the
// grip away in the gap between that leave and the grip's own enter. The gap is a real
// ordering between two real events, and the only way to assert it is to drive the clock
// between them — which is what these do.
//
// Only the half of the life-cycle that needs no document is here: what the pointer, the
// focus and the clock do to a target. The menu, the writes behind it and the orderings
// they are wrapped in are claims about a note, and they are asserted against a real one
// through the real grip in `block-handle-menu-ui.test.ts` — which is the pair this module
// exists to be the interface of.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createBlockHandleLife,
  HANDLE_HIDE_MS,
} from "$lib/editor/block-handle-life.svelte";
import type { BlockTarget } from "$lib/editor/block-handle";

// The life-cycle holds a target and never looks inside it; these stand for two blocks.
const paragraph = {
  pos: 4,
  node: { type: { name: "paragraph" } },
} as unknown as BlockTarget;
const statblock = {
  pos: 20,
  node: { type: { name: "statblockBlock" } },
} as unknown as BlockTarget;

/**
 * The life-cycle with no editor behind it.
 *
 * Every method that reaches the document answers "nothing to do" without one, which is
 * the same answer it gives between a note closing and the grip unmounting — so this is
 * the real degenerate case rather than a stub standing in for one.
 */
const handle = () => createBlockHandleLife(() => null);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the grip's hover", () => {
  it("shows the block the pointer is over", () => {
    const life = handle();
    life.point(paragraph);

    expect(life.target).toBe(paragraph);
  });

  it("follows the pointer from block to block without blinking", () => {
    const life = handle();
    life.point(paragraph);
    life.point(statblock);

    expect(life.target).toBe(statblock);
  });

  it("holds the same answer still while the pointer crosses one block", () => {
    // Identity, and it is a performance claim rather than bookkeeping: the grip re-places
    // itself whenever this changes, and placing measures three times — the block's box,
    // its first line's rects, the column's computed style. `blockTargetAt` builds a fresh
    // object per answer, so a `point` that assigned unconditionally would force that
    // reflow on every one of the sixty-odd `mousemove`s a second a GM generates crossing
    // a single paragraph.
    const life = handle();
    life.point(paragraph);
    const first = life.target;
    life.point({ ...paragraph } as BlockTarget);
    life.point({ ...paragraph } as BlockTarget);

    expect(life.target).toBe(first);
  });

  it("takes the new answer when the block at that position was rewritten", () => {
    // The other half, and why the node is compared and not only the position: an edit
    // rebuilds the block into a new object, and the grip must re-measure a card that has
    // just grown a row rather than sit where the old one ended.
    const life = handle();
    life.point(paragraph);
    const edited = {
      pos: paragraph.pos,
      node: { type: { name: "paragraph" } },
    } as BlockTarget;
    life.point(edited);

    expect(life.target).toBe(edited);
  });

  it("survives the pointer moving onto the grip itself", () => {
    // The whole point. The leave arrives first and the enter a moment later, and between
    // them a GM's hand is already on the way to a grip that must still be there.
    const life = handle();
    life.point(paragraph);
    life.point(null);
    life.hover(true);
    vi.advanceTimersByTime(HANDLE_HIDE_MS * 5);

    expect(life.target).toBe(paragraph);
  });

  it("hides when the pointer leaves the prose for anywhere else", () => {
    const life = handle();
    life.point(paragraph);
    life.point(null);

    // Still there while the grip could yet claim it...
    expect(life.target).toBe(paragraph);
    vi.advanceTimersByTime(HANDLE_HIDE_MS);
    expect(life.target).toBeNull();
  });

  it("hides once the pointer leaves the grip too", () => {
    const life = handle();
    life.point(paragraph);
    life.point(null);
    life.hover(true);
    life.hover(false);
    vi.advanceTimersByTime(HANDLE_HIDE_MS);

    expect(life.target).toBeNull();
  });

  it("stays when the pointer goes back to the prose before the hide lands", () => {
    const life = handle();
    life.point(paragraph);
    life.point(null);
    vi.advanceTimersByTime(HANDLE_HIDE_MS - 20);
    life.point(statblock);
    vi.advanceTimersByTime(HANDLE_HIDE_MS);

    expect(life.target).toBe(statblock);
  });

  it("drops a target whose positions are stale — a scroll, or an edit", () => {
    const life = handle();
    life.point(paragraph);
    life.invalidate();

    expect(life.target).toBeNull();
  });

  it("keeps a held grip through an edit, because the edit is its own move", () => {
    const life = handle();
    life.point(paragraph);
    life.hover(true);
    life.invalidate();

    expect(life.target).toBe(paragraph);
  });
});

// ─── Two holds, not one ───────────────────────────────────────────────────────
//
// The pointer and the focus overlap, which is why they are tracked apart: `Mod-Shift-h`
// raises the grip under wherever the pointer happens to be resting and focuses it, so the
// GM's first nudge of the mouse raises `mouseleave` on a grip that still holds the
// keyboard. One shared boolean would report that as "nothing is holding this", drop the
// handle, and strand focus on nothing mid-gesture.

describe("what is holding the grip up", () => {
  it("keeps a focused grip when the pointer leaves it", () => {
    const life = handle();
    life.point(paragraph);
    life.hover(true);
    life.focus(true);
    life.hover(false);
    vi.advanceTimersByTime(HANDLE_HIDE_MS * 5);

    expect(life.target).toBe(paragraph);
  });

  it("keeps a hovered grip when the focus leaves it", () => {
    const life = handle();
    life.point(paragraph);
    life.hover(true);
    life.focus(true);
    life.focus(false);
    vi.advanceTimersByTime(HANDLE_HIDE_MS * 5);

    expect(life.target).toBe(paragraph);
  });

  it("lets go once neither the pointer nor the focus is on it", () => {
    const life = handle();
    life.point(paragraph);
    life.hover(true);
    life.focus(true);
    life.focus(false);
    life.hover(false);
    vi.advanceTimersByTime(HANDLE_HIDE_MS);

    expect(life.target).toBeNull();
  });

  it("exempts a focused grip from an edit's invalidation, as a hovered one is", () => {
    const life = handle();
    life.point(paragraph);
    life.focus(true);
    life.invalidate();

    expect(life.target).toBe(paragraph);
  });
});

// ─── The keyboard's way in ────────────────────────────────────────────────────

describe("a grip raised from the keyboard", () => {
  it("stays up with nothing holding it but the request", () => {
    // `Mod-Shift-h` has no pointer behind it, so there is nothing to keep the grip alive
    // the way a hovering hand does — the grab has to hold it itself, until the grip it
    // asked for exists and takes the focus.
    const life = handle();
    life.grab(paragraph);
    vi.advanceTimersByTime(HANDLE_HIDE_MS * 5);

    expect(life.target).toBe(paragraph);
    expect(life.grabbed).toBe(true);
  });

  it("stops asking for focus once the grip has taken it", () => {
    const life = handle();
    life.grab(paragraph);
    life.focus(true);
    life.grabHandled();

    expect(life.grabbed).toBe(false);
    expect(life.target).toBe(paragraph);
  });

  it("stays up when the focus it asked for never lands", () => {
    // `el.focus()` raises a focus event, and a window that is not the foreground one can
    // withhold that until it comes back. The grab is answered either way — the grip has
    // been drawn and has asked — so a hide scheduled on that answer would take the grip
    // out from under a GM whose keyboard raised it, with no gesture left to bring it back.
    const life = handle();
    life.grab(paragraph);
    life.grabHandled();
    vi.advanceTimersByTime(HANDLE_HIDE_MS * 5);

    expect(life.target).toBe(paragraph);
  });

  it("is still up on the clock after the grab is answered, held by the focus it asked for", () => {
    const life = handle();
    life.grab(paragraph);
    life.focus(true);
    life.grabHandled();
    vi.advanceTimersByTime(HANDLE_HIDE_MS * 5);

    expect(life.target).toBe(paragraph);
  });
});

// ─── Endings ──────────────────────────────────────────────────────────────────

describe("the end of a gesture", () => {
  it("comes down at once when one lands, not after the hide delay", () => {
    // A drop rewrites the document, so every position the handle holds now describes a
    // note that no longer exists. Waiting even 120ms leaves a grip on screen pointing at
    // whichever block has moved into that spot.
    const life = handle();
    life.point(paragraph);
    life.hover(true);
    life.release();

    expect(life.target).toBeNull();
  });

  it("does not come back up after a release, held or not", () => {
    const life = handle();
    life.grab(paragraph);
    life.release();
    vi.advanceTimersByTime(HANDLE_HIDE_MS * 5);

    expect(life.target).toBeNull();
    expect(life.grabbed).toBe(false);
  });

  it("takes the handle down when a drag ends, however it ended", () => {
    // Escape, a drop on the desktop, a drop that landed: all of them leave the handle
    // holding positions from before the drop.
    const life = handle();
    life.point(paragraph);
    life.hover(true);
    life.endDrag();

    expect(life.target).toBeNull();
  });

  it("lets the next hover raise the grip again", () => {
    // Every latch is let go by an ending. One left set would ignore the pointer for the
    // rest of the session — the grip frozen off, with nothing on screen saying why.
    const life = handle();
    life.grab(paragraph);
    life.focus(true);
    life.release();
    life.point(statblock);

    expect(life.target).toBe(statblock);
  });
});

describe("the life-cycle's teardown", () => {
  it("cancels a pending hide, so nothing fires into a destroyed editor", () => {
    const life = handle();
    life.point(paragraph);
    life.point(null);
    life.destroy();

    expect(vi.getTimerCount()).toBe(0);
  });
});
