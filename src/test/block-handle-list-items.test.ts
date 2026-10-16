// A bullet held as its list item (2026-10 design review).
//
// The handle used to stop at the paragraph inside a bullet, so every action but Turn into
// reached the wrong thing: Delete emptied the text and left the bullet, Duplicate put an
// unbulleted paragraph inside the same bullet, and ↑/↓ did nothing — a bullet's paragraph
// has no siblings. These pin the item as the thing a GM's "this bullet" means.
import { describe, it, expect, afterEach } from "vitest";
import {
  asListItem,
  blockMarkdown,
  blockName,
  deleteBlock,
  duplicateBlock,
  moveBlock,
  textOf,
} from "$lib/editor/block-handle";
import { runBlockHandleAction } from "$lib/editor/block-handle-menu";
import { closeNote, note, saved, targetOfNth } from "./fixtures/note-editor";

afterEach(closeNote);

/** The nth bullet, as the handle now holds it: its item, reached from its line. */
function bullet(editor: ReturnType<typeof note>, index: number) {
  return asListItem(editor.state.doc, targetOfNth(editor, "paragraph", index));
}

describe("which block a bullet's grip holds", () => {
  it("lifts a bullet's line to its list item", () => {
    const editor = note("- one\n- two");
    const held = bullet(editor, 1);

    expect(held.node.type.name).toBe("listItem");
    expect(held.node.textContent).toBe("two");
    expect(blockName(held.node)).toBe("list item");
  });

  it("leaves a paragraph outside a list as it is", () => {
    const editor = note("A sentence.");
    expect(asListItem(editor.state.doc, targetOfNth(editor, "paragraph", 0)).node.type.name).toBe(
      "paragraph",
    );
  });

  it("reaches the line again for Turn into", () => {
    const editor = note("- one");
    const text = textOf(bullet(editor, 0));
    expect(text.node.type.name).toBe("paragraph");
    expect(text.node.textContent).toBe("one");
  });
});

describe("what the actions do to a bullet", () => {
  it("deletes the bullet, not just its words", () => {
    const editor = note("- one\n- two\n- three");
    deleteBlock(editor, bullet(editor, 1));
    expect(saved(editor)).toBe("- one\n- three");
  });

  it("takes the list with its only bullet, rather than leaving an empty one", () => {
    const editor = note("Before.\n\n- only\n\nAfter.");
    deleteBlock(editor, bullet(editor, 1));
    expect(saved(editor)).toBe("Before.\n\nAfter.");
  });

  it("duplicates the bullet as a bullet", () => {
    const editor = note("- one\n- two");
    duplicateBlock(editor, bullet(editor, 0));
    expect(saved(editor)).toBe("- one\n- one\n- two");
  });

  it("moves a bullet among its siblings", () => {
    const editor = note("- one\n- two\n- three");
    moveBlock(editor, bullet(editor, 2), -1);
    expect(saved(editor)).toBe("- one\n- three\n- two");
  });

  it("copies a bullet as the list item it is written as", () => {
    const bullets = note("- one\n- two");
    expect(blockMarkdown(bullets, bullet(bullets, 1))).toBe("- two");
    closeNote();

    const numbered = note("1. one\n2. two");
    expect(blockMarkdown(numbered, bullet(numbered, 1))).toMatch(/^\d+\. two$/);
  });

  it("turns a bullet into a heading through its line", async () => {
    const editor = note("- one");
    await runBlockHandleAction(editor, bullet(editor, 0), { turnInto: "heading2" });
    expect(saved(editor)).toBe("## one");
  });
});
