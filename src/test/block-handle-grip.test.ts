// The grip half of the block handle (#190) — the part a GM can see and pull.
//
// Three seams, and the split between them is the same one the engine already makes: what
// is a decision about a document is asserted here, and what is layout is asserted in a
// browser (`block-handle-placement.browser.test.ts`), because jsdom has no boxes and a
// placement test written against it would pass whatever the numbers were.
//
// So: the keyboard move is a document change and lives here. The drag's *handoff* to
// ProseMirror is a state change and lives here — the drag itself is a pointer gesture
// jsdom cannot perform, and firing `dragstart` at it would prove only that an event
// dispatched. The placement arithmetic is here too, but only because `handlePlacement`
// takes numbers rather than elements; the numbers it is given in the app are measured in
// the browser test.
import { describe, it, expect, afterEach } from "vitest";
import { NodeSelection } from "@tiptap/pm/state";
import {
  blockTargetAt,
  handlePlacement,
  moveBlockAt,
  startBlockDrag,
  type BlockTarget,
  type HandleGeometry,
} from "$lib/editor/block-handle";
import { caretAt, closeNote, note, press, saved } from "./fixtures/note-editor";

afterEach(closeNote);

/** The position of the first node of `type` — where the handle would be holding it. */
function posOf(editor: ReturnType<typeof note>, type: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.type.name === type) found = pos;
    return found === -1;
  });
  expect(found, `the note holds a ${type}`).toBeGreaterThanOrEqual(0);
  return found;
}

/** The position of the nth node of `type`, for the fights that hold identical siblings. */
function posOfNth(editor: ReturnType<typeof note>, type: string, index: number): number {
  const found: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === type) found.push(pos);
  });
  expect(found.length).toBeGreaterThan(index);
  return found[index];
}

// jsdom has no `DataTransfer`, and the one thing under test about it is what was written
// to it — so this records exactly that and nothing else.
function fakeDataTransfer() {
  const data = new Map<string, string>();
  let dragImage: Element | null = null;
  return {
    data,
    get dragImage() {
      return dragImage;
    },
    transfer: {
      effectAllowed: "none",
      clearData: () => data.clear(),
      setData: (format: string, value: string) => data.set(format, value),
      getData: (format: string) => data.get(format) ?? "",
      setDragImage: (el: Element) => {
        dragImage = el;
      },
    } as unknown as DataTransfer,
  };
}

// ─── Moving a block by keyboard ───────────────────────────────────────────────

describe("moving a block one place", () => {
  it("moves a paragraph down, and the note's markdown holds the new order", () => {
    const editor = note("First.\n\nSecond.");
    moveBlockAt(editor, posOf(editor, "paragraph"), 1);

    expect(saved(editor)).toBe("Second.\n\nFirst.");
  });

  it("moves a paragraph up", () => {
    const editor = note("First.\n\nSecond.");
    moveBlockAt(editor, posOfNth(editor, "paragraph", 1), -1);

    expect(saved(editor)).toBe("Second.\n\nFirst.");
  });

  it("reorders a fight creature by creature, which is why the grip exists", () => {
    const editor = note(
      [
        "> [!encounter] The Ambush",
        "> ```statblock",
        "> # Kobold A",
        "> HP: 5/5",
        "> ```",
        "> ```statblock",
        "> # Kobold B",
        "> HP: 5/5",
        "> ```",
      ].join("\n"),
    );
    moveBlockAt(editor, posOfNth(editor, "statblockBlock", 1), -1);

    const out = saved(editor);
    expect(out.indexOf("Kobold B")).toBeLessThan(out.indexOf("Kobold A"));
    // Still in the box: the creature moved up the order, it did not fall out of the fight.
    expect(
      out
        .split("\n")
        .filter((l) => l.includes("Kobold"))
        .every((l) => l.startsWith(">")),
    ).toBe(true);
  });

  it("stops at the first sibling rather than walking out of the callout", () => {
    const md = ["Before.", "", "> [!note] The Halls", "> Something waits."].join("\n");
    const editor = note(md);

    // The paragraph inside the quote is the first thing in it; there is nowhere above it
    // that is still inside the box, and leaving the box is not a move the GM asked for.
    expect(moveBlockAt(editor, posOfNth(editor, "paragraph", 1), -1)).toBeNull();
    expect(saved(editor)).toBe(md);
  });

  it("declines at the ends of the note, changing nothing", () => {
    const editor = note("Only.");
    expect(moveBlockAt(editor, posOf(editor, "paragraph"), -1)).toBeNull();
    expect(moveBlockAt(editor, posOf(editor, "paragraph"), 1)).toBeNull();
    expect(saved(editor)).toBe("Only.");
  });

  it("answers with where the block landed, still holding it", () => {
    // What the handle draws itself against next: the old position now holds a neighbour.
    const editor = note("First.\n\n```statblock\n# Kobold A\nHP: 5/5\n```");
    const from = posOf(editor, "statblockBlock");
    const landed = moveBlockAt(editor, from, -1);

    expect(landed).not.toBeNull();
    expect(landed).not.toBe(from);
    expect(blockTargetAt(editor.state.doc, landed!)?.node.type.name).toBe("statblockBlock");
  });

  it("leaves the moved block selected, so a second press moves the same one", () => {
    const editor = note("First.\n\nSecond.\n\nThird.");
    const landed = moveBlockAt(editor, posOfNth(editor, "paragraph", 2), -1)!;

    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect(editor.state.selection.from).toBe(landed);
    expect((editor.state.selection as NodeSelection).node.textContent).toBe("Third.");
  });

  it("is one undo step, like every other write in the pattern", () => {
    const md = "First.\n\nSecond.";
    const editor = note(md);
    moveBlockAt(editor, posOf(editor, "paragraph"), 1);
    editor.commands.undo();

    expect(saved(editor)).toBe(md);
  });

  it("declines a position that no longer holds a block", () => {
    const editor = note("A sentence.");
    expect(moveBlockAt(editor, 9999, 1)).toBeNull();
  });
});

