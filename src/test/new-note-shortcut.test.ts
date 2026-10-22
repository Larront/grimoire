// `Ctrl/Cmd+N` creates a new note (#227).
//
// The seam is the shell over a mocked `invoke`, as the Quick Notes Dialog's tests
// use: the key is pressed on `window` the way a GM presses it, and what the test
// reads is the `create_note` that went out and the tab that came back. The point
// of the ticket is that this is the *palette's* path — so the palette's command is
// pressed here too, and both are asserted to send the same call.
import { render, fireEvent, cleanup, waitFor } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import AppShell from "$lib/components/AppShell.svelte";
import { tabs } from "$lib/stores/tabs.svelte";
import { ledger } from "$lib/stores/ledger.svelte";
import { searchPalette } from "$lib/stores/search.svelte";
import { notes } from "$lib/stores/notes.svelte";
import { createUntitledNote } from "$lib/utils/note-actions";
import type { Note } from "$lib/types/ledger";

vi.mock("svelte-sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }),
  Toaster: vi.fn(),
}));

const LEDGER_PATH = "/worlds/marsh";

const CREATED: Note = {
  id: 7,
  title: "Untitled",
  path: "Untitled.md",
  parent_path: null,
  modified_at: "2026-08-21T00:00:00Z",
} as Note;

beforeEach(() => {
  searchPalette.open = false;
  vi.mocked(invoke).mockClear();
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd === "open_ledger")
      return Promise.resolve({
        path: LEDGER_PATH,
        note_count: 0,
        scene_count: 0,
        map_count: 0,
        failed_imports: [],
        unlinked_pins: [],
        recovered_from_backup: null,
      });
    if (cmd === "get_file_tree")
      return Promise.resolve({ name: "", path: "", is_dir: true, children: [] });
    if (cmd === "get_statblock_preset_default") return Promise.resolve(null);
    if (cmd === "create_note") return Promise.resolve(CREATED);
    return Promise.resolve([]);
  });
});

afterEach(async () => {
  cleanup();
  searchPalette.open = false;
  tabs.closeAll("left");
  tabs.closeAll("right");
  vi.mocked(invoke).mockImplementation(() => Promise.resolve(null));
  await ledger.closeLedger();
});

/** Press the shortcut wherever the focus happens to be. */
function pressShortcut(target: Window | Element = window, init: KeyboardEventInit = {}) {
  return fireEvent.keyDown(target, { key: "n", ctrlKey: true, ...init });
}

const createCalls = () => vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "create_note");

describe("Ctrl/Cmd+N — a new note", () => {
  it("creates Untitled at the ledger root when no note is open, and opens it named", async () => {
    await ledger.openLedger(LEDGER_PATH);
    render(AppShell);

    await pressShortcut();

    await waitFor(() => expect(createCalls()).toHaveLength(1));
    expect(createCalls()[0][1]).toEqual({
      noteTitle: "Untitled",
      notePath: "Untitled.md",
      noteParentPath: null,
    });
    await waitFor(() => expect(tabs.activeTab?.id).toBe(CREATED.id));
    expect(tabs.activeTab?.type).toBe("note");
  });

  // 2026-10 design review: beside the open note, not always at the root (#227 was
  // "root, always"). Only the page in front of the GM decides — never the tree.
  it("creates Untitled in the folder of the note the GM is in", async () => {
    const mira = { ...CREATED, id: 3, title: "Mira", path: "Characters/Mira.md" } as Note;
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_notes") return Promise.resolve([mira]);
      if (cmd === "create_note") return Promise.resolve({ ...CREATED, id: 8 });
      if (cmd === "get_file_tree")
        return Promise.resolve({ name: "", path: "", is_dir: true, children: [] });
      return Promise.resolve([]);
    });
    await notes.load();
    tabs.openTab({ type: "note", id: mira.id, title: mira.title });

    await createUntitledNote();

    expect(createCalls()[0][1]).toEqual({
      noteTitle: "Untitled",
      notePath: "Characters/Untitled.md",
      noteParentPath: "Characters",
    });
  });

  it("creates at the root when the focused pane shows something other than a note", async () => {
    tabs.openTab({ type: "graph", id: 0, title: "Graph" });

    await createUntitledNote();

    expect(createCalls()[0][1]).toEqual(
      expect.objectContaining({ notePath: "Untitled.md", noteParentPath: null }),
    );
  });

  // Asserted off the shell, because the TabBar clears the flag as soon as it has
  // acted on it — by the time a rendered shell settles, the rename is over.
  it("opens the note named, so the first thing a GM types is its title", async () => {
    await ledger.openLedger(LEDGER_PATH);

    await createUntitledNote();

    expect(tabs.activeTab?.rename).toBe(true);
  });

  it("answers to the Cmd spelling too, since the shortcut is one gesture on both", async () => {
    await ledger.openLedger(LEDGER_PATH);
    render(AppShell);

    await pressShortcut(window, { ctrlKey: false, metaKey: true });

    await waitFor(() => expect(createCalls()).toHaveLength(1));
  });

  it("sends exactly what the palette's Create note sends", async () => {
    await ledger.openLedger(LEDGER_PATH);
    render(AppShell);

    await pressShortcut();
    await waitFor(() => expect(createCalls()).toHaveLength(1));
    const fromShortcut = createCalls()[0][1];

    tabs.closeAll("left");
    searchPalette.open = true;
    const command = await waitFor(() => {
      const hit = document.querySelector<HTMLElement>('[data-testid="cmd-create-note"]');
      expect(hit).toBeTruthy();
      return hit as HTMLElement;
    });
    await fireEvent.click(command);

    await waitFor(() => expect(createCalls()).toHaveLength(2));
    expect(createCalls()[1][1]).toEqual(fromShortcut);
  });

  it("is silent with no ledger open — no note, and no toast saying why", async () => {
    render(AppShell);

    await pressShortcut();

    // A beat, because "nothing happened" cannot be waited for.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(createCalls()).toHaveLength(0);
    expect(tabs.activeTab).toBeFalsy();
  });

  it("leaves Ctrl+N alone where the GM is typing, because there it already means something", async () => {
    await ledger.openLedger(LEDGER_PATH);
    render(AppShell);
    const field = document.createElement("input");
    document.body.appendChild(field);

    await pressShortcut(field);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(createCalls()).toHaveLength(0);
    field.remove();
  });

  it("still fires on Cmd+N in a text field, where it means nothing native", async () => {
    await ledger.openLedger(LEDGER_PATH);
    render(AppShell);
    const field = document.createElement("input");
    document.body.appendChild(field);

    await pressShortcut(field, { ctrlKey: false, metaKey: true });

    await waitFor(() => expect(createCalls()).toHaveLength(1));
    field.remove();
  });

  it("leaves Ctrl+Shift+N to the Quick Notes Dialog, which owns it", async () => {
    await ledger.openLedger(LEDGER_PATH);
    render(AppShell);

    await pressShortcut(window, { key: "N", shiftKey: true });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(createCalls()).toHaveLength(0);
  });
});
