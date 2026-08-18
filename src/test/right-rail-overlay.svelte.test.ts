import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RightRailState } from "$lib/stores/right-rail.svelte";
import { overlay } from "$lib/stores/overlay.svelte";

// IsMobile(1024) reads matchMedia; a matching query is the ≤1023px window where
// each pane's Details Pane is a Sheet rather than a docked rail.
function stubMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

beforeEach(() => {
  overlay.active = null;
  stubMatchMedia(true);
});

afterEach(() => {
  overlay.active = null;
  stubMatchMedia(false);
});

describe("RightRailState — one overlay token per pane (#200)", () => {
  it("each pane's sheet toggle takes one press after the other pane opened its own", () => {
    const dispose = $effect.root(() => {
      const left = new RightRailState("left");
      const right = new RightRailState("right");

      left.toggle();
      expect(left.openMobile).toBe(true);
      expect(right.openMobile).toBe(false);

      // The right pane takes the overlay; the left sheet closes.
      right.toggle();
      expect(right.openMobile).toBe(true);
      expect(left.openMobile).toBe(false);

      // One press — not two — reopens the left sheet.
      left.toggle();
      expect(left.openMobile).toBe(true);
      expect(right.openMobile).toBe(false);
    });
    dispose();
  });

  it("holds a distinct overlay token per pane", () => {
    const dispose = $effect.root(() => {
      const left = new RightRailState("left");
      const right = new RightRailState("right");

      left.setOpenMobile(true);
      const leftToken = overlay.active;
      right.setOpenMobile(true);
      const rightToken = overlay.active;

      expect(leftToken).not.toBe(rightToken);
      expect(leftToken).toBeTruthy();
      expect(rightToken).toBeTruthy();
    });
    dispose();
  });

  it("releasing a pane's sheet leaves the other pane's token alone", () => {
    const dispose = $effect.root(() => {
      const left = new RightRailState("left");
      const right = new RightRailState("right");

      right.setOpenMobile(true);
      left.setOpenMobile(false);

      expect(right.openMobile).toBe(true);
    });
    dispose();
  });

  it("desktop toggle still flips the docked rail, untouched by the overlay", () => {
    stubMatchMedia(false);
    const dispose = $effect.root(() => {
      const left = new RightRailState("left");
      expect(left.open).toBe(false);
      left.toggle();
      expect(left.open).toBe(true);
      expect(overlay.active).toBeNull();
    });
    dispose();
  });
});
