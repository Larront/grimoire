import { render, cleanup, act, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
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

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
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
    expect(row.textContent).toContain("/mnt/usb/lost-world");
    // The healthy entry still renders as an openable row.
    expect(getByText("My Campaign")).toBeTruthy();
    // A missing entry never triggers open_ledger — there is no open button for it.
    expect(queryByText("Folder not found — /worlds/my-campaign")).toBeNull();
  });

  it("remove button calls remove_recent_ledger and drops the row", async () => {
    mockInvoke([PRESENT, MISSING]);
    const { getByTestId, queryByTestId } = render(HomePage);
    await flush();

    await fireEvent.click(getByTestId("recent-remove-btn"));
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
