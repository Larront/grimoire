// The block handle's decisions (#182 follow-on) — which block, and what happens to it.
//
// The handle's *placement* is layout and is not asserted anywhere: jsdom has no boxes, so a
// test that called `posAtCoords` would measure nothing and pass regardless. That is why the
// module keeps the pointer maths down to one line and puts every decision behind
// `blockTargetAt`, which takes a document and a position. What is below is that decision,
// plus the four things the menu does — all of it real document behaviour.
import { describe, it, expect, afterEach } from "vitest";
import { NodeSelection } from "@tiptap/pm/state";
import {
  blockTargetAt,
  blockMarkdownAt,
  canTurnInto,
  deleteBlockAt,
  duplicateBlockAt,
  selectBlockAt,
  turnIntoAt,
} from "$lib/editor/block-handle";
import { closeNote, note, saved } from "./fixtures/note-editor";

afterEach(closeNote);

/** The position of the first node of `type`, the way the handle would end up holding it. */
function posOf(editor: ReturnType<typeof note>, type: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.type.name === type) found = pos;
    return found === -1;
  });
  expect(found, `the note holds a ${type}`).toBeGreaterThanOrEqual(0);
  return found;
}

// ─── Which block ──────────────────────────────────────────────────────────────

describe("the handle targets the innermost block", () => {
  it("targets the paragraph a caret sits in, not the document", () => {
    const editor = note("A sentence.");
    const pos = posOf(editor, "paragraph");

    // A coordinate inside the text resolves to a text position, one past the block's start.
    const target = blockTargetAt(editor.state.doc, pos + 1);
    expect(target?.node.type.name).toBe("paragraph");
    expect(target?.pos).toBe(pos);
  });

  it("targets a statblock, which holds no text position of its own", () => {
    const editor = note("```statblock\n# Kobold A\nHP: 5/5\n```");
    const pos = posOf(editor, "statblockBlock");

    const target = blockTargetAt(editor.state.doc, pos);
    expect(target?.node.type.name).toBe("statblockBlock");
    expect(target?.pos).toBe(pos);
  });

  it("targets the creature inside an encounter, not the box around it", () => {
    // The decision the whole module is shaped around: a fight is reordered creature by
    // creature, so hovering one has to mean that one.
    const editor = note(
      ["> [!encounter] The Ambush", "> ```statblock", "> # Kobold A", "> HP: 5/5", "> ```"].join(
        "\n",
      ),
    );
    const pos = posOf(editor, "statblockBlock");

    const target = blockTargetAt(editor.state.doc, pos);
    expect(target?.node.type.name).toBe("statblockBlock");
  });

  it("targets a paragraph inside a callout, not the callout", () => {
    const editor = note("> [!note] The Halls\n> Something waits.");
    const pos = posOf(editor, "paragraph");

    expect(blockTargetAt(editor.state.doc, pos + 1)?.node.type.name).toBe("paragraph");
  });

  it("targets the callout itself from a position that is not in any child", () => {
    // Over the header or the padding, which is the only hold a box has once its children
    // answer for themselves.
    const editor = note("> [!note] The Halls\n> Something waits.");
    const pos = posOf(editor, "blockquote");

    expect(blockTargetAt(editor.state.doc, pos)?.node.type.name).toBe("blockquote");
  });

  it("never targets the document, however far out the walk goes", () => {
    const editor = note("A sentence.");
    expect(blockTargetAt(editor.state.doc, 0)?.node.type.name).not.toBe("doc");
  });

  it("declines a position outside the document rather than throwing", () => {
    const editor = note("A sentence.");
    expect(blockTargetAt(editor.state.doc, -1)).toBeNull();
    expect(blockTargetAt(editor.state.doc, 9999)).toBeNull();
  });
});

// ─── Select ───────────────────────────────────────────────────────────────────

describe("selecting a block", () => {
  it("makes the block the selection, which is what a drag carries", () => {
    const editor = note("```statblock\n# Kobold A\nHP: 5/5\n```");
    expect(selectBlockAt(editor, posOf(editor, "statblockBlock"))).toBe(true);

    const { selection } = editor.state;
    expect(selection).toBeInstanceOf(NodeSelection);
    expect((selection as NodeSelection).node.type.name).toBe("statblockBlock");
  });

  it("declines a position that no longer holds a block", () => {
    const editor = note("A sentence.");
    expect(selectBlockAt(editor, 9999)).toBe(false);
  });
});

// ─── Delete ───────────────────────────────────────────────────────────────────

