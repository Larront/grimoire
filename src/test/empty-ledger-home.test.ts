import { render, cleanup, act, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import PaneContent from "../lib/components/PaneContent.svelte";
import { ledger } from "../lib/stores/ledger.svelte";
import { notes } from "../lib/stores/notes.svelte";
import { tabs } from "../lib/stores/tabs.svelte";

// The world's home renders inside the pane layer (PaneContent) whenever the pane is
// empty — the route page itself is replaced by AppShell as soon as a world opens.
// Revised in the 2026-10 design review: it used to show only while a world had no
// notes, and an empty pane after that said "No tab open".

async function flush() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const note = (id: number, title: string, modified_at: string) => ({
  id,
  path: `${title}.md`,
  title,
  icon: null,
  cover_image: null,
  parent_path: null,
  archived: false,
  modified_at,
});

function mockWorld(noteList: ReturnType<typeof note>[] = [], extra: (cmd: string) => unknown = () => null) {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "open_ledger")
      return {
        path: "/test/The Sunken Coast",
        note_count: noteList.length,
        scene_count: 0,
        map_count: 0,
        failed_imports: [],
        unlinked_pins: [],
      };
    if (cmd === "get_notes") return noteList;
    // Every other list the world's stores read — scenes, maps — is empty, as a real
    // world's are, rather than null.
    // An opened note's details read its tags too.
    if (cmd === "read_note_tags") return [];
    return extra(cmd) ?? (cmd.startsWith("get_") || cmd.startsWith("list_") ? [] : null);
  });
}

afterEach(async () => {
  cleanup();
  tabs.closeAll("left");
  tabs.closeAll("right");
  await ledger.closeLedger();
  vi.mocked(invoke).mockResolvedValue(null);
});

describe("a world's home — a new, empty world", () => {
  beforeEach(async () => {
    mockWorld([]);
    await ledger.openLedger("/test/The Sunken Coast");
    await flush();
  });

  it("leads with the world's own name and the first-note line", async () => {
    const { getByRole, getByText } = render(PaneContent, { props: { pane: "left" } });
    await flush();
    expect(getByRole("heading", { name: "The Sunken Coast" })).toBeTruthy();
    expect(getByText("Every world begins with its first note.")).toBeTruthy();
  });

  it("focuses New note on arrival, so Enter writes the first note", async () => {
    const { getByTestId } = render(PaneContent, { props: { pane: "left" } });
    await flush();
    expect(document.activeElement).toBe(getByTestId("home-new-note"));
  });

  it("offers a note from a template", async () => {
    const { getByTestId } = render(PaneContent, { props: { pane: "left" } });
    await flush();
    expect(getByTestId("start-from-template").textContent?.trim()).toBe("Note from template…");
  });

  it("says a failure once — the toast — with no line repeating it under the button", async () => {
    mockWorld([], (cmd) => {
      if (cmd === "create_note") throw "ERR_BAD_NAME: no";
      return null;
    });
    const { getByTestId } = render(PaneContent, { props: { pane: "left" } });
    await flush();

    await fireEvent.click(getByTestId("home-new-note"));
    await flush();

    expect(document.querySelector("[role='alert']")).toBeNull();
  });
});

describe("a world's home — a world with notes", () => {
  beforeEach(async () => {
    mockWorld([
      note(1, "Mira Vell", "2026-10-20T00:00:00Z"),
      note(2, "The Drowned Bell", "2026-10-25T00:00:00Z"),
    ]);
    await ledger.openLedger("/test/The Sunken Coast");
    await notes.load();
    await flush();
  });

  it("still shows the world in an empty pane: what is in it, and the notes last edited", async () => {
    const { getByRole, getByText, getAllByTestId, queryByText } = render(PaneContent, {
      props: { pane: "left" },
    });
    await flush();

    expect(getByRole("heading", { name: "The Sunken Coast" })).toBeTruthy();
    expect(getByText("2 notes")).toBeTruthy();
    expect(queryByText("Every world begins with its first note.")).toBeNull();
    expect(queryByText("No tab open")).toBeNull();
    const rows = getAllByTestId("home-recent-note").map((r) => r.textContent);
    expect(rows[0]).toContain("The Drowned Bell");
    expect(rows[1]).toContain("Mira Vell");
  });

  it("opens a recent note in its own pane", async () => {
    const { getAllByTestId } = render(PaneContent, { props: { pane: "left" } });
    await flush();

    await fireEvent.click(getAllByTestId("home-recent-note")[1]);

    expect(tabs.leftActiveTab).toEqual(expect.objectContaining({ type: "note", id: 1 }));
  });

  it("takes focus only on arrival — a home shown again later leaves focus alone", async () => {
    const first = render(PaneContent, { props: { pane: "left" } });
    await flush();
    first.unmount();
    (document.activeElement as HTMLElement | null)?.blur();

    const { getByTestId } = render(PaneContent, { props: { pane: "left" } });
    await flush();

    expect(document.activeElement).not.toBe(getByTestId("home-new-note"));
  });
});
