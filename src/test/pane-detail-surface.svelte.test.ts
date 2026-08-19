import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  DOCK_THRESHOLD,
  PaneDetailSurface,
  paneSurface,
  resetPaneSurfaces,
} from "$lib/details/pane-detail-surface.svelte";
import { overlay } from "$lib/stores/overlay.svelte";

// One stub for both queries the surface reads, told apart by the query text:
// the ≤1023px sheet breakpoint and prefers-reduced-motion.
function stubMatchMedia({ mobile = false, reducedMotion = false } = {}) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? reducedMotion : mobile,
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

/** A ResizeObserver that reports one width the moment it is pointed at an element. */
function makeResizeObserver(width: number) {
  return class MockResizeObserver {
    #cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.#cb = cb;
    }
    observe(target: Element) {
      this.#cb(
        [
          {
            contentRect: { width, height: 800 } as DOMRectReadOnly,
            target,
          } as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const NOTE_POLICY = { toggleable: true, alwaysFloat: false };
const MAP_POLICY = { toggleable: false, alwaysFloat: true };

const originalResizeObserver = globalThis.ResizeObserver;

/** A claimed surface that has already measured a pane of the given width. */
function measuredAt(width: number, policy = NOTE_POLICY) {
  globalThis.ResizeObserver = makeResizeObserver(width);
  const surface = new PaneDetailSurface("left");
  surface.claim(policy);
  surface.measure(document.createElement("div"));
  return surface;
}

beforeEach(() => {
  overlay.active = null;
  stubMatchMedia();
});

afterEach(() => {
  overlay.active = null;
  globalThis.ResizeObserver = originalResizeObserver;
  resetPaneSurfaces();
  stubMatchMedia();
});

// ── Presentation mode ─────────────────────────────────────────────────────────

describe("PaneDetailSurface — mode", () => {
  it("docks at exactly the threshold", () => {
    expect(measuredAt(DOCK_THRESHOLD).mode).toBe("docked");
  });

  it("docks above the threshold", () => {
    expect(measuredAt(1200).mode).toBe("docked");
  });

  it("floats one pixel below the threshold", () => {
    expect(measuredAt(DOCK_THRESHOLD - 1).mode).toBe("floating");
  });

  it("the threshold is 820px of pane width", () => {
    expect(DOCK_THRESHOLD).toBe(820);
  });

  it("is a sheet on mobile however wide the pane measures", () => {
    stubMatchMedia({ mobile: true });
    expect(measuredAt(1280).mode).toBe("sheet");
  });

  it("floats regardless of width when the pane's policy is always-float", () => {
    expect(measuredAt(1280, MAP_POLICY).mode).toBe("floating");
  });

  it("floats rather than sheeting on mobile when the policy is always-float", () => {
    stubMatchMedia({ mobile: true });
    expect(measuredAt(400, MAP_POLICY).mode).toBe("floating");
  });
});

// ── Readiness (the flash guard) ───────────────────────────────────────────────

describe("PaneDetailSurface — readiness", () => {
  it("is not ready before the pane has been measured", () => {
    const surface = new PaneDetailSurface("left");
    surface.claim(NOTE_POLICY);
    expect(surface.ready).toBe(false);
  });

  it("is ready once a width has arrived", () => {
    expect(measuredAt(600).ready).toBe(true);
  });

  it("is ready without measuring at all when the policy is always-float", () => {
    const surface = new PaneDetailSurface("left");
    surface.claim(MAP_POLICY);
    expect(surface.ready).toBe(true);
  });

  it("forgets the measurement when the claim is released", () => {
    const surface = measuredAt(1000);
    expect(surface.mode).toBe("docked");
    // The content leaves. A stale wide reading must not dock a rail into a pane
    // that has since been split, nor stand in for a pane that never measures.
    const release = surface.claim(NOTE_POLICY);
    release();
    expect(surface.ready).toBe(false);
    expect(surface.mode).toBe("floating");
  });
});

// ── Which layer the floating chrome sits on ───────────────────────────────────

describe("PaneDetailSurface — floating over a stacked host", () => {
  it("a note pane has no stacked host, so its float stays under the app's modals", () => {
    expect(measuredAt(600).overStackedHost).toBe(false);
  });

  it("an always-float pane does — a map's Leaflet panes have to be cleared", () => {
    expect(measuredAt(600, MAP_POLICY).overStackedHost).toBe(true);
  });
});

// ── Measurement ───────────────────────────────────────────────────────────────

describe("PaneDetailSurface — measurement", () => {
  it("re-measuring a wider pane flips the mode from floating to docked", () => {
    const surface = measuredAt(600);
    expect(surface.mode).toBe("floating");
    globalThis.ResizeObserver = makeResizeObserver(1000);
    surface.measure(document.createElement("div"));
    expect(surface.mode).toBe("docked");
  });

  it("measure hands back a teardown that disconnects the observer", () => {
    const disconnect = vi.fn();
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect = disconnect;
    } as unknown as typeof ResizeObserver;
    const surface = new PaneDetailSurface("left");
    surface.measure(document.createElement("div"))();
    expect(disconnect).toHaveBeenCalled();
  });
});

// ── Policy claim ──────────────────────────────────────────────────────────────

describe("PaneDetailSurface — what the pane's content claims", () => {
  it("offers no toggle until something claims the surface", () => {
    expect(new PaneDetailSurface("left").toggleable).toBe(false);
  });

  it("offers a toggle once a toggleable surface is claimed", () => {
    const surface = new PaneDetailSurface("left");
    surface.claim(NOTE_POLICY);
    expect(surface.toggleable).toBe(true);
  });

  it("offers no toggle for a selection-driven surface", () => {
    const surface = new PaneDetailSurface("left");
    surface.claim(MAP_POLICY);
    expect(surface.toggleable).toBe(false);
  });

  it("releasing the claim withdraws the toggle", () => {
    const surface = new PaneDetailSurface("left");
    const release = surface.claim(NOTE_POLICY);
    release();
    expect(surface.toggleable).toBe(false);
  });

  it("an outgoing pane's late release does not withdraw the incoming pane's claim", () => {
    const surface = new PaneDetailSurface("left");
    const releaseOld = surface.claim(MAP_POLICY);
    surface.claim(NOTE_POLICY);
    releaseOld();
    expect(surface.toggleable).toBe(true);
  });
});

// ── Visibility ────────────────────────────────────────────────────────────────

describe("PaneDetailSurface — visibility", () => {
  it("desktop visibility is the pane's own latch", () => {
    const surface = measuredAt(1000);
    expect(surface.visible).toBe(false);
    surface.toggle();
    expect(surface.visible).toBe(true);
  });

  it("mobile visibility is the overlay token, not the desktop latch", () => {
    stubMatchMedia({ mobile: true });
    const surface = measuredAt(400);
    surface.open = true;
    expect(surface.visible).toBe(false);
    surface.toggle();
    expect(surface.visible).toBe(true);
    expect(overlay.active).toBe("right-rail:left");
  });

  it("each pane's sheet takes one press after the other pane opened its own (#200)", () => {
    stubMatchMedia({ mobile: true });
    const left = new PaneDetailSurface("left");
    const right = new PaneDetailSurface("right");

    left.toggle();
    expect(left.openMobile).toBe(true);
    expect(right.openMobile).toBe(false);

    right.toggle();
    expect(right.openMobile).toBe(true);
    expect(left.openMobile).toBe(false);

    left.toggle();
    expect(left.openMobile).toBe(true);
    expect(right.openMobile).toBe(false);
  });

  it("releasing a pane's sheet leaves the other pane's token alone", () => {
    stubMatchMedia({ mobile: true });
    const left = new PaneDetailSurface("left");
    const right = new PaneDetailSurface("right");

    right.setOpenMobile(true);
    left.setOpenMobile(false);

    expect(right.openMobile).toBe(true);
  });

  it("the desktop latch is untouched by the overlay", () => {
    const surface = measuredAt(1000);
    surface.toggle();
    expect(surface.open).toBe(true);
    expect(overlay.active).toBeNull();
  });
});

// ── Motion ────────────────────────────────────────────────────────────────────

describe("PaneDetailSurface — float transition", () => {
  it("flies in from the right", () => {
    expect(measuredAt(600).transition.x).toBeGreaterThan(0);
  });

  it("animates when reduced motion is off", () => {
    expect(measuredAt(600).transition.duration).toBeGreaterThan(0);
  });

  it("snaps when reduced motion is on", () => {
    stubMatchMedia({ reducedMotion: true });
    expect(measuredAt(600).transition.duration).toBe(0);
  });

  it("snaps for an always-float surface too — the map panels obey it as well", () => {
    stubMatchMedia({ reducedMotion: true });
    expect(measuredAt(600, MAP_POLICY).transition.duration).toBe(0);
  });
});

// ── One surface per pane slot ─────────────────────────────────────────────────

describe("paneSurface — one surface per pane slot", () => {
  it("hands the same surface back for a pane", () => {
    expect(paneSurface("left")).toBe(paneSurface("left"));
  });

  it("holds a distinct surface per pane", () => {
    expect(paneSurface("left")).not.toBe(paneSurface("right"));
  });

  it("holds a distinct overlay token per pane", () => {
    stubMatchMedia({ mobile: true });
    paneSurface("left").setOpenMobile(true);
    const leftToken = overlay.active;
    paneSurface("right").setOpenMobile(true);
    expect(overlay.active).not.toBe(leftToken);
  });

  it("outlives the pane's content, so a rail left open reopens on the way back", () => {
    const surface = paneSurface("left");
    const release = surface.claim(NOTE_POLICY);
    surface.open = true;
    release();
    surface.claim(NOTE_POLICY);
    expect(surface.open).toBe(true);
  });

  it("reset clears the latch and the claim", () => {
    const surface = paneSurface("left");
    surface.claim(NOTE_POLICY);
    surface.open = true;
    resetPaneSurfaces();
    expect(surface.open).toBe(false);
    expect(surface.toggleable).toBe(false);
  });
});
