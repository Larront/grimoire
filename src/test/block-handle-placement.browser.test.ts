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
import {
  blockTargetAt,
  targetFromCoords,
  type BlockTarget,
} from "$lib/editor/block-handle";
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
 *
 * The title sits inside the column above the prose, as it does in the app, because the
 * column is now what the handle listens on — so what the handle does about a pointer up in
 * the title is a real question and there has to be a title for it to be asked about.
 */
function openNote(
  markdown: string,
  paneWidth: number,
  onBlockTarget?: (target: BlockTarget | null) => void,
) {
  const pane = document.createElement("div");
  pane.style.cssText = `container-type: inline-size; width: ${paneWidth}px; position: absolute; left: 0; top: 0;`;
  const column = document.createElement("div");
  column.setAttribute("data-note-column", "");
  const title = document.createElement("input");
  title.style.cssText = "display: block; width: 100%; height: 40px;";
  column.appendChild(title);
  pane.appendChild(column);
  document.body.appendChild(pane);

  const host = document.createElement("div");
  column.appendChild(host);

  const editor = new Editor({
    element: host,
    extensions: noteExtensions({ onBlockTarget }),
    content: markdown,
    contentType: "markdown",
  });
  open = { editor, pane };
  return { editor, pane, column, title };
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
      onPin: () => {},
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

  it("clears the bullet a list item is marked with, rather than sitting on it", async () => {
    // A bullet is drawn outside the item's own box — `list-style-position: outside` puts it
    // in the list's padding, inside no block at all — so a grip placed from the paragraph in
    // the item lands squarely on top of the marker.
    const { editor } = openNote("- the one with the sling\n- the one with the net", WIDE_PANE);
    const list = editor.view.dom.querySelector("ul")!;
    const item = pointerAt(editor, inside(editor.view.dom.querySelector("li")!));
    const rect = await grip(editor, item);

    // Clear of the whole list, marker and all, which puts a bullet's grip in the same
    // column as every other grip in the note.
    expect(rect.right).toBeLessThanOrEqual(list.getBoundingClientRect().left);
  });

  it("puts every grip in one column, whatever depth its block is at", async () => {
    const { editor } = openNote(
      [
        "A plain paragraph.",
        "",
        "- a bullet",
        "",
        "> [!encounter] The Ambush",
        "> ```statblock",
        "> # Kobold A",
        "> HP: 5/5",
        "> ```",
      ].join("\n"),
      WIDE_PANE,
    );
    const shapes = [
      firstBlock(editor),
      editor.view.dom.querySelector("li")!,
      editor.view.dom.querySelector("[data-note-block='statblock']")!,
    ];

    const lefts: number[] = [];
    for (const el of shapes) {
      lefts.push((await grip(editor, pointerAt(editor, inside(el)))).left);
      dropGrip();
    }
    // One column, so the grip never moves sideways as the pointer walks down a note — and
    // the vertical, which is exact, is what says which block it holds.
    expect(new Set(lefts).size).toBe(1);
  });

  it.each([
    ["a callout, beside its header", "> [!encounter] The Ambush\n> Something waits."],
    ["a plain quote, beside its first line", "> A quoted line.\n> And a second one."],
    ["a statblock, beside its first row", "```statblock\n# Kobold A\nHP: 5/5\n```"],
  ])("sits at the top of %s — not halfway down it", async (_name, markdown) => {
    // Every block with children or chrome above its text got this wrong at once, and for one
    // reason: a range over a wrapper element yields a single rect the size of the whole
    // block, so "the first line" was the block itself and the grip was centred on it. The
    // target is the container rather than what a pointer inside it would find, because the
    // container is the thing that was mis-measured.
    const { editor } = openNote(markdown, NARROW_PANE);
    const target = blockTargetAt(editor.state.doc, 0)!;
    const block = boxOf(editor, target);
    const rect = await grip(editor, target);

    // Tall enough that the middle is unmistakably not the top.
    expect(block.height).toBeGreaterThan(40);
    // Within a line of the block's leading edge...
    expect(rect.top).toBeLessThan(block.top + 20);
    // ...and not above it, which is the half a naive "align with the top" gets wrong: a
    // callout's header is a dozen pixels of padding down from the box's own edge, and the
    // grip belongs beside the header.
    expect(rect.top).toBeGreaterThanOrEqual(block.top - 2);
  });

  it("straddles a divider rather than hanging below it", async () => {
    // The other end of the test above, and excluded from it by construction: its guard is
    // `height > 40`, so every block *shorter* than the grip sat outside the one claim about
    // the vertical. A divider is the extreme — its box is a single pixel — and the fallback
    // in `firstLineBox` reported the handle's own height for it, which zeroes the centring
    // term and degenerates the placement to top-alignment. An 18px grip whose top edge is
    // level with a 1px rule hangs entirely *below* it and reads as the next paragraph's.
    //
    // Targeted by position rather than by pointer: a rule is thinner than any point a hand
    // could aim at it, which is what the gutter's full-height hover is for.
    const { editor } = openNote("Above.\n\n---\n\nBelow.", NARROW_PANE);
    let pos = -1;
    editor.state.doc.descendants((node, at) => {
      if (node.type.name === "horizontalRule") pos = at;
    });
    const target = blockTargetAt(editor.state.doc, pos)!;
    expect(target.node.type.name).toBe("horizontalRule");

    const block = boxOf(editor, target);
    const rect = await grip(editor, target);

    // Centred on the block, which for something shorter than the grip means the block's own
    // middle falls inside the grip rather than at its top edge.
    const middle = block.top + block.height / 2;
    expect(rect.top).toBeLessThanOrEqual(middle);
    expect(rect.bottom).toBeGreaterThanOrEqual(middle);
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
    const callout = editor.view.dom.querySelector("blockquote")!.getBoundingClientRect();

    // Clear of the card, and of the box holding it: the gap between the two is narrower
    // than a grip, so a grip that only cleared the card sat on the callout's accent rule
    // and its tint. It goes out in the gutter instead, and still on the pane.
    expect(rect.right).toBeLessThanOrEqual(block.left);
    expect(rect.right).toBeLessThanOrEqual(callout.left);
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
    // Named for what pressing it does — Enter and Space open the menu — with the reorder
    // gesture the arrows carry described alongside rather than folded into the name.
    expect(el.getAttribute("aria-label")).toBe("Actions for statblock");
    expect(el.getAttribute("aria-describedby")).toBe("block-handle-hint");
    expect(document.getElementById("block-handle-hint")?.textContent?.trim()).toContain(
      "Arrow up and down",
    );
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

describe("reaching for the grip", () => {
  // The move a GM actually makes: left out of the words, then up to the grip. The first
  // half of it leaves the prose — the gutter is the column's padding, not the editor's —
  // and until #190's follow-on that leave took the grip away before the second half
  // arrived. These dispatch real `mousemove`s at real coordinates and read what the
  // extension reports, so the whole path is under test: the listener, the clamp, and
  // `posAtCoords` on the coordinate the clamp produced.
  function open(markdown: string, paneWidth = NARROW_PANE) {
    const seen: (BlockTarget | null)[] = [];
    const opened = openNote(markdown, paneWidth, (t) => seen.push(t));
    return { ...opened, last: () => seen.at(-1) ?? null };
  }

  function pointerAtColumn(column: Element, point: { left: number; top: number }) {
    column.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: point.left,
        clientY: point.top,
      }),
    );
  }

  /** A point out in the gutter, level with `top` — where the grip is reached from. */
  function inGutter(column: Element, top: number) {
    return { left: column.getBoundingClientRect().left + 2, top };
  }

  it("holds the block while the pointer sits in the gutter beside its last line", async () => {
    const { editor, column, last } = open(`${"A very long sentence ".repeat(20).trim()}.`);
    const paragraph = firstBlock(editor);
    const block = paragraph.getBoundingClientRect();
    expect(block.height).toBeGreaterThan(60); // it really did wrap

    // Level with the bottom of a paragraph several lines tall, which is the y furthest
    // from the grip: the grip is drawn beside the *first* line.
    const low = block.bottom - 6;
    pointerAtColumn(column, { left: block.left + 8, top: low });
    expect(last()?.node.textContent).toBe(paragraph.textContent);

    const rect = await grip(editor, last()!);
    expect(rect.bottom, "the grip is a long way up from that y").toBeLessThan(low - 20);

    // Straight out into the margin, nowhere near the grip, and the block is still held.
    pointerAtColumn(column, inGutter(column, low));
    expect(last()?.node.textContent).toBe(paragraph.textContent);
  });

  it("holds a paragraph under the pointer's own height, not the one the grip is beside", () => {
    // Two paragraphs, and the gutter beside the second must answer with the second. A
    // "keep whatever was showing" fix would pass the test above and fail this one.
    const { editor, column, last } = open("First.\n\nSecond.", WIDE_PANE);
    const blocks = Array.from(editor.view.dom.children);
    const first = blocks[0].getBoundingClientRect();
    const second = blocks[1].getBoundingClientRect();

    pointerAtColumn(column, inGutter(column, first.top + first.height / 2));
    expect(last()?.node.textContent).toBe("First.");

    pointerAtColumn(column, inGutter(column, second.top + second.height / 2));
    expect(last()?.node.textContent).toBe("Second.");
  });

  it("keeps a creature inside an encounter when the pointer goes out to the margin", () => {
    // The nested case, and the one a clamp can get wrong: the gutter is outside the
    // callout, so a pointer level with a creature but out in the margin is level with the
    // *box* too — and answering with the box would move the grip off the creature the GM
    // was reaching for, silently, mid-reach.
    const { editor, column, last } = open(
      ["> [!encounter] The Ambush", "> ```statblock", "> # Kobold A", "> HP: 5/5", "> ```"].join(
        "\n",
      ),
      WIDE_PANE,
    );
    const card = editor.view.dom.querySelector("[data-note-block='statblock']")!;
    const box = card.getBoundingClientRect();

    pointerAtColumn(column, inGutter(column, box.top + box.height / 2));
    expect(last()?.node.type.name).toBe("statblockBlock");
  });

  it("never answers with the list while the pointer walks down its bullets", () => {
    // The flicker this closes: a list's own surface is the strip its markers sit in and the
    // leading between its items, so a pointer crossing a bullet crossed list, item, list,
    // item — and the grip jumped between the whole list and one bullet, twice a bullet.
    const { editor, column, last } = open(
      ["- first bullet", "- second bullet", "- third bullet"].join("\n"),
      WIDE_PANE,
    );
    const list = editor.view.dom.querySelector("ul")!.getBoundingClientRect();
    const items = Array.from(editor.view.dom.querySelectorAll("li"));

    // Every height the list covers, in one-pixel steps: the items, the gaps between them,
    // the markers' own rows. Two x's — the marker strip inside the list's padding, and the
    // gutter outside the prose — because both were reported and they take different paths.
    for (const left of [list.left + 6, column.getBoundingClientRect().left + 2]) {
      const seen = new Set<string>();
      for (let top = Math.ceil(list.top); top <= Math.floor(list.bottom); top++) {
        pointerAtColumn(column, { left, top });
        const target = last();
        expect(target, `a block at (${left}, ${top})`).not.toBeNull();
        seen.add(target!.node.type.name);
        expect(["bulletList", "listItem"]).not.toContain(target!.node.type.name);
      }
      expect(seen).toEqual(new Set(["paragraph"]));
    }

    // And each of the three is still reachable, one per item, which is what the list gave up
    // being a target for.
    const held = items.map((li) => {
      pointerAtColumn(column, inside(li));
      return last()?.node.textContent;
    });
    expect(held).toEqual(["first bullet", "second bullet", "third bullet"]);
  });

  it("holds a callout's own blocks all the way down its side, and the box by its header", () => {
    // The same flicker as the bullets, in the one other place a note has it: the blocks
    // inside a callout are a paragraph's margin apart, and the gaps answered "the callout"
    // — throwing the grip up to the header and back, once per block.
    const { editor, column, last } = open(
      ["> [!encounter] The Ambush", "> The first thing.", ">", "> The second thing."].join("\n"),
      WIDE_PANE,
    );
    const body = Array.from(editor.view.dom.querySelectorAll(".callout-body p"));
    expect(body).toHaveLength(2);
    const first = body[0].getBoundingClientRect();
    const second = body[1].getBoundingClientRect();
    expect(second.top).toBeGreaterThan(first.bottom); // there really is a gap

    for (let top = Math.ceil(first.top); top <= Math.floor(second.bottom); top++) {
      pointerAtColumn(column, inGutter(column, top));
      expect(last()?.node.type.name, `at y ${top}`).toBe("paragraph");
    }

    // The header is still the box's own, which is what "between two children" protects: it
    // has no block above it, so nothing there is a gap between anything.
    const header = editor.view.dom.querySelector(".callout-header")!.getBoundingClientRect();
    pointerAtColumn(column, inGutter(column, header.top + header.height / 2));
    expect(last()?.node.type.name).toBe("blockquote");
  });

  it("answers nothing for a pointer up in the note's title", () => {
    const { column, title, last } = open("The lower halls are flooded.");
    const box = title.getBoundingClientRect();
    pointerAtColumn(column, { left: box.left + 20, top: box.top + box.height / 2 });
    expect(last()).toBeNull();
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
