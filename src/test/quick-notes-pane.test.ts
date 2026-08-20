// The Quick Notes Pane (#230) — park a thought, find it again.
//
// The seam is the real store over a mocked `invoke`: what the pane draws comes
// back through `list_quick_notes` the way it does in the app, and a capture is a
// real `create_quick_note` followed by a real re-read. That is what makes the
// round trip — type a line, watch it land in today's group — a claim rather than
// a mock returning what the test wanted.
import { render, fireEvent, cleanup, waitFor } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import QuickNotesPane from "$lib/components/panes/QuickNotesPane.svelte";
import { quickNotes } from "$lib/stores/quick-notes.svelte";
import { tabs } from "$lib/stores/tabs.svelte";
import type { QuickNote } from "$lib/bindings.gen";

// Everything resolves to the same note, so a click on a drawn link has somewhere
// to go; the pane's own rule about *unresolved* targets is asserted separately.
const resolve = vi.fn();
vi.mock("$lib/stores/link-resolver.svelte", () => ({
  linkResolver: {
    isKnown: () => true,
    prime: vi.fn(),
    resolve: (...args: unknown[]) => resolve(...args),
  },
}));

// What the `[[` dropdown offers — the capture box takes the same autocomplete
// every other free-text surface does, so its query goes through `search_notes`.
const SEARCH_RESULTS = [
  { id: 42, title: "Mira Ashvale", path: "People/Mira Ashvale.md" },
  { id: 43, title: "Marsh Road", path: "Places/Marsh Road.md" },
];

let rows: QuickNote[] = [];

function note(id: number, body: string, local: string): QuickNote {
  return { id, body, captured_at: new Date(local).toISOString() };
}

const today = () => new Date().toISOString().slice(0, 10);

beforeEach(() => {
  rows = [];
  resolve.mockReset();
  vi.mocked(invoke).mockClear();
  resolve.mockResolvedValue({ id: 42, title: "Mira Ashvale", path: "People/Mira Ashvale.md" });
  vi.mocked(invoke).mockImplementation((cmd: string, args?: unknown) => {
    if (cmd === "list_quick_notes") return Promise.resolve([...rows]);
    if (cmd === "search_notes") return Promise.resolve(SEARCH_RESULTS);
    if (cmd === "create_quick_note") {
      const created = note(
        rows.length + 1,
        String((args as { body?: string })?.body),
        new Date().toISOString(),
      );
      rows = [...rows, created];
      return Promise.resolve(created);
    }
    return Promise.resolve(null);
  });
});

afterEach(async () => {
  cleanup();
  tabs.closeAll("left");
  tabs.closeAll("right");
  rows = [];
  await quickNotes.load();
});

/** Mount the pane with the store already holding `rows`. */
async function open() {
  await quickNotes.load();
  const view = render(QuickNotesPane);
  await waitFor(() => expect(document.querySelector("[data-quick-notes-pane]")).toBeTruthy());
  return view;
}

const captureBox = () =>
  document.querySelector<HTMLInputElement>("[data-wiki-capture]") as HTMLInputElement;

