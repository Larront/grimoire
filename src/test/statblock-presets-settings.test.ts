import { render, fireEvent, cleanup, waitFor, within } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import StatblockPresetsSettings from "../lib/components/StatblockPresetsSettings.svelte";
import type { StatblockPreset } from "$lib/editor/statblock-presets";

const GOBLIN: StatblockPreset = {
  name: "Goblin",
  fence: "```statblock\n# Goblin\nHP: 7/7\n```",
};

/** Answer the two reads the section makes, and record everything else. */
function ledgerWith(presets: StatblockPreset[], defaultName: string | null) {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "list_statblock_presets") return presets;
    if (cmd === "get_ledger_path") return "/vault";
    if (cmd === "get_statblock_preset_default") return defaultName;
    return null;
  });
}

const calls = (cmd: string) => vi.mocked(invoke).mock.calls.filter(([name]) => name === cmd);

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  ledgerWith([], null);
});

afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(null);
});

async function open(presets: StatblockPreset[], defaultName: string | null = null) {
  ledgerWith(presets, defaultName);
  const result = render(StatblockPresetsSettings, { props: { open: true } });
  await waitFor(() => expect(calls("list_statblock_presets").length).toBeGreaterThan(0));
  return result;
}

// ── The list ─────────────────────────────────────────────────────────────────

describe("statblock presets — the list", () => {
  it("lists the GM's own presets", async () => {
    const view = await open([GOBLIN]);
    const list = view.getByTestId("statblock-preset-list");
    await waitFor(() => expect(within(list).getByText("Goblin")).toBeTruthy());
  });

  it("says so when there are none", async () => {
    const view = await open([]);
    const list = view.getByTestId("statblock-preset-list");
    expect(within(list).getByText(/haven't saved any presets/i)).toBeTruthy();
  });

  it("lists the two shipped presets as un-editable", async () => {
    const view = await open([]);
    const builtins = view.getByTestId("statblock-builtin-list");
    expect(within(builtins).getByText("5E SRD")).toBeTruthy();
    expect(within(builtins).getByText("Large Orc")).toBeTruthy();
    expect(within(builtins).queryByRole("button")).toBeNull();
  });

  it("refuses to rename a preset onto a shipped name", async () => {
    const view = await open([GOBLIN]);
    await fireEvent.click(await view.findByLabelText("Rename Goblin"));

    const input = view.getByTestId("preset-rename-input");
    await fireEvent.input(input, { target: { value: "5e srd" } });
    await waitFor(() => expect(view.getByTestId("rename-reserved")).toBeTruthy());

    await fireEvent.keyDown(input, { key: "Enter" });
    expect(calls("rename_statblock_preset")).toHaveLength(0);
  });
});

// ── The default pointer ──────────────────────────────────────────────────────

describe("statblock presets — the vault's default", () => {
  it("offers Blank, the shipped two and the GM's own", async () => {
    const view = await open([GOBLIN]);
    const select = view.getByTestId("statblock-default-select") as HTMLSelectElement;
    await waitFor(() =>
      expect([...select.options].map((o) => o.textContent?.trim())).toEqual([
        "Blank",
        "5E SRD",
        "Large Orc",
        "Goblin",
      ]),
    );
  });

  it("choosing a preset stores the pointer", async () => {
    const view = await open([GOBLIN]);
    const select = view.getByTestId("statblock-default-select") as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(4));

    await fireEvent.change(select, { target: { value: "Goblin" } });

    await waitFor(() =>
      expect(calls("save_statblock_preset_default")[0][1]).toEqual({
        preset: "Goblin",
      }),
    );
  });

  it("choosing Blank clears the pointer — blank is the absence of a preset", async () => {
    const view = await open([GOBLIN], "Goblin");
    const select = view.getByTestId("statblock-default-select") as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("Goblin"));

    await fireEvent.change(select, { target: { value: "" } });

    await waitFor(() =>
      expect(calls("save_statblock_preset_default")[0][1]).toEqual({
        preset: null,
      }),
    );
  });

  it("reports a pointer that no longer resolves as (not found)", async () => {
    const view = await open([GOBLIN], "Bugbear");
    const select = view.getByTestId("statblock-default-select") as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("Bugbear"));
    expect([...select.options].some((o) => o.textContent?.includes("Bugbear (not found)"))).toBe(
      true,
    );
  });

  it("does not mark a resolvable pointer as missing", async () => {
    const view = await open([GOBLIN], "goblin");
    const select = view.getByTestId("statblock-default-select") as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(4));
    expect([...select.options].some((o) => o.textContent?.includes("not found"))).toBe(false);
  });
});

// ── Rename and delete ────────────────────────────────────────────────────────

describe("statblock presets — rename and delete", () => {
  it("renames a preset", async () => {
    const view = await open([GOBLIN]);
    await fireEvent.click(await view.findByLabelText("Rename Goblin"));

    const input = view.getByTestId("preset-rename-input");
    await fireEvent.input(input, { target: { value: "Goblin Scout" } });
    await fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(calls("rename_statblock_preset")[0][1]).toEqual({
        from: "Goblin",
        to: "Goblin Scout",
      }),
    );
  });

  it("escape abandons a rename", async () => {
    const view = await open([GOBLIN]);
    await fireEvent.click(await view.findByLabelText("Rename Goblin"));

    const input = view.getByTestId("preset-rename-input");
    await fireEvent.input(input, { target: { value: "Nope" } });
    await fireEvent.keyDown(input, { key: "Escape" });

    expect(calls("rename_statblock_preset")).toHaveLength(0);
    await waitFor(() => expect(view.queryByTestId("preset-rename-input")).toBeNull());
  });

  it("deletes a preset behind a confirmation", async () => {
    const view = await open([GOBLIN]);
    await fireEvent.click(await view.findByLabelText("Delete Goblin"));

    const confirm = await view.findByTestId("preset-delete-confirm");
    await fireEvent.click(confirm);

    await waitFor(() =>
      expect(calls("delete_statblock_preset")[0][1]).toEqual({
        name: "Goblin",
      }),
    );
  });

  it("deleting does not clear a default pointing at it — it dangles, visibly", async () => {
    const view = await open([GOBLIN], "Goblin");
    await fireEvent.click(await view.findByLabelText("Delete Goblin"));
    await fireEvent.click(await view.findByTestId("preset-delete-confirm"));

    await waitFor(() => expect(calls("delete_statblock_preset")).toHaveLength(1));
    expect(calls("save_statblock_preset_default")).toHaveLength(0);
  });
});
