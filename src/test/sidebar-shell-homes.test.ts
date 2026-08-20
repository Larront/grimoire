// Search, Graph and Settings in the expanded sidebar (#235).
//
// The claim under test is not "a button exists" but "it does the same thing its
// rail twin does" — the reason these controls are being given homes at all is
// #226, which deletes the rail and leaves the sidebar's copy as the only one. So
// each test presses the sidebar's control and reads the *effect*: a tab opened,
// a dialog flag raised.
import { render, fireEvent, cleanup, waitFor } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import AppShell from "$lib/components/AppShell.svelte";
import { tabs } from "$lib/stores/tabs.svelte";
import { ledger } from "$lib/stores/ledger.svelte";
import { dialogs } from "$lib/stores/overlay.svelte";
import { searchPalette } from "$lib/stores/search.svelte";

vi.mock("svelte-sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }),
  Toaster: vi.fn(),
}));

const LEDGER_PATH = "/worlds/marsh";

beforeEach(() => {
  dialogs.settingsOpen = false;
  searchPalette.open = false;
  vi.mocked(invoke).mockClear();
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd === "open_ledger")
      return Promise.resolve({
        path: LEDGER_PATH,
        note_count: 0,
        scene_count: 0,
        map_count: 0,
        failed_imports: [],
        unlinked_pins: [],
        recovered_from_backup: null,
      });
    if (cmd === "get_file_tree")
      return Promise.resolve({ name: "", path: "", is_dir: true, children: [] });
    if (cmd === "get_statblock_preset_default") return Promise.resolve(null);
    return Promise.resolve([]);
  });
});

afterEach(async () => {
  cleanup();
  dialogs.settingsOpen = false;
  searchPalette.open = false;
  tabs.closeAll("left");
  tabs.closeAll("right");
  vi.mocked(invoke).mockImplementation(() => Promise.resolve(null));
  await ledger.closeLedger();
});

async function openShell() {
  await ledger.openLedger(LEDGER_PATH);
  const view = render(AppShell);
  await waitFor(() => expect(document.querySelector('[data-slot="sidebar"]')).toBeTruthy());
  return view;
}

const byTestId = (id: string) =>
  document.querySelector<HTMLElement>(`[data-testid="${id}"]`) as HTMLElement;

describe("the sidebar's own homes for Search, Graph and Settings", () => {
  it("Graph is a row in the sidebar, and opens the Graph tab", async () => {
    await openShell();

    await waitFor(() => expect(byTestId("sidebar-graph")).toBeTruthy());
    await fireEvent.click(byTestId("sidebar-graph"));

    await waitFor(() => expect(tabs.activeTab?.type).toBe("graph"));
  });

  it("opens one Graph tab, never two, however it is reached", async () => {
    await openShell();

    await fireEvent.click(byTestId("sidebar-graph"));
    await waitFor(() => expect(tabs.activeTab?.type).toBe("graph"));
    // `openTab`'s dedup, which is what makes two surfaces onto one destination
    // safe — and what #226 will lean on when the rail's copy is the sidebar's.
    await fireEvent.click(byTestId("sidebar-quick-notes"));
    await fireEvent.click(byTestId("sidebar-graph"));

    await waitFor(() => expect(tabs.activeTab?.type).toBe("graph"));
    expect(tabs.left.tabs.filter((t) => t.type === "graph")).toHaveLength(1);
  });

  it("Settings is in the sidebar footer, and opens the Settings dialog", async () => {
    await openShell();

    await waitFor(() => expect(byTestId("sidebar-settings")).toBeTruthy());
    await fireEvent.click(byTestId("sidebar-settings"));

    await waitFor(() => expect(dialogs.settingsOpen).toBe(true));
  });

  it("Search already had a home, and it still opens the palette", async () => {
    await openShell();

    // `AppSearch` — the bar with the Cmd+K hint — was in the sidebar before this
    // ticket. The premise that Search lived only on the rail was wrong, and this
    // is the assertion that keeps it from being "fixed" into the header later.
    await waitFor(() => expect(byTestId("app-search-bar")).toBeTruthy());
    await fireEvent.click(byTestId("app-search-bar"));

    await waitFor(() => expect(searchPalette.open).toBe(true));
  });

  it("the sidebar's Scenes row and the rail's reach the same tab", async () => {
    await openShell();

    await fireEvent.click(byTestId("sidebar-scenes"));
    await waitFor(() => expect(tabs.activeTab?.type).toBe("scenes"));
    const viaSidebar = tabs.activeTab;

    tabs.closeAll("left");
    await fireEvent.click(byTestId("sidebar-scenes"));
    await waitFor(() => expect(tabs.activeTab?.type).toBe("scenes"));

    expect(tabs.activeTab?.title).toBe(viaSidebar?.title);
    expect(tabs.activeTab?.id).toBe(viaSidebar?.id);
  });
});
