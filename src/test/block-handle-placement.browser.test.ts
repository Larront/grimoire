// Where the block handle actually lands, measured in a real browser (#190).
//
// This file exists because of a bug that shipped with a green test. Statblock tiling was
// asserted in jsdom, where every box is 0×0 at 0,0, so the assertion held while two cards
// that could never fit side by side went out believing they did. Placement is layout, and
// layout is the one thing jsdom cannot answer at all — so the handle's position is checked
// here, in headless Chromium, against the app's own stylesheet.
//
// What is under test is the whole path a GM's pointer takes: `posAtCoords` on a real
// coordinate, the block's real box, the real gutter from `app.css`, and the grip mounted
// and measured. Nothing in that chain is stubbed, which is the point — a stub anywhere in
// it puts the test back in the world where it passes regardless.
import { describe, it, expect, afterEach } from "vitest";
import { mount, unmount, tick } from "svelte";
import { Editor } from "@tiptap/core";
import { noteExtensions } from "$lib/editor/note-extensions";
import { targetFromCoords, type BlockTarget } from "$lib/editor/block-handle";
import BlockHandle from "$lib/components/editor/BlockHandle.svelte";
import "../app.css";

// The narrowest a note pane realistically gets: a window split in two, inside an app
// already carrying the icon rail and the sidebar. If the grip fits here it fits anywhere.
const NARROW_PANE = 320;
const WIDE_PANE = 1100;

let open: { editor: Editor; pane: HTMLElement } | null = null;
let handle: Record<string, unknown> | null = null;

afterEach(() => {
  dropGrip();
  open?.editor.destroy();
  open?.pane.remove();
  open = null;
});

/**
 * The note pane's column, as NotePane draws it: a container-query parent — which is all
 * Tailwind's `@container` is — holding the element that carries the gutter.
 */
function openNote(markdown: string, paneWidth: number) {
  const pane = document.createElement("div");
  pane.style.cssText = `container-type: inline-size; width: ${paneWidth}px; position: absolute; left: 0; top: 0;`;
  const column = document.createElement("div");
  column.setAttribute("data-note-column", "");
  pane.appendChild(column);
  document.body.appendChild(pane);

  const editor = new Editor({
    element: column,
    extensions: noteExtensions(),
    content: markdown,
    contentType: "markdown",
  });
  open = { editor, pane };
  return { editor, pane, column };
}

/** A point a little inside an element — where a pointer crossing it first lands. */
function inside(el: Element, dx = 8, dy = 6): { left: number; top: number } {
  const r = el.getBoundingClientRect();
  return { left: r.left + dx, top: r.top + dy };
}

/** What the extension resolves for a pointer at a point on the screen. */
function pointerAt(editor: Editor, point: { left: number; top: number }): BlockTarget {
  const target = targetFromCoords(editor.view, point);
  expect(target, `a block under (${point.left}, ${point.top})`).not.toBeNull();
  return target!;
}

/** The grip, drawn beside a block and measured as the GM sees it. */
async function grip(editor: Editor, target: BlockTarget): Promise<DOMRect> {
  handle = mount(BlockHandle, {
    target: document.body,
    props: {
      editor,
      target,
      onHold: () => {},
      onRetarget: () => {},
      onRelease: () => {},
    },
  });
  await tick();
  const el = document.querySelector("[data-block-handle]");
  expect(el, "the grip is drawn").not.toBeNull();
  return el!.getBoundingClientRect();
}

function dropGrip() {
  if (handle) unmount(handle);
  handle = null;
}

/** The box of the block the handle is holding. */
function boxOf(editor: Editor, target: BlockTarget): DOMRect {
  return (editor.view.nodeDOM(target.pos) as HTMLElement).getBoundingClientRect();
}

/** The first block of a note, which most of these hover. */
function firstBlock(editor: Editor): Element {
  return editor.view.dom.firstElementChild!;
}

