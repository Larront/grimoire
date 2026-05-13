import { render, fireEvent, cleanup } from "@testing-library/svelte";
import { describe, it, expect, vi, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import AppShell from "../lib/components/AppShell.svelte";
import { overlay } from "../lib/stores/overlay.svelte";

const desktopMatchMedia = vi.fn().mockImplementation((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

const mobileMatchMedia = vi.fn().mockImplementation((query: string) => ({
  matches: true,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

afterEach(async () => {
  cleanup();
  overlay.active = null;
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: desktopMatchMedia,
  });
  vi.mocked(invoke).mockResolvedValue(null);
});

// ── Right rail responsive behaviour ──────────────────────────────────────────

describe("right rail responsive behaviour", () => {
  it("right rail is docked at ≥1024px (not a Sheet)", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: desktopMatchMedia,
    });
    const { container } = render(AppShell);

    const dockedRail = container.querySelector(
      '[data-slot="right-rail"][data-mobile="false"]',
    );
    expect(dockedRail).toBeTruthy();
  });

  it("right rail trigger renders in the header", () => {
    const { getByTestId } = render(AppShell);
    expect(getByTestId("right-rail-trigger")).toBeTruthy();
  });

  it("trigger toggles the docked rail closed and open on desktop", async () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: desktopMatchMedia,
    });
    const { container, getByTestId } = render(AppShell);

    const rail = container.querySelector(
      '[data-slot="right-rail"][data-mobile="false"]',
    )!;
    expect(rail.getAttribute("data-state")).toBe("closed");

    await fireEvent.click(getByTestId("right-rail-trigger"));
    expect(rail.getAttribute("data-state")).toBe("open");

    await fireEvent.click(getByTestId("right-rail-trigger"));
    expect(rail.getAttribute("data-state")).toBe("closed");
  });

  it("right rail opens as overlay at ≤1023px after trigger click", async () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: mobileMatchMedia,
    });
    const { getByTestId } = render(AppShell);

    await fireEvent.click(getByTestId("right-rail-trigger"));

    const overlayRail = document.body.querySelector(
      '[data-slot="right-rail"][data-mobile="true"]',
    );
    expect(overlayRail).toBeTruthy();
  });
});

// ── Overlay mutual exclusion on tablet (≤1023px) ─────────────────────────────

describe("overlay mutual exclusion on tablet (≤1023px)", () => {
  it("opening right rail overlay closes sidebar overlay", async () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: mobileMatchMedia,
    });
    const { getByTestId } = render(AppShell);

    // Open sidebar overlay first (Ctrl+\)
    await fireEvent.keyDown(window, { key: "\\", ctrlKey: true });
    expect(
      document.body.querySelector(
        '[data-mobile="true"][data-sidebar="sidebar"]',
      ),
    ).toBeTruthy();

    // Open right rail overlay
    await fireEvent.click(getByTestId("right-rail-trigger"));

    // Sidebar overlay should now be closed, right rail overlay open
    expect(
      document.body.querySelector(
        '[data-mobile="true"][data-sidebar="sidebar"]',
      ),
    ).toBeFalsy();
    expect(
      document.body.querySelector(
        '[data-slot="right-rail"][data-mobile="true"]',
      ),
    ).toBeTruthy();
  });

  it("opening sidebar overlay closes right rail overlay", async () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: mobileMatchMedia,
    });
    const { getByTestId } = render(AppShell);

    // Open right rail overlay first
    await fireEvent.click(getByTestId("right-rail-trigger"));
    expect(
      document.body.querySelector(
        '[data-slot="right-rail"][data-mobile="true"]',
      ),
    ).toBeTruthy();

    // Open sidebar overlay (Ctrl+\)
    await fireEvent.keyDown(window, { key: "\\", ctrlKey: true });

    // Right rail should now be closed, sidebar overlay open
    expect(
      document.body.querySelector(
        '[data-slot="right-rail"][data-mobile="true"]',
      ),
    ).toBeFalsy();
    expect(
      document.body.querySelector(
        '[data-mobile="true"][data-sidebar="sidebar"]',
      ),
    ).toBeTruthy();
  });

  it("on desktop (≥1024px) both panels are simultaneously docked", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: desktopMatchMedia,
    });
    const { container } = render(AppShell);

    const sidebar = container.querySelector(
      '[data-slot="sidebar"][data-state]',
    );
    const rail = container.querySelector('[data-slot="right-rail"]');

    expect(sidebar).toBeTruthy();
    expect(rail).toBeTruthy();
  });
});
