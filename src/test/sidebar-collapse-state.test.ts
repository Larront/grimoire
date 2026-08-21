// Collapsed-or-expanded survives a restart (#226).
//
// Upstream wrote a `sidebar:state` cookie that nothing here ever read — a
// SvelteKit pattern wanting a server — so the sidebar opened on every launch no
// matter what the GM last did. That was cheap while collapsing merely hid a panel
// the rail stood beside. Now that collapsed *is* the rail, it is a state a GM may
// want to live in, and a remount is the closest this suite gets to a restart.
import { render, fireEvent, cleanup, waitFor } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import AppShell from "$lib/components/AppShell.svelte";
import { ledger } from "$lib/stores/ledger.svelte";
import { tabs } from "$lib/stores/tabs.svelte";
import { SIDEBAR_WIDTH_MIN_PX } from "$lib/components/ui/sidebar/constants";
import {
  SIDEBAR_STATE_STORAGE_KEY,
  readSidebarOpen,
  persistSidebarOpen,
} from "$lib/utils/sidebar-state";

vi.mock("svelte-sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }),
  Toaster: vi.fn(),
}));

beforeEach(() => {
  localStorage.removeItem(SIDEBAR_STATE_STORAGE_KEY);
  vi.mocked(invoke).mockImplementation(() => Promise.resolve([]));
});

afterEach(async () => {
  cleanup();
  localStorage.removeItem(SIDEBAR_STATE_STORAGE_KEY);
  tabs.closeAll("left");
  tabs.closeAll("right");
  vi.mocked(invoke).mockImplementation(() => Promise.resolve(null));
  await ledger.closeLedger();
});

const sidebarEl = () => document.querySelector('[data-slot="sidebar"]') as HTMLElement;

describe("the sidebar remembers whether it is a strip", () => {
  it("opens expanded for a GM who has never collapsed it", () => {
    render(AppShell);
    expect(sidebarEl().getAttribute("data-state")).toBe("expanded");
  });

  it("comes back collapsed after being collapsed", async () => {
    render(AppShell);
    await fireEvent.keyDown(window, { key: "\\", ctrlKey: true });
    await waitFor(() => expect(sidebarEl().getAttribute("data-state")).toBe("collapsed"));

    cleanup();
    render(AppShell);

    expect(sidebarEl().getAttribute("data-state")).toBe("collapsed");
    expect(sidebarEl().getAttribute("data-collapsible")).toBe("icon");
  });

  it("comes back expanded after being expanded again", async () => {
    persistSidebarOpen(false);
    render(AppShell);
    expect(sidebarEl().getAttribute("data-state")).toBe("collapsed");

    await fireEvent.keyDown(window, { key: "\\", ctrlKey: true });
    await waitFor(() => expect(sidebarEl().getAttribute("data-state")).toBe("expanded"));

    cleanup();
    render(AppShell);

    expect(sidebarEl().getAttribute("data-state")).toBe("expanded");
  });

  it("no longer writes the cookie nothing read", async () => {
    render(AppShell);
    await fireEvent.keyDown(window, { key: "\\", ctrlKey: true });
    await waitFor(() => expect(sidebarEl().getAttribute("data-state")).toBe("collapsed"));

    expect(document.cookie).not.toContain("sidebar:state");
    expect(localStorage.getItem(SIDEBAR_STATE_STORAGE_KEY)).toBe("false");
  });
});

describe("reading a state that is not there", () => {
  it("is expanded when nothing is stored", () => {
    expect(readSidebarOpen()).toBe(true);
  });

  it("is expanded when the stored value is junk, rather than collapsed by accident", () => {
    // Only the string this module writes for collapsed may mean collapsed.
    // Anything else — corrupted, half-written, or left by an older build — must
    // read expanded: the strip is not a state to start a GM in by accident.
    localStorage.setItem(SIDEBAR_STATE_STORAGE_KEY, "yes");
    expect(readSidebarOpen()).toBe(true);
  });

  it("is collapsed only for the value it writes for collapsed", () => {
    persistSidebarOpen(false);
    expect(localStorage.getItem(SIDEBAR_STATE_STORAGE_KEY)).toBe("false");
    expect(readSidebarOpen()).toBe(false);
  });
});

describe("collapsed is a state, not a width", () => {
  it("keeps the remembered width across a collapse and an expand", async () => {
    render(AppShell);
    const wrapper = document.querySelector('[data-slot="sidebar-wrapper"]') as HTMLElement;
    const before = wrapper.style.getPropertyValue("--sidebar-width");
    expect(before).toBeTruthy();

    await fireEvent.keyDown(window, { key: "\\", ctrlKey: true });
    await waitFor(() => expect(sidebarEl().getAttribute("data-state")).toBe("collapsed"));
    await fireEvent.keyDown(window, { key: "\\", ctrlKey: true });
    await waitFor(() => expect(sidebarEl().getAttribute("data-state")).toBe("expanded"));

    // The 3rem strip is `--sidebar-width-icon`; the remembered width is never
    // overwritten by it, so 192px stays a drag floor rather than a cliff.
    expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe(before);
    expect(Number.parseInt(before, 10)).toBeGreaterThanOrEqual(SIDEBAR_WIDTH_MIN_PX);
  });
});
