import { render, cleanup, act } from "@testing-library/svelte";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import HomePage from "../routes/+page.svelte";
import { ledger } from "../lib/stores/ledger.svelte";
import { notes } from "../lib/stores/notes.svelte";

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

const NOTE = {
  id: 1,
  path: "First Note.md",
  title: "First Note",
  icon: null,
  cover_image: null,
  parent_path: null,
  archived: false,
  modified_at: "2026-01-01T00:00:00Z",
};

function mockOpenLedger(noteList: typeof NOTE[] = []) {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "open_ledger")
      return {
        path: "/test/new-world",
        note_count: noteList.length,
        scene_count: 0,
        map_count: 0,
        failed_imports: [],
      };
    if (cmd === "get_notes") return noteList;
    if (cmd === "get_recent_ledgers") return [];
    return null;
  });
}

afterEach(async () => {
  cleanup();
  await ledger.closeLedger();
  vi.mocked(invoke).mockResolvedValue(null);
});

describe("empty-ledger home — template affordance", () => {
  beforeEach(async () => {
    mockOpenLedger([]);
    await ledger.openLedger("/test/new-world");
    await flush();
  });

  it("renders the 'or start from a template' affordance when ledger is empty", async () => {
    const { getByTestId } = render(HomePage);
    await flush();
    expect(getByTestId("start-from-template")).toBeTruthy();
  });

  it("does not render the template affordance when ledger has notes", async () => {
    mockOpenLedger([NOTE]);
    await notes.load();
    await flush();

    const { queryByTestId } = render(HomePage);
    await flush();
    expect(queryByTestId("start-from-template")).toBeNull();
  });
});
