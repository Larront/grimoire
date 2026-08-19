// The grip and the life-cycle it reports to, driven together (#191, #211).
//
// The engine's writes are pinned in block-handle-menu.test.ts, the clock in
// block-handle-life.svelte.test.ts, and the grip's placement in Chromium next door. What
// is left — and it is the half of this a GM actually performs — is the gesture: a click
// that opens a menu without cancelling the drag that shares the same button, a menu that
// keeps focus while it is up, and two ways out of it that both leave the GM somewhere they
// can carry on typing.
//
// Driven through the real `BlockHandle` **and the real life-cycle behind it**, on a real
// note. The two halves used to be well tested apart with nothing mounting them together,
// so the contract between them — which latch a gesture sets, and what order its steps run
// in — lived entirely in the gap, which is where the frozen grip lived too. The pair is
// the subject here; a mounted menu on its own would prove only that a callback fired.
import { fireEvent, render } from "@testing-library/svelte";
import { describe, it, expect, afterEach, vi } from "vitest";
import type { Editor } from "@tiptap/core";

vi.mock("$lib/toast", () => ({ toastError: vi.fn() }));

import { toastError } from "$lib/toast";
import BlockHandle from "$lib/components/editor/BlockHandle.svelte";
import { blockStillThere, deleteBlock, type BlockTarget } from "$lib/editor/block-handle";
import {
  createBlockHandleLife,
  type BlockHandleLife,
} from "$lib/editor/block-handle-life.svelte";
import { NodeSelection } from "@tiptap/pm/state";
import { closeNote, note, saved, targetOf, targetOfNth } from "./fixtures/note-editor";

afterEach(closeNote);

/**
 * A clipboard on a `navigator` that has none.
 *
 * Defined onto the real object rather than swapped for a literal: Tiptap reads
 * `navigator.platform` while it builds its keymap, and that is a prototype getter a spread
 * copy silently loses — which surfaces three tests later as an editor that will not mount.
 */
function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

afterEach(() => {
  if ("clipboard" in navigator) delete (navigator as { clipboard?: unknown }).clipboard;
  vi.mocked(toastError).mockClear();
});

/**
 * The hide delay these run with, and `settle` is the wait for it.
 *
 * Short and real rather than faked: a fake clock over a mounted editor fakes the frames
 * its node views draw in too. Nothing here asserts *how long* the grip lingers — that is
 * the clock test's subject next door — only that it goes, or does not.
 *
 * Not a race under load, which is the usual objection to a sleep in a test: the hide and
 * this wait are two timers armed in that order, and a timer due at 5ms is dispatched
 * before one due at 20ms however far behind the loop is running.
 */
const HIDE_MS = 5;
const settle = () => new Promise((resolve) => setTimeout(resolve, HIDE_MS * 4));

/** The grip, drawn on one block of a note, reporting to its own life-cycle. */
function grip(editor: Editor, type = "paragraph", index = 0) {
  return gripOn(editor, targetOfNth(editor, type, index));
}

/** The grip drawn on a target the caller chose — including one the document has lost. */
function gripOn(editor: Editor, target: BlockTarget) {
  const handle = createBlockHandleLife(() => editor, HIDE_MS);
  // As a hover raises it: the life-cycle is told what the pointer is over, and the grip is
  // what the editor draws for the target it then holds.
  handle.point(target);
  const { unmount } = render(BlockHandle, { props: { editor, target, handle } });
  const el = document.querySelector<HTMLButtonElement>("[data-block-handle]")!;
  expect(el, "the grip is drawn").not.toBeNull();
  // `unmount` because the editor's own `{#if}` can take the grip away mid-gesture, and
  // what that leaves behind is the thing this pair exists to get right.
  return { el, handle, unmount };
}

/**
 * The editor's own report of a change, wired as `Editor.svelte` wires it.
 *
 * Not inside `gripOn` because several tests below make a block vanish *on purpose*, to
 * leave the grip holding one the document no longer has — the state a live-reload or
 * another pane's undo produces, and precisely the one this signal normally prevents.
 */
function reportEdits(editor: Editor, handle: BlockHandleLife) {
  editor.on("update", ({ transaction }) => handle.documentChanged(transaction));
}

const menu = () => document.querySelector<HTMLElement>("[data-block-handle-menu]");

/**
 * Every item, in reading order. Both roles, because the transformations are radios — one
 * of the seven is the kind the block already is — and the three that apply to every block
 * are plain items. A selector naming only the first would quietly stop seeing the other.
 */
