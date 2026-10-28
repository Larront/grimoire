import { render, fireEvent, cleanup, within } from "@testing-library/svelte";
import { describe, it, expect, vi, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { waitFor } from "@testing-library/svelte";
import AppShell from "../lib/components/AppShell.svelte";
import { searchPalette } from "../lib/stores/search.svelte";
import { dialogs } from "../lib/stores/overlay.svelte";
import * as toast from "$lib/toast";

afterEach(async () => {
  cleanup();
  searchPalette.open = false;
  dialogs.settingsOpen = false;
  dialogs.tagManagerOpen = false;
  vi.mocked(invoke).mockResolvedValue(null);
});

function mockTagUsage(
  entries: Array<{ tag: string; note_count: number; pin_count: number }>,
  styles: Record<string, { color: string | null; hidden: boolean; slot?: number | null }> = {},
) {
  vi.mocked(invoke).mockClear();
  vi.mocked(invoke).mockImplementation(async (cmd) => {
    if (cmd === "get_tag_usage_counts") return entries;
    if (cmd === "get_tag_graph_styles") return styles;
    return null;
  });
}

// ── Usage count aggregate ─────────────────────────────────────────────────────

describe("tag manager — usage count aggregate", () => {
  it("shows each tag with its total usage count (notes + pins)", async () => {
    mockTagUsage([{ tag: "npc", note_count: 3, pin_count: 2 }]);
    render(AppShell);
    dialogs.tagManagerOpen = true;
    const dialog = await waitFor(() => {
      const el = document.body.querySelector('[data-testid="tag-manager-dialog"]');
      if (!el) throw new Error("dialog not found");
      return el as HTMLElement;
    });
    const countEl = await waitFor(() => {
      const el = within(dialog).getByTestId("tag-usage-count-npc");
      return el;
    });
    expect(countEl.textContent?.trim()).toBe("5 uses");
    expect(countEl.getAttribute("title")).toBe("3 notes and 2 pins");
  });

  it("shows a count of note_count alone when pin_count is zero", async () => {
    mockTagUsage([{ tag: "creature", note_count: 4, pin_count: 0 }]);
    render(AppShell);
    dialogs.tagManagerOpen = true;
    const dialog = await waitFor(() => {
      const el = document.body.querySelector('[data-testid="tag-manager-dialog"]');
      if (!el) throw new Error("dialog not found");
      return el as HTMLElement;
    });
    const countEl = await waitFor(() => within(dialog).getByTestId("tag-usage-count-creature"));
    expect(countEl.textContent?.trim()).toBe("4 uses");
  });

  it("lists all tags in the ledger", async () => {
    mockTagUsage([
      { tag: "npc", note_count: 2, pin_count: 0 },
      { tag: "location", note_count: 0, pin_count: 1 },
    ]);
    render(AppShell);
    dialogs.tagManagerOpen = true;
    const dialog = await waitFor(() => {
      const el = document.body.querySelector('[data-testid="tag-manager-dialog"]');
      if (!el) throw new Error("dialog not found");
      return el as HTMLElement;
    });
    await waitFor(() => within(dialog).getByText("npc"));
    expect(within(dialog).getByText("location")).toBeTruthy();
  });

  it("shows empty state when there are no tags", async () => {
    mockTagUsage([]);
    render(AppShell);
    dialogs.tagManagerOpen = true;
    const dialog = await waitFor(() => {
      const el = document.body.querySelector('[data-testid="tag-manager-dialog"]');
      if (!el) throw new Error("dialog not found");
      return el as HTMLElement;
    });
    const empty = await waitFor(() => within(dialog).getByTestId("tag-manager-empty"));
    expect(empty).toBeTruthy();
  });
});

// ── Entry point: Settings "Manage tags…" row ──────────────────────────────────

describe("tag manager — settings entry point", () => {
  async function openSettings() {
    const result = render(AppShell);
    // The rail is gone (#226) — Settings is a row in the sidebar footer, at every width.
    await fireEvent.click(result.getByTestId("sidebar-settings"));
    const dialog = await result.findByRole("dialog");
    return { ...result, dialog };
  }

  // The tag manager entry point lives under the "Content" section tab.
  async function openContentTab() {
    const opened = await openSettings();
    await fireEvent.click(within(opened.dialog).getByTestId("settings-tab-content"));
    return opened;
  }

  it("settings dialog has a Tags row with a Manage button", async () => {
    const { dialog } = await openContentTab();
    expect(within(dialog).getByTestId("open-tag-manager-btn")).toBeTruthy();
  });

  it("clicking 'Manage' in Settings closes Settings and opens Tag Manager", async () => {
    const { dialog } = await openContentTab();
    expect(dialogs.settingsOpen).toBe(true);

    await fireEvent.click(within(dialog).getByTestId("open-tag-manager-btn"));

    expect(dialogs.settingsOpen).toBe(false);
    expect(dialogs.tagManagerOpen).toBe(true);
  });
});

// ── Entry point: Command Palette "Manage tags" command ────────────────────────

describe("tag manager — command palette entry point", () => {
  async function openPaletteAndSearch(query: string) {
    render(AppShell);
    await fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => {
      if (!searchPalette.open) throw new Error("palette not open");
    });
    // Type the query to surface the command (default cap hides it otherwise).
    const input = document.body.querySelector(
      'input[placeholder="Type a command or search..."]',
    ) as HTMLInputElement;
    input.value = query;
    await fireEvent.input(input);
  }

  it("palette has a 'Manage tags' command when searched", async () => {
    await openPaletteAndSearch("manage");
    expect(document.body.querySelector('[data-testid="cmd-manage-tags"]')).toBeTruthy();
  });

  it("selecting 'Manage tags' command closes palette and opens Tag Manager", async () => {
    await openPaletteAndSearch("manage");
    const cmd = document.body.querySelector('[data-testid="cmd-manage-tags"]') as HTMLElement;
    await fireEvent.click(cmd);
    expect(searchPalette.open).toBe(false);
    expect(dialogs.tagManagerOpen).toBe(true);
  });
});

