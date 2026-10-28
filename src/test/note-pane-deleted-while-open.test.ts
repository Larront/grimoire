import { render, cleanup, act, waitFor } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import AppShell from "../lib/components/AppShell.svelte";
import { tabs } from "../lib/stores/tabs.svelte";
import { notes } from "../lib/stores/notes.svelte";
import { editorClean, editorCalls, editorBuffer } from "./mocks/editor-clean";
import type { Note } from "../lib/types/ledger";

vi.mock("svelte-sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
  Toaster: vi.fn(),
}));

// Real TipTap doesn't run deterministically in jsdom; the deleted-banner policy
// only cares about the buffer surviving and getMarkdown() feeding "recreate".
vi.mock("$lib/components/editor/Editor.svelte", async () => ({
  default: (await import("./mocks/MockEditor.svelte")).default,
}));

// Capture the event listeners NotePane registers so the test can emit the
// backend watcher's note:removed / note:moved the way the real watcher would.
const { listeners } = vi.hoisted(() => ({
  listeners: {} as Record<string, ((e: { payload: unknown }) => void)[]>,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: (e: { payload: unknown }) => void) => {
    (listeners[name] ??= []).push(cb);
    return () => {
      listeners[name] = (listeners[name] ?? []).filter((f) => f !== cb);
    };
  }),
}));

async function emit(name: string, payload: unknown) {
  await act(async () => {
    (listeners[name] ?? []).forEach((cb) => cb({ payload }));
  });
}

const testNote: Note = {
  id: 1,
  path: "Aldric.md",
  title: "Aldric",
  icon: null,
  cover_image: null,
  parent_path: null,
  archived: false,
  modified_at: "2026-01-01T00:00:00Z",
};

// The rows get_notes currently returns — mutated per test to model the notes
// store reacting to an external delete / move the way the sidebar sync does.
let storeNotes: Note[] = [testNote];
let diskContent = "Original body";

beforeEach(() => {
  editorClean.value = true;
  editorCalls.pause = 0;
  editorCalls.resume = 0;
  editorCalls.discard = 0;
  storeNotes = [{ ...testNote }];
  diskContent = "Original body";
  for (const k of Object.keys(listeners)) delete listeners[k];
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === "get_notes") return storeNotes;
    if (cmd === "read_note_content") return diskContent;
    if (cmd === "read_note_tags") return [];
    if (cmd === "list_all_tags") return [];
    if (cmd === "get_note_aliases") return [];
    if (cmd === "get_alias_collisions") return [];
    if (cmd === "create_note") {
      // Recreation inserts a fresh row with a NEW id, as the backend does.
      const a = args as { noteTitle: string; notePath: string };
      const created: Note = {
        ...testNote,
        id: 2,
        title: a.noteTitle,
        path: a.notePath,
      };
      storeNotes = [created];
      return created;
    }
    if (cmd === "write_note_content") return null;
    return null;
  });
});

afterEach(() => {
  cleanup();
  tabs.closeAll("left");
  tabs.closeAll("right");
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  vi.mocked(invoke).mockResolvedValue(null);
});

async function openNote() {
  tabs.openTab({ type: "note", id: 1, title: "Aldric" });
  await act(() => notes.load());
  const utils = render(AppShell);
  await waitFor(() =>
    expect(utils.getByTestId("mock-editor").getAttribute("data-content")).toBe("Original body"),
  );
  return utils;
}

// The sidebar's own note:removed/note:moved listener refetches the notes store;
// reproduce that store refresh explicitly so the test doesn't depend on the
// sidebar being mounted.
async function syncStore() {
  await act(() => notes.load());
}