const items = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]'),
  );

/** The menu item whose label starts with a word — how a GM picks one out. */
function item(verb: string): HTMLElement {
  const found = items().find((el) => el.textContent?.trim().startsWith(verb));
  expect(found, `a "${verb}" item`).toBeTruthy();
  return found!;
}

/** The section headings a GM reads down the menu. */
const sectionTitles = () =>
  Array.from(menu()?.querySelectorAll<HTMLElement>('[role="group"]') ?? []).map((el) =>
    el.getAttribute("aria-label"),
  );

// ─── What is holding the grip up ──────────────────────────────────────────────

describe("the pointer and the focus, which are two different holds", () => {
  it("keeps holding a focused grip when the pointer moves off it", async () => {
    // `Mod-Shift-h` raises the grip wherever the pointer happens to be resting, so the
    // GM's first nudge of the mouse raises `mouseleave` on a grip that still holds the
    // keyboard. Reported as "nothing is holding this", the handle drops and focus is
    // stranded on nothing, mid-gesture.
    const editor = note("A sentence.");
    const { el, handle } = grip(editor);
    await fireEvent.focus(el);
    await fireEvent.mouseLeave(el);
    await settle();

    expect(handle.target).not.toBeNull();
  });

  it("lets go once neither the pointer nor the focus is on it", async () => {
    const editor = note("A sentence.");
    const { el, handle } = grip(editor);
    await fireEvent.mouseEnter(el);
    await fireEvent.focus(el);
    await fireEvent.blur(el);
    await fireEvent.mouseLeave(el);
    await settle();

    expect(handle.target).toBeNull();
  });
});

// ─── Opening it ───────────────────────────────────────────────────────────────

describe("clicking the grip", () => {
  it("opens a menu of the three actions that apply to any block", async () => {
    const editor = note("```statblock\n# Kobold A\nHP: 5/5\n```");
    const { el } = grip(editor, "statblockBlock");
    await fireEvent.click(el);

    expect(menu()).not.toBeNull();
    expect(items().map((i) => i.getAttribute("aria-label"))).toEqual([
      "Duplicate statblock",
      "Copy statblock as Markdown",
      "Delete statblock",
    ]);
  });

  it("puts Turn into above them on a paragraph, and Delete last of all", async () => {
    const editor = note("A sentence.");
    const { el } = grip(editor);
    await fireEvent.click(el);

    expect(items().map((i) => i.getAttribute("aria-label"))).toEqual([
      "Paragraph",
      "Heading 1",
      "Heading 2",
      "Heading 3",
      "Bullet List",
      "Numbered List",
      "Quote",
      "Duplicate paragraph",
      "Copy paragraph as Markdown",
      "Delete paragraph",
    ]);
  });

  it("names the block, so the menu is not three verbs with no subject", async () => {
    const editor = note("```statblock\n# Kobold A\nHP: 5/5\n```");
    const { el } = grip(editor, "statblockBlock");
    await fireEvent.click(el);

    expect(menu()?.getAttribute("aria-label")).toBe("Actions for statblock");
  });

  it("holds the grip up for as long as the menu is open", async () => {
    // The pointer crosses a gap to reach the menu, and the grip's own mouseleave fires on
    // the way — so something other than the hover has to be keeping it on screen.
    const editor = note("A sentence.");
    const { el, handle } = grip(editor);
    await fireEvent.click(el);
    await fireEvent.mouseLeave(el);
    await settle();

    expect(handle.target).not.toBeNull();
    expect(el.getAttribute("aria-expanded")).toBe("true");
  });

  it("puts focus in the menu, so the note stops taking the keystrokes", async () => {
    const editor = note("A sentence.");
    const { el } = grip(editor);
    await fireEvent.click(el);

    expect(document.activeElement).toBe(items()[0]);
  });

  it("closes again on a second click of the grip", async () => {
    const editor = note("A sentence.");
    const { el, handle } = grip(editor);
    await fireEvent.click(el);
    await fireEvent.click(el);

    expect(menu()).toBeNull();
    expect(handle.menu).toBeNull();
  });
});

// ─── Closing it ───────────────────────────────────────────────────────────────

