import { render, cleanup, fireEvent, waitFor } from "@testing-library/svelte";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { flushSync } from "svelte";

vi.mock("svelte-sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    dismiss: vi.fn(),
  }),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn().mockResolvedValue(undefined),
}));

import { toast as sonner } from "svelte-sonner";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import FailedImportsDialog from "../lib/components/FailedImportsDialog.svelte";
import { ledger } from "../lib/stores/ledger.svelte";
import { unreadableNotes } from "../lib/stores/unreadable-notes.svelte";
import { needsAttention } from "../lib/stores/needs-attention.svelte";

afterEach(async () => {
  cleanup();
  unreadableNotes.replace([]);
  vi.mocked(invoke).mockResolvedValue(null);
  vi.mocked(sonner).mockClear();
  vi.mocked(sonner.dismiss).mockClear();
  vi.mocked(sonner.success).mockClear();
});

const sampleFailures = [
  {
    path: "Sessions/Session 4.md",
    reason: "Another program is using it. Close that program, or wait for syncing to finish.",
  },
  {
    path: "Lore/Embers.md",
    reason: "It's only in the cloud. Start OneDrive, or your sync app, and try again.",
  },
  { path: "Archive/", reason: "Your computer won't let Grimoire read it. Check its permissions." },
];

function openResult(failed_imports: typeof sampleFailures) {
  return {
    path: "/worlds/Ashfen",
    note_count: 3,
    scene_count: 0,
    map_count: 0,
    failed_imports,
    unlinked_pins: [],
  };
}

// ── Opening a world ─────────────────────────────────────────────────

describe("a world with notes it couldn't read", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockResolvedValue(null);
  });

  it("says nothing when every note read", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) =>
      cmd === "open_ledger" ? openResult([]) : null,
    );
    await ledger.openLedger("/worlds/Ashfen");
    expect(vi.mocked(sonner)).not.toHaveBeenCalled();
    expect(vi.mocked(sonner.error)).not.toHaveBeenCalled();
  });

  // Listed where the world says what needs attention, not raised as a toast that
  // outlived its world (2026-10 design review).
  it("keeps the list and says so where the world needs attention, not in a toast", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) =>
      cmd === "open_ledger" ? openResult(sampleFailures) : null,
    );
    await ledger.openLedger("/worlds/Ashfen");

    expect(unreadableNotes.items).toEqual(sampleFailures);
    expect(vi.mocked(sonner)).not.toHaveBeenCalled();
    const item = needsAttention.items.find((i) => i.kind === "notes")!;
    expect(item.label).toBe("3 notes couldn't be opened");
    flushSync(() => void item.action.run());
    expect(unreadableNotes.open).toBe(true);
  });

  it("takes the last world's list down when the next opens cleanly", async () => {
    unreadableNotes.replace(sampleFailures);
    vi.mocked(invoke).mockImplementation(async (cmd) =>
      cmd === "open_ledger" ? openResult([]) : null,
    );
    await ledger.openLedger("/worlds/Other");
    expect(unreadableNotes.count).toBe(0);
    expect(needsAttention.items.some((i) => i.kind === "notes")).toBe(false);
  });

  it("takes the list down when the world closes", async () => {
    unreadableNotes.replace(sampleFailures);
    await ledger.closeLedger();
    expect(unreadableNotes.count).toBe(0);
  });
});

// ── The list ────────────────────────────────────────────────────────

describe("FailedImportsDialog", () => {
  async function open(items = sampleFailures) {
    unreadableNotes.replace(items);
    unreadableNotes.show();
    const view = render(FailedImportsDialog);
    await view.findByTestId("failed-imports-dialog");
    return view;
  }

  it("names each note by its name, under its folder, with why in words", async () => {
    const view = await open();
    expect(view.getByText("Session 4")).toBeTruthy();
    expect(view.getByText("Sessions")).toBeTruthy();
    expect(view.getByText("Archive (folder)")).toBeTruthy();
    expect(view.getByText(/only in the cloud/)).toBeTruthy();
    expect(view.queryByText(/os error/)).toBeNull();
    expect(view.getAllByTestId("failed-import-row")).toHaveLength(3);
  });

  it("says the files are safe, in the singular for one", async () => {
    const view = await open([sampleFailures[0]]);
    expect(view.getByText("A note Grimoire couldn't open")).toBeTruthy();
    expect(view.getByText(/It's still in your ledger's folder, untouched/)).toBeTruthy();
  });

  it("shows a note in its folder on disk", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) =>
      cmd === "open_ledger" ? openResult([]) : null,
    );
    await ledger.openLedger("/worlds/Ashfen");
    const view = await open();
    await fireEvent.click(view.getByLabelText("Show Session 4 in its folder"));
    expect(revealItemInDir).toHaveBeenCalledWith("/worlds/Ashfen/Sessions/Session 4.md");
  });

  it("tries again: notes that read now leave the list, and it says how many", async () => {
    const view = await open();
    vi.mocked(invoke).mockImplementation(async (cmd) =>
      cmd === "reread_notes" ? { failed_imports: [sampleFailures[2]], unlinked_pins: [] } : null,
    );
    await fireEvent.click(view.getByTestId("failed-imports-retry"));

    await waitFor(() =>
      expect(view.getByTestId("failed-imports-outcome").textContent).toContain("2 open now."),
    );
    expect(unreadableNotes.items).toEqual([sampleFailures[2]]);
    expect(view.getAllByTestId("failed-import-row")).toHaveLength(1);
  });

  it("closes, and says so, when everything reads", async () => {
    await open([sampleFailures[0]]);
    vi.mocked(invoke).mockImplementation(async (cmd) =>
      cmd === "reread_notes" ? { failed_imports: [], unlinked_pins: [] } : null,
    );
    await unreadableNotes.retry();
    expect(unreadableNotes.open).toBe(false);
    expect(vi.mocked(sonner.success)).toHaveBeenCalledWith(
      "Every note opens again",
      expect.anything(),
    );
  });
});
