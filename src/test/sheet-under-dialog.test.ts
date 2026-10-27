// A shell dialog and the narrow window's sheets (2026-10 design review).
//
// Settings opened from the sidebar's sheet used to open under it, dimmed by the
// sheet's scrim, because nothing closed the sheet. And the sidebar kept its own
// open flag beside the overlay token, so once anything else took the token the
// next Ctrl+\ closed a sheet that was already shut.
import { render, cleanup, act } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("$lib/toast", () => ({
  toastUndo: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastExternalMoveLinks: vi.fn(),
  toastUnlinkedPins: vi.fn(),
  toastUnreadableNotes: vi.fn(),
  toastDbRestored: vi.fn(),
  toastDbRebuilt: vi.fn(),
  dismissDbRecovery: vi.fn(),
  toastMigrationReport: vi.fn(),
  dismissFormatUpdate: vi.fn(),
}));
import { invoke } from "@tauri-apps/api/core";
import AppShell from "$lib/components/AppShell.svelte";
import { ledger } from "$lib/stores/ledger.svelte";
import { tabs } from "$lib/stores/tabs.svelte";
import { dialogs, overlay } from "$lib/stores/overlay.svelte";
import { searchPalette } from "$lib/stores/search.svelte";

// A window under 1024px, where the sidebar is a sheet.
const narrowMatchMedia = vi.fn().mockImplementation((query: string) => ({
  matches: query.includes("max-width"),
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function pressSidebarKey() {
  await act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "\\", ctrlKey: true }));
  });
}

beforeEach(async () => {
  Object.defineProperty(window, "matchMedia", { writable: true, value: narrowMatchMedia });
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "open_ledger")
      return {
        path: "/vault",
        note_count: 0,
        scene_count: 0,
        map_count: 0,
        failed_imports: [],
        unlinked_pins: [],
      };
    if (cmd === "get_file_tree")
      return { name: "vault", path: "", is_dir: true, note_id: null, map_id: null, children: [] };
    if (cmd === "get_statblock_preset_default") return null;
    if (cmd.startsWith("get_") || cmd.startsWith("list_")) return [];
    return null;
  });
  await ledger.openLedger("/vault");
  await flush();
});

afterEach(async () => {
  dialogs.settingsOpen = false;
  searchPalette.open = false;
  overlay.dismiss();
  cleanup();
  await ledger.closeLedger();
  tabs.closeAll("left");
  vi.mocked(invoke).mockResolvedValue(null);
});

describe("a shell dialog over the sidebar's sheet", () => {
  it("Settings closes the sheet it was opened from", async () => {
    render(AppShell);
    await flush();
    await pressSidebarKey();
    expect(overlay.active).toBe("sidebar");

    await act(() => {
      dialogs.settingsOpen = true;
    });
    expect(overlay.active).toBeNull();
  });

  it("so does the palette", async () => {
    render(AppShell);
    await flush();
    await pressSidebarKey();

    await act(() => {
      searchPalette.open = true;
    });
    expect(overlay.active).toBeNull();
  });

  it("one press opens the sheet again afterwards, not two", async () => {
    render(AppShell);
    await flush();
    await pressSidebarKey();
    await act(() => {
      dialogs.settingsOpen = true;
    });
    await act(() => {
      dialogs.settingsOpen = false;
    });

    await pressSidebarKey();
    expect(overlay.active).toBe("sidebar");
  });
});
