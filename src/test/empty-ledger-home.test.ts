import { render, cleanup, act } from "@testing-library/svelte";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import PaneContent from "../lib/components/PaneContent.svelte";
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

// The empty-ledger home renders inside the pane layer (PaneContent) when a
// ledger is open with no notes and no tab focused — the route page itself is
// replaced by AppShell as soon as a ledger opens.
describe("empty-ledger home — template affordance", () => {
  beforeEach(async () => {
    mockOpenLedger([]);
    await ledger.openLedger("/test/new-world");
    await flush();
  });

  it("renders the 'or start from a template' affordance when ledger is empty", async () => {
    const { getByTestId } = render(PaneContent, { props: { pane: "left" } });
    await flush();
    expect(getByTestId("start-from-template")).toBeTruthy();
  });

  it("renders the first-note prompt when ledger is empty", async () => {
    const { getByText } = render(PaneContent, { props: { pane: "left" } });
    await flush();
    expect(getByText("Every world begins with its first note.")).toBeTruthy();
  });

  it("does not render the template affordance when ledger has notes", async () => {
    mockOpenLedger([NOTE]);
    await notes.load();
    await flush();

    const { queryByTestId, getByText } = render(PaneContent, {
      props: { pane: "left" },
    });
    await flush();
    expect(queryByTestId("start-from-template")).toBeNull();
    // Populated ledger with no focused tab falls back to the plain placeholder
    expect(getByText("No tab open")).toBeTruthy();
  });
});