describe("deleting a block", () => {
  it("takes exactly the block, leaving what surrounded it", () => {
    const editor = note(
      ["Before.", "", "```statblock", "# Kobold A", "HP: 5/5", "```", "", "After."].join("\n"),
    );
    deleteBlockAt(editor, posOf(editor, "statblockBlock"));

    expect(saved(editor)).toBe("Before.\n\nAfter.");
  });

  it("takes a callout's contents with it, because they are its children", () => {
    // The consistency the delete was asked for: a box and what is in it are one block, so
    // one gesture removes both. There is no unwrap any more.
    const editor = note(
      ["Before.", "", "> [!encounter] The Ambush", "> Something waits.", "", "After."].join("\n"),
    );
    deleteBlockAt(editor, posOf(editor, "blockquote"));

    const out = saved(editor);
    expect(out).toBe("Before.\n\nAfter.");
    expect(out).not.toContain("waits");
  });

  it("is one undo step, like every other write in the pattern", () => {
    const md = ["```statblock", "# Kobold A", "HP: 5/5", "```"].join("\n");
    const editor = note(md);
    deleteBlockAt(editor, posOf(editor, "statblockBlock"));
    editor.commands.undo();

    expect(saved(editor)).toBe(md);
  });
});

// ─── Duplicate ────────────────────────────────────────────────────────────────

describe("duplicating a block", () => {
  it("puts a copy directly after the original", () => {
    const md = ["```statblock", "# Kobold A", "HP: 5/5", "```"].join("\n");
    const editor = note(md);
    duplicateBlockAt(editor, posOf(editor, "statblockBlock"));

    expect(saved(editor)).toBe(`${md}\n\n${md}`);
  });

  it("brings a callout's children along", () => {
    const md = ["> [!encounter] The Ambush", "> ```statblock", "> # Kobold A", "> HP: 5/5", "> ```"].join(
      "\n",
    );
    const editor = note(md);
    duplicateBlockAt(editor, posOf(editor, "blockquote"));

    const out = saved(editor);
    expect(out.match(/Kobold A/g)).toHaveLength(2);
    expect(out.match(/!\[?\[?encounter/g) ?? out.match(/\[!encounter\]/g)).toHaveLength(2);
  });

  it("is one undo step", () => {
    const md = ["```statblock", "# Kobold A", "HP: 5/5", "```"].join("\n");
    const editor = note(md);
    duplicateBlockAt(editor, posOf(editor, "statblockBlock"));
    editor.commands.undo();

    expect(saved(editor)).toBe(md);
  });
});

// ─── Copy ─────────────────────────────────────────────────────────────────────

describe("copying a block", () => {
  it("yields the markdown the block is written as on disk", () => {
    // Not HTML and not a ProseMirror slice: a creature pasted into Obsidian has to land as
    // the fence a GM could have typed.
    const md = ["```statblock", "# Kobold A", "HP: 5/5", "```"].join("\n");
    const editor = note(md);

    expect(blockMarkdownAt(editor, posOf(editor, "statblockBlock"))).toBe(md);
  });

  it("yields a paragraph's own text", () => {
    const editor = note("A sentence.");
    expect(blockMarkdownAt(editor, posOf(editor, "paragraph"))).toBe("A sentence.");
  });

  it("yields a callout with its contents quoted", () => {
    const md = ["> [!encounter] The Ambush", "> Something waits."].join("\n");
    const editor = note(md);

    expect(blockMarkdownAt(editor, posOf(editor, "blockquote"))).toBe(md);
  });
});

// ─── Turn into ────────────────────────────────────────────────────────────────

describe("turning one block into another", () => {
  it("offers itself for a paragraph and refuses a statblock", () => {
    const editor = note("A sentence.\n\n```statblock\n# Kobold A\nHP: 5/5\n```");
    const paragraph = editor.state.doc.nodeAt(posOf(editor, "paragraph"))!;
    const statblock = editor.state.doc.nodeAt(posOf(editor, "statblockBlock"))!;

    expect(canTurnInto(paragraph)).toBe(true);
    // A creature is not a sentence with extra steps: there is no answer to which of its
    // rows would survive becoming a heading.
    expect(canTurnInto(statblock)).toBe(false);
  });

  it("makes a paragraph a heading", () => {
    const editor = note("The Lower Halls");
    turnIntoAt(editor, posOf(editor, "paragraph"), "heading2");

    expect(saved(editor)).toBe("## The Lower Halls");
  });

  it("makes a heading a paragraph again", () => {
    const editor = note("## The Lower Halls");
    turnIntoAt(editor, posOf(editor, "heading"), "paragraph");

    expect(saved(editor)).toBe("The Lower Halls");
  });

  it("makes a paragraph a list item", () => {
    const editor = note("the one with the sling");
    turnIntoAt(editor, posOf(editor, "paragraph"), "bulletList");

    expect(saved(editor)).toBe("- the one with the sling");
  });

  it("makes a paragraph a quote", () => {
    const editor = note("Something waits.");
    turnIntoAt(editor, posOf(editor, "paragraph"), "quote");

    expect(saved(editor)).toBe("> Something waits.");
  });

  it("declines a statblock, changing nothing", () => {
    const md = ["```statblock", "# Kobold A", "HP: 5/5", "```"].join("\n");
    const editor = note(md);

    expect(turnIntoAt(editor, posOf(editor, "statblockBlock"), "heading1")).toBe(false);
    expect(saved(editor)).toBe(md);
  });
});
