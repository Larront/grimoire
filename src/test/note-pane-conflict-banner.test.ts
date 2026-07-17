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

// Swap the real TipTap Editor for a stub whose clean/dirty state the test
// controls (editorClean) — TipTap doesn't run deterministically in jsdom, and
// the banner policy only cares about isClean() + the reloaded content.
vi.mock("$lib/components/editor/Editor.svelte", async () => ({
  default: (await import("./mocks/MockEditor.svelte")).default,
}));

// Capture the frontend event listeners NotePane registers so the test can emit
// note:content-changed the way the backend watcher would.
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

async function emitContentChanged(path: string) {
  await act(async () => {
    (listeners["note:content-changed"] ?? []).forEach((cb) =>
      cb({ payload: { path } }),
    );
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

// What read_note_content currently returns from disk — mutated per test to
// stand in for an external edit.
let diskContent = "Original body";

beforeEach(() => {
  editorClean.value = true;
  editorCalls.pause = 0;
  editorCalls.resume = 0;
  editorCalls.discard = 0;
  diskContent = "Original body";
  for (const k of Object.keys(listeners)) delete listeners[k];
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "get_notes") return [testNote];
    if (cmd === "read_note_content") return diskContent;
    if (cmd === "read_note_tags") return [];
    if (cmd === "list_all_tags") return [];
    if (cmd === "get_note_aliases") return [];
    if (cmd === "get_alias_collisions") return [];
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

describe("NotePane — external change conflict banner (issue #129)", () => {
  it("reloads a clean buffer silently with no banner", async () => {
    editorClean.value = true;
    const { getByTestId, queryByTestId } = await openNote();

    diskContent = "External edit";
    await emitContentChanged("Aldric.md");

    await waitFor(() =>
      expect(getByTestId("mock-editor").getAttribute("data-content")).toBe(
        "External edit",
      ),
    );
    expect(queryByTestId("conflict-banner")).toBeNull();
  });

  it("shows the conflict banner instead of clobbering a dirty buffer", async () => {
    const { getByTestId, queryByTestId } = await openNote();
    editorClean.value = false;

    diskContent = "External edit";
    await emitContentChanged("Aldric.md");

    await waitFor(() => expect(getByTestId("conflict-banner")).toBeTruthy());
    // Buffer untouched — the editor was not reseeded from disk.
    expect(getByTestId("mock-editor").getAttribute("data-content")).toBe(
      "Original body",
    );
    // Autosave is frozen so a queued edit can't clobber the external change
    // on disk while the banner waits for a choice (issue #129).
    expect(editorCalls.pause).toBeGreaterThanOrEqual(1);
  });

  it("'Reload from disk' replaces the buffer with the external version and clears the banner", async () => {
    const { getByTestId, queryByTestId } = await openNote();
    editorClean.value = false;
    diskContent = "External edit";
    await emitContentChanged("Aldric.md");
    await waitFor(() => expect(getByTestId("conflict-banner")).toBeTruthy());

    // A remount reseeds a clean editor, so honour the reload from here on.
    editorClean.value = true;
    await act(() => getByTestId("conflict-reload").click());

    await waitFor(() =>
      expect(getByTestId("mock-editor").getAttribute("data-content")).toBe(
        "External edit",
      ),
    );
    expect(queryByTestId("conflict-banner")).toBeNull();
    // The stale buffer is dropped, not flushed to disk, on reload.
    expect(editorCalls.discard).toBeGreaterThanOrEqual(1);
  });

  it("'Keep my version' dismisses the banner and preserves the buffer", async () => {
    const { getByTestId, queryByTestId } = await openNote();
    editorClean.value = false;
    diskContent = "External edit";
    await emitContentChanged("Aldric.md");
    await waitFor(() => expect(getByTestId("conflict-banner")).toBeTruthy());

    await act(() => getByTestId("conflict-keep").click());

    expect(queryByTestId("conflict-banner")).toBeNull();
    // The buffer is kept — the editor was never reseeded from disk.
    expect(getByTestId("mock-editor").getAttribute("data-content")).toBe(
      "Original body",
    );
    // Autosave resumes so the kept buffer is written to disk (not left frozen).
    expect(editorCalls.resume).toBeGreaterThanOrEqual(1);
  });
});
