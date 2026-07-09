import { render, cleanup, act, waitFor } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import AppShell from "../lib/components/AppShell.svelte";
import { tabs } from "../lib/stores/tabs.svelte";
import { notes } from "../lib/stores/notes.svelte";
import { editorClean, editorCalls } from "./mocks/editor-clean";
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
      const created: Note = { ...testNote, id: 2, title: a.noteTitle, path: a.notePath };
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
    expect(utils.getByTestId("mock-editor").getAttribute("data-content")).toBe(
      "Original body",
    ),
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
    expect(getByTestId("mock-editor").getAttribute("data-content")).toBe(
      "Original body",
    );
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
    expect(create?.[1]).toMatchObject({ noteTitle: "Aldric", notePath: "Aldric.md" });
    const write = calls.find((c) => c[0] === "write_note_content");
    expect(write?.[1]).toMatchObject({ notePath: "Aldric.md", content: "Original body" });

    // The tab followed the recreated note (new id); the banner cleared and the
    // editor remounted on the restored file.
    await waitFor(() => expect(queryByTestId("deleted-banner")).toBeNull());
    expect(getByTestId("mock-editor").getAttribute("data-content")).toBe(
      "Original body",
    );
  });

  it("'Close' closes the tab", async () => {
    const { getByTestId, queryByTestId } = await openNote();
    storeNotes = [];
    await emit("note:removed", { path: "Aldric.md" });
    await syncStore();
    await waitFor(() => expect(getByTestId("deleted-banner")).toBeTruthy());

    await act(() => getByTestId("deleted-close").click());

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
    expect(getByTestId("mock-editor").getAttribute("data-content")).toBe(
      "Original body",
    );
  });
});