// ── Per-tag graph color and visibility ────────────────────────────────────────

async function openTagManager(
  entries: Array<{ tag: string; note_count: number; pin_count: number }>,
  styles: Record<string, { color: string | null; hidden: boolean; slot?: number | null }> = {},
) {
  mockTagUsage(entries, styles);
  render(AppShell);
  dialogs.tagManagerOpen = true;
  const dialog = await waitFor(() => {
    const el = document.body.querySelector('[data-testid="tag-manager-dialog"]');
    if (!el) throw new Error("dialog not found");
    return el as HTMLElement;
  });
  // Wait for tag rows to load
  await waitFor(() => {
    if (entries.length > 0) {
      const rows = dialog.querySelectorAll('[data-testid="tag-manager-row"]');
      if (rows.length === 0) throw new Error("rows not rendered");
    }
  });
  return dialog;
}

/** Open a row's ⋯ menu and choose an item by its visible name. */
async function chooseFromMenu(dialog: HTMLElement, tag: string, item: RegExp) {
  const trigger = within(dialog).getByTestId(`tag-menu-${tag}`);
  await fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
  const entry = await waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) =>
      item.test(el.textContent ?? ""),
    );
    if (!found) throw new Error(`menu item ${item} not found`);
    return found;
  });
  await fireEvent.click(entry);
}

const calls = (cmd: string) => vi.mocked(invoke).mock.calls.filter(([c]) => c === cmd);