describe("NotePane — deleted / moved while open (issue #130)", () => {
  it("keeps the pane and its buffer behind a banner when the file is deleted", async () => {
    const { getByTestId, queryByTestId } = await openNote();

    storeNotes = []; // the file is gone; the store drops its row
    await emit("note:removed", { path: "Aldric.md" });
    await syncStore();

    // The pane did NOT collapse to "Note not found" — the buffer is still shown.
    await waitFor(() => expect(getByTestId("deleted-banner")).toBeTruthy());
    expect(getByTestId("mock-editor").getAttribute("data-content")).toBe("Original body");
    expect(queryByTestId("note-load-error")).toBeNull();
  });

  it("ignores a note:removed for a different note", async () => {
    const { queryByTestId } = await openNote();

    await emit("note:removed", { path: "Someone-Else.md" });

    expect(queryByTestId("deleted-banner")).toBeNull();
  });

  it("'Save to recreate' writes the buffer back to the original path", async () => {
    const { getByTestId, queryByTestId } = await openNote();
    storeNotes = [];
    await emit("note:removed", { path: "Aldric.md" });
    await syncStore();
    await waitFor(() => expect(getByTestId("deleted-banner")).toBeTruthy());

    await act(() => getByTestId("deleted-recreate").click());

    // Recreated at the original path, then the buffer written into it.
    const calls = vi.mocked(invoke).mock.calls;
    const create = calls.find((c) => c[0] === "create_note");
    expect(create?.[1]).toMatchObject({
      noteTitle: "Aldric",
      notePath: "Aldric.md",
    });
    const write = calls.find((c) => c[0] === "write_note_content");
    expect(write?.[1]).toMatchObject({
      notePath: "Aldric.md",
      content: "Original body",
    });

    // The tab followed the recreated note (new id); the banner cleared and the
    // editor remounted on the restored file.
    await waitFor(() => expect(queryByTestId("deleted-banner")).toBeNull());
    expect(getByTestId("mock-editor").getAttribute("data-content")).toBe("Original body");
  });

  // The editor's buffer is the body alone, and the save restores the rest from a file
  // that is gone — so recreating used to drop every tag and alias (2026-10 review).
  it("'Save to recreate' brings back the tags, aliases and the rest of the frontmatter", async () => {
    diskContent = "---\ntags: [npc]\naliases: [Mira]\nsource: obsidian\n---\nOriginal body";
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "get_notes") return storeNotes;
      if (cmd === "read_note_content") return diskContent;
      if (cmd === "read_note_tags") return ["npc"];
      if (cmd === "get_note_aliases") return ["Mira"];
      if (cmd === "create_note") {
        const a = args as { noteTitle: string; notePath: string };
        const created: Note = { ...testNote, id: 2, title: a.noteTitle, path: a.notePath };
        storeNotes = [created];
        return created;
      }
      return [];
    });
    const { getByTestId } = await openNote();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("get_note_aliases", { noteId: 1 }));
    storeNotes = [];
    await emit("note:removed", { path: "Aldric.md" });
    await syncStore();
    await waitFor(() => expect(getByTestId("deleted-banner")).toBeTruthy());

    await act(() => getByTestId("deleted-recreate").click());

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_note_aliases", { noteId: 2, aliases: ["Mira"] }),
    );
    const write = vi.mocked(invoke).mock.calls.findLast((c) => c[0] === "write_note_content");
    expect((write?.[1] as { content: string }).content).toBe(
      "---\ntags: [npc]\naliases: [Mira]\nsource: obsidian\n---\nOriginal body",
    );
    expect(invoke).toHaveBeenCalledWith("write_note_tags", { notePath: "Aldric.md", tags: ["npc"] });
  });

  // What's open is the only copy there is, so closing asks once, in the banner.
  it("'Close without saving' asks first, and closes the tab only when confirmed", async () => {
    const { getByTestId, queryByTestId } = await openNote();
    storeNotes = [];
    await emit("note:removed", { path: "Aldric.md" });
    await syncStore();
    await waitFor(() => expect(getByTestId("deleted-banner")).toBeTruthy());

    await act(() => getByTestId("deleted-close").click());
    expect(getByTestId("mock-editor")).toBeTruthy();
    await act(() => getByTestId("deleted-close-cancel").click());
    expect(getByTestId("deleted-recreate")).toBeTruthy();

    await act(() => getByTestId("deleted-close").click());
    await act(() => getByTestId("deleted-close-confirm").click());

    expect(queryByTestId("mock-editor")).toBeNull();
    expect(queryByTestId("deleted-banner")).toBeNull();
  });

  it("follows an external move without a banner or a lost session", async () => {
    const { getByTestId, queryByTestId } = await openNote();

    // The backend re-keyed the row in place: same id, new path/title.
    storeNotes = [{ ...testNote, path: "People/Aldric.md", title: "Aldric" }];
    await emit("note:moved", { from: "Aldric.md", to: "People/Aldric.md" });
    await syncStore();

    // No delete banner, and the same editor buffer is still mounted (the id never
    // changed, so the pane wasn't torn down or reloaded).
    expect(queryByTestId("deleted-banner")).toBeNull();
    expect(getByTestId("mock-editor").getAttribute("data-content")).toBe("Original body");
  });
});