// ─── Handing the drag to ProseMirror ──────────────────────────────────────────

describe("starting a drag from the grip", () => {
  it("tells the view the drag is its own, and that it is a move", () => {
    // Without this the drop is parsed back out of the clipboard HTML as foreign content
    // and *copied*, so the block ends up in two places — the silent failure the grip
    // would otherwise ship with, since the drag looks right the whole way.
    const editor = note("First.\n\n```statblock\n# Kobold A\nHP: 5/5\n```");
    const { transfer } = fakeDataTransfer();

    expect(startBlockDrag(editor, posOf(editor, "statblockBlock"), transfer)).toBe(true);
    expect(editor.view.dragging?.move).toBe(true);
    expect(editor.view.dragging?.slice.content.firstChild?.type.name).toBe("statblockBlock");
  });

  it("selects the block, which is what the slice is taken from", () => {
    const editor = note("```statblock\n# Kobold A\nHP: 5/5\n```");
    startBlockDrag(editor, posOf(editor, "statblockBlock"), fakeDataTransfer().transfer);

    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect((editor.state.selection as NodeSelection).node.type.name).toBe("statblockBlock");
  });

  it("carries the block's markdown for anything outside this window", () => {
    // A creature dragged into Obsidian lands as the fence a GM could have typed, for the
    // reason the copy action gives (ADR-0016 §1). Inside the editor this payload is never
    // read — the view moves the slice it was handed above.
    const md = ["```statblock", "# Kobold A", "HP: 5/5", "```"].join("\n");
    const editor = note(md);
    const { transfer, data } = fakeDataTransfer();
    startBlockDrag(editor, posOf(editor, "statblockBlock"), transfer);

    expect(data.get("text/plain")).toBe(md);
    expect(data.get("text/html")).toContain("statblock");
  });

  it("drags a ghost of the block rather than of the grip", () => {
    const editor = note("A sentence.");
    const fake = fakeDataTransfer();
    const block = document.createElement("p");
    startBlockDrag(editor, posOf(editor, "paragraph"), fake.transfer, block);

    expect(fake.dragImage).toBe(block);
  });

  it("declines a position that no longer holds a block, and starts nothing", () => {
    const editor = note("A sentence.");
    expect(startBlockDrag(editor, 9999, fakeDataTransfer().transfer)).toBe(false);
    expect(editor.view.dragging).toBeNull();
  });
});

// ─── Where the handle goes ────────────────────────────────────────────────────
//
// The arithmetic only. What these numbers are in the app — the block's real box, the
// column's real left edge — is measured in Chromium, next door.

describe("placing the handle beside a block", () => {
  /** A paragraph in a column, and a grip of the size the stylesheet gives one. */
  const geometry = (over: Partial<HandleGeometry> = {}): HandleGeometry => ({
    block: { left: 100, top: 200, width: 400, height: 24 },
    firstLine: 24,
    handle: { width: 18, height: 18 },
    gap: 6,
    columnLeft: 40,
    ...over,
  });

  it("sits entirely to the left of the block, never over a word", () => {
    const { left } = handlePlacement(geometry());
    expect(left + 18).toBeLessThanOrEqual(100);
  });

  it("follows a block indented inside a callout", () => {
    const outer = handlePlacement(geometry());
    const inner = handlePlacement(
      geometry({ block: { left: 132, top: 200, width: 340, height: 24 } }),
    );

    expect(inner.left).toBe(outer.left + 32);
  });

  it("centres on the first line, not on the middle of a long paragraph", () => {
    const tall = handlePlacement(
      geometry({ block: { left: 100, top: 200, width: 400, height: 120 } }),
    );

    expect(tall.top).toBe(handlePlacement(geometry()).top);
    expect(tall.top).toBe(200 + (24 - 18) / 2);
  });

  it("centres on a sealed block's own height, which is all it has", () => {
    // A statblock has no line box, so the caller passes the card's height and the handle
    // sits beside the card rather than above it.
    const { top } = handlePlacement(
      geometry({
        block: { left: 100, top: 200, width: 400, height: 60 },
        firstLine: 60,
      }),
    );
    expect(top).toBe(200 + (60 - 18) / 2);
  });

  it("stops at the column's edge rather than hanging off a pane dragged narrow", () => {
    const { left } = handlePlacement(
      geometry({ block: { left: 44, top: 200, width: 200, height: 24 } }),
    );
    expect(left).toBe(40);
  });
});

// ─── Reaching the handle without a mouse ──────────────────────────────────────

describe("the keyboard's way in", () => {
  it("raises the handle on the block the caret is in", () => {
    // Hover is the only other way in, so without this the grip and everything behind it
    // do not exist for a GM who does not point at things.
    const grabbed: BlockTarget[] = [];
    const editor = note("First.\n\nSecond.", {
      onBlockGrab: (target) => grabbed.push(target),
    });
    caretAt(editor, posOfNth(editor, "paragraph", 1) + 1);
    press(editor, "h", { ctrlKey: true, shiftKey: true });

    expect(grabbed).toHaveLength(1);
    expect(grabbed[0].node.textContent).toBe("Second.");
  });
});