describe("dismissing the menu without choosing anything", () => {
  it("closes on Escape and hands focus back to the grip", async () => {
    const editor = note("A sentence.");
    const { el, handle } = grip(editor);
    await fireEvent.click(el);
    await fireEvent.keyDown(items()[0], { key: "Escape" });

    expect(menu()).toBeNull();
    expect(handle.menu).toBeNull();
    expect(document.activeElement).toBe(el);
  });

  it("closes when the GM presses somewhere else entirely", async () => {
    const editor = note("A sentence.");
    const { el } = grip(editor);
    await fireEvent.click(el);
    await fireEvent.pointerDown(document.body);

    expect(menu()).toBeNull();
  });

  it("leaves focus where the press landed, rather than dragging it to the grip", async () => {
    // Escape has nowhere else to be and the grip is the right answer for it. A press
    // does have somewhere: several of this editor's own buttons take focus deliberately
    // by preventing their mousedown's default, and pulling it back would undo that.
    const editor = note("A sentence.");
    const elsewhere = document.createElement("button");
    document.body.appendChild(elsewhere);
    const { el } = grip(editor);
    await fireEvent.click(el);
    await fireEvent.pointerDown(elsewhere);
    elsewhere.focus();

    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it("stays open while the pointer is inside it", async () => {
    // Nothing closes on a pointer leaving the grip: the menu is a surface to move onto,
    // not one to hover.
    const editor = note("A sentence.");
    const { el } = grip(editor);
    await fireEvent.click(el);
    await fireEvent.mouseLeave(el);
    await fireEvent.mouseEnter(item("Delete"));
    await fireEvent.pointerDown(item("Delete"));

    expect(menu()).not.toBeNull();
  });

  it("leaves the note exactly as it was", async () => {
    const md = "A sentence.";
    const editor = note(md);
    const { el } = grip(editor);
    await fireEvent.click(el);
    await fireEvent.keyDown(items()[0], { key: "Escape" });

    expect(saved(editor)).toBe(md);
  });
});

// ─── Walking it ───────────────────────────────────────────────────────────────

describe("the menu from the keyboard", () => {
  it("moves focus down the items and wraps round the end", async () => {
    const editor = note("```statblock\n# Kobold A\nHP: 5/5\n```");
    const { el } = grip(editor, "statblockBlock");
    await fireEvent.click(el);

    for (const expected of [1, 2, 0]) {
      await fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
      expect(document.activeElement).toBe(items()[expected]);
    }
  });

  it("moves back up, wrapping the other way", async () => {
    const editor = note("```statblock\n# Kobold A\nHP: 5/5\n```");
    const { el } = grip(editor, "statblockBlock");
    await fireEvent.click(el);
    await fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });

    expect(document.activeElement).toBe(items()[2]);
  });

  it("walks straight through the section heading into the actions below it", async () => {
    // The heading is not a stop: a GM holding ↓ must not have to press past a word they
    // cannot choose, and the transformations and the three actions are one list to walk.
    const editor = note("A sentence.");
    const { el } = grip(editor);
    await fireEvent.click(el);
    for (let i = 0; i < 7; i++) {
      await fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    }

    expect(document.activeElement).toBe(item("Duplicate"));
  });

  it("jumps to the last item with End, ten items down", async () => {
    const editor = note("A sentence.");
    const { el } = grip(editor);
    await fireEvent.click(el);
    await fireEvent.keyDown(document.activeElement!, { key: "End" });

    expect(document.activeElement).toBe(item("Delete"));
  });

  it("keeps exactly one item in the tab order", async () => {
    const editor = note("A sentence.");
    const { el } = grip(editor);
    await fireEvent.click(el);

    expect(items().filter((i) => i.getAttribute("tabindex") === "0")).toHaveLength(1);
  });

  it("closes on Tab rather than tabbing out into an unrelated pane", async () => {
    const editor = note("A sentence.");
    const { el } = grip(editor);
    await fireEvent.click(el);
    await fireEvent.keyDown(items()[0], { key: "Tab" });

    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(el);
  });
});

// ─── Choosing something ───────────────────────────────────────────────────────

