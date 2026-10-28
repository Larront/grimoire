import { render, cleanup, act, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import LedgerSelector from "../lib/components/sidebar/LedgerSelector.svelte";
import LedgerHome from "../lib/components/panes/LedgerHome.svelte";
import SampleEffects from "../lib/components/SampleEffects.svelte";
import { ledger } from "../lib/stores/ledger.svelte";
import { dialogs } from "../lib/stores/overlay.svelte";
import { tabs } from "../lib/stores/tabs.svelte";

const SAMPLE_PATH = "/app-data/sample-world";
const SAMPLE_TABS_KEY = `grimoire:tabs:${SAMPLE_PATH}`;

const START_HERE_NOTE = {
  id: 1,
  path: "Start Here.md",
  title: "Start Here",
  icon: null,
  cover_image: null,
  parent_path: null,
  archived: false,
  modified_at: "2026-01-01T00:00:00Z",
};

const RECENT = {
  path: "/worlds/Gods Ascendant",
  name: "Gods Ascendant",
  note_count: 3,
  scene_count: 0,
  map_count: 0,
  last_opened: "2026-01-01T00:00:00Z",
  missing: false,
};

function mockSampleInvoke(noteList = [START_HERE_NOTE]) {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "explore_sample_ledger") return SAMPLE_PATH;
    if (cmd === "open_ledger")
      return {
        path: SAMPLE_PATH,
        note_count: noteList.length,
        scene_count: 0,
        map_count: 0,
        failed_imports: [],
        unlinked_pins: [],
      };
    if (cmd === "get_notes") return noteList;
    if (cmd === "get_recent_ledgers") return [RECENT];
    if (cmd === "close_ledger") return null;
    // Every other list a world's stores read — scenes, maps — is empty, not null.
    return cmd.startsWith("get_") || cmd.startsWith("list_") ? [] : null;
  });
}

async function flush() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// ── The example, in the sidebar's ledger menu ───────────────────────────────
// 2026-10 design review: the example kept its own marker in place of the ledger
// menu, which left no way back to the GM's own ledgers but a folder picker. It
// now keeps the same menu, named as itself, with Make this ledger mine added.

describe("the example in the ledger menu", () => {
  beforeEach(async () => {
    await ledger.closeLedger();
    vi.mocked(invoke).mockReset();
    localStorage.removeItem(SAMPLE_TABS_KEY);
  });

  afterEach(async () => {
    cleanup();
    dialogs.adoptOpen = false;
    await ledger.closeLedger();
    vi.mocked(invoke).mockResolvedValue(null);
  });

  it("is named as itself, marked as an example", async () => {
    mockSampleInvoke();
    await ledger.exploreSample();
    await flush();

    const { getByTestId } = render(LedgerSelector);
    await flush();

    const marker = getByTestId("sample-world-marker");
    expect(marker.textContent).toContain("The Ashfen Vale");
    expect(marker.textContent).toContain("example");
    expect(marker.textContent).not.toContain("Example World");
  });

  it("keeps the way back to the GM's own ledgers, and offers to make it theirs", async () => {
    mockSampleInvoke();
    await ledger.exploreSample();
    await flush();

    const { getByTestId, getByText } = render(LedgerSelector);
    await flush();
    await fireEvent.click(getByTestId("sample-world-marker"));
    await flush();

    expect(getByText("Gods Ascendant")).toBeTruthy();
    await fireEvent.click(getByTestId("make-mine-btn"));
    expect(dialogs.adoptOpen).toBe(true);
  });

  it("offers nothing about the example in a ledger of the GM's own", async () => {
    const { queryByTestId } = render(LedgerSelector);
    await flush();

    expect(queryByTestId("sample-world-marker")).toBeNull();
    expect(queryByTestId("make-mine-btn")).toBeNull();
  });
});

// ── The example explains itself on its own home ─────────────────────────────

describe("the example's home", () => {
  beforeEach(async () => {
    await ledger.closeLedger();
    vi.mocked(invoke).mockReset();
    localStorage.removeItem(SAMPLE_TABS_KEY);
  });

  afterEach(async () => {
    cleanup();
    dialogs.adoptOpen = false;
    await ledger.closeLedger();
    vi.mocked(invoke).mockResolvedValue(null);
  });

  it("says it is an example, that changes are kept, and how to make it yours", async () => {
    mockSampleInvoke();
    await ledger.exploreSample();
    await flush();

    const { getByRole, getByTestId, getByText } = render(LedgerHome, { props: { pane: "left" } });
    await flush();

    expect(getByRole("heading", { name: "The Ashfen Vale" })).toBeTruthy();
    expect(getByTestId("home-example").textContent).toContain("An example ledger");
    expect(getByText("What you change here is kept for next time.")).toBeTruthy();
    await fireEvent.click(getByTestId("home-make-mine"));
    expect(dialogs.adoptOpen).toBe(true);
  });
});

// ── SampleEffects: auto-open Start Here ──────────────────────────────────────

describe("SampleEffects — auto-open Start Here", () => {
  beforeEach(async () => {
    await ledger.closeLedger();
    vi.mocked(invoke).mockReset();
    localStorage.removeItem(SAMPLE_TABS_KEY);
  });

  afterEach(async () => {
    cleanup();
    await ledger.closeLedger();
    vi.mocked(invoke).mockResolvedValue(null);
  });

  it("opens the Start Here tab after exploreSample and notes load", async () => {
    mockSampleInvoke([START_HERE_NOTE]);

    render(SampleEffects);
    await ledger.exploreSample();
    await flush();
    await flush();

    expect(tabs.left.tabs.some((t) => t.title === "Start Here" && t.type === "note")).toBe(true);
  });

  it("clears pendingStartHere after opening the tab", async () => {
    mockSampleInvoke([START_HERE_NOTE]);

    render(SampleEffects);
    await ledger.exploreSample();
    await flush();
    await flush();

    expect(ledger.pendingStartHere).toBe(false);
  });
});
