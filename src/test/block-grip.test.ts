// The grip (#182 follow-on) — how a block is picked up.
//
// A sealed block holds every click so its own fields work (ADR-0016 §4), and the cost of
// that is stated in the connector already: ProseMirror never selects the node, so there is
// nothing for Backspace to take. The same absence is why a card could not be copied, cut,
// or dragged anywhere — a `NodeSelection` is what all three of those operate on, and no
// gesture produced one.
//
// The grip is the seam that fixes it, and it is deliberately two halves in two places:
// each block draws its own handle (§8 keeps appearance out of the connector) and marks it
// with `data-block-grip`; the connector routes events on it past `stopEvent` and offers the
// `selectNode` capability behind it. These cases pin the contract between the halves,
// because a grip that renders and does nothing looks exactly like a grip that works.
//
// Drag itself is not asserted here. jsdom has no drag-and-drop and no layout, so a test
// that fired `dragstart` would prove only that the event dispatched. What is testable, and
// what actually broke when this was wired, is the selection: whether the node the grip
// belongs to becomes the selection, and whether the node spec allows a drag at all.
import { describe, it, expect, afterEach } from "vitest";
import { NodeSelection } from "@tiptap/pm/state";
import { fireEvent } from "@testing-library/svelte";
import { closeNote, dom, note, saved } from "./fixtures/note-editor";

afterEach(closeNote);

/** One note per block type, each holding exactly one of it. */
const BLOCKS: [name: string, nodeType: string, markdown: string, grip: string][] = [
  [
    "statblock",
    "statblockBlock",
    "```statblock\n# Kobold A\nHP: 5/5\n```",
    "Select statblock",
  ],
  [
    "infobox",
    "infoboxBlock",
    "```infobox\n# The Ember Keep\nRuler: Mira\n```",
    "Select infobox",
  ],
  [
    "timeline",
    "timelineBlock",
    "```timeline\n# The Shattering\nDate: 3rd of Frostfall\n```",
    "Select timeline",
  ],
  ["callout", "blockquote", "> [!encounter] The Ambush\n> Something waits.", "Select callout"],
];

/** The grip inside the one block a note holds. */
function grip(editor: ReturnType<typeof note>, label: string): HTMLElement {
  const found = dom(editor).querySelector<HTMLElement>(`[aria-label="${label}"]`);
  expect(found, `the block offers a "${label}" grip`).toBeTruthy();
  return found!;
}

describe("every block offers a grip", () => {
  it.each(BLOCKS)("%s draws one, marked as the connector's seam", (_name, _type, md, label) => {
    const editor = note(md);
    // The attribute is the whole contract with the connector: without it the mousedown is
    // swallowed like every other click and the grip is decoration.
    expect(grip(editor, label).closest("[data-block-grip]")).toBeTruthy();
  });

  it.each(BLOCKS)("%s is draggable, or the drag could not start", (_name, type, md) => {
    const editor = note(md);
    expect(editor.schema.nodes[type].spec.draggable).toBe(true);
  });

  // Scene and Image are absent from the table above because neither draws its chrome
  // unconditionally — Scene's needs a bound scene from the store, Image's appears only
  // once the node is selected — so their grips are checked by hand rather than here.
  // The spec half is still worth pinning: it is the half that silently disables a drag.
  it.each([
    ["sceneBlock"],
    ["image"],
  ])("%s allows a drag too", (type) => {
    const editor = note("Prose.");
    expect(editor.schema.nodes[type].spec.draggable).toBe(true);
  });
});

describe("a grip selects the block it belongs to", () => {
  it.each(BLOCKS)("%s becomes the selection on mousedown", async (_name, type, md, label) => {
    const editor = note(md);
    await fireEvent.mouseDown(grip(editor, label));

    const { selection } = editor.state;
    expect(selection).toBeInstanceOf(NodeSelection);
    expect((selection as NodeSelection).node.type.name).toBe(type);
  });

  it("selects the creature whose grip was used, not its identical neighbour", async () => {
    // Two fences of the same shape in one note: a position that drifted by one node would
    // pass every case above and still pick up the wrong creature.
    const md = [
      "```statblock",
      "# Kobold A",
      "HP: 5/5",
      "```",
      "",
      "```statblock",
      "# Kobold B",
      "HP: 5/5",
      "```",
    ].join("\n");
    const editor = note(md);
    const grips = [
      ...dom(editor).querySelectorAll<HTMLElement>('[aria-label="Select statblock"]'),
    ];
    expect(grips).toHaveLength(2);

    await fireEvent.mouseDown(grips[1]);

    const selected = (editor.state.selection as NodeSelection).node;
    expect(selected.attrs.name).toBe("Kobold B");
  });

  it("selects a block nested in a callout, where a fight's creatures live", async () => {
    const editor = note(
      ["> [!encounter] The Ambush", "> ```statblock", "> # Kobold A", "> HP: 5/5", "> ```"].join(
        "\n",
      ),
    );
    await fireEvent.mouseDown(grip(editor, "Select statblock"));

    const selected = (editor.state.selection as NodeSelection).node;
    expect(selected.type.name).toBe("statblockBlock");
    expect(selected.attrs.name).toBe("Kobold A");
  });
});

describe("a selected block is one thing the document can move", () => {
  // Cut and drag-to-move are both a delete of the selection plus an insert elsewhere. The
  // delete is the half that can go wrong quietly — taking a neighbour, or half a fence —
  // so it is the half worth pinning.
  it("deletes exactly the block, leaving what surrounded it", async () => {
    const md = ["Before.", "", "```statblock", "# Kobold A", "HP: 5/5", "```", "", "After."].join(
      "\n",
    );
    const editor = note(md);
    await fireEvent.mouseDown(grip(editor, "Select statblock"));
    editor.commands.deleteSelection();

    expect(saved(editor)).toBe("Before.\n\nAfter.");
  });

  it("takes the callout's contents with it, because they are its children", async () => {
    const md = [
      "Before.",
      "",
      "> [!encounter] The Ambush",
      "> ```statblock",
      "> # Kobold A",
      "> HP: 5/5",
      "> ```",
      "",
      "After.",
    ].join("\n");
    const editor = note(md);
    await fireEvent.mouseDown(grip(editor, "Select callout"));
    editor.commands.deleteSelection();

    const out = saved(editor);
    expect(out).toBe("Before.\n\nAfter.");
    expect(out).not.toContain("Kobold");
  });

  it("makes the delete one undo step, like every other write through the connector", async () => {
    const md = ["```statblock", "# Kobold A", "HP: 5/5", "```"].join("\n");
    const editor = note(md);
    await fireEvent.mouseDown(grip(editor, "Select statblock"));
    editor.commands.deleteSelection();
    editor.commands.undo();

    expect(saved(editor)).toBe(md);
  });
});