describe("choosing an item acts on the block the grip was on", () => {
  it("duplicates that block and no other", async () => {
    const editor = note("First.\n\nSecond.");
    const { el } = grip(editor, "paragraph", 1);
    await fireEvent.click(el);
    await fireEvent.click(item("Duplicate"));

    expect(saved(editor)).toBe("First.\n\nSecond.\n\nSecond.");
  });

  it("deletes a callout and everything in it, in one undo", async () => {
    const editor = note(
      ["Before.", "", "> [!encounter] The Ambush", "> Two kobolds.", "", "After."].join(
        "\n",
      ),
    );
    const { el } = grip(editor, "blockquote");
    await fireEvent.click(el);
    await fireEvent.click(item("Delete"));

    expect(saved(editor)).toBe("Before.\n\nAfter.");
    editor.commands.undo();
    expect(saved(editor)).toContain("The Ambush");
  });

  it("copies the block's markdown to the clipboard", async () => {
    const md = ["```statblock", "# Kobold A", "HP: 5/5", "```"].join("\n");
    const editor = note(`Before.\n\n${md}`);
    const writeText = stubClipboard();
    const { el } = grip(editor, "statblockBlock");
    await fireEvent.click(el);
    await fireEvent.click(item("Copy"));

    expect(writeText).toHaveBeenCalledWith(md);
    expect(saved(editor)).toBe(`Before.\n\n${md}`);
  });

  it("says so, and still gets out of the way, when the clipboard refuses", async () => {
    // A hardened webview or a denied permission *rejects*, and the menu item that held
    // focus is already gone by then — so an unhandled throw would leave the GM's next
    // keystrokes going nowhere. Silence would be worse than the toast: a copy that did
    // not happen is otherwise discovered at the paste, in another app.
    const editor = note("A sentence.");
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("NotAllowedError")) },
      configurable: true,
    });
    const { el, handle } = grip(editor);
    await fireEvent.click(el);
    await fireEvent.click(item("Copy"));

    expect(toastError).toHaveBeenCalledOnce();
    expect(vi.mocked(toastError).mock.calls[0][0]).toContain("clipboard");
    expect(handle.target).toBeNull();
    expect(menu()).toBeNull();
  });

  it("names the command that failed, rather than blaming the clipboard for all four", async () => {
    // Copy is the one that fails as a matter of course; the other three reach the same
    // `catch` when a write throws. Telling a GM whose Delete failed that their clipboard
    // has no access sends them to check a permission that had nothing to do with it — and
    // the gesture did nothing either way, so the message is all they have to go on.
    const editor = note("A sentence.");
    const { el } = grip(editor);
    await fireEvent.click(el);
    // The write itself is what throws here: a dispatch into a view torn out from under it
    // is the shape of the real failure, a stale position reaching ProseMirror. Once only,
    // so the focus the handler restores on its way out still works — otherwise the test
    // breaks the recovery it is asserting reached the GM.
    vi.spyOn(editor.view, "dispatch").mockImplementationOnce(() => {
      throw new Error("no");
    });
    await fireEvent.click(item("Delete"));

    expect(toastError).toHaveBeenCalledOnce();
    const said = vi.mocked(toastError).mock.calls[0][0];
    expect(said).toContain("delete");
    expect(said).not.toContain("clipboard");
  });
});

// ─── The drag, at both ends ───────────────────────────────────────────────────

describe("dragging from the grip", () => {
  /** jsdom has no `DataTransfer`, and `dragstart` needs one to write the payload to. */
  const transfer = () =>
    ({
      clearData: () => {},
      setData: () => {},
      getData: () => "",
      setDragImage: () => {},
      effectAllowed: "none",
    }) as unknown as DataTransfer;

  it("hands the drag to ProseMirror, so the drop is a move and not a copy", async () => {
    const editor = note("First.\n\n```statblock\n# Kobold A\nHP: 5/5\n```");
    const { el } = grip(editor, "statblockBlock");
    await fireEvent.dragStart(el, { dataTransfer: transfer() });

    expect(editor.view.dragging?.move).toBe(true);
  });

  it("lets it go again when the drag ends in nothing at all", async () => {
    // Escape, or a drop on the desktop. ProseMirror clears `dragging` only from listeners
    // on its own DOM, and the grip is chrome outside it — so the latch would survive, and
    // the next drop of anything into this note would insert the statblock instead and
    // delete the selection to make room for it.
    const editor = note("First.\n\n```statblock\n# Kobold A\nHP: 5/5\n```");
    const { el, handle } = grip(editor, "statblockBlock");
    await fireEvent.dragStart(el, { dataTransfer: transfer() });
    await fireEvent.dragEnd(el);

    expect(editor.view.dragging).toBeNull();
    // Still the other thing dragend is for: the positions the handle holds describe the
    // note as it was before the drop.
    expect(handle.target).toBeNull();
  });

  it("closes the menu and takes the handle down with it", async () => {
    // Every position the handle holds describes the note as it was before the write.
    const editor = note("First.\n\nSecond.");
    const { el, handle } = grip(editor);
    await fireEvent.click(el);
    await fireEvent.click(item("Duplicate"));

    expect(menu()).toBeNull();
    expect(handle.menu).toBeNull();
    expect(handle.target).toBeNull();
  });

  it("does nothing when the block went while the menu was open, mid-transformation", async () => {
    const editor = note("Alpha.\n\nBravo.\n\nDelta.");
    const { el } = grip(editor, "paragraph", 1);
    await fireEvent.click(el);
    deleteBlock(editor, targetOf(editor, "paragraph"));
    await fireEvent.click(item("Heading 1"));

    expect(saved(editor)).toBe("Bravo.\n\nDelta.");
  });

  it("does nothing when the block went while the menu was open", async () => {
    // The menu is open on "Bravo."; the note loses "Alpha." underneath it, so the
    // position it holds now lands on "Delta." — a resolvable position, the wrong block.
    const editor = note("Alpha.\n\nBravo.\n\nDelta.");
    const { el } = grip(editor, "paragraph", 1);
    await fireEvent.click(el);
    deleteBlock(editor, targetOf(editor, "paragraph"));
    await fireEvent.click(item("Delete"));

    expect(saved(editor)).toBe("Bravo.\n\nDelta.");
  });
});

