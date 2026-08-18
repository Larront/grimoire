import { render, cleanup } from "@testing-library/svelte";
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

import { toast as sonner } from "svelte-sonner";
import UnlinkedPinsDialog from "../lib/components/UnlinkedPinsDialog.svelte";
import { ledger, unlinkedPinsModal } from "../lib/stores/ledger.svelte";
import { tabs } from "../lib/stores/tabs.svelte";

afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockResolvedValue(null);
  vi.mocked(sonner).mockClear();
  unlinkedPinsModal.open = false;
  unlinkedPinsModal.pins = [];
});

const samplePins = [
  { pin_id: 1, pin_title: "Waterdeep", map_id: 7, map_title: "Sword Coast" },
  { pin_id: 2, pin_title: "Neverwinter", map_id: 7, map_title: "Sword Coast" },
];

function openResult(unlinked_pins: typeof samplePins) {
  return {
    path: "/vault",
    note_count: 3,
    scene_count: 0,
    map_count: 1,
    failed_imports: [],
    unlinked_pins,
  };
}

// ── What the GM is told ───────────────────────────────────────────

describe("a ledger repair that re-created notes", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockResolvedValue(null);
  });

  // The common case, and the whole reason this can be a permanent toast without
  // becoming corner-noise: almost every open finds nothing to repair.
  it("says nothing when the repair changed nothing", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) =>
      cmd === "open_ledger" ? openResult([]) : null,
    );

    await ledger.openLedger("/vault");
    expect(vi.mocked(sonner)).not.toHaveBeenCalled();
  });

  // The message is permanent, so it belongs to the ledger that raised it: opening
  // a second vault with nothing to repair has to take the first one's message down
  // rather than leave it hanging over a ledger it says nothing about.
  it("takes the message down when the next ledger has nothing to repair", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) =>
      cmd === "open_ledger" ? openResult([]) : null,
    );

    await ledger.openLedger("/other-vault");
    expect(vi.mocked(sonner.dismiss)).toHaveBeenCalledWith("unlinked-pins");
  });

  it("tells the GM when pins were left pointing at nothing", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) =>
      cmd === "open_ledger" ? openResult(samplePins) : null,
    );

    await ledger.openLedger("/vault");

    const [message, opts] = vi.mocked(sonner).mock.calls[0] as unknown as [
      string,
      { description: string; action: { label: string } },
    ];
    expect(message).toBe("2 pins lost their note");
    // The GM-facing voice (ADR-0010): no paths, no ids, no counts of database
    // rows — what happened, and what they may need to do about it.
    expect(opts.description).toMatch(/notes are intact/i);
    expect(opts.description).toMatch(/linking to them again/i);
    expect(opts.action.label).toBe("Show pins");
  });

  it("names one pin in the singular", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) =>
      cmd === "open_ledger" ? openResult([samplePins[0]]) : null,
    );

    await ledger.openLedger("/vault");
    expect(vi.mocked(sonner).mock.calls[0][0]).toBe("1 pin lost its note");
  });

  // "Discoverable rather than merely reported": the message has to lead
  // somewhere, or it is a fact the GM cannot act on.
  it("opens the pin list from the toast", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) =>
      cmd === "open_ledger" ? openResult(samplePins) : null,
    );

    await ledger.openLedger("/vault");
    expect(unlinkedPinsModal.pins).toEqual(samplePins);
    expect(unlinkedPinsModal.open).toBe(false);

    const opts = vi.mocked(sonner).mock.calls[0][1] as unknown as {
      action: { onClick: () => void };
    };
    flushSync(() => opts.action.onClick());
    expect(unlinkedPinsModal.open).toBe(true);
  });
});

// ── The list itself ───────────────────────────────────────────────

describe("UnlinkedPinsDialog", () => {
  it("names each pin and the map it sits on", async () => {
    const { findByText, findAllByText } = render(UnlinkedPinsDialog, {
      open: true,
      pins: samplePins,
    });

    expect(await findByText("Waterdeep")).toBeTruthy();
    expect(await findByText("Neverwinter")).toBeTruthy();
    expect((await findAllByText("Sword Coast")).length).toBe(2);
  });

  it("takes the GM to the map the pin is on", async () => {
    const navigateOpen = vi.spyOn(tabs, "navigateOpen").mockImplementation(() => {});

    const { findByText } = render(UnlinkedPinsDialog, {
      open: true,
      pins: [samplePins[0]],
    });

    const row = (await findByText("Waterdeep")).closest("button");
    row?.click();

    expect(navigateOpen).toHaveBeenCalledWith({
      type: "map",
      id: 7,
      title: "Sword Coast",
    });
    navigateOpen.mockRestore();
  });
});
