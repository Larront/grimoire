import { render, fireEvent, cleanup, act } from "@testing-library/svelte";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { DOCK_THRESHOLD, getDockMode, floatTransition } from "../lib/utils/dock-threshold";
import AppShell from "../lib/components/AppShell.svelte";
import { tabs } from "../lib/stores/tabs.svelte";
import { overlay } from "../lib/stores/overlay.svelte";

afterEach(async () => {
  cleanup();
  overlay.active = null;
  tabs.closeAll("right");
  tabs.closeAll("left");
  vi.mocked(invoke).mockResolvedValue(null);
});

// ── Pure threshold logic ──────────────────────────────────────────────────────

describe("getDockMode threshold", () => {
  it("returns docked at exactly the threshold", () => {
    expect(getDockMode(DOCK_THRESHOLD)).toBe("docked");
  });

  it("returns docked above the threshold", () => {
    expect(getDockMode(1200)).toBe("docked");
    expect(getDockMode(DOCK_THRESHOLD + 1)).toBe("docked");
  });

  it("returns floating just below the threshold", () => {
    expect(getDockMode(DOCK_THRESHOLD - 1)).toBe("floating");
  });

  it("returns floating at zero", () => {
    expect(getDockMode(0)).toBe("floating");
  });

  it("DOCK_THRESHOLD is 820", () => {
    expect(DOCK_THRESHOLD).toBe(820);
  });
});

// ── Reduced-motion snap ───────────────────────────────────────────────────────

describe("floatTransition reduced-motion", () => {
  it("has positive duration when reduced-motion is off", () => {
    expect(floatTransition(false).duration).toBeGreaterThan(0);
  });

  it("duration is 0 when reduced-motion is on (snaps)", () => {
    expect(floatTransition(true).duration).toBe(0);
  });

  it("always uses x offset for fly direction", () => {
    expect(floatTransition(false).x).toBeGreaterThan(0);
    expect(floatTransition(true).x).toBeGreaterThan(0);
  });
});

// ── Width-based dock/float in NotePane ───────────────────────────────────────

function makeResizeObserver(width: number) {
  return class MockResizeObserver {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe(target: Element) {
      this.cb(
        [
          {
            contentRect: { width, height: 800 } as DOMRectReadOnly,
            target,
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          },
        ],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  };
}

describe("NotePane dock/float presentation based on pane width", () => {
  it("renders docked aside when pane width ≥ 820px", async () => {
    globalThis.ResizeObserver = makeResizeObserver(900);
    tabs.openTab({ type: "note", id: 1, title: "My Note" });
    const { container, getByTestId } = render(AppShell);
    await act(() => {});

    // Toggle rail open
    await fireEvent.click(getByTestId("left-rail-trigger"));

    const dockedRail = container.querySelector(
      '[data-slot="right-rail"][data-mobile="false"]',
    );
    expect(dockedRail).toBeTruthy();
    expect(dockedRail!.getAttribute("data-state")).toBe("open");

    // Floating panel should NOT be present
    const floatPanel = container.querySelector("[data-float]");
    expect(floatPanel).toBeNull();
  });

  it("renders floating panel when pane width < 820px", async () => {
    globalThis.ResizeObserver = makeResizeObserver(600);
    tabs.openTab({ type: "note", id: 1, title: "My Note" });
    const { container, getByTestId } = render(AppShell);
    await act(() => {});

    // Toggle rail open
    await fireEvent.click(getByTestId("left-rail-trigger"));
    await act(() => {});

    // Docked aside should NOT be present (isDocked=false)
    const dockedRail = container.querySelector(
      '[data-slot="right-rail"][data-mobile="false"]',
    );
    expect(dockedRail).toBeNull();

    // Floating panel should be present
    const floatPanel = container.querySelector('[data-float="true"]');
    expect(floatPanel).toBeTruthy();
  });

  it("docked aside is present but closed when rail is toggled off (width ≥ 820)", async () => {
    globalThis.ResizeObserver = makeResizeObserver(1000);
    tabs.openTab({ type: "note", id: 1, title: "My Note" });
    const { container } = render(AppShell);
    await act(() => {});

    const dockedRail = container.querySelector(
      '[data-slot="right-rail"][data-mobile="false"]',
    );
    expect(dockedRail).toBeTruthy();
    expect(dockedRail!.getAttribute("data-state")).toBe("closed");
  });

  it("floating panel is absent when rail is closed (width < 820)", async () => {
    globalThis.ResizeObserver = makeResizeObserver(600);
    tabs.openTab({ type: "note", id: 1, title: "My Note" });
    const { container } = render(AppShell);
    await act(() => {});

    // Rail is closed by default — floating panel should not appear
    const floatPanel = container.querySelector('[data-float="true"]');
    expect(floatPanel).toBeNull();
  });
});