describe("Quick Notes Pane", () => {
  it("says one warm line when the pen is empty, and nothing else", async () => {
    await open();
    const empty = document.querySelector("[data-quick-notes-empty]");
    expect(empty?.textContent?.trim()).toBe("Thoughts that arrived before their place did.");
    // No illustration, no example rows: the line is the whole empty state.
    expect(document.querySelectorAll("[data-quick-note]")).toHaveLength(0);
  });

  it("commits a line into today's group and clears for the next one", async () => {
    await open();
    const box = captureBox();

    await fireEvent.input(box, { target: { value: "the marsh fires spread west" } });
    await fireEvent.keyDown(box, { key: "Enter" });

    await waitFor(() => expect(document.querySelectorAll("[data-quick-note]")).toHaveLength(1));
    expect(invoke).toHaveBeenCalledWith("create_quick_note", {
      body: "the marsh fires spread west",
    });
    // Landed under today's heading, which is where a thought parked now belongs.
    const group = document.querySelector(`[data-capture-day="${today()}"]`);
    expect(group?.textContent).toContain("Today");
    expect(group?.textContent).toContain("the marsh fires spread west");
    // Cleared, so the next thought can be typed straight in.
    expect(captureBox().value).toBe("");
  });

  it("writes nothing for an empty box", async () => {
    await open();
    const box = captureBox();
    await fireEvent.input(box, { target: { value: "   " } });
    await fireEvent.keyDown(box, { key: "Enter" });

    expect(invoke).not.toHaveBeenCalledWith("create_quick_note", expect.anything());
    expect(document.querySelector("[data-quick-notes-empty]")).toBeTruthy();
  });

  it("shows every day it holds, newest first, chronological inside a day", async () => {
    rows = [
      note(1, "the marsh fires", "2026-08-18T21:40:00"),
      note(2, "morning thought", "2026-08-19T09:15:00"),
      note(3, "later thought", "2026-08-19T11:05:00"),
    ];
    await open();

    const days = [...document.querySelectorAll("[data-capture-day]")].map((d) =>
      d.getAttribute("data-capture-day"),
    );
    expect(days).toEqual(["2026-08-19", "2026-08-18"]);

    const first = document.querySelector('[data-capture-day="2026-08-19"]');
    const bodies = [...(first?.querySelectorAll("[data-quick-note]") ?? [])].map((li) =>
      li.textContent?.trim(),
    );
    expect(bodies).toEqual(["morning thought", "later thought"]);
  });

  it("draws a wikilink and opens the note it names when clicked", async () => {
    rows = [note(1, "[[People/Mira Ashvale.md]] should already know", "2026-08-19T09:00:00")];
    await open();

    const link = document.querySelector<HTMLElement>("[data-wiki-link]");
    expect(link).toBeTruthy();
    expect(link?.dataset.path).toBe("People/Mira Ashvale.md");

    await fireEvent.click(link!);
    await waitFor(() => expect(tabs.activeTab?.id).toBe(42));
    expect(tabs.activeTab?.type).toBe("note");
    expect(resolve).toHaveBeenCalledWith("People/Mira Ashvale.md");
  });

  it("leaves an unresolved link inert — writing a note out of the pen would be filing", async () => {
    resolve.mockResolvedValue(null);
    rows = [note(1, "[[Nobody]] said anything", "2026-08-19T09:00:00")];
    await open();

    await fireEvent.click(document.querySelector<HTMLElement>("[data-wiki-link]")!);
    await waitFor(() => expect(resolve).toHaveBeenCalled());
    expect(invoke).not.toHaveBeenCalledWith("create_note", expect.anything());
    expect(tabs.activeTab).toBeNull();
  });

  it("offers no way to edit a Quick Note yet", async () => {
    rows = [note(1, "a thought", "2026-08-19T09:00:00")];
    await open();
    // A read-only field is the *absence* of a control, not a disabled one — so
    // there is no button to mis-click into an edit that does not exist (#232).
    expect(document.querySelector("[data-quick-note] button")).toBeNull();
  });
});

describe("Quick Notes Pane — the capture box's autocomplete", () => {
  it("offers the `[[` dropdown and writes the note it accepts into the line", async () => {
    await open();
    const box = captureBox();

    await fireEvent.input(box, { target: { value: "ask [[mi" } });
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).toBeTruthy());
    expect(document.querySelector('[role="listbox"]')?.textContent).toContain("Mira Ashvale");

    // Enter belongs to the dropdown while it is open: it takes the note rather
    // than committing a half-typed link.
    await fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(captureBox().value).toBe("ask [[People/Mira Ashvale.md]]"));
    expect(invoke).not.toHaveBeenCalledWith("create_quick_note", expect.anything());
  });
});

