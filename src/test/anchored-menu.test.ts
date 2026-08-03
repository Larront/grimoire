// Where a caret-anchored dropdown goes (#175 review).
//
// The bug this file pins: all three suggestion menus were drawn at the caret's bottom
// with nothing asking whether that was inside the window, so a `/` typed on the last
// visible line opened a menu the GM could not see. The geometry is a pure function so it
// can be asserted without a layout engine — jsdom performs none, which is exactly why
// the decision was extracted from the components in the first place.
import { describe, it, expect } from "vitest";
import { menuPlacement } from "$lib/utils/anchored-menu";

const viewport = { width: 1200, height: 800 };
/** A menu of a few items, and the caret it hangs off. */
const box = { width: 240, height: 180 };
const caret = (top: number) => ({ x: 400, y: top + 20, anchorTop: top });

describe("a menu with room below the caret", () => {
  it("opens below it, at the caret's left", () => {
    const { left, top, flipped } = menuPlacement(caret(100), box, viewport);
    expect(flipped).toBe(false);
    expect(left).toBe(400);
    expect(top).toBe(120);
  });
});

describe("a menu with no room below the caret", () => {
  it("flips above it", () => {
    // A caret 60px from the bottom, and a 180px menu: below is off screen.
    const { top, flipped } = menuPlacement(caret(740), box, viewport);
    expect(flipped).toBe(true);
    // Clear of the caret's own line, not merely of its baseline: `anchorTop` is what
    // makes the flipped menu sit above the text rather than over it.
    expect(top).toBe(740 - 180 - 8);
    expect(top + box.height).toBeLessThanOrEqual(740);
  });

  it("stays below when there is no room either way, showing its first item", () => {
    // A tall menu in a short window. Flipping would clip the top of the list — the item
    // the GM is likeliest to want — where overflowing the bottom clips the last.
    const tall = { width: 240, height: 700 };
    const { top, flipped } = menuPlacement(caret(300), tall, { width: 1200, height: 400 });
    expect(flipped).toBe(false);
    expect(top).toBeGreaterThanOrEqual(8);
  });

  it("measures the menu rather than assuming a height", () => {
    // The same caret, two list lengths: a two-item menu still fits below where a
    // ten-item one does not. This is why placement waits for the drawn element.
    const short = menuPlacement(caret(700), { width: 240, height: 60 }, viewport);
    const long = menuPlacement(caret(700), { width: 240, height: 300 }, viewport);
    expect(short.flipped).toBe(false);
    expect(long.flipped).toBe(true);
  });
});

describe("horizontal clamping", () => {
  it("pulls a menu back inside the right edge", () => {
    const { left } = menuPlacement({ x: 1100, y: 200, anchorTop: 180 }, box, viewport);
    expect(left).toBe(1200 - 240 - 8);
  });

  it("never places a menu at a negative left, even if it is wider than the window", () => {
    const { left } = menuPlacement(
      { x: 4, y: 200, anchorTop: 180 },
      { width: 1400, height: 180 },
      viewport,
    );
    expect(left).toBe(8);
  });
});

describe("a caller that has not been taught the caret's top", () => {
  it("still flips, landing the menu's bottom at the anchor", () => {
    // `anchorTop` is optional so an un-updated caller degrades to overlapping the line
    // by the caret's height rather than opening off screen.
    const { top, flipped } = menuPlacement({ x: 400, y: 760 }, box, viewport);
    expect(flipped).toBe(true);
    expect(top).toBe(760 - 180 - 8);
  });
});
