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
import { describe, it, expect, afterEach } from "vitest";
import {
  blockHandleMenuItems,
  blockStillThere,
  runBlockHandleAction,
  type ClipboardWriter,
} from "$lib/editor/block-handle-menu";
import { deleteBlockAt } from "$lib/editor/block-handle";
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

describe("the three things that apply to every block", () => {
  it("offers duplicate, copy and delete, in that order", () => {
    const editor = note("A sentence.");
    const items = blockHandleMenuItems(targetOf(editor, "paragraph").node);

    expect(items.map((i) => i.action)).toEqual(["duplicate", "copy", "delete"]);
  });

  it("names the block it would act on, in the GM's word for it", () => {
    // A grip floating in the margin has no container to be read in, so "Delete" alone
    // tells a screen reader nothing about which of forty blocks is about to go.
    const editor = note("```statblock\n# Kobold A\nHP: 5/5\n```");
    const items = blockHandleMenuItems(targetOf(editor, "statblockBlock").node);

    expect(items.map((i) => i.label)).toEqual([
      "Duplicate statblock",
      "Copy statblock as Markdown",
      "Delete statblock",
    ]);
  });

  it("names a callout by its type, which is how a GM thinks of the box", () => {
    const editor = note("> [!encounter] The Ambush\n> Two kobolds.");
    const items = blockHandleMenuItems(targetOf(editor, "blockquote").node);

    expect(items[2].label).toBe("Delete encounter callout");
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
    deleteBlockAt(editor, posOf(editor, "paragraph"));

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
    deleteBlockAt(editor, target.pos);
    await runBlockHandleAction(editor, target, "copy", clipboard);

    expect(written).toEqual([]);
  });

  it("asks which block is there, not merely whether one is", () => {
    // The distinction the whole guard rests on, stated on its own: a position that still
    // resolves is not the same claim as the block the GM was looking at.
    const editor = note("Alpha.\n\nBravo.\n\nDelta.");
    const bravo = targetOfNth(editor, "paragraph", 1);
    expect(blockStillThere(editor, bravo)).toBe(true);

    deleteBlockAt(editor, posOf(editor, "paragraph"));
    expect(editor.state.doc.nodeAt(bravo.pos)).not.toBeNull();
    expect(blockStillThere(editor, bravo)).toBe(false);
  });
});
