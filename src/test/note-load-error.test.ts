import { render, cleanup, act, waitFor } from "@testing-library/svelte";
import { describe, it, expect, vi, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import AppShell from "../lib/components/AppShell.svelte";
import { tabs } from "../lib/stores/tabs.svelte";
import { notes } from "../lib/stores/notes.svelte";
import type { Note } from "../lib/types/ledger";

vi.mock("svelte-sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
  }),
  Toaster: vi.fn(),
}));

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

afterEach(async () => {
  cleanup();
  tabs.closeAll("left");
  tabs.closeAll("right");
  vi.mocked(invoke).mockResolvedValue(null);
});

describe("NotePane — file deleted externally (issue #112)", () => {
  it("renders an in-pane error state when the note content can't be read", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_notes") return [testNote];
      if (cmd === "read_note_content") throw "No such file or directory";
      if (cmd === "read_note_tags") return [];
      if (cmd === "list_all_tags") return [];
      if (cmd === "get_note_aliases") return [];
      if (cmd === "get_alias_collisions") return [];
      return null;
    });

    tabs.openTab({ type: "note", id: 1, title: "Aldric" });
    await act(() => notes.load());
    const { getByTestId } = render(AppShell);

    await waitFor(() => {
      expect(getByTestId("note-load-error").textContent).toContain(
        "couldn't be read",
      );
    });
    // No editor mounts in the error state, so no autosave can recreate the file.
    expect(document.querySelector(".tiptap")).toBeNull();
  });
});
