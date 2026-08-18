// The menu's actions, wired to the block the grip is on (#191).
//
// The three writes themselves are the engine's, and pinned next door in
// block-handle.test.ts. What is asserted here is the *wiring*: that each menu item
// reaches the block the grip is currently holding and not a neighbour, that the words a
// GM reads name that block, that Copy puts the note's own markdown somewhere a paste can
// find it, and that a target gone stale under a menu still open does nothing at all.
//
// That last one is the case with teeth, and it is why these take a whole `BlockTarget`
// rather than a position. A menu is open across time — the GM opens it, reads it, and
// clicks — and a position alone goes stale *silently*: the block above gets deleted and
// the position still resolves, to whatever has since slid into it. The last describe
// below is that scenario, and it is the one failure a GM cannot see coming.
import { describe, it, expect, afterEach, vi } from "vitest";

// A scene block asks the ledger for its tracks the moment its node view mounts, and there
// is no ledger here — the call resolves to null and the `.map` on it rejects into nowhere,
// which Vitest reports as an unhandled error with every test still green. Nothing below
// depends on a scene's contents; only on a scene being a block with no answer to "become
// a heading".
vi.mock("$lib/stores/scenes.svelte", () => ({
  scenes: {
    scenes: [],
    getSlots: () => Promise.resolve([]),
    invalidateSlots: () => {},
  },
}));

import {
  blockHandleMenuSections,
  runBlockHandleAction,
  type BlockHandleMenuSection,
  type ClipboardWriter,
} from "$lib/editor/block-handle-menu";
import { blockStillThere, deleteBlock } from "$lib/editor/block-handle";
import {
  closeNote,
  note,
  posOf,
  saved,
  targetOf,
  targetOfNth,
} from "./fixtures/note-editor";

afterEach(closeNote);

/** A clipboard that only remembers, which is the whole of what Copy is asked to do. */
function fakeClipboard() {
  const written: string[] = [];
  return {
    written,
    clipboard: {
      writeText: async (text: string) => {
        written.push(text);
      },
    } satisfies ClipboardWriter,
  };
}

// ─── What the menu offers ─────────────────────────────────────────────────────

/** The menu for the first node of `type`, as the grip on it would open it. */
function menuFor(editor: ReturnType<typeof note>, type: string): BlockHandleMenuSection[] {
  return blockHandleMenuSections(editor.state.doc, targetOf(editor, type));
}

/** The section headings a GM reads down the menu — `undefined` for the unlabelled one. */
const headings = (sections: BlockHandleMenuSection[]) => sections.map((s) => s.title);

/** The section titled `title`, which must be there. */
function section(sections: BlockHandleMenuSection[], title: string) {
  const found = sections.find((s) => s.title === title);
  expect(found, `a "${title}" section`).toBeTruthy();
  return found!;
}

describe("the three things that apply to every block", () => {
  it("offers duplicate, copy and delete, in that order", () => {
    const editor = note("```statblock\n# Kobold A\nHP: 5/5\n```");
    const { items } = menuFor(editor, "statblockBlock")[0];

    expect(items.map((i) => i.command)).toEqual(["duplicate", "copy", "delete"]);
  });

  it("names the block it would act on, in the GM's word for it", () => {
    // A grip floating in the margin has no container to be read in, so "Delete" alone
    // tells a screen reader nothing about which of forty blocks is about to go.
    const editor = note("```statblock\n# Kobold A\nHP: 5/5\n```");
    const { items } = menuFor(editor, "statblockBlock")[0];

    expect(items.map((i) => i.label)).toEqual([
      "Duplicate statblock",
      "Copy statblock as Markdown",
      "Delete statblock",
    ]);
  });

  it("names a callout by its type, which is how a GM thinks of the box", () => {
    const editor = note("> [!encounter] The Ambush\n> Two kobolds.");
    const { items } = menuFor(editor, "blockquote")[0];

    expect(items[2].label).toBe("Delete encounter callout");
  });

  it("stays last, below the transformations, on a block that has both", () => {
    // Ordered least to most destructive across the whole menu, so the item a mis-aimed
    // click lands on is one the GM can undo without noticing what they lost.
    const editor = note("A sentence.");
    const sections = menuFor(editor, "paragraph");

    expect(headings(sections)).toEqual(["Turn into", undefined]);
    expect(sections.at(-1)!.items.at(-1)!.command).toBe("delete");
  });
});

// ─── Turn into ────────────────────────────────────────────────────────────────