// ─── Turn into ────────────────────────────────────────────────────────────────

describe("the Turn into section, on the blocks that have an answer to it", () => {
  it.each([
    ["a paragraph", "A sentence.", "paragraph"],
    ["a heading", "## The Lower Halls", "heading"],
    // A grip on a list item holds the paragraph its text lives in — the innermost block —
    // so this is the same claim reached through one more layer of ancestry.
    ["a list item", "- the one with the sling", "paragraph"],
  ])("is there for %s", async (_what, md, type) => {
    const editor = note(md);
    const { el } = grip(editor, type);
    await fireEvent.click(el);

    expect(sectionTitles()).toContain("Turn into");
  });

  it.each([
    ["a statblock", "```statblock\n# Kobold A\nHP: 5/5\n```", "statblockBlock"],
    ["an infobox", "```infobox\n# The Ember Keep\nRuler: Mira\n```", "infoboxBlock"],
    [
      "a timeline",
      "```timeline\n# The Shattering\nDate: 3rd of Frostfall\n```",
      "timelineBlock",
    ],
    ["an image", "![The gate](images/gate.png)", "image"],
  ])("is absent entirely on %s — not drawn dim", async (_what, md, type) => {
    // A creature is not a sentence with extra steps: there is no deciding which of its
    // rows survives becoming a heading. A greyed-out section would still be a claim that
    // some arrangement of the note makes it work, and there is none.
    const editor = note(md);
    const { el } = grip(editor, type);
    await fireEvent.click(el);

    expect(sectionTitles()).toEqual([null]);
    expect(items()).toHaveLength(3);
  });

  it.each([
    ["Heading 2", "## The Lower Halls"],
    ["Bullet List", "- The Lower Halls"],
    ["Quote", "> The Lower Halls"],
    ["Numbered List", "1. The Lower Halls"],
  ])("writes the markers %s is spelled with", async (label, expected) => {
    const editor = note("The Lower Halls");
    const { el } = grip(editor);
    await fireEvent.click(el);
    await fireEvent.click(item(label));

    expect(saved(editor)).toBe(expected);
  });

  it("drops the markers on the way back to a paragraph", async () => {
    const editor = note("## The Lower Halls");
    const { el } = grip(editor, "heading");
    await fireEvent.click(el);
    await fireEvent.click(item("Paragraph"));

    expect(saved(editor)).toBe("The Lower Halls");
  });

  it("makes a plain quote and never a typed callout", async () => {
    // A GM asking for a quote is asking for a quote; picking "encounter" or "warning"
    // for them would be inventing an intent they did not express.
    const editor = note("Something waits.");
    const { el } = grip(editor);
    await fireEvent.click(el);
    await fireEvent.click(item("Quote"));

    expect(saved(editor)).toBe("> Something waits.");
  });

  it("is one undo, taking back the heading and not the sentence", async () => {
    const editor = note("The Lower");
    editor.commands.insertContentAt(
      targetOf(editor, "paragraph").pos + 1 + "The Lower".length,
      " Halls",
    );
    const { el } = grip(editor);
    await fireEvent.click(el);
    await fireEvent.click(item("Heading 2"));
    editor.commands.undo();

    expect(saved(editor)).toBe("The Lower Halls");
  });

  it("ticks the kind the block already is, and nothing else", async () => {
    const editor = note("## The Lower Halls");
    const { el } = grip(editor, "heading");
    await fireEvent.click(el);
    const checked = items().filter((i) => i.getAttribute("aria-checked") === "true");

    expect(checked.map((i) => i.getAttribute("aria-label"))).toEqual(["Heading 2"]);
  });

  it("ticks a list item as the list it is in, not as a paragraph", async () => {
    const editor = note("1. first light");
    const { el } = grip(editor);
    await fireEvent.click(el);
    const checked = items().filter((i) => i.getAttribute("aria-checked") === "true");

    expect(checked.map((i) => i.getAttribute("aria-label"))).toEqual(["Numbered List"]);
  });

  it("offers every kind as a radio, so a screen reader reads it as a choice", async () => {
    const editor = note("A sentence.");
    const { el } = grip(editor);
    await fireEvent.click(el);

    expect(
      items()
        .filter((i) => i.getAttribute("role") === "menuitemradio")
        .map((i) => i.getAttribute("aria-checked")),
    ).toEqual(["true", "false", "false", "false", "false", "false", "false"]);
  });

  it("leaves the note alone when the GM picks the kind it already is", async () => {
    // `toggleBulletList` on a bullet list lifts it back out, so the ticked item would
    // un-list the block — the one thing "turn into a bullet list" cannot be asking for.
    const md = "- the one with the sling";
    const editor = note(md);
    const { el } = grip(editor);
    await fireEvent.click(el);
    await fireEvent.click(item("Bullet List"));

    expect(saved(editor)).toBe(md);
  });
});