describe("tag manager — per-tag graph color", () => {
  it("shows the colour the graph draws, Automatic being the tag's ramp step", async () => {
    const dialog = await openTagManager([{ tag: "npc", note_count: 3, pin_count: 0 }], {
      npc: { color: null, hidden: false, slot: 0 },
    });
    const swatch = within(dialog).getByTestId("tag-color-npc");
    expect(swatch.getAttribute("aria-label")).toBe("Graph colour for npc: Automatic");
  });

  it("names an explicit colour, and draws the swatch in it", async () => {
    const dialog = await openTagManager([{ tag: "npc", note_count: 3, pin_count: 0 }], {
      npc: { color: "#ff0000", hidden: false, slot: 0 },
    });
    const swatch = within(dialog).getByTestId("tag-color-npc");
    expect(swatch.getAttribute("aria-label")).toBe("Graph colour for npc: #ff0000");
    expect(swatch.style.background).toMatch(/ff0000|255, 0, 0/);
  });

  it("opens the app's colour picker, not the system's, with Automatic to go back", async () => {
    const dialog = await openTagManager([{ tag: "npc", note_count: 3, pin_count: 0 }], {
      npc: { color: "#ff0000", hidden: false, slot: 0 },
    });
    expect(dialog.querySelector('input[type="color"]')).toBeNull();
    await fireEvent.click(within(dialog).getByTestId("tag-color-npc"));
    const picker = await waitFor(() => {
      const el = document.body.querySelector("[data-color-picker]");
      if (!el) throw new Error("picker not open");
      return el as HTMLElement;
    });
    await fireEvent.click(within(picker).getByRole("button", { name: /Automatic/ }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_tag_graph_color", { tag: "npc", color: null }),
    );
  });
});

// ── Per-tag graph visibility ──────────────────────────────────────────────────

describe("tag manager — per-tag graph visibility", () => {
  it("each tag row shows a visibility switch, on when the tag is shown", async () => {
    const dialog = await openTagManager([{ tag: "npc", note_count: 1, pin_count: 0 }]);
    const toggle = within(dialog).getByTestId("tag-visibility-npc");
    expect(toggle.getAttribute("role")).toBe("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("is off when the tag is hidden", async () => {
    const dialog = await openTagManager([{ tag: "npc", note_count: 1, pin_count: 0 }], {
      npc: { color: null, hidden: true },
    });
    const toggle = within(dialog).getByTestId("tag-visibility-npc");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("writes the hidden flag alone, never a colour with it", async () => {
    const dialog = await openTagManager([{ tag: "npc", note_count: 1, pin_count: 0 }], {
      npc: { color: "#ff0000", hidden: false },
    });
    await fireEvent.click(within(dialog).getByTestId("tag-visibility-npc"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_tag_graph_hidden", { tag: "npc", hidden: true }),
    );
    expect(calls("set_tag_graph_color")).toHaveLength(0);
  });
});

// ── Rename, merge, delete ─────────────────────────────────────────────────────

const UNDO = { from_tag: "npc", to_tag: "person", notes: [], pins: [], styles: [] };

function mockRetag(
  entries: Array<{ tag: string; note_count: number; pin_count: number }>,
  result: { note_count: number; pin_count: number; merged: boolean } = {
    note_count: 3,
    pin_count: 1,
    merged: false,
  },
) {
  vi.mocked(invoke).mockImplementation(async (cmd) => {
    if (cmd === "get_tag_usage_counts") return entries;
    if (cmd === "get_tag_graph_styles") return {};
    if (cmd === "retag_tag") return { ...result, undo: UNDO };
    return null;
  });
}

async function openWithRetag(
  entries: Array<{ tag: string; note_count: number; pin_count: number }>,
  result?: { note_count: number; pin_count: number; merged: boolean },
) {
  const dialog = await openTagManager(entries);
  mockRetag(entries, result);
  return dialog;
}

describe("tag manager — rename and merge", () => {
  it("each tag row has a ⋯ menu with Rename, Merge into… and Delete", async () => {
    const dialog = await openWithRetag([{ tag: "npc", note_count: 3, pin_count: 1 }]);
    await fireEvent.pointerDown(within(dialog).getByTestId("tag-menu-npc"), {
      button: 0,
      pointerType: "mouse",
    });
    const items = await waitFor(() => {
      const found = [...document.querySelectorAll('[role="menuitem"]')].map((el) =>
        el.textContent?.trim(),
      );
      if (found.length < 3) throw new Error("menu not open");
      return found;
    });
    expect(items).toEqual(["Rename", "Merge into…", "Delete"]);
  });

  it("renames at once, offering Undo rather than asking first", async () => {
    const undo = vi.spyOn(toast, "toastUndo");
    const dialog = await openWithRetag([{ tag: "npc", note_count: 3, pin_count: 1 }]);
    await chooseFromMenu(dialog, "npc", /Rename/);

    const input = (await waitFor(() =>
      within(dialog).getByTestId("retag-input-npc"),
    )) as HTMLInputElement;
    expect(input.value).toBe("npc");
    await fireEvent.input(input, { target: { value: "person" } });
    await fireEvent.submit(input.form!);

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("retag_tag", { fromTag: "npc", toTag: "person" }),
    );
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
    await waitFor(() => expect(undo).toHaveBeenCalled());
    expect(undo.mock.calls[0][0]).toBe("Renamed “npc” to “person” on 3 notes and 1 pin");

    undo.mock.calls[0][2]!();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("undo_retag", { undo: UNDO }));
    undo.mockRestore();
  });

  it("says Merged when the name was already a tag", async () => {
    const undo = vi.spyOn(toast, "toastUndo");
    const dialog = await openWithRetag(
      [
        { tag: "npc", note_count: 2, pin_count: 0 },
        { tag: "person", note_count: 5, pin_count: 0 },
      ],
      { note_count: 2, pin_count: 0, merged: true },
    );
    await chooseFromMenu(dialog, "npc", /Merge into/);
    const input = await waitFor(() => within(dialog).getByTestId("retag-input-npc"));
    await fireEvent.input(input, { target: { value: "per" } });

    // Existing tags are offered; choosing one merges into it.
    await fireEvent.click(
      await waitFor(() => within(dialog).getByTestId("retag-suggestion-person")),
    );
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("retag_tag", { fromTag: "npc", toTag: "person" }),
    );
    await waitFor(() => expect(undo).toHaveBeenCalled());
    expect(undo.mock.calls[0][0]).toBe("Merged “npc” into “person” on 2 notes");
    undo.mockRestore();
  });

  it("refuses a name tags can't have, keeping what was typed", async () => {
    const dialog = await openWithRetag([{ tag: "npc", note_count: 1, pin_count: 0 }]);
    await chooseFromMenu(dialog, "npc", /Rename/);
    const input = (await waitFor(() =>
      within(dialog).getByTestId("retag-input-npc"),
    )) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: "bad tag!" } });

    expect(within(dialog).getByText(/letters, numbers, - _ and \/ only/)).toBeTruthy();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(within(dialog).getByTestId("retag-apply-npc")).toBeDisabled();
    await fireEvent.submit(input.form!);
    expect(calls("retag_tag")).toHaveLength(0);
    expect(input.value).toBe("bad tag!");
  });

  it("Escape closes the name field, not the dialog", async () => {
    const dialog = await openWithRetag([{ tag: "npc", note_count: 1, pin_count: 0 }]);
    await chooseFromMenu(dialog, "npc", /Rename/);
    const input = await waitFor(() => within(dialog).getByTestId("retag-input-npc"));
    await fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(within(dialog).queryByTestId("retag-input-npc")).toBeNull());
    expect(dialogs.tagManagerOpen).toBe(true);
  });
});

