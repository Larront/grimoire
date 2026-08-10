// Opening, walking and closing the grip's menu (#191).
//
// The engine's writes are pinned in block-handle-menu.test.ts and the grip's placement in
// Chromium next door. What is left — and it is the half of this ticket a GM actually
// performs — is the gesture: a click that opens a menu without cancelling the drag that
// shares the same button, a menu that keeps focus while it is up, and two ways out of it
// that both leave the GM somewhere they can carry on typing.
//
// Driven through the real `BlockHandle` on a real note, because the claims are about what
// a click does to a document. A mounted menu on its own would prove only that a callback
// fired.
import { fireEvent, render } from "@testing-library/svelte";
import { describe, it, expect, afterEach, vi } from "vitest";
import type { Editor } from "@tiptap/core";

vi.mock("$lib/toast", () => ({ toastError: vi.fn() }));

import { toastError } from "$lib/toast";
import BlockHandle from "$lib/components/editor/BlockHandle.svelte";
import { deleteBlockAt } from "$lib/editor/block-handle";
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

/** The grip, drawn on one block of a note, with the handle's own callbacks recorded. */
function grip(editor: Editor, type = "paragraph", index = 0) {
  const pinned: boolean[] = [];
  const held: boolean[] = [];
  const released: true[] = [];
  render(BlockHandle, {
    props: {
      editor,
      target: targetOfNth(editor, type, index),
      onHold: (h: boolean) => held.push(h),
      onPin: (p: boolean) => pinned.push(p),
      onRetarget: () => {},
      onRelease: () => released.push(true),
    },
  });
  const el = document.querySelector<HTMLButtonElement>("[data-block-handle]")!;
  expect(el, "the grip is drawn").not.toBeNull();
  return { el, pinned, held, released };
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
    const { el, held } = grip(editor);
    await fireEvent.focus(el);
    await fireEvent.mouseLeave(el);

    expect(held.at(-1)).toBe(true);
  });

  it("lets go once neither the pointer nor the focus is on it", async () => {
    const editor = note("A sentence.");
    const { el, held } = grip(editor);
    await fireEvent.mouseEnter(el);
    await fireEvent.focus(el);
    await fireEvent.blur(el);
    await fireEvent.mouseLeave(el);

    expect(held.at(-1)).toBe(false);
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
    const { el, pinned } = grip(editor);
    await fireEvent.click(el);

    expect(pinned).toEqual([true]);
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
    const { el, pinned } = grip(editor);
    await fireEvent.click(el);
    await fireEvent.click(el);

    expect(menu()).toBeNull();
    expect(pinned).toEqual([true, false]);
  });
});

// ─── Closing it ───────────────────────────────────────────────────────────────

describe("dismissing the menu without choosing anything", () => {
  it("closes on Escape and hands focus back to the grip", async () => {
    const editor = note("A sentence.");
    const { el, pinned } = grip(editor);
    await fireEvent.click(el);
    await fireEvent.keyDown(items()[0], { key: "Escape" });

    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(el);
    expect(pinned).toEqual([true, false]);
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
    const { el, released } = grip(editor);
    await fireEvent.click(el);
    await fireEvent.click(item("Copy"));

    expect(toastError).toHaveBeenCalledOnce();
    expect(released).toEqual([true]);
    expect(menu()).toBeNull();
  });

  it("closes the menu and takes the handle down with it", async () => {
    // Every position the handle holds describes the note as it was before the write.
    const editor = note("First.\n\nSecond.");
    const { el, released } = grip(editor);
    await fireEvent.click(el);
    await fireEvent.click(item("Duplicate"));

    expect(menu()).toBeNull();
    expect(released).toEqual([true]);
  });

  it("does nothing when the block went while the menu was open, mid-transformation", async () => {
    const editor = note("Alpha.\n\nBravo.\n\nDelta.");
    const { el } = grip(editor, "paragraph", 1);
    await fireEvent.click(el);
    deleteBlockAt(editor, targetOf(editor, "paragraph").pos);
    await fireEvent.click(item("Heading 1"));

    expect(saved(editor)).toBe("Bravo.\n\nDelta.");
  });

  it("does nothing when the block went while the menu was open", async () => {
    // The menu is open on "Bravo."; the note loses "Alpha." underneath it, so the
    // position it holds now lands on "Delta." — a resolvable position, the wrong block.
    const editor = note("Alpha.\n\nBravo.\n\nDelta.");
    const { el } = grip(editor, "paragraph", 1);
    await fireEvent.click(el);
    deleteBlockAt(editor, targetOf(editor, "paragraph").pos);
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
