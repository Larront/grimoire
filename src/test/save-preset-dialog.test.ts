// "Save shape as preset" (#179) — the one authoring gesture, driven from a real block.
//
// What these tests are really pinning is the *absence* of a preset editor: the only
// way a preset comes into being is the block's own chrome, and what it captures is the
// fence that block would write, uncleaned.
import { render, fireEvent, cleanup, waitFor } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import StatblockBlockView from "$lib/components/editor/StatblockBlockView.svelte";
import {
  DEFAULT_STATBLOCK_WIDTH,
  type StatblockSection,
} from "$lib/editor/statblock-block";
import type { LabelledRow } from "$lib/editor/labelled-row";

vi.mock("$lib/stores/link-resolver.svelte", () => ({
  linkResolver: { isKnown: () => true, prime: vi.fn(), resolve: vi.fn() },
}));

const ROWS: LabelledRow[] = [
  { label: "HP", value: "3/12" },
  { label: "Wounds", value: "[x][ ][ ]" },
];

const SECTIONS: StatblockSection[] = [
  { heading: "Actions", entries: [{ name: "Bite", body: "+4 to hit, 1d6." }] },
];

const calls = (cmd: string) =>
  vi.mocked(invoke).mock.calls.filter(([name]) => name === cmd);

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (cmd: string) =>
    cmd === "list_statblock_presets" ? [] : null,
  );
});

afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(null);
});

async function openDialog(name = "Goblin Scout") {
  const view = render(StatblockBlockView, {
    props: {
      name,
      rows: ROWS,
      sections: SECTIONS,
      width: DEFAULT_STATBLOCK_WIDTH,
      onCommit: vi.fn(),
    },
  });
  await fireEvent.click(view.getByLabelText("Save shape as preset"));
  await view.findByTestId("save-preset-dialog");
  return view;
}

describe("save shape as preset", () => {
  it("is reachable from the block without opening the structure mode", async () => {
    const view = render(StatblockBlockView, {
      props: {
        name: "Goblin",
        rows: ROWS,
        sections: SECTIONS,
        width: DEFAULT_STATBLOCK_WIDTH,
        onCommit: vi.fn(),
      },
    });
    expect(view.getByLabelText("Save shape as preset")).toBeTruthy();
    // The pencil is still shut — this is not an authoring-mode-only control.
    expect(view.getByLabelText("Edit statblock structure")).toBeTruthy();
  });

  it("previews the block's fence text verbatim, read-only", async () => {
    const view = await openDialog();
    const preview = view.getByTestId("preset-preview");
    expect(preview.textContent).toBe(
      "```statblock\n# Goblin Scout\nHP: 3/12\nWounds: [x][ ][ ]\n\n## Actions\nBite: +4 to hit, 1d6.\n```",
    );
    expect(preview.tagName).toBe("PRE");
    expect(preview.querySelector("input, textarea")).toBeNull();
  });

  it("offers the block's own name and saves under it", async () => {
    const view = await openDialog();
    const input = view.getByTestId("preset-name-input") as HTMLInputElement;
    expect(input.value).toBe("Goblin Scout");

    await fireEvent.click(view.getByTestId("preset-save-btn"));

    await waitFor(() => expect(calls("save_statblock_preset")).toHaveLength(1));
    const [, args] = calls("save_statblock_preset")[0] as [
      string,
      Record<string, string>,
    ];
    expect(args.name).toBe("Goblin Scout");
    expect(args.fence).toContain("HP: 3/12");
  });

  it("saves a played value exactly as it stands — no cleaning, no blanking", async () => {
    const view = await openDialog();
    await fireEvent.click(view.getByTestId("preset-save-btn"));

    await waitFor(() => expect(calls("save_statblock_preset")).toHaveLength(1));
    const [, args] = calls("save_statblock_preset")[0] as [
      string,
      Record<string, string>,
    ];
    expect(args.fence).toContain("HP: 3/12");
    expect(args.fence).toContain("Wounds: [x][ ][ ]");
    expect(args.fence).not.toContain("12/12");
  });

  it("refuses to save under no name at all", async () => {
    const view = await openDialog("");
    const input = view.getByTestId("preset-name-input");
    await fireEvent.input(input, { target: { value: "   " } });

    expect(
      (view.getByTestId("preset-save-btn") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("warns that a name already in the store will be saved over", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) =>
      cmd === "list_statblock_presets"
        ? [{ name: "Goblin Scout", fence: "```statblock\nHP: 1/1\n```" }]
        : null,
    );
    const view = await openDialog();
    await waitFor(() =>
      expect(view.getByTestId("preset-replaces").textContent).toContain(
        "Goblin Scout",
      ),
    );
  });

  // The shipped two cannot be edited or deleted, and saving over their names would be
  // exactly that by another route.
  it("refuses a shipped preset's name outright", async () => {
    const view = await openDialog();
    await fireEvent.input(view.getByTestId("preset-name-input"), {
      target: { value: "  large ORC " },
    });

    await waitFor(() =>
      expect(view.getByTestId("preset-reserved").textContent).toContain(
        "built-in",
      ),
    );
    expect(
      (view.getByTestId("preset-save-btn") as HTMLButtonElement).disabled,
    ).toBe(true);

    await fireEvent.click(view.getByTestId("preset-save-btn"));
    expect(calls("save_statblock_preset")).toHaveLength(0);
  });
});