describe("the grip beside a block", () => {
  it("sits in the gutter, clear of the prose, at the narrowest pane width", async () => {
    const { editor, pane } = openNote("The lower halls are flooded.", NARROW_PANE);
    const target = pointerAt(editor, inside(firstBlock(editor)));
    const block = boxOf(editor, target);
    const rect = await grip(editor, target);

    expect(rect.width).toBeGreaterThan(0);
    // Never over a word...
    expect(rect.right).toBeLessThanOrEqual(block.left);
    // ...and never off the pane: the gutter is sized for it rather than borrowed from a
    // margin that a split pane does not have.
    expect(rect.left).toBeGreaterThan(pane.getBoundingClientRect().left);
  });

  it("is a place the pointer can actually reach", async () => {
    // A grip drawn under the prose, or under a block's own chrome, hides from the hand
    // reaching for it — and its box would still measure correctly.
    const { editor } = openNote("The lower halls are flooded.", NARROW_PANE);
    const target = pointerAt(editor, inside(firstBlock(editor)));
    const rect = await grip(editor, target);

    const hit = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    expect(hit?.closest("[data-block-handle]")).not.toBeNull();
  });

  it("tracks the pointer down the note, block by block", async () => {
    const { editor } = openNote(
      "First paragraph.\n\n## A heading\n\nThird paragraph.",
      WIDE_PANE,
    );
    const blocks = Array.from(editor.view.dom.children);

    const top = pointerAt(editor, inside(blocks[0]));
    const topRect = await grip(editor, top);
    dropGrip();

    const bottom = pointerAt(editor, inside(blocks[2]));
    const bottomRect = await grip(editor, bottom);

    expect(top.node.textContent).toBe("First paragraph.");
    expect(bottom.node.textContent).toBe("Third paragraph.");
    expect(bottomRect.top).toBeGreaterThan(topRect.top);
  });

  it("hovers a heading and a list item as readily as a paragraph", async () => {
    const { editor } = openNote("## A heading\n\n- the one with the sling", WIDE_PANE);
    const heading = pointerAt(editor, inside(editor.view.dom.querySelector("h2")!));
    expect(heading.node.type.name).toBe("heading");
    expect((await grip(editor, heading)).width).toBeGreaterThan(0);
    dropGrip();

    const item = pointerAt(editor, inside(editor.view.dom.querySelector("li")!));
    expect(["listItem", "paragraph"]).toContain(item.node.type.name);
    const rect = await grip(editor, item);
    expect(rect.right).toBeLessThanOrEqual(boxOf(editor, item).left);
  });

  it.each([
    ["an infobox", "```infobox\nPopulation: 4,200\n```", "infoboxBlock"],
    [
      "a timeline",
      "```timeline\n# The Shattering\nDate: 3rd of Frostfall\n```",
      "timelineBlock",
    ],
    ["a scene", "```scene\n# The Tavern\nId: 7\n```", "sceneBlock"],
    ["an image", "![The gate](images/gate.png)", "image"],
  ])(
    "holds %s, which draws its own chrome and swallows its own events",
    async (_name, markdown, type) => {
      // A sealed block holds every event raised inside it (ADR-0016 §4), which is exactly
      // why the handle listens on the editor's surface instead of per block — so these are
      // the cases that would silently have no grip if it did not.
      const { editor } = openNote(markdown, WIDE_PANE);
      const target = pointerAt(editor, inside(firstBlock(editor)));
      expect(target.node.type.name).toBe(type);

      const rect = await grip(editor, target);
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.right).toBeLessThanOrEqual(boxOf(editor, target).left);
    },
  );

  it("sits beside the first line of a paragraph that wraps, not its middle", async () => {
    const { editor } = openNote(`${"A very long sentence ".repeat(20).trim()}.`, NARROW_PANE);
    const target = pointerAt(editor, inside(firstBlock(editor)));
    const block = boxOf(editor, target);
    const rect = await grip(editor, target);

    expect(block.height).toBeGreaterThan(60); // it really did wrap
    expect(rect.top).toBeLessThan(block.top + 40);
  });

  it("follows a creature into the encounter that holds it, still clear of the card", async () => {
    // The engine targets the innermost block, so hovering a statblock inside a callout
    // gives the creature — and the grip then has to fit inside the callout's own padding
    // rather than out in the note's margin.
    const { editor, pane } = openNote(
      [
        "> [!encounter] The Ambush",
        "> ```statblock",
        "> # Kobold A",
        "> HP: 5/5",
        "> ```",
      ].join("\n"),
      WIDE_PANE,
    );
    const card = editor.view.dom.querySelector("[data-note-block='statblock']");
    expect(card, "the creature is drawn").not.toBeNull();

    const target = pointerAt(editor, inside(card!));
    expect(target.node.type.name).toBe("statblockBlock");

    const block = boxOf(editor, target);
    const rect = await grip(editor, target);

    // Always the same distance from the block it holds, whatever holds *that*. A
    // callout's own padding is narrower than the gutter, so the grip for a creature
    // inside one reaches a few pixels past the box's edge — the accepted cost of one
    // rule rather than a special case per container, and it still covers no prose and
    // stays on the pane.
    expect(rect.right).toBeLessThanOrEqual(block.left);
    expect(rect.left).toBeGreaterThan(pane.getBoundingClientRect().left);
  });

  it("targets the callout itself over its header, and sits beside the box", async () => {
    const { editor } = openNote("> [!note] The Halls\n> Something waits.", WIDE_PANE);
    const header = editor.view.dom.querySelector(".callout-header");
    expect(header, "the callout draws a header").not.toBeNull();

    const target = pointerAt(editor, inside(header!));
    expect(target.node.type.name).toBe("blockquote");

    const rect = await grip(editor, target);
    expect(rect.right).toBeLessThanOrEqual(boxOf(editor, target).left);
  });

  it("carries a label naming what it would move, and takes focus", async () => {
    const { editor } = openNote("```statblock\n# Kobold A\nHP: 5/5\n```", WIDE_PANE);
    const target = pointerAt(editor, inside(firstBlock(editor)));
    await grip(editor, target);

    const el = document.querySelector("[data-block-handle]") as HTMLElement;
    expect(el.getAttribute("aria-label")).toBe("Move statblock");
    el.focus();
    expect(document.activeElement).toBe(el);
  });
});