describe("Quick Notes Pane — staying put", () => {
  it("still holds a thought after the tab is closed and opened again", async () => {
    const view = await open();
    const box = captureBox();
    await fireEvent.input(box, { target: { value: "check what she'd have heard" } });
    await fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(document.querySelectorAll("[data-quick-note]")).toHaveLength(1));

    // Closing the tab unmounts the pane; nothing about the thought lived in it.
    view.unmount();
    expect(document.querySelector("[data-quick-note]")).toBeNull();

    await open();
    await waitFor(() => expect(document.querySelectorAll("[data-quick-note]")).toHaveLength(1));
    expect(document.querySelector("[data-quick-note]")?.textContent).toContain(
      "check what she'd have heard",
    );
  });
});

describe("Quick Notes Pane — a write that fails", () => {
  it("puts the line back in the box, because the thought exists nowhere else", async () => {
    await open();
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "list_quick_notes") return Promise.resolve([]);
      if (cmd === "create_quick_note") return Promise.reject(new Error("ERR_DB_LOCKED: busy"));
      return Promise.resolve(null);
    });

    const box = captureBox();
    await fireEvent.input(box, { target: { value: "the marsh fires spread west" } });
    await fireEvent.keyDown(box, { key: "Enter" });

    await waitFor(() => expect(captureBox().value).toBe("the marsh fires spread west"));
    expect(document.querySelectorAll("[data-quick-note]")).toHaveLength(0);
  });

  it("keeps the next thought the GM started typing over the failed one", async () => {
    await open();
    let rejectWrite: (reason: Error) => void = () => {};
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "list_quick_notes") return Promise.resolve([]);
      if (cmd === "create_quick_note")
        return new Promise((_, reject) => {
          rejectWrite = reject;
        });
      return Promise.resolve(null);
    });

    const box = captureBox();
    await fireEvent.input(box, { target: { value: "first thought" } });
    await fireEvent.keyDown(box, { key: "Enter" });
    // The write is still in flight and the GM has moved on.
    await fireEvent.input(captureBox(), { target: { value: "second thought" } });
    rejectWrite(new Error("ERR_DB_LOCKED: busy"));

    await waitFor(() => expect(captureBox().value).toBe("second thought"));
  });
});

describe("Quick Notes Pane — the `[[` dropdown's exits", () => {
  it("closes when the box is left, since the box itself never unmounts", async () => {
    await open();
    const box = captureBox();
    await fireEvent.input(box, { target: { value: "ask [[mi" } });
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).toBeTruthy());

    await fireEvent.blur(box);
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).toBeNull());
  });

  it("ignores a search that lands after the line was committed", async () => {
    await open();
    let landSearch: (items: unknown[]) => void = () => {};
    vi.mocked(invoke).mockImplementation((cmd: string, args?: unknown) => {
      if (cmd === "list_quick_notes") return Promise.resolve([...rows]);
      if (cmd === "search_notes")
        return new Promise((resolveSearch) => {
          landSearch = resolveSearch as (items: unknown[]) => void;
        });
      if (cmd === "create_quick_note") {
        const created = note(
          rows.length + 1,
          String((args as { body?: string })?.body),
          new Date().toISOString(),
        );
        rows = [...rows, created];
        return Promise.resolve(created);
      }
      return Promise.resolve(null);
    });

    const box = captureBox();
    await fireEvent.input(box, { target: { value: "ask [[mi" } });
    // Committed before the query came back: the line lands, and the late result
    // must not open a menu over the empty box and claim the next Enter.
    await fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("create_quick_note", { body: "ask [[mi" }),
    );
    landSearch(SEARCH_RESULTS);

    await waitFor(() => expect(captureBox().value).toBe(""));
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });
});

describe("Quick Notes Pane — a session that crosses midnight", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-labels the day when the local day turns over", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T23:59:30"));
    rows = [note(1, "the marsh fires", "2026-08-19T21:40:00")];
    await quickNotes.load();
    render(QuickNotesPane);
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('[data-capture-day="2026-08-19"]')?.textContent).toContain(
      "Today",
    );

    // Past midnight, with nothing else touching the list: the heading must move
    // on by itself, or a GM mid-session reads yesterday's thoughts as today's.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(document.querySelector('[data-capture-day="2026-08-19"]')?.textContent).toContain(
      "Yesterday",
    );
  });
});