describe("the section offering what a text block can become", () => {
  it("offers the seven kinds, in the order a GM reads them", () => {
    const editor = note("A sentence.");

    expect(section(menuFor(editor, "paragraph"), "Turn into").items).toEqual([
      { command: { turnInto: "paragraph" }, label: "Paragraph", icon: "Pilcrow", current: true },
      { command: { turnInto: "heading1" }, label: "Heading 1", icon: "Heading1", current: false },
      { command: { turnInto: "heading2" }, label: "Heading 2", icon: "Heading2", current: false },
      { command: { turnInto: "heading3" }, label: "Heading 3", icon: "Heading3", current: false },
      { command: { turnInto: "bulletList" }, label: "Bullet List", icon: "List", current: false },
      { command: { turnInto: "orderedList" }, label: "Numbered List", icon: "ListOrdered", current: false },
      { command: { turnInto: "quote" }, label: "Quote", icon: "Quote", current: false },
    ]);
  });

  it("is offered for a heading and for a list item", () => {
    const heading = note("## The Lower Halls");
    expect(headings(menuFor(heading, "heading"))).toContain("Turn into");
    closeNote();

    // The grip on a list item holds the paragraph its text lives in — the innermost
    // block, which is the one thing about this the ancestry has to answer.
    const list = note("- the one with the sling");
    expect(headings(menuFor(list, "paragraph"))).toContain("Turn into");
  });

  it.each([
    ["statblockBlock", "```statblock\n# Kobold A\nHP: 5/5\n```"],
    ["infoboxBlock", "```infobox\n# The Ember Keep\nRuler: Mira\n```"],
    ["timelineBlock", "```timeline\n# The Shattering\nDate: 3rd of Frostfall\n```"],
    ["sceneBlock", "```scene\n# The Tavern\nId: 7\n```"],
    ["image", "![The gate](images/gate.png)"],
  ])("is absent entirely for a %s — not greyed out, absent", (type, md) => {
    // There is no way to decide which of a creature's rows survives becoming a heading,
    // because a creature is not a sentence with extra steps. An option that could never
    // be chosen is worse than no option: it says one exists.
    const editor = note(md);

    expect(headings(menuFor(editor, type))).toEqual([undefined]);
  });

  it("marks the heading's own level, and nothing else", () => {
    const editor = note("## The Lower Halls");
    const { items } = section(menuFor(editor, "heading"), "Turn into");

    expect(items.filter((i) => i.current).map((i) => i.label)).toEqual(["Heading 2"]);
  });

  it("marks a list item as the list it is in, not as a paragraph", () => {
    const editor = note("1. first light");
    const { items } = section(menuFor(editor, "paragraph"), "Turn into");

    expect(items.filter((i) => i.current).map((i) => i.label)).toEqual(["Numbered List"]);
  });

  it("marks a callout's own prose as a paragraph, the callout being a container", () => {
    const editor = note("> [!encounter] The Ambush\n> Two kobolds.");
    const { items } = section(menuFor(editor, "paragraph"), "Turn into");

    expect(items.filter((i) => i.current).map((i) => i.label)).toEqual(["Paragraph"]);
  });
});