// ─── What the next keystroke lands on ─────────────────────────────────────────
//
// Three parts of this gesture set a whole-block `NodeSelection` on purpose — the grip's own
// `mousedown` and `startBlockDrag`, so a drag has something to carry, and `moveBlock`, so
// a second `↑` moves the same block. A node selection is *replaced* by the next character
// typed, so every route that hands focus back to the prose has to collapse it first or the
// GM's next letter stands in for the block they just acted on.
//
// Typed as ProseMirror types: `insertText` against the live selection is the same write a
// keypress performs, and it is the write that made these three destructive.

describe("handing focus back to the prose", () => {
  /** The GM's next character, exactly as a keypress applies it: over the selection. */
  function typeNext(editor: Editor, text = "x") {
    editor.view.dispatch(editor.state.tr.insertText(text));
  }

  it("leaves a caret and not the block, after a menu action reached by mouse", async () => {
    const editor = note("First.\n\nSecond.");
    const { el } = grip(editor);
    // The whole gesture, `mousedown` included: that press is what selects the block.
    await fireEvent.mouseDown(el);
    await fireEvent.click(el);
    await fireEvent.click(item("Duplicate"));
    await Promise.resolve();

    expect(editor.state.selection).not.toBeInstanceOf(NodeSelection);
    typeNext(editor);
    // The duplicate is still there and so is the original — one of them carries the
    // character, neither is replaced by it.
    expect(saved(editor)).toContain("First.");
    expect(saved(editor).split("\n\n")).toHaveLength(3);
  });

  it("leaves a caret after a copy, which is the paragraph a GM types straight after", async () => {
    stubClipboard();
    const editor = note("First.\n\nSecond.");
    const { el } = grip(editor);
    await fireEvent.mouseDown(el);
    await fireEvent.click(el);
    await fireEvent.click(item("Copy"));
    await Promise.resolve();
    typeNext(editor);

    // The thing that was copied survives being typed next to. Before this it did not: the
    // paragraph became "x" on the first character.
    expect(saved(editor)).toContain("First.");
    expect(saved(editor)).toContain("Second.");
  });

  it("leaves a caret when Escape follows a keyboard reorder", async () => {
    // The route that survives fixing the mouse one: `moveBlock` leaves the block it
    // moved selected by design, and Escape is the way out of a grip raised by `Mod-Shift-h`
    // — so the exit from a reorder handed the prose a node selection with no press involved.
    const editor = note("First.\n\nSecond.\n\nThird.");
    const { el } = grip(editor, "paragraph", 2);
    await fireEvent.keyDown(el, { key: "ArrowUp" });
    expect(saved(editor)).toBe("First.\n\nThird.\n\nSecond.");

    await fireEvent.keyDown(el, { key: "Escape" });
    expect(editor.state.selection).not.toBeInstanceOf(NodeSelection);

    typeNext(editor);
    expect(saved(editor)).toContain("Third.");
  });
});