// The file comes back as a new row with a new id, the way the watcher sees a file moved
// back into the world or restored from the Recycle Bin.
async function deleteThenReturn(returned: string) {
  storeNotes = [];
  await emit("note:removed", { path: "Aldric.md" });
  await syncStore();
  diskContent = returned;
  storeNotes = [{ ...testNote, id: 7 }];
  await syncStore();
}

describe("NotePane — the deleted file comes back (2026-10 design review)", () => {
  afterEach(() => {
    editorBuffer.value = null;
  });

  it("drops the banner and follows the returned note when nothing differs", async () => {
    const { queryByTestId, getByTestId } = await openNote();
    await deleteThenReturn("Original body");

    await waitFor(() => expect(queryByTestId("deleted-banner")).toBeNull());
    expect(queryByTestId("conflict-banner")).toBeNull();
    expect(tabs.leftActiveTab?.id).toBe(7);
    // The open buffer stayed; nothing re-read it.
    expect(getByTestId("mock-editor").getAttribute("data-content")).toBe("Original body");
  });

  it("asks, as a conflict, when the open copy says something the file doesn't", async () => {
    const { queryByTestId, getByTestId } = await openNote();
    editorBuffer.value = "Original body, with what I wrote while it was gone";
    await deleteThenReturn("Original body");

    await waitFor(() => expect(getByTestId("conflict-banner")).toBeTruthy());
    expect(queryByTestId("deleted-banner")).toBeNull();
    expect(editorCalls.pause).toBeGreaterThan(0);
    // The tab waits for the choice: moving it would read the file over the buffer.
    expect(tabs.leftActiveTab?.id).toBe(1);
  });

  it("keeping the open copy writes it, then follows the returned note", async () => {
    const { getByTestId } = await openNote();
    editorBuffer.value = "Original body, with what I wrote while it was gone";
    await deleteThenReturn("Original body");
    await waitFor(() => expect(getByTestId("conflict-banner")).toBeTruthy());

    await act(() => getByTestId("conflict-keep").click());

    await waitFor(() => expect(tabs.leftActiveTab?.id).toBe(7));
    expect(editorCalls.resume).toBe(1);
  });

  it("reloading takes the returned file, without writing", async () => {
    const { getByTestId } = await openNote();
    editorBuffer.value = "Original body, with what I wrote while it was gone";
    await deleteThenReturn("Original body");
    await waitFor(() => expect(getByTestId("conflict-banner")).toBeTruthy());

    await act(() => getByTestId("conflict-reload").click());

    await waitFor(() => expect(tabs.leftActiveTab?.id).toBe(7));
    expect(editorCalls.resume).toBe(0);
    expect(editorCalls.discard).toBe(1);
  });

  it("never shows both banners: a delete ends a waiting conflict", async () => {
    const { queryByTestId, getByTestId } = await openNote();
    editorClean.value = false;
    diskContent = "Changed elsewhere";
    await emit("note:content-changed", { path: "Aldric.md" });
    await waitFor(() => expect(getByTestId("conflict-banner")).toBeTruthy());

    storeNotes = [];
    await emit("note:removed", { path: "Aldric.md" });
    await syncStore();

    await waitFor(() => expect(getByTestId("deleted-banner")).toBeTruthy());
    expect(queryByTestId("conflict-banner")).toBeNull();
  });
});
