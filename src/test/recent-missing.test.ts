import { render, cleanup, act, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import HomePage from "../routes/+page.svelte";
import { ledger } from "../lib/stores/ledger.svelte";

const PRESENT = {
  path: "/worlds/my-campaign",
  name: "My Campaign",
  note_count: 5,
  scene_count: 0,
  map_count: 0,
  last_opened: new Date().toISOString(),
  missing: false,
};

const MISSING = {
  path: "/mnt/usb/lost-world",
  name: "Lost World",
  note_count: 12,
  scene_count: 2,
  map_count: 1,
  last_opened: new Date().toISOString(),
  missing: true,
};

function mockInvoke(recents: unknown[]) {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "get_recent_ledgers") return recents;
    if (cmd === "remove_recent_ledger") return null;
    return null;
  });
}

// The Splash reads its worlds and the example's state together, so give the
// promise chain a few turns.
async function flush() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("Splash — missing recent ledgers (issue #111)", () => {
  beforeEach(async () => {
    await ledger.closeLedger();
  });

  afterEach(async () => {
    cleanup();
    vi.mocked(invoke).mockResolvedValue(null);
  });

  it("renders a missing entry as a non-clickable 'Folder not found' row", async () => {
    mockInvoke([PRESENT, MISSING]);
    const { getByTestId, getByText, queryByText } = render(HomePage);
    await flush();

    const row = getByTestId("recent-missing");
    expect(row.textContent).toContain("Lost World");
    expect(row.textContent).toContain("Folder not found");
    // The end of the path on the row, the whole of it on hover.
    expect(row.textContent).toContain("lost-world");
    expect(row.querySelector("[title='/mnt/usb/lost-world']")).toBeTruthy();
    // The healthy entry still renders as an openable row.
    expect(getByText("My Campaign")).toBeTruthy();
    // A missing entry never triggers open_ledger — there is no open button for it.
    expect(queryByText("Folder not found — /worlds/my-campaign")).toBeNull();
  });

  it("remove button calls remove_recent_ledger and drops the row", async () => {
    mockInvoke([PRESENT, MISSING]);
    const { getByLabelText, queryByTestId } = render(HomePage);
    await flush();

    // Every ledger can be taken off the list now, not only a missing one.
    await fireEvent.click(getByLabelText("Remove Lost World from recent ledgers"));
    await flush();

    const calls = vi.mocked(invoke).mock.calls;
    const removal = calls.find(([cmd]) => cmd === "remove_recent_ledger");
    expect(removal?.[1]).toMatchObject({ path: "/mnt/usb/lost-world" });
    expect(queryByTestId("recent-missing")).toBeNull();
  });

  it("healthy entries render no missing treatment", async () => {
    mockInvoke([PRESENT]);
    const { queryByTestId } = render(HomePage);
    await flush();

    expect(queryByTestId("recent-missing")).toBeNull();
  });
});

// Find it (2026-10 design review): a moved world could only be taken off the list.
describe("Splash — finding a world whose folder moved", () => {
  const MOVED_TO = "/mnt/backup/lost-world";

  function mockFind(opens: "ok" | "refused") {
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "get_recent_ledgers") return [PRESENT, MISSING];
      if (cmd === "open_ledger") {
        if (opens === "refused") throw new Error("could not open");
        return {
          path: (args as { path: string }).path,
          note_count: 12,
          scene_count: 2,
          map_count: 1,
          failed_imports: [],
          unlinked_pins: [],
        };
      }
      if (cmd.startsWith("get_") || cmd.startsWith("list_")) return [];
      return null;
    });
  }

  const calls = (cmd: string) => vi.mocked(invoke).mock.calls.filter(([c]) => c === cmd);

  beforeEach(async () => {
    await ledger.closeLedger();
    vi.mocked(invoke).mockClear();
    vi.mocked(dialogOpen).mockReset();
  });

  afterEach(async () => {
    cleanup();
    await ledger.closeLedger();
    vi.mocked(invoke).mockResolvedValue(null);
  });

  it("opens the world from where the GM says it is, and drops the entry for the old folder", async () => {
    mockFind("ok");
    vi.mocked(dialogOpen).mockResolvedValue(MOVED_TO);
    const { getByLabelText } = render(HomePage);
    await flush();

    await fireEvent.click(getByLabelText("Find Lost World…"));
    await flush();

    expect(vi.mocked(dialogOpen)).toHaveBeenCalledWith(
      expect.objectContaining({ directory: true, title: "Where is Lost World now?" }),
    );
    expect(calls("open_ledger")[0]?.[1]).toMatchObject({ path: MOVED_TO });
    expect(calls("remove_recent_ledger")[0]?.[1]).toMatchObject({ path: MISSING.path });
  });

  it("leaves the list alone when the GM backs out of choosing", async () => {
    mockFind("ok");
    vi.mocked(dialogOpen).mockResolvedValue(null);
    const { getByLabelText } = render(HomePage);
    await flush();

    await fireEvent.click(getByLabelText("Find Lost World…"));
    await flush();

    expect(calls("open_ledger")).toHaveLength(0);
    expect(calls("remove_recent_ledger")).toHaveLength(0);
  });

  it("keeps the old entry when the chosen folder won't open", async () => {
    mockFind("refused");
    vi.mocked(dialogOpen).mockResolvedValue(MOVED_TO);
    const { getByLabelText } = render(HomePage);
    await flush();

    await fireEvent.click(getByLabelText("Find Lost World…"));
    await flush();

    expect(calls("open_ledger")).toHaveLength(1);
    expect(calls("remove_recent_ledger")).toHaveLength(0);
  });
});