// ─── A grip still holding a block that has gone ───────────────────────────────
//
// The grip is drawn from a hover and then *stays* — through a live-reload, an undo, the
// GM's own last keystroke in another pane. Its three direct gestures are the ones that
// used to get the weakest check of the three in the codebase: "is *a* block there", which
// a position that has gone stale answers yes to, because a bystander has slid into it.
//
// The note is three paragraphs of the same length on purpose. The grip is put on "Bravo.",
// "Alpha." goes, and the position the grip holds now lands exactly on "Delta." — a
// position that still resolves, to the wrong block. Nothing below may touch it.

describe("a grip left holding a block the document no longer has", () => {
  /** A note with the grip on the middle paragraph, and the one above it since deleted. */
  function staleGrip() {
    const editor = note("Alpha.\n\nBravo.\n\nDelta.");
    const bravo = targetOfNth(editor, "paragraph", 1);
    deleteBlock(editor, targetOf(editor, "paragraph"));
    // The failure this guards is only reachable because the position is still good.
    expect(editor.state.doc.nodeAt(bravo.pos)?.textContent).toBe("Delta.");
    return { editor, target: bravo, ...gripOn(editor, bravo) };
  }

  it("reorders nothing when the arrow keys reach a stale target", async () => {
    const { editor, el, handle, target } = staleGrip();

    await fireEvent.keyDown(el, { key: "ArrowUp" });
    await fireEvent.keyDown(el, { key: "ArrowDown" });

    expect(saved(editor)).toBe("Bravo.\n\nDelta.");
    // And the handle did not follow a write that never happened: it is still on the block
    // it was given, stale as that is.
    expect(handle.target).toBe(target);
  });

  it("selects nothing on mousedown, so Delete does not find a bystander selected", async () => {
    const { editor, el } = staleGrip();

    await fireEvent.mouseDown(el);

    expect(editor.state.selection).not.toBeInstanceOf(NodeSelection);
  });

  it("starts no drag, so nothing can be dropped from a block that has gone", async () => {
    const { editor, el } = staleGrip();

    await fireEvent.dragStart(el);

    expect(editor.view.dragging).toBeNull();
    expect(saved(editor)).toBe("Bravo.\n\nDelta.");
  });
});

// ─── What holds the handle up, and what takes it down ─────────────────────────
//
// The claims that used to have nowhere to live: one half of each was a latch in the
// machine and the other a callback in the component, and no test mounted both. Every one
// of these is the gesture a GM performs, end to end.

