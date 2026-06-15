import { render, fireEvent, cleanup, within } from "@testing-library/svelte";
import { describe, it, expect, vi, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { waitFor } from "@testing-library/svelte";
import AppShell from "../lib/components/AppShell.svelte";
import { searchPalette } from "../lib/stores/search.svelte";

afterEach(async () => {
  cleanup();
  searchPalette.open = false;
  searchPalette.settingsOpen = false;
  searchPalette.tagManagerOpen = false;
  vi.mocked(invoke).mockResolvedValue(null);
});

function mockTagUsage(
  entries: Array<{ tag: string; note_count: number; pin_count: number }>,
  styles: Record<string, { color: string | null; hidden: boolean }> = {},
) {
  vi.mocked(invoke).mockImplementation(async (cmd) => {
    if (cmd === "get_tag_usage_counts") return entries;
    if (cmd === "get_tag_graph_styles") return styles;
    if (cmd === "set_tag_graph_style") return null;
    return null;
  });
}

// ── Usage count aggregate ─────────────────────────────────────────────────────

describe("tag manager — usage count aggregate", () => {
  it("shows each tag with its total usage count (notes + pins)", async () => {
    mockTagUsage([{ tag: "npc", note_count: 3, pin_count: 2 }]);
    render(AppShell);
    searchPalette.tagManagerOpen = true;
    const dialog = await waitFor(() => {
      const el = document.body.querySelector('[data-testid="tag-manager-dialog"]');
      if (!el) throw new Error("dialog not found");
      return el as HTMLElement;
    });
    const countEl = await waitFor(() => {
      const el = within(dialog).getByTestId("tag-usage-count-npc");
      return el;
    });
    expect(countEl.textContent?.trim()).toBe("5");
  });

  it("shows a count of note_count alone when pin_count is zero", async () => {
    mockTagUsage([{ tag: "creature", note_count: 4, pin_count: 0 }]);
    render(AppShell);
    searchPalette.tagManagerOpen = true;
    const dialog = await waitFor(() => {
      const el = document.body.querySelector('[data-testid="tag-manager-dialog"]');
      if (!el) throw new Error("dialog not found");
      return el as HTMLElement;
    });
    const countEl = await waitFor(() =>
      within(dialog).getByTestId("tag-usage-count-creature"),
    );
    expect(countEl.textContent?.trim()).toBe("4");
  });

  it("lists all tags in the ledger", async () => {
    mockTagUsage([
      { tag: "npc", note_count: 2, pin_count: 0 },
      { tag: "location", note_count: 0, pin_count: 1 },
    ]);
    render(AppShell);
    searchPalette.tagManagerOpen = true;
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
    searchPalette.tagManagerOpen = true;
    const dialog = await waitFor(() => {
      const el = document.body.querySelector('[data-testid="tag-manager-dialog"]');
      if (!el) throw new Error("dialog not found");
      return el as HTMLElement;
    });
    const empty = await waitFor(() =>
      within(dialog).getByTestId("tag-manager-empty"),
    );
    expect(empty).toBeTruthy();
  });
});

// ── Entry point: Settings "Manage tags…" row ──────────────────────────────────

describe("tag manager — settings entry point", () => {
  async function openSettings() {
    const result = render(AppShell);
    const rail = result.getByTestId("icon-rail");
    await fireEvent.click(
      within(rail).getByRole("button", { name: /^settings$/i }),
    );
    const dialog = await result.findByRole("dialog");
    return { ...result, dialog };
  }

  it("settings dialog has a 'Manage tags…' row with an Open button", async () => {
    const { dialog } = await openSettings();
    expect(within(dialog).getByTestId("open-tag-manager-btn")).toBeTruthy();
  });

  it("clicking 'Open' in Settings closes Settings and opens Tag Manager", async () => {
    const { dialog } = await openSettings();
    expect(searchPalette.settingsOpen).toBe(true);

    await fireEvent.click(within(dialog).getByTestId("open-tag-manager-btn"));

    expect(searchPalette.settingsOpen).toBe(false);
    expect(searchPalette.tagManagerOpen).toBe(true);
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
    expect(
      document.body.querySelector('[data-testid="cmd-manage-tags"]'),
    ).toBeTruthy();
  });

  it("selecting 'Manage tags' command closes palette and opens Tag Manager", async () => {
    await openPaletteAndSearch("manage");
    const cmd = document.body.querySelector(
      '[data-testid="cmd-manage-tags"]',
    ) as HTMLElement;
    await fireEvent.click(cmd);
    expect(searchPalette.open).toBe(false);
    expect(searchPalette.tagManagerOpen).toBe(true);
  });
});

// ── Per-tag graph color and visibility ────────────────────────────────────────

async function openTagManager(
  entries: Array<{ tag: string; note_count: number; pin_count: number }>,
  styles: Record<string, { color: string | null; hidden: boolean }> = {},
) {
  mockTagUsage(entries, styles);
  render(AppShell);
  searchPalette.tagManagerOpen = true;
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

describe("tag manager — per-tag graph color", () => {
  it("each tag row shows a color picker input", async () => {
    const dialog = await openTagManager(
      [{ tag: "npc", note_count: 3, pin_count: 0 }],
      { npc: { color: "#ff0000", hidden: false } },
    );
    await waitFor(() => {
      expect(dialog.querySelector('[data-testid="tag-color-npc"]')).toBeTruthy();
    });
  });

  it("color picker value reflects the stored tag color", async () => {
    const dialog = await openTagManager(
      [{ tag: "npc", note_count: 3, pin_count: 0 }],
      { npc: { color: "#ff0000", hidden: false } },
    );
    await waitFor(() => {
      const input = dialog.querySelector('[data-testid="tag-color-npc"]') as HTMLInputElement;
      expect(input).toBeTruthy();
      expect(input.value).toBe("#ff0000");
    });
  });

  it("clear button appears when tag has an explicit color", async () => {
    const dialog = await openTagManager(
      [{ tag: "npc", note_count: 3, pin_count: 0 }],
      { npc: { color: "#ff0000", hidden: false } },
    );
    await waitFor(() => {
      expect(dialog.querySelector('[data-testid="tag-color-clear-npc"]')).toBeTruthy();
    });
  });

  it("clear button is absent when tag has no explicit color", async () => {
    const dialog = await openTagManager(
      [{ tag: "npc", note_count: 3, pin_count: 0 }],
      {},
    );
    await waitFor(() => {
      const rows = dialog.querySelectorAll('[data-testid="tag-manager-row"]');
      expect(rows.length).toBeGreaterThan(0);
    });
    expect(dialog.querySelector('[data-testid="tag-color-clear-npc"]')).toBeFalsy();
  });

  it("clicking clear calls set_tag_graph_style with color null", async () => {
    const dialog = await openTagManager(
      [{ tag: "npc", note_count: 3, pin_count: 0 }],
      { npc: { color: "#ff0000", hidden: false } },
    );
    vi.mocked(invoke).mockClear();
    const clearBtn = await waitFor(() => {
      const el = dialog.querySelector('[data-testid="tag-color-clear-npc"]') as HTMLElement;
      if (!el) throw new Error("clear btn not found");
      return el;
    });
    await fireEvent.click(clearBtn);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("set_tag_graph_style", {
        tag: "npc",
        color: null,
        hidden: false,
      });
    });
  });
});

