import { render, fireEvent, cleanup, within, waitFor } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import AppShell from "../lib/components/AppShell.svelte";
import LedgerSelector from "../lib/components/sidebar/LedgerSelector.svelte";
import { ledger } from "../lib/stores/ledger.svelte";
import { tabs } from "../lib/stores/tabs.svelte";
import { SIDEBAR_STATE_STORAGE_KEY } from "../lib/components/ui/sidebar/constants";

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
  // The sidebar remembers collapsed-or-expanded now (#226), and a remembered
  // state is a test leaking into the next one.
  localStorage.removeItem(SIDEBAR_STATE_STORAGE_KEY);
  await ledger.closeLedger();
  tabs.closeAll("left");
  if (tabs.right) tabs.closeAll("right");
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: desktopMatchMedia,
  });
  vi.mocked(invoke).mockResolvedValue(null);
});

// ── Sidebar responsive behaviour ─────────────────────────────────────────────

describe("sidebar responsive behaviour", () => {
  it("sidebar renders in docked mode at ≥1024px (desktop div, not Sheet)", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: desktopMatchMedia,
    });
    const { container } = render(AppShell);

    // Desktop: renders a plain div with data-slot="sidebar" that has data-state (not a Sheet)
    const desktopSidebar = container.querySelector('[data-slot="sidebar"][data-state]');
    expect(desktopSidebar).toBeTruthy();
  });

  it("sidebar renders as overlay sheet at ≤1023px (Sheet content present after toggle)", async () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: mobileMatchMedia,
    });
    render(AppShell);

    // Ctrl+\ opens the mobile sheet overlay
    await fireEvent.keyDown(window, { key: "\\", ctrlKey: true });

    // Sheet.Content renders with data-mobile="true" when open
    const mobileSidebar = document.body.querySelector('[data-mobile="true"]');
    expect(mobileSidebar).toBeTruthy();
  });
});

// ── Ledger selector ────────────────────────────────────────────────────────────

describe("ledger selector", () => {
  beforeEach(async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_ledger_path") return "/Users/test/MyLedger";
      if (cmd === "get_accent_preset") return null;
      if (cmd === "get_density_level") return null;
      if (cmd === "get_recent_ledgers")
        return [
          {
            name: "MyLedger",
            path: "/Users/test/MyLedger",
            note_count: 5,
            scene_count: 2,
            map_count: 1,
            last_opened: "2025-01-01T00:00:00Z",
          },
          {
            name: "OtherLedger",
            path: "/Users/test/OtherLedger",
            note_count: 0,
            scene_count: 0,
            map_count: 0,
            last_opened: "2025-01-02T00:00:00Z",
          },
        ];
      return null;
    });
    await ledger.checkExistingLedger();
  });

  it("shows the current ledger name", () => {
    const { getByText } = render(LedgerSelector);
    expect(getByText("MyLedger")).toBeTruthy();
  });

  it("popover opens on click and lists available ledgers", async () => {
    const { getByRole, findByText } = render(LedgerSelector);
    const trigger = getByRole("button", { name: /ledger selector/i });
    await fireEvent.click(trigger);

    expect(await findByText("OtherLedger")).toBeTruthy();
    expect(await findByText("Open new ledger")).toBeTruthy();
  });
});

// ── The collapsed sidebar, which is the rail now (#226) ──────────────────────
//
// These were the `IconRail` tests. The component is gone and the strip is the
// sidebar's own collapsed state, so they assert `data-collapsible="icon"` — the
// attribute the component already emits, and the thing they were really about.

/**
 * Collapse the sidebar and hand back its element.
 *
 * `Ctrl+\` toggles, and the state now survives a reload (#226) — so a test that
 * pressed it last leaves the next one starting collapsed. Read the state first
 * rather than assuming it; `afterEach` clears the key, and this is the belt to
 * that's braces.
 */
async function collapse() {
  const el = document.querySelector('[data-slot="sidebar"]') as HTMLElement;
  if (el.getAttribute("data-state") !== "collapsed") {
    await fireEvent.keyDown(window, { key: "\\", ctrlKey: true });
  }
  await waitFor(() => expect(el.getAttribute("data-collapsible")).toBe("icon"));
  return el;
}

describe("the collapsed sidebar", () => {
  it("is the 3rem strip when collapsed, and is not when expanded", async () => {
    render(AppShell);
    const el = document.querySelector('[data-slot="sidebar"]') as HTMLElement;
    expect(el.getAttribute("data-state")).toBe("expanded");
    expect(el.getAttribute("data-collapsible")).toBe("");

    await collapse();

    expect(el.getAttribute("data-state")).toBe("collapsed");
  });

  // By testid rather than by name: the expanded sidebar has a "Files" collapsible
  // trigger of its own, and both are in the DOM at once — jsdom applies no
  // stylesheet, so it cannot tell which of them the collapsed state is showing.
  it("keeps Files reachable, as an icon that expands and reveals the tree", async () => {
    render(AppShell);
    const sidebar = await collapse();

    await fireEvent.click(within(sidebar).getByTestId("sidebar-files-standin"));

    await waitFor(() => expect(sidebar.getAttribute("data-state")).toBe("expanded"));
  });

  it("keeps Graph reachable, and it opens the Graph tab", async () => {
    render(AppShell);
    const sidebar = await collapse();

    await fireEvent.click(within(sidebar).getByTestId("sidebar-graph"));

    expect(tabs.left.tabs.filter((t) => t.type === "graph")).toHaveLength(1);
  });

  it("opens one Graph tab however many times it is pressed", async () => {
    render(AppShell);
    const sidebar = await collapse();
    const graphBtn = within(sidebar).getByTestId("sidebar-graph");

    await fireEvent.click(graphBtn);
    await fireEvent.click(graphBtn);

    const graphTabs = [...tabs.left.tabs, ...(tabs.right?.tabs ?? [])].filter(
      (t) => t.type === "graph",
    );
    expect(graphTabs).toHaveLength(1);
  });

  it("carries Search, Scenes, Quick Notes and Settings too", async () => {
    render(AppShell);
    const sidebar = await collapse();

    // The stand-ins are the strip's own controls; Quick Notes, Graph and Settings
    // are ordinary rows that become their icons.
    expect(within(sidebar).getByTestId("sidebar-search-icon")).toBeTruthy();
    expect(within(sidebar).getByTestId("sidebar-scenes-standin")).toBeTruthy();
    expect(within(sidebar).getByTestId("sidebar-quick-notes")).toBeTruthy();
    expect(within(sidebar).getByTestId("sidebar-settings")).toBeTruthy();
  });

  // What the collapsed strip *hides* — the create toolbar, the file tree, the
  // scene favourites, Templates, the mini player — is decided by CSS that jsdom
  // does not load, so it is not asserted here. It is a screenshot's job, not
  // this file's; asserting the class names instead would only restate the
  // implementation.
});