describe("tag manager — delete", () => {
  it("asks inside the row, naming what the tag is on", async () => {
    const dialog = await openWithRetag([{ tag: "npc", note_count: 3, pin_count: 1 }]);
    await chooseFromMenu(dialog, "npc", /Delete/);
    const group = await waitFor(() =>
      within(dialog).getByRole("group", { name: "Confirm deleting npc" }),
    );
    expect(group.textContent).toContain("Remove “npc” from 3 notes and 1 pin?");
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("deletes with retag_tag(to: null) once confirmed", async () => {
    const dialog = await openWithRetag([{ tag: "npc", note_count: 3, pin_count: 1 }]);
    await chooseFromMenu(dialog, "npc", /Delete/);
    await fireEvent.click(
      await waitFor(() => within(dialog).getByTestId("tag-delete-confirm-npc")),
    );
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("retag_tag", { fromTag: "npc", toTag: null }),
    );
  });

  it("Cancel leaves the tag alone", async () => {
    const dialog = await openWithRetag([{ tag: "npc", note_count: 3, pin_count: 1 }]);
    await chooseFromMenu(dialog, "npc", /Delete/);
    await fireEvent.click(await waitFor(() => within(dialog).getByTestId("tag-delete-cancel-npc")));
    await waitFor(() =>
      expect(within(dialog).queryByRole("group", { name: "Confirm deleting npc" })).toBeNull(),
    );
    expect(calls("retag_tag")).toHaveLength(0);
  });

  it("refreshes the list after a retag", async () => {
    const entries = [{ tag: "npc", note_count: 3, pin_count: 1 }];
    const dialog = await openWithRetag(entries);
    await chooseFromMenu(dialog, "npc", /Delete/);
    entries.length = 0;
    await fireEvent.click(
      await waitFor(() => within(dialog).getByTestId("tag-delete-confirm-npc")),
    );
    await waitFor(() => within(dialog).getByTestId("tag-manager-empty"));
  });
});
