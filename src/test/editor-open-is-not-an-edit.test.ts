// Opening a note is not editing it (2026-10 design review).
//
// Tiptap keeps an empty paragraph after a note's last block and adds it with the first
// transaction after the note opens — the broken-link marking is one. The editor took
// that for an edit and saved, so a note that ended in a block (the example world's
// Start Here) gained a blank line on disk every time it was opened.
import "./fixtures/note-editor";
import { render, cleanup, act } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { invoke } from "@tauri-apps/api/core";
import Editor from "$lib/components/editor/Editor.svelte";

const ENDS_IN_A_BLOCK = "A note.\n\n```scene\n# Boss Battle\nId: 1\n```\n";

function tiptap(container: HTMLElement): TiptapEditor {
  return (container.querySelector(".ProseMirror") as unknown as { editor: TiptapEditor }).editor;
}

beforeEach(() => {
  vi.useFakeTimers();
  // The scene block asks for its scene's tracks as it mounts.
  vi.mocked(invoke).mockImplementation(async (cmd: string) =>
    cmd.startsWith("get_") || cmd.startsWith("list_") ? [] : null,
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.mocked(invoke).mockResolvedValue(null);
});

describe("the editor's autosave", () => {
  it("doesn't save a note that was only opened", async () => {
    const onSave = vi.fn(async () => {});
    const { container } = render(Editor, { initialContent: ENDS_IN_A_BLOCK, onSave });
    const editor = tiptap(container);

    // What marking the broken links does: a transaction that edits nothing.
    await act(() => editor.view.dispatch(editor.state.tr.setMeta("probe", true)));
    expect(editor.state.doc.lastChild?.type.name).toBe("paragraph");
    await act(() => vi.advanceTimersByTime(1000));

    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves an edit, ending the note in one newline rather than a blank line", async () => {
    const onSave = vi.fn(async (_body: string) => {});
    const { container } = render(Editor, { initialContent: ENDS_IN_A_BLOCK, onSave });
    const editor = tiptap(container);

    await act(() => editor.commands.insertContentAt(1, "Still "));
    await act(() => vi.advanceTimersByTime(1000));

    expect(onSave).toHaveBeenCalledTimes(1);
    const body = onSave.mock.calls[0][0];
    expect(body.startsWith("Still A note.")).toBe(true);
    expect(body.endsWith("```\n")).toBe(true);
  });

  it("doesn't save an edit that was undone", async () => {
    const onSave = vi.fn(async () => {});
    const { container } = render(Editor, { initialContent: "A note.\n", onSave });
    const editor = tiptap(container);

    await act(() => editor.commands.insertContentAt(1, "x"));
    await act(() => editor.commands.undo());
    await act(() => vi.advanceTimersByTime(1000));

    expect(onSave).not.toHaveBeenCalled();
  });
});