describe("dragging the grip", () => {
  it("moves the block, and the note's markdown holds the new order", async () => {
    // The gesture end to end, and the reason it is here rather than next door: the drop
    // is resolved from a *coordinate*, so a test without layout can only assert that an
    // event dispatched. The events are dispatched by hand — the browser's own drag needs
    // a held mouse button no test harness can supply — but everything they are handed is
    // real: a real DataTransfer, real client coordinates, and ProseMirror's own drop.
    const { editor } = openNote("First.\n\nSecond.", WIDE_PANE);
    const blocks = Array.from(editor.view.dom.children);
    const target = pointerAt(editor, inside(blocks[0]));
    await grip(editor, target);

    const el = document.querySelector("[data-block-handle]") as HTMLElement;
    const dataTransfer = new DataTransfer();
    el.dispatchEvent(
      new DragEvent("dragstart", {
        dataTransfer,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(editor.view.dragging?.move, "the view was told this drag is its own").toBe(true);

    // Dropped past the end of the second paragraph's text, which is the coordinate a GM
    // aiming below it lands on. The x matters as much as the y: a drop over the *start*
    // of that line resolves to the boundary the block already sits at, and the whole
    // gesture completes having changed nothing.
    const second = blocks[1].getBoundingClientRect();
    editor.view.dom.dispatchEvent(
      new DragEvent("drop", {
        dataTransfer,
        bubbles: true,
        cancelable: true,
        clientX: second.right - 4,
        clientY: second.bottom - 4,
      }),
    );

    expect(editor.getMarkdown().trim()).toBe("Second.\n\nFirst.");
  });
});

describe("the gutter", () => {
  it("holds the grip and its gap with room to spare, at the narrowest pane", async () => {
    // The derivation written in app.css, checked against what the browser resolved rather
    // than restated as a number here: whatever `--block-gutter` becomes, the grip and the
    // gap it is placed with have to fit inside the column's leading padding.
    const { editor, column } = openNote("A sentence.", NARROW_PANE);
    const target = pointerAt(editor, inside(firstBlock(editor)));
    const block = boxOf(editor, target);
    const rect = await grip(editor, target);

    const styles = getComputedStyle(column);
    const gutter = parseFloat(styles.paddingInlineStart);
    const gap = block.left - rect.right;

    // The gap on screen IS the token, which is the only way to catch the failure this
    // pair invites: `getComputedStyle` hands a custom property back as written rather
    // than resolved, so a `rem` in the stylesheet becomes a sub-pixel gap in the maths
    // and every "clear of the prose" assertion still passes.
    expect(gap).toBeCloseTo(parseFloat(styles.getPropertyValue("--block-handle-gap")), 1);
    expect(rect.width).toBeCloseTo(
      parseFloat(styles.getPropertyValue("--block-handle-size")),
      1,
    );
    expect(gutter).toBeGreaterThanOrEqual(rect.width + gap);
  });
});
