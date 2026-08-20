import { render, fireEvent, cleanup, act } from "@testing-library/svelte";
import { describe, it, expect, vi, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import AppShell from "../lib/components/AppShell.svelte";
import { tabs } from "../lib/stores/tabs.svelte";
import { overlay } from "../lib/stores/overlay.svelte";
import { resetPaneSurfaces } from "../lib/details/pane-detail-surface.svelte";

// The dock/float *decision* is `PaneDetailSurface`'s and is tested against that
// interface in pane-detail-surface.svelte.test.ts. What is left here is the
// wiring: that a pane rendered at a given width puts its Details Pane in the
// chrome the surface chose.

const defaultResizeObserver = globalThis.ResizeObserver;

afterEach(async () => {
  cleanup();
  overlay.active = null;
  resetPaneSurfaces();
  globalThis.ResizeObserver = defaultResizeObserver;
  tabs.closeAll("right");
  tabs.closeAll("left");
  vi.mocked(invoke).mockResolvedValue(null);
});

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

    const dockedRail = container.querySelector('[data-slot="right-rail"][data-mobile="false"]');
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

    // Docked aside should NOT be present (the surface is floating)
    const dockedRail = container.querySelector('[data-slot="right-rail"][data-mobile="false"]');
    expect(dockedRail).toBeNull();

    // Floating panel should be present
    const floatPanel = container.querySelector('[data-float="true"]');
    expect(floatPanel).toBeTruthy();

    // …and below the app's dialogs and sheets, which are all `fixed z-50`
    // portalled to <body>. Nothing between this float and <body> establishes a
    // stacking context, so a higher layer here paints over a modal's scrim.
    expect(floatPanel!.className).toContain("z-50");
    expect(floatPanel!.className).not.toContain("z-1000");
  });

  it("docked aside is present but closed when rail is toggled off (width ≥ 820)", async () => {
    globalThis.ResizeObserver = makeResizeObserver(1000);
    tabs.openTab({ type: "note", id: 1, title: "My Note" });
    const { container } = render(AppShell);
    await act(() => {});

    const dockedRail = container.querySelector('[data-slot="right-rail"][data-mobile="false"]');
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
