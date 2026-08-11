// The block handle's decisions (#182 follow-on) — which block, and what happens to it.
//
// The handle's *placement* is layout and is not asserted anywhere: jsdom has no boxes, so a
// test that called `posAtCoords` would measure nothing and pass regardless. That is why the
// module keeps the pointer maths down to one line and puts every decision behind
// `blockTargetAt`, which takes a document and a position. What is below is that decision,
// plus the four things the menu does — all of it real document behaviour.
import { describe, it, expect, afterEach, vi } from "vitest";
import { NodeSelection } from "@tiptap/pm/state";

// A scene block asks the ledger for its tracks the moment its node view mounts, and there
// is no ledger here — the call resolves to null and the `.map` on it rejects into nowhere,
// which Vitest reports as an unhandled error with every test still green. Nothing below
// depends on a scene's contents; only on a scene being a block the handle can delete.
vi.mock("$lib/stores/scenes.svelte", () => ({
  scenes: {
    scenes: [],
    getSlots: () => Promise.resolve([]),
    invalidateSlots: () => {},
  },
}));

import {
  blockTargetAt,
  blockMarkdownAt,
  canTurnInto,
  deleteBlockAt,
  duplicateBlockAt,
  hoverProbeAt,
  selectBlockAt,
  turnIntoAt,
  turnIntoKindAt,
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

// ─── Where a pointer counts as hovering ───────────────────────────────────────
//
// The numbers half of the gutter hover. What it does to a real document at a real coordinate
// is in `block-handle-placement.browser.test.ts`, where there is layout to measure; this is
// the rule itself, which is a decision about four edges.

describe("the pointer's hover zone", () => {
  // A pane 300 wide with a 36px gutter: prose from 36 to 300, one block tall.
  const zone = {
    prose: { left: 36, top: 100, width: 264, height: 200 },
    columnLeft: 0,
  };

  it("leaves a pointer over the words exactly where it is", () => {
    expect(hoverProbeAt({ left: 120, top: 150 }, zone)).toEqual({
      left: 120,
      top: 150,
      fromGutter: false,
    });
  });

  it("pulls a pointer out in the gutter back to the prose, keeping its height", () => {
    // The height is the whole answer: it is what says *which* block, and the distance out
    // into the margin is what the GM is not making a claim about.
    expect(hoverProbeAt({ left: 4, top: 260 }, zone)).toEqual({
      left: 37,
      top: 260,
      fromGutter: true,
    });
  });

  it("answers for the far edge of the gutter, which is where a pointer overshoots to", () => {
    expect(hoverProbeAt({ left: 0, top: 150 }, zone)?.fromGutter).toBe(true);
    expect(hoverProbeAt({ left: -1, top: 150 }, zone)).toBeNull();
  });

  it("declines a pointer above or below the prose", () => {
    // Above is the note's title, below is the empty space under the last block. Neither is
    // a claim about a block, and a clamp with no vertical bound would make both into one.
    expect(hoverProbeAt({ left: 10, top: 99 }, zone)).toBeNull();
    expect(hoverProbeAt({ left: 10, top: 301 }, zone)).toBeNull();
  });

  it("declines a pointer past the far side of the prose", () => {
    // The trailing margin is not a gutter: there is no grip over there to reach for.
    expect(hoverProbeAt({ left: 301, top: 150 }, zone)).toBeNull();
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

  // The blocks that gave up their own trash can (#194). Each one used to carry a control
  // because it is sealed — it holds every click, so ProseMirror never selects the node
  // and Backspace has nothing to take. Deleting them here is what makes taking those
  // controls out a removal of a duplicate rather than a removal of the only way out.
  it.each([
    ["an infobox", "```infobox\n# The Ember Keep\nRuler: Mira\n```", "infoboxBlock"],
    [
      "a timeline",
      "```timeline\n# The Shattering\nDate: 3rd of Frostfall\n```",
      "timelineBlock",
    ],
    ["a scene block", "```scene\n# The Tavern\nId: 7\n```", "sceneBlock"],
  ])("takes %s, which has no removal control of its own", (_what, md, type) => {
    const editor = note(["Before.", "", md, "", "After."].join("\n"));
    deleteBlockAt(editor, posOf(editor, type));

    expect(saved(editor)).toBe("Before.\n\nAfter.");

    editor.commands.undo();
    expect(saved(editor)).toBe(["Before.", "", md, "", "After."].join("\n"));
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

  it("lifts a list item out of its list on the way to being a quote", () => {
    // `wrapIn` alone refuses inside a list item — a blockquote is not valid there — and
    // returns having done nothing, so the Quote the menu offers on a bullet (#192) would
    // be one a GM can click and watch not happen. The lift is not a workaround either:
    // the block they asked to quote is no longer a bullet.
    const editor = note("- the one with the sling\n- and the other");
    turnIntoAt(editor, posOf(editor, "paragraph"), "quote");

    expect(saved(editor)).toBe("> the one with the sling\n\n- and the other");
  });

  it("lifts a list item out on the way to a heading, taking only that item", () => {
    const editor = note("- the one with the sling\n- and the other");
    turnIntoAt(editor, posOf(editor, "paragraph"), "heading2");

    expect(saved(editor)).toBe("## the one with the sling\n\n- and the other");
  });

  it("answers that something happened even where the chain reports otherwise", () => {
    // `setNode` returns false down its `clearNodes` fallback — the path that unwraps a
    // quote — so a chain's own answer says "nothing happened" about a write that plainly
    // did. The caller uses this to tell an ordinary no-op from a stale menu.
    const editor = note("> Something waits.");
    const done = turnIntoAt(editor, posOf(editor, "paragraph"), "paragraph");

    expect(saved(editor)).toBe("Something waits.");
    expect(done).toBe(true);
  });

  it("is one undo, taking back the heading and not the sentence before it", () => {
    // The other three writes close the history group and this one did not, so a GM who
    // typed a line and turned it into a heading in the same breath lost both to one
    // Ctrl+Z — the typing being the part they did not ask to take back (ADR-0016 §6).
    const editor = note("The Lower");
    const pos = posOf(editor, "paragraph");
    editor.commands.insertContentAt(pos + 1 + "The Lower".length, " Halls");
    turnIntoAt(editor, pos, "heading2");
    editor.commands.undo();

    expect(saved(editor)).toBe("The Lower Halls");
  });
});

// ─── What it already is ───────────────────────────────────────────────────────

describe("naming the kind a block already is", () => {
  it("reads a paragraph, and a heading at its own level", () => {
    const editor = note("A sentence.\n\n## The Lower Halls");

    expect(turnIntoKindAt(editor.state.doc, posOf(editor, "paragraph"))).toBe("paragraph");
    expect(turnIntoKindAt(editor.state.doc, posOf(editor, "heading"))).toBe("heading2");
  });

  it("reads the list a list item is in, not the paragraph inside it", () => {
    // The handle targets the *innermost* block, which for a list item is the paragraph
    // its text lives in — so the answer is only in the ancestry above it.
    const bullets = note("- the one with the sling");
    expect(turnIntoKindAt(bullets.state.doc, posOf(bullets, "paragraph"))).toBe(
      "bulletList",
    );
    closeNote();

    const numbered = note("1. first light");
    expect(turnIntoKindAt(numbered.state.doc, posOf(numbered, "paragraph"))).toBe(
      "orderedList",
    );
  });

  it("reads a plain quote as a quote, and a callout's own prose as a paragraph", () => {
    // A GM turning a paragraph into a quote is asking for a quote, so a plain one is on
    // offer and its prose reads as it. An encounter box is *not* on offer — it is a
    // container — so what is inside it is a paragraph, which is both true and the thing
    // that stops "Paragraph" tearing that prose out of the box.
    const quote = note("> Something waits.");
    expect(turnIntoKindAt(quote.state.doc, posOf(quote, "paragraph"))).toBe("quote");
    closeNote();

    const callout = note("> [!encounter] The Ambush\n> Two kobolds.");
    expect(turnIntoKindAt(callout.state.doc, posOf(callout, "paragraph"))).toBe(
      "paragraph",
    );
  });

  it("has no answer for a block that cannot be turned into anything", () => {
    const editor = note("```statblock\n# Kobold A\nHP: 5/5\n```");

    expect(turnIntoKindAt(editor.state.doc, posOf(editor, "statblockBlock"))).toBeNull();
  });

  it("declines a position past the end of the document", () => {
    const editor = note("A sentence.");

    expect(turnIntoKindAt(editor.state.doc, 9999)).toBeNull();
  });
});