describe("choosing what the block becomes", () => {
  // The markers, not the node names: what the GM keeps is the file, and a heading that
  // rendered right and wrote nothing would be a note that lost the change on reload.
  it.each([
    ["heading1", "# The Lower Halls"],
    ["heading2", "## The Lower Halls"],
    ["heading3", "### The Lower Halls"],
    ["bulletList", "- The Lower Halls"],
    ["orderedList", "1. The Lower Halls"],
    ["quote", "> The Lower Halls"],
  ] as const)("writes %s as `%s`", async (into, expected) => {
    const editor = note("The Lower Halls");
    await runBlockHandleAction(editor, targetOf(editor, "paragraph"), { turnInto: into });

    expect(saved(editor)).toBe(expected);
  });

  it("drops the markers on the way back to a paragraph", async () => {
    const editor = note("## The Lower Halls");
    await runBlockHandleAction(editor, targetOf(editor, "heading"), {
      turnInto: "paragraph",
    });

    expect(saved(editor)).toBe("The Lower Halls");
  });

  it("makes a plain quote and never a typed callout", async () => {
    // A GM asking for a quote is asking for a quote; choosing "encounter" or "warning"
    // for them would be inventing an intent they did not express.
    const editor = note("Something waits.");
    await runBlockHandleAction(editor, targetOf(editor, "paragraph"), {
      turnInto: "quote",
    });

    expect(saved(editor)).toBe("> Something waits.");
    expect(editor.state.doc.nodeAt(posOf(editor, "blockquote"))?.attrs.calloutType).toBeFalsy();
  });

  it("leaves an encounter box standing when its own prose is turned into a paragraph", async () => {
    // The failure this is written against: `setNode` falls back to `clearNodes` when the
    // block is already a paragraph, and `clearNodes` lifts it out of *every* wrapper —
    // so the prose landed above the box, the box was left with nothing in it and went,
    // and the GM's encounter was gone from a menu item that promised a paragraph.
    const md = ["> [!encounter] The Ambush", "> Two kobolds wait."].join("\n");
    const editor = note(md);
    const done = await runBlockHandleAction(editor, targetOf(editor, "paragraph"), {
      turnInto: "paragraph",
    });

    expect(done).toBe(false);
    expect(saved(editor)).toBe(md);
  });

  it("still un-quotes a plain quote, which is a paragraph the GM can ask for", async () => {
    // The other side of the same guard: a plain quote *is* on offer, so its prose reads
    // as the quote and "Paragraph" is a real change rather than a no-op.
    const editor = note("> Something waits.");
    const done = await runBlockHandleAction(editor, targetOf(editor, "paragraph"), {
      turnInto: "paragraph",
    });

    expect(done).toBe(true);
    expect(saved(editor)).toBe("Something waits.");
  });

  it("does nothing when the block is already that kind", async () => {
    // `toggleBulletList` on a bullet list lifts it back out, so the item naming what the
    // block already is would un-list it — the one thing "turn into a bullet list" cannot
    // be asking for.
    const md = "- the one with the sling";
    const editor = note(md);
    const done = await runBlockHandleAction(editor, targetOf(editor, "paragraph"), {
      turnInto: "bulletList",
    });

    expect(done).toBe(false);
    expect(saved(editor)).toBe(md);
  });

  it("declines a statblock, changing nothing", async () => {
    const md = ["```statblock", "# Kobold A", "HP: 5/5", "```"].join("\n");
    const editor = note(md);
    const done = await runBlockHandleAction(editor, targetOf(editor, "statblockBlock"), {
      turnInto: "heading1",
    });

    expect(done).toBe(false);
    expect(saved(editor)).toBe(md);
  });

  it("does nothing when the block went while the menu was open", async () => {
    const editor = note("Alpha.\n\nBravo.\n\nDelta.");
    const bravo = targetOfNth(editor, "paragraph", 1);
    deleteBlock(editor, targetOf(editor, "paragraph"));

    expect(
      await runBlockHandleAction(editor, bravo, { turnInto: "heading1" }),
    ).toBe(false);
    expect(saved(editor)).toBe("Bravo.\n\nDelta.");
  });
});

// ─── Duplicate ────────────────────────────────────────────────────────────────

describe("duplicating the block the grip is on", () => {
  it("places the copy immediately after the original", async () => {
    const editor = note("First.\n\nSecond.");
    await runBlockHandleAction(editor, targetOf(editor, "paragraph"), "duplicate");

    expect(saved(editor)).toBe("First.\n\nFirst.\n\nSecond.");
  });

  it("brings a callout's contents with it — five clicks, six kobolds", async () => {
    const md = [
      "> [!encounter] The Ambush",
      "> ```statblock",
      "> # Kobold A",
      "> HP: 5/5",
      "> ```",
    ].join("\n");
    const editor = note(md);
    await runBlockHandleAction(editor, targetOf(editor, "blockquote"), "duplicate");

    expect(saved(editor).match(/Kobold A/g)).toHaveLength(2);
    expect(saved(editor)).toBe(`${md}\n\n${md}`);
  });

  it("duplicates the creature the grip is on, not its identical neighbour", async () => {
    const editor = note(
      [
        "```statblock",
        "# Kobold A",
        "HP: 5/5",
        "```",
        "",
        "```statblock",
        "# Kobold B",
        "HP: 5/5",
        "```",
      ].join("\n"),
    );
    await runBlockHandleAction(
      editor,
      targetOfNth(editor, "statblockBlock", 1),
      "duplicate",
    );

    expect(saved(editor).match(/# Kobold [AB]/g)).toEqual([
      "# Kobold A",
      "# Kobold B",
      "# Kobold B",
    ]);
  });

  it("is one undo, so a mis-click takes back the copy and not the sentence", async () => {
    const md = "A sentence the GM typed.\n\nSecond.";
    const editor = note(md);
    await runBlockHandleAction(editor, targetOf(editor, "paragraph"), "duplicate");
    editor.commands.undo();

    expect(saved(editor)).toBe(md);
  });
});

// ─── Copy ─────────────────────────────────────────────────────────────────────