describe("tag manager — per-tag graph visibility", () => {
  it("each tag row shows a visibility toggle", async () => {
    const dialog = await openTagManager(
      [{ tag: "npc", note_count: 3, pin_count: 0 }],
    );
    await waitFor(() => {
      expect(dialog.querySelector('[data-testid="tag-visibility-npc"]')).toBeTruthy();
    });
  });

  it("visibility toggle aria-checked is true when tag is visible", async () => {
    const dialog = await openTagManager(
      [{ tag: "npc", note_count: 3, pin_count: 0 }],
      { npc: { color: null, hidden: false } },
    );
    await waitFor(() => {
      const toggle = dialog.querySelector('[data-testid="tag-visibility-npc"]') as HTMLElement;
      expect(toggle.getAttribute("aria-checked")).toBe("true");
    });
  });

  it("visibility toggle aria-checked is false when tag is hidden", async () => {
    const dialog = await openTagManager(
      [{ tag: "npc", note_count: 3, pin_count: 0 }],
      { npc: { color: null, hidden: true } },
    );
    await waitFor(() => {
      const toggle = dialog.querySelector('[data-testid="tag-visibility-npc"]') as HTMLElement;
      expect(toggle.getAttribute("aria-checked")).toBe("false");
    });
  });

  it("toggling a visible tag calls set_tag_graph_style with hidden: true", async () => {
    const dialog = await openTagManager(
      [{ tag: "npc", note_count: 3, pin_count: 0 }],
      { npc: { color: "#ff0000", hidden: false } },
    );
    vi.mocked(invoke).mockClear();
    const toggle = await waitFor(() => {
      const el = dialog.querySelector('[data-testid="tag-visibility-npc"]') as HTMLElement;
      if (!el) throw new Error("toggle not found");
      return el;
    });
    await fireEvent.click(toggle);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("set_tag_graph_style", {
        tag: "npc",
        color: "#ff0000",
        hidden: true,
      });
    });
  });

  it("toggling a hidden tag calls set_tag_graph_style with hidden: false", async () => {
    const dialog = await openTagManager(
      [{ tag: "npc", note_count: 3, pin_count: 0 }],
      { npc: { color: null, hidden: true } },
    );
    vi.mocked(invoke).mockClear();
    const toggle = await waitFor(() => {
      const el = dialog.querySelector('[data-testid="tag-visibility-npc"]') as HTMLElement;
      if (!el) throw new Error("toggle not found");
      return el;
    });
    await fireEvent.click(toggle);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("set_tag_graph_style", {
        tag: "npc",
        color: null,
        hidden: false,
      });
    });
  });
});
