import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { SearchHit, showSearchHit } from "$lib/editor/search-hit";
import { ATTENTION } from "$lib/motion";

// Where a search landed: the matched words tinted, for as long as the fade runs.
describe("search hit", () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
    vi.useRealTimers();
  });

  function make(): Editor {
    editor = new Editor({
      element: document.createElement("div"),
      extensions: [StarterKit, SearchHit],
      content: "<p>The dragon sleeps under Emberfall.</p>",
    });
    return editor;
  }

  it("tints the matched words, then takes the tint away", () => {
    vi.useFakeTimers();
    const ed = make();
    showSearchHit(ed.view, { from: 5, to: 11 });

    const hit = ed.view.dom.querySelector(".search-hit");
    expect(hit?.textContent).toBe("dragon");

    vi.advanceTimersByTime(ATTENTION);
    expect(ed.view.dom.querySelector(".search-hit")).toBeNull();
  });

  it("follows the words if the note changes before it fades", () => {
    const ed = make();
    showSearchHit(ed.view, { from: 5, to: 11 });
    ed.commands.insertContentAt(1, "Old ");
    expect(ed.view.dom.querySelector(".search-hit")?.textContent).toBe("dragon");
  });

  it("does nothing once the editor is gone", () => {
    vi.useFakeTimers();
    const ed = make();
    showSearchHit(ed.view, { from: 5, to: 11 });
    ed.destroy();
    editor = null;
    expect(() => vi.advanceTimersByTime(ATTENTION)).not.toThrow();
  });
});
