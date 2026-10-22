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
import { ledger } from "../lib/stores/ledger.svelte";
import { unlinkedPins } from "../lib/stores/unlinked-pins.svelte";
import { tabs } from "../lib/stores/tabs.svelte";
import type { UnlinkedPin } from "../lib/bindings.gen";

afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockResolvedValue(null);
  unlinkedPins.replace([]);
  vi.mocked(sonner).mockClear();
  vi.mocked(sonner.dismiss).mockClear();
});

const samplePins: UnlinkedPin[] = [
  {
    pin_id: 1,
    pin_title: "Waterdeep",
    map_id: 7,
    map_title: "Sword Coast",
    was_note_title: "Waterdeep",
  },
  {
    pin_id: 2,
    pin_title: "Neverwinter",
    map_id: 7,
    map_title: "Sword Coast",
    was_note_title: "City of Skilled Hands",
  },
  { pin_id: 3, pin_title: "Menzoberranzan", map_id: 9, map_title: "Underdark", was_note_title: "" },
];

function openResult(unlinked_pins: UnlinkedPin[]) {
  return {
    path: "/vault",
    note_count: 3,
    scene_count: 0,
    map_count: 1,
    failed_imports: [],
    unlinked_pins,
  };
}

/** The last toast raised: its title and options. */
function lastToast() {
  const calls = vi.mocked(sonner).mock.calls;
  return calls[calls.length - 1] as unknown as [
    string,
    { description: string; action: { label: string; onClick: (e: Event) => void } },
  ];
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

  // The message is permanent, so it belongs to the ledger that raised it.
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

    const [message, opts] = lastToast();
    expect(message).toBe("3 pins lost their note");
    // No paths, no ids, no counts of database rows — and not "when it opened",
    // since the same repair runs mid-session.
    expect(opts.description).toMatch(/notes are intact/i);
    expect(opts.description).toMatch(/these pins need linking to their note again/i);
    expect(opts.description).not.toMatch(/opened/);
    expect(opts.action.label).toBe("Show pins");
  });

  it("names one pin in the singular, all the way through", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) =>
      cmd === "open_ledger" ? openResult([samplePins[0]]) : null,
    );

    await ledger.openLedger("/vault");
    const [message, opts] = lastToast();
    expect(message).toBe("1 pin lost its note");
    expect(opts.description).toMatch(/this pin needs linking to its note again/);
  });

  it("opens the list from the toast, and the toast stays", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) =>
      cmd === "open_ledger" ? openResult(samplePins) : null,
    );

    await ledger.openLedger("/vault");
    expect(unlinkedPins.pins).toEqual(samplePins);
    expect(unlinkedPins.open).toBe(false);

    const event = new Event("click", { cancelable: true });
    flushSync(() => lastToast()[1].action.onClick(event));
    expect(unlinkedPins.open).toBe(true);
    // Sonner dismisses on an action unless it is prevented: the toast is the way
    // back to the list after fixing one pin.
    expect(event.defaultPrevented).toBe(true);
  });
});

// ── The list as pins are fixed ─────────────────────────────────────

describe("working through the list", () => {
  it("drops a fixed pin and counts the toast down", () => {
    unlinkedPins.replace(samplePins);
    unlinkedPins.resolve(1);

    expect(unlinkedPins.pins.map((p) => p.pin_id)).toEqual([2, 3]);
    expect(lastToast()[0]).toBe("2 pins still need their note");

    unlinkedPins.resolve(2);
    expect(lastToast()[0]).toBe("1 pin still needs its note");
  });

  it("takes the toast down and closes the list when the last pin is fixed", () => {
    unlinkedPins.replace([samplePins[0]]);
    unlinkedPins.show();
    unlinkedPins.resolve(1);

    expect(unlinkedPins.open).toBe(false);
    expect(vi.mocked(sonner.dismiss)).toHaveBeenCalledWith("unlinked-pins");
  });

  it("adds a mid-session batch to the pins not yet fixed, rather than replacing them", () => {
    unlinkedPins.replace([samplePins[0]]);
    unlinkedPins.add([samplePins[0], samplePins[2]]);
    expect(unlinkedPins.pins.map((p) => p.pin_id)).toEqual([1, 3]);
  });

  it("remembers the note a pin used to open, for its search", () => {
    unlinkedPins.replace(samplePins);
    expect(unlinkedPins.wasNoteFor(2)).toBe("City of Skilled Hands");
    expect(unlinkedPins.wasNoteFor(3)).toBeNull();
  });

  it("hands the chosen pin to its map once, and the caret to its search once", () => {
    unlinkedPins.replace(samplePins);
    unlinkedPins.goToPin(samplePins[1]);

    expect(unlinkedPins.takeGoTo(9)).toBeNull();
    expect(unlinkedPins.takeGoTo(7)).toBe(2);
    expect(unlinkedPins.takeGoTo(7)).toBeNull();
    expect(unlinkedPins.takeFocus(2)).toBe(true);
    expect(unlinkedPins.takeFocus(2)).toBe(false);
  });
});

// ── The list itself ───────────────────────────────────────────────

describe("UnlinkedPinsDialog", () => {
  it("groups pins under their map, each with the note it was linked to", async () => {
    unlinkedPins.replace(samplePins);
    unlinkedPins.show();
    const { findByText, getAllByTestId } = render(UnlinkedPinsDialog);

    expect(await findByText("Sword Coast")).toBeTruthy();
    expect(await findByText("Underdark")).toBeTruthy();
    expect(await findByText("was City of Skilled Hands")).toBeTruthy();
    expect(getAllByTestId("unlinked-pin-row")).toHaveLength(3);
  });

  it("titles one pin in the singular", async () => {
    unlinkedPins.replace([samplePins[0]]);
    unlinkedPins.show();
    const { findByText } = render(UnlinkedPinsDialog);
    expect(await findByText("A pin that needs its note again")).toBeTruthy();
  });

  it("takes the GM to the pin: its map opens, and the pin is asked for", async () => {
    const navigateOpen = vi.spyOn(tabs, "navigateOpen").mockImplementation(() => {});
    unlinkedPins.replace([samplePins[0]]);
    unlinkedPins.show();
    const { findByLabelText } = render(UnlinkedPinsDialog);

    (await findByLabelText(/Go to Waterdeep on Sword Coast/)).click();

    expect(navigateOpen).toHaveBeenCalledWith({ type: "map", id: 7, title: "Sword Coast" });
    expect(unlinkedPins.goTo).toEqual({ mapId: 7, pinId: 1 });
    expect(unlinkedPins.open).toBe(false);
    navigateOpen.mockRestore();
  });
});