describe("the grip while its menu is open", () => {
  it("stays up when the pointer crosses the gap to the menu", async () => {
    // The grip's own `mouseleave` fires on the way into the menu, and the hide it would
    // otherwise schedule would take the menu's anchor away from under it.
    const editor = note("A sentence.");
    const { el, handle } = grip(editor);
    await fireEvent.mouseEnter(el);
    await fireEvent.click(el);
    await fireEvent.mouseLeave(el);
    await settle();

    expect(handle.target).not.toBeNull();
    expect(menu()).not.toBeNull();
  });

  it("keeps naming the block it was opened on, whatever the pointer does", async () => {
    // Every item acts on one block, so a pointer wandering back over the prose underneath
    // the menu — which the editor reports as ordinary movement — must not change which.
    const editor = note("First.\n\nSecond.");
    const { el, handle } = grip(editor);
    const opened = handle.target;
    await fireEvent.click(el);
    handle.point(targetOfNth(editor, "paragraph", 1));

    expect(handle.target).toBe(opened);
    expect(handle.menu?.target).toBe(opened);
  });

  it("comes down once the menu closes and nothing else holds it", async () => {
    const editor = note("A sentence.");
    const { el, handle } = grip(editor);
    await fireEvent.click(el);
    await fireEvent.keyDown(items()[0], { key: "Escape" });
    // Escape hands focus back to the grip, so let go of that too.
    await fireEvent.blur(el);
    await settle();

    expect(handle.target).toBeNull();
  });

  it("stays up after the menu closes if the pointer is back on the grip", async () => {
    const editor = note("A sentence.");
    const { el, handle } = grip(editor);
    await fireEvent.mouseEnter(el);
    await fireEvent.click(el);
    await fireEvent.keyDown(items()[0], { key: "Escape" });
    await settle();

    expect(handle.target).not.toBeNull();
    expect(menu()).toBeNull();
  });

  it("goes when the note scrolls out from under it, pointer resting on it or not", async () => {
    // A held grip is exempt from an invalidation; a menu is emphatically not, and this is
    // the one case where the two overlap. The menu is drawn `fixed` off a grip placed from
    // a measurement the scroll has just made wrong, so one that survived would hang in the
    // window naming a block that is no longer beside it.
    const editor = note("A sentence.");
    const { el, handle } = grip(editor);
    await fireEvent.mouseEnter(el);
    await fireEvent.click(el);
    // What `Editor.svelte` calls from its capture-phase scroll listener.
    handle.invalidate();

    expect(handle.target).toBeNull();
    expect(handle.menu).toBeNull();
  });

  it("goes down before the unmount that follows it, leaving no latch stranded", async () => {
    // The frozen grip, performed the way the editor performs it. The grip is unmounted by
    // an `{#if}` on the target, so the target going is what takes the component away — and
    // the menu has to be closed *by the same step*, not by the component on its way out.
    // It was the other way round before: a pin set here and released from `onDestroy`,
    // which is a latch a component can be torn away from, and one left set ignored the
    // pointer for the rest of the session with nothing on screen saying why.
    const editor = note("First.\n\nSecond.");
    const { el, handle, unmount } = grip(editor);
    await fireEvent.mouseEnter(el);
    await fireEvent.click(el);
    expect(menu()).not.toBeNull();

    // The scroll, and then what `Editor.svelte` does about it.
    handle.invalidate();
    expect(handle.menu).toBeNull();
    expect(handle.target).toBeNull();
    unmount();

    const next = targetOfNth(editor, "paragraph", 1);
    handle.point(next);

    expect(handle.target).toBe(next);
  });

  it("comes down when the document changes under it", async () => {
    // A menu open across an edit — another pane's undo, a live-reload — is ten items built
    // on a note that has moved beneath them.
    const editor = note("First.\n\nSecond.");
    const { el, handle } = grip(editor, "paragraph", 1);
    reportEdits(editor, handle);
    await fireEvent.mouseEnter(el);
    await fireEvent.click(el);
    editor.commands.insertContentAt(1, "X");

    expect(handle.menu).toBeNull();
    expect(handle.target).toBeNull();
  });
});

describe("a grip in the GM's hand while its block is rewritten", () => {
  it("carries the target through the change rather than keeping the old node", async () => {
    // Pressing the grip blurs whatever field the GM was in and that field commits, so the
    // block under their pointer is a new object before the mouse comes back up. Every
    // write addresses its block by node identity: without this the grip is still beside
    // the block and still looks live, and every gesture behind it refuses.
    const editor = note("First.\n\nSecond.");
    const { el, handle } = grip(editor, "paragraph", 1);
    reportEdits(editor, handle);
    await fireEvent.mouseEnter(el);
    const before = handle.target!;

    editor.commands.insertContentAt(before.pos + 1, "X");

    expect(handle.target).not.toBe(before);
    expect(blockStillThere(editor.state.doc, handle.target!)).toBe(true);
  });

  it("takes down a grip nobody is holding, because the next mousemove answers again", async () => {
    const editor = note("First.\n\nSecond.");
    const { handle } = grip(editor, "paragraph", 1);
    reportEdits(editor, handle);

    editor.commands.insertContentAt(1, "X");

    expect(handle.target).toBeNull();
  });

  it("keeps holding the block a keyboard reorder moved, so a second press moves the same one", async () => {
    // The change the grip cannot be walked through: a reorder deletes the block and puts
    // it back elsewhere, and where it landed is known only after the write.
    const editor = note("First.\n\nSecond.\n\nThird.");
    const { el, handle } = grip(editor, "paragraph", 2);
    reportEdits(editor, handle);
    await fireEvent.focus(el);

    await fireEvent.keyDown(el, { key: "ArrowUp" });
    expect(saved(editor)).toBe("First.\n\nThird.\n\nSecond.");
    expect(blockStillThere(editor.state.doc, handle.target!)).toBe(true);

    await fireEvent.keyDown(el, { key: "ArrowUp" });
    expect(saved(editor)).toBe("Third.\n\nFirst.\n\nSecond.");
  });
});