describe("copying the block as the markdown it is written as", () => {
  it("puts the block's own fence on the clipboard, not HTML", async () => {
    // Pasted into Obsidian it lands as the fence a GM could have typed (ADR-0016 §1).
    const md = ["```statblock", "# Kobold A", "HP: 5/5", "```"].join("\n");
    const editor = note(`Before.\n\n${md}`);
    const { clipboard, written } = fakeClipboard();
    await runBlockHandleAction(
      editor,
      targetOf(editor, "statblockBlock"),
      "copy",
      clipboard,
    );

    expect(written).toEqual([md]);
  });

  it("carries a callout's children, quote markers and all", async () => {
    const md = ["> [!note] The Halls", "> Something waits below."].join("\n");
    const editor = note(md);
    const { clipboard, written } = fakeClipboard();
    await runBlockHandleAction(editor, targetOf(editor, "blockquote"), "copy", clipboard);

    expect(written).toEqual([md]);
  });

  it("leaves the note untouched", async () => {
    const md = "A sentence.";
    const editor = note(md);
    await runBlockHandleAction(
      editor,
      targetOf(editor, "paragraph"),
      "copy",
      fakeClipboard().clipboard,
    );

    expect(saved(editor)).toBe(md);
  });

  it("answers false when there is no clipboard to write to", async () => {
    // A Tauri window has one; a test environment and a hardened browser may not, and a
    // menu item that throws into nowhere is worse than one that declines.
    const editor = note("A sentence.");
    const done = await runBlockHandleAction(
      editor,
      targetOf(editor, "paragraph"),
      "copy",
      undefined,
    );

    expect(done).toBe(false);
  });
});

// ─── Delete ───────────────────────────────────────────────────────────────────

describe("deleting the block the grip is on", () => {
  it("takes exactly the block and leaves the prose around it", async () => {
    const editor = note("First.\n\nSecond.\n\nThird.");
    await runBlockHandleAction(editor, targetOfNth(editor, "paragraph", 1), "delete");

    expect(saved(editor)).toBe("First.\n\nThird.");
  });

  it("takes a callout's contents with it, in one gesture", async () => {
    // A box and the creatures in it are not two different removals.
    const editor = note(
      [
        "Before.",
        "",
        "> [!encounter] The Ambush",
        "> ```statblock",
        "> # Kobold A",
        "> HP: 5/5",
        "> ```",
        "",
        "After.",
      ].join("\n"),
    );
    await runBlockHandleAction(editor, targetOf(editor, "blockquote"), "delete");

    expect(saved(editor)).toBe("Before.\n\nAfter.");
  });

  it("is one undo", async () => {
    const md = "First.\n\nSecond.";
    const editor = note(md);
    await runBlockHandleAction(editor, targetOf(editor, "paragraph"), "delete");
    editor.commands.undo();

    expect(saved(editor)).toBe(md);
  });
});

// ─── A target that has gone stale ─────────────────────────────────────────────

describe("acting on a block that is no longer where the menu found it", () => {
  it("does nothing rather than hitting the block that moved into the spot", async () => {
    // The case a position alone cannot see, and the three paragraphs are the same length
    // on purpose: the menu is open on "Bravo.", "Alpha." goes while it is up, and the
    // position the menu holds now lands exactly on "Delta." — a resolvable position
    // describing the wrong block, which is the shape of the failure.
    const editor = note("Alpha.\n\nBravo.\n\nDelta.");
    const bravo = targetOfNth(editor, "paragraph", 1);
    deleteBlock(editor, targetOf(editor, "paragraph"));

    expect(editor.state.doc.nodeAt(bravo.pos)?.textContent).toBe("Delta.");
    for (const action of ["duplicate", "copy", "delete"] as const) {
      expect(
        await runBlockHandleAction(editor, bravo, action, fakeClipboard().clipboard),
      ).toBe(false);
    }
    expect(saved(editor)).toBe("Bravo.\n\nDelta.");
  });

  it("declines a position the document shrank out from under", async () => {
    const editor = note("First.\n\nSecond.");
    const second = targetOfNth(editor, "paragraph", 1);
    editor.commands.setContent("Only.", { contentType: "markdown" });

    expect(await runBlockHandleAction(editor, second, "delete")).toBe(false);
    expect(saved(editor)).toBe("Only.");
  });

  it("copies nothing when the block has gone", async () => {
    const editor = note("A sentence.\n\nSecond.");
    const target = targetOf(editor, "paragraph");
    const { clipboard, written } = fakeClipboard();
    deleteBlock(editor, target);
    await runBlockHandleAction(editor, target, "copy", clipboard);

    expect(written).toEqual([]);
  });

  it("asks which block is there, not merely whether one is", () => {
    // The distinction the whole guard rests on, stated on its own: a position that still
    // resolves is not the same claim as the block the GM was looking at.
    const editor = note("Alpha.\n\nBravo.\n\nDelta.");
    const bravo = targetOfNth(editor, "paragraph", 1);
    expect(blockStillThere(editor.state.doc, bravo)).toBe(true);

    deleteBlock(editor, targetOf(editor, "paragraph"));
    expect(editor.state.doc.nodeAt(bravo.pos)).not.toBeNull();
    expect(blockStillThere(editor.state.doc, bravo)).toBe(false);
  });
});
