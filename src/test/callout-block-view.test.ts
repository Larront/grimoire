// The Callout's node view (#181) — the pattern's container exemplar, and the first
// block whose children ProseMirror owns.
//
// The seam is a **real editor with real node views**, mounted into a real element,
// driven the way a GM drives it: markdown in, a gesture, markdown out. Nothing here
// asserts on how the view reaches an answer — the connector's own interface is pinned
// in node-view-connector.test.ts, the fence and header grammar in block-markdown.test.ts
// and callout-block.test.ts.
//
// A real editor is what this ticket's claims need. ProseMirror-owned children, a caret
// that reaches the top of a body and leaves it, and a keystroke that must *not* escape
// the title input are all facts about the document after an event, and a component
// mounted on its own has no document to be right about.
import { fireEvent, render } from "@testing-library/svelte";
import { describe, it, expect, afterEach, vi } from "vitest";
import type { Editor } from "@tiptap/core";
import BlockHandle from "$lib/components/editor/BlockHandle.svelte";
import { createBlockHandleLife } from "$lib/editor/block-handle-life.svelte";
import {
  bodyStart,
  caretAt,
  caretIn,
  closeNote,
  dom,
  note,
  press,
  saved,
  targetOf,
} from "./fixtures/note-editor";

vi.mock("$lib/stores/link-resolver.svelte", () => ({
  linkResolver: { isKnown: () => true, prime: vi.fn(), resolve: vi.fn() },
}));

// ─── Harness ──────────────────────────────────────────────────────────────────
//
// The editor itself is `fixtures/note-editor.ts`, shared with the encounter-grouping
// tests (#182). What is local here is the one selector only a callout has.

afterEach(closeNote);

function titleField(editor: Editor, index = 0): HTMLElement {
  const fields = dom(editor).querySelectorAll<HTMLElement>(
    '[aria-label="Callout title"]',
  );
  return fields[index];
}

// ─── The body is ProseMirror's ────────────────────────────────────────────────

describe("a callout's body is ordinary document content", () => {
  const MD =
    "> [!warning] The bridge is out\n> The eastern crossing collapsed last winter.";

  it("draws the body inside the node view's content hole", () => {
    const editor = note(MD);
    const hole = dom(editor).querySelector("[data-node-view-content]");

    expect(hole).toBeTruthy();
    expect(hole).toHaveTextContent("The eastern crossing collapsed last winter.");
  });

  it("takes typed text into the body and writes it to the file", () => {
    const editor = note(MD);
    editor.commands.insertContentAt(bodyStart(editor), "Mind the gap. ");

    expect(saved(editor)).toBe(
      "> [!warning] The bridge is out\n> Mind the gap. The eastern crossing collapsed last winter.",
    );
  });

  it("takes a whole new block into the body", () => {
    // A container, not a widget: the body's shape is the GM's to change.
    const editor = note(MD);
    editor.commands.insertContentAt(bodyStart(editor), "<p>First thought.</p>");

    expect(saved(editor)).toContain("> First thought.");
    expect(saved(editor)).toContain("> [!warning] The bridge is out");
  });

  it("keeps the header out of the body's text", () => {
    // The header is chrome the view draws, not a paragraph of the document — so the
    // title's characters must not be in the content hole at all.
    const editor = note(MD);
    const hole = dom(editor).querySelector("[data-node-view-content]");

    expect(hole).not.toHaveTextContent("The bridge is out");
  });

  it("draws an ordinary quote as a quote, with no header at all", () => {
    const editor = note("> Just a quotation.");

    expect(titleField(editor)).toBeUndefined();
    expect(dom(editor).querySelector("blockquote")).toHaveTextContent(
      "Just a quotation.",
    );
    expect(saved(editor)).toBe("> Just a quotation.");
  });
});

// ─── The title field ──────────────────────────────────────────────────────────

describe("a callout's title is a Linked Text Field", () => {
  it("draws the title the GM wrote", () => {
    const editor = note("> [!warning] The bridge is out\n> Mind the gap.");
    expect(titleField(editor)).toHaveTextContent("The bridge is out");
  });

  it("commits an edited title to the file", async () => {
    const editor = note("> [!warning] The bridge is out\n> Mind the gap.");
    await fireEvent.click(titleField(editor));
    await fireEvent.input(titleField(editor), {
      target: { value: "The bridge is gone" },
    });
    await fireEvent.blur(titleField(editor));

    expect(saved(editor)).toBe("> [!warning] The bridge is gone\n> Mind the gap.");
  });

  it("writes an emptied title as no title rather than an empty one", async () => {
    const editor = note("> [!warning] The bridge is out\n> Mind the gap.");
    await fireEvent.click(titleField(editor));
    await fireEvent.input(titleField(editor), { target: { value: "" } });
    await fireEvent.blur(titleField(editor));

    expect(saved(editor)).toBe("> [!warning]\n> Mind the gap.");
  });

  it("shows the type word for an untitled callout without writing it to the file", async () => {
    // The displayed fallback is the field's *placeholder*, so there is no path by
    // which it becomes `> [!read-aloud] Read Aloud` in the GM's note.
    const editor = note("> [!read-aloud]\n> The doors stand open.");

    expect(titleField(editor)).toHaveTextContent("Read Aloud");
    await fireEvent.click(titleField(editor));
    await fireEvent.blur(titleField(editor));
    expect(saved(editor)).toBe("> [!read-aloud]\n> The doors stand open.");
  });

  it("keeps the type and the fold marker the GM never touched", async () => {
    // The connector's write-back merges rather than replaces, so an edit to the title
    // cannot drop the two attributes beside it.
    const editor = note("> [!WaRnInG]- The bridge is out\n> Mind the gap.");
    await fireEvent.click(titleField(editor));
    await fireEvent.input(titleField(editor), { target: { value: "Careful" } });
    await fireEvent.blur(titleField(editor));

    expect(saved(editor)).toBe("> [!WaRnInG]- Careful\n> Mind the gap.");
  });

  it("draws a wikilink in the title as a live link the host surface can navigate", async () => {
    const editor = note("> [!note] Ask [[Captain Ash]]\n> She was there.");
    const link = titleField(editor).querySelector("[data-wiki-link]");

    expect(link).toHaveAttribute("data-path", "Captain Ash");
    expect(link).toHaveTextContent("Captain Ash");
  });

  it("takes a wikilink typed into the title and keeps its characters in the file", async () => {
    const editor = note("> [!note] The witness\n> She was there.");
    await fireEvent.click(titleField(editor));
    await fireEvent.input(titleField(editor), {
      target: { value: "Ask [[Captain Ash]]" },
    });
    await fireEvent.blur(titleField(editor));

    expect(saved(editor)).toBe("> [!note] Ask [[Captain Ash]]\n> She was there.");
    expect(titleField(editor).querySelector("[data-wiki-link]")).toHaveAttribute(
      "data-path",
      "Captain Ash",
    );
  });

  it("builds no HTML string for a title holding markup characters", () => {
    // Links are structured segments Svelte draws, which is what makes this the
    // characters the GM typed rather than a tag the browser parsed.
    const editor = note("> [!note] <b>bold</b> & [[Ash]]\n> Body.");
    expect(titleField(editor)).toHaveTextContent("<b>bold</b> & Ash");
    expect(titleField(editor).querySelector("b")).toBeNull();
  });
});

// ─── Event swallowing ─────────────────────────────────────────────────────────

describe("typing in the title stays in the title", () => {
  it("leaks no keystroke to the document", async () => {
    const editor = note("> [!warning] The bridge is out\n> Mind the gap.");
    await fireEvent.click(titleField(editor));
    const input = titleField(editor);

    await fireEvent.keyDown(input, { key: "x" });
    await fireEvent.keyDown(input, { key: "Backspace" });
    await fireEvent.keyDown(input, { key: "Enter" });

    expect(saved(editor)).toBe("> [!warning] The bridge is out\n> Mind the gap.");
  });

  it("marks the header as chrome the caret cannot enter, and the body as content", () => {
    // The header is the block's, the hole is ProseMirror's — which is the whole of the
    // arrangement the connector's default event rule then acts on. No bespoke
    // `stopEvent` is written for Callout.
    const editor = note("> [!warning] The bridge is out\n> Mind the gap.");
    const header = dom(editor).querySelector(".callout-header");

    expect(header).toHaveAttribute("contenteditable", "false");
    expect(
      dom(editor)
        .querySelector("[data-node-view-content]")
        ?.closest("[contenteditable=false]"),
    ).toBeNull();
  });

  it("keeps the caret in the field rather than moving it into the document", async () => {
    const editor = note("> [!warning] The bridge is out\n> Mind the gap.");
    await fireEvent.click(titleField(editor));

    expect(document.activeElement).toBe(titleField(editor));
    expect(titleField(editor).tagName).toBe("INPUT");
  });
});

// ─── Keyboard boundaries ──────────────────────────────────────────────────────
//
// The named cost of a non-editable header above an editable body, asserted rather
// than assumed: the caret reaches the top of the body, leaves it, and is never
// stranded in the header.

describe("the callout's keyboard boundaries", () => {
  const WITH_PROSE = "Before the box.\n\n> [!warning] The bridge is out\n> Mind the gap.";

  it("lets the caret reach the top of the body", () => {
    const editor = note(WITH_PROSE);
    caretAt(editor, bodyStart(editor));

    expect(editor.state.selection.empty).toBe(true);
    expect(caretIn(editor)).toBe("Mind the gap.");
    expect(editor.state.selection.$from.parentOffset).toBe(0);
  });

  it("moves the caret past the header on ArrowUp rather than trapping it", () => {
    const editor = note(WITH_PROSE);
    caretAt(editor, bodyStart(editor));
    press(editor, "ArrowUp");

    expect(caretIn(editor)).toBe("Before the box.");
  });

  it("moves the caret out on ArrowLeft too", () => {
    const editor = note(WITH_PROSE);
    caretAt(editor, bodyStart(editor));
    press(editor, "ArrowLeft");

    expect(caretIn(editor)).toBe("Before the box.");
  });

  it("leaves an arrow key alone anywhere but the top of a body", () => {
    // Every other keystroke reaches ProseMirror's own defaults untouched.
    const editor = note(WITH_PROSE);
    caretAt(editor, bodyStart(editor) + 4);
    press(editor, "ArrowLeft");

    // Still where it was: the boundary did not fire, so nothing yanked the caret out
    // of the body and horizontal motion inside the text is the browser's as usual.
    expect(caretIn(editor)).toBe("Mind the gap.");
    expect(editor.state.selection.$from.parentOffset).toBe(4);
  });

  it("exits an empty body on Backspace, leaving the callout intact", () => {
    // An empty body is a valid state and the title beside it is content the GM typed,
    // so one keystroke must not swallow the box.
    const editor = note("Before the box.\n\n> [!warning] The bridge is out");
    caretAt(editor, bodyStart(editor));
    press(editor, "Backspace");

    expect(caretIn(editor)).toBe("Before the box.");
    expect(saved(editor)).toBe("Before the box.\n\n> [!warning] The bridge is out");
  });

  it("leaves a body that holds anything to ProseMirror's own backspace", () => {
    // Not this ticket's case, and whatever the default does it must not lose the
    // GM's characters — which is what a block-specific rule reaching too far would do.
    const editor = note(WITH_PROSE);
    caretAt(editor, bodyStart(editor, 0));
    press(editor, "Backspace");

    expect(editor.state.doc.textContent).toContain("Mind the gap.");
    expect(editor.state.doc.textContent).toContain("Before the box.");
  });

  it("keeps an empty callout with nowhere above it to go", () => {
    // The inner box opens its parent's body, so the caret has nowhere to escape to.
    // The keystroke is still claimed: handing it to ProseMirror's own backspace would
    // remove the quote and take the GM's title with it.
    const md = "> [!note] The Ledger\n> > [!warning] The bridge is out";
    const editor = note(md);
    caretAt(editor, bodyStart(editor, 1));
    press(editor, "Backspace");

    expect(saved(editor)).toBe(md);
  });

  it("exits the inner callout of a nest into the prose above it", () => {
    const md =
      "> [!note] The Ledger\n> Signed in ash.\n>\n> > [!warning] The bridge is out";
    const editor = note(md);
    caretAt(editor, bodyStart(editor, 1));
    press(editor, "Backspace");

    expect(caretIn(editor)).toBe("Signed in ash.");
    expect(saved(editor)).toBe(md);
  });
});

// ─── Nesting ──────────────────────────────────────────────────────────────────

describe("nested content is editable in place", () => {
  it("mounts a node view for a callout inside a callout", () => {
    const editor = note(
      "> [!note] The Ledger\n> > [!warning] The bridge is out\n> > Mind the gap.",
    );
    const fields = dom(editor).querySelectorAll('[aria-label="Callout title"]');

    expect([...fields].map((f) => f.textContent?.trim())).toEqual([
      "The Ledger",
      "The bridge is out",
    ]);
  });

  it("edits the inner callout's title without touching the outer one", async () => {
    const md =
      "> [!note] The Ledger\n> > [!warning] The bridge is out\n> > Mind the gap.";
    const editor = note(md);

    await fireEvent.click(titleField(editor, 1));
    await fireEvent.input(titleField(editor, 1), {
      target: { value: "Careful" },
    });
    await fireEvent.blur(titleField(editor, 1));

    expect(saved(editor)).toBe(
      "> [!note] The Ledger\n> > [!warning] Careful\n> > Mind the gap.",
    );
  });

  it("renders a fence inside a callout as its own block rather than a code box", () => {
    // #158's failure, asserted where a GM meets it: the fence a fight is grouped
    // around must be a real block at depth, node view and all.
    const editor = note(
      "> [!encounter] The Ambush\n> ```infobox\n> Population: 4,200\n> ```",
    );

    expect(dom(editor).querySelector(".infobox-block")).toBeTruthy();
    expect(dom(editor).querySelector("pre")).toBeNull();
  });

  it("takes an edit to a list inside a callout", () => {
    const editor = note("> [!encounter] The Ambush\n> - one with a sling");
    editor.commands.insertContentAt(bodyStart(editor), "and ");

    expect(saved(editor)).toBe("> [!encounter] The Ambush\n> - and one with a sling");
  });

  it("takes an edit inside a nested fence's own node view", async () => {
    // Rendering at depth is half the requirement. This is the other half: the nested
    // block's own fields are live, so a GM editing a statblock inside
    // `> [!encounter] The Ambush` is editing it in place, and the bytes that change
    // are the inner fence's.
    const md = "> [!encounter] The Ambush\n> ```infobox\n> Population: 4,200\n> ```";
    const editor = note(md);
    const value = dom(editor).querySelector<HTMLElement>('[aria-label="Row 1 value"]')!;

    await fireEvent.click(value);
    await fireEvent.input(dom(editor).querySelector('[aria-label="Row 1 value"]')!, {
      target: { value: "4,300" },
    });
    await fireEvent.blur(dom(editor).querySelector('[aria-label="Row 1 value"]')!);

    expect(saved(editor)).toBe(
      "> [!encounter] The Ambush\n> ```infobox\n> Population: 4,300\n> ```",
    );
  });
});

// ─── Collapse ─────────────────────────────────────────────────────────────────

describe("collapsing a callout", () => {
  const MD = "> [!encounter] The Ambush\n> Four goblins.";

  it("hides the body and shows the header", async () => {
    const editor = note(MD);
    await fireEvent.click(dom(editor).querySelector('[aria-label="Collapse callout"]')!);

    expect(dom(editor).querySelector("[data-node-view-content]")).toHaveAttribute(
      "hidden",
    );
    expect(titleField(editor)).toHaveTextContent("The Ambush");
  });

  it("changes nothing in the file, collapsed or expanded", async () => {
    const editor = note(MD);
    await fireEvent.click(dom(editor).querySelector('[aria-label="Collapse callout"]')!);
    expect(saved(editor)).toBe(MD);

    await fireEvent.click(dom(editor).querySelector('[aria-label="Expand callout"]')!);
    expect(saved(editor)).toBe(MD);
    expect(dom(editor).querySelector("[data-node-view-content]")).not.toHaveAttribute(
      "hidden",
    );
  });

  it("takes the caret out of a body it hides", async () => {
    // The body is real document content, so a caret left inside a hidden one would
    // type invisibly — an edit to a note the GM cannot see. It leaves the way the
    // keyboard boundary sends it: to just before the box.
    const editor = note(`Before the box.\n\n${MD}`);
    caretAt(editor, bodyStart(editor));
    expect(caretIn(editor)).toBe("Four goblins.");

    await fireEvent.click(dom(editor).querySelector('[aria-label="Collapse callout"]')!);

    expect(caretIn(editor)).toBe("Before the box.");
    expect(saved(editor)).toBe(`Before the box.\n\n${MD}`);
  });

  it("leaves a caret that was never in the body where it is", async () => {
    const editor = note(`Before the box.\n\n${MD}`);
    caretAt(editor, 2);

    await fireEvent.click(dom(editor).querySelector('[aria-label="Collapse callout"]')!);

    expect(editor.state.selection.from).toBe(2);
  });

  it("starts collapsed when the file's fold marker asks for it", () => {
    const editor = note("> [!encounter]- The Ambush\n> Four goblins.");

    expect(dom(editor).querySelector("[data-node-view-content]")).toHaveAttribute(
      "hidden",
    );
    expect(dom(editor).querySelector('[aria-label="Expand callout"]')).toBeTruthy();
  });

  it("starts open when the marker asks for open, and writes the marker back either way", async () => {
    const editor = note("> [!encounter]+ The Ambush\n> Four goblins.");

    expect(dom(editor).querySelector("[data-node-view-content]")).not.toHaveAttribute(
      "hidden",
    );
    await fireEvent.click(dom(editor).querySelector('[aria-label="Collapse callout"]')!);
    expect(saved(editor)).toBe("> [!encounter]+ The Ambush\n> Four goblins.");
  });

  it("keeps a collapsed body in the document rather than deleting it", async () => {
    // Collapse is view state; a collapse that removed the children would be a
    // collapse that edited the note.
    const editor = note(MD);
    await fireEvent.click(dom(editor).querySelector('[aria-label="Collapse callout"]')!);

    expect(dom(editor).querySelector("[data-node-view-content]")).toHaveTextContent(
      "Four goblins.",
    );
  });
});

// ─── The document's word is final ─────────────────────────────────────────────

describe("a callout follows the document", () => {
  it("redraws its title from the attributes it is given, as after an undo", async () => {
    const editor = note("> [!warning] The bridge is out\n> Mind the gap.");
    await fireEvent.click(titleField(editor));
    await fireEvent.input(titleField(editor), { target: { value: "Careful" } });
    await fireEvent.blur(titleField(editor));

    editor.commands.undo();
    await Promise.resolve();

    expect(titleField(editor)).toHaveTextContent("The bridge is out");
    expect(saved(editor)).toBe("> [!warning] The bridge is out\n> Mind the gap.");
  });

  it("survives a save with an empty body", () => {
    const editor = note("> [!warning] The bridge is out");

    expect(saved(editor)).toBe("> [!warning] The bridge is out");
    expect(titleField(editor)).toHaveTextContent("The bridge is out");
  });

  it("makes one undo step of a committed title edit, not one per keystroke", async () => {
    // The field commits when the GM leaves it, so a coherent edit is one document
    // write — and one Ctrl+Z takes the whole of it back.
    const editor = note("Before the box.\n\n> [!warning] The bridge is out");
    await fireEvent.click(titleField(editor));
    await fireEvent.input(titleField(editor), { target: { value: "C" } });
    await fireEvent.input(titleField(editor), { target: { value: "Ca" } });
    await fireEvent.input(titleField(editor), { target: { value: "Careful" } });
    await fireEvent.blur(titleField(editor));

    expect(saved(editor)).toBe("Before the box.\n\n> [!warning] Careful");
    editor.commands.undo();
    expect(saved(editor)).toBe("Before the box.\n\n> [!warning] The bridge is out");
  });
});

// ─── Removing the box ─────────────────────────────────────────────────────────
//
// These assertions used to say the opposite: the header's own control *unwrapped*, so
// the box went and the prose inside it stayed. They are rewritten here rather than
// deleted because the record of a reversed decision is worth more than a clean file —
// callout-block.ts holds the reasoning, this holds the behaviour it produced.

/**
 * The removal a GM actually performs, end to end: the grip beside the callout, the menu it
 * opens, the Delete in it.
 *
 * Driven through the real `BlockHandle` rather than by calling `deleteBlockAt` — which is
 * how these read at first, and it made every claim below pass with the grip, the menu and
 * their whole module deleted from the app. The callout offers no removal of its own (the
 * test above pins that), so this gesture is the *only* way a box comes off a note, and it is
 * the thing this suite is about.
 *
 * The `mousedown` is part of it and not noise: it is what selects the block for the drag
 * that shares this button, so it is also what leaves a whole-block selection for the menu
 * action to hand back to the prose.
 */
async function deleteViaGrip(editor: Editor) {
  const handle = createBlockHandleLife(() => editor);
  const target = targetOf(editor, "blockquote");
  handle.point(target);
  render(BlockHandle, { props: { editor, target, handle } });
  const grip = document.querySelector<HTMLButtonElement>("[data-block-handle]");
  expect(grip, "a grip on the callout").not.toBeNull();

  await fireEvent.mouseDown(grip!);
  await fireEvent.click(grip!);

  const remove = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) =>
    el.textContent?.trim().startsWith("Delete"),
  );
  expect(remove, "a Delete item in the grip's menu").toBeTruthy();
  await fireEvent.click(remove!);
  // The action is genuinely async — Copy awaits a clipboard, so all four go through a
  // promise — and the write lands in its `finally`.
  await Promise.resolve();
}

describe("removing a callout", () => {
  it("draws no removal control of its own, in the header or anywhere else", () => {
    const editor = note(
      "> [!warning] The bridge is out\n> The eastern crossing collapsed last winter.",
    );
    const labels = [...dom(editor).querySelectorAll("button")].map((b) =>
      b.getAttribute("aria-label"),
    );

    // The title, which is a field opened for typing, and the chevron — collapse being
    // the header's one piece of chrome that is not a field. Nothing else.
    expect(labels.sort()).toEqual(["Callout title", "Collapse callout"]);
  });

  it("draws none on an ordinary quote either, which has no header at all", () => {
    // The old unwrap was offered only by a typed callout, a quote with no type having no
    // header to put it in. Nothing is offered by either now, and the quote still draws
    // no chrome — which is the half of that claim that outlived the control.
    const editor = note("> Just a quotation.");

    expect(dom(editor).querySelectorAll("button")).toHaveLength(0);
  });

  it("takes the body with the box when the handle's menu deletes it", async () => {
    const editor = note(
      "> [!warning] The bridge is out\n> The eastern crossing collapsed last winter.",
    );

    await deleteViaGrip(editor);

    expect(saved(editor)).toBe("");
  });

  it("takes every block the body held, not just the first", async () => {
    // The case the old unwrap was careful about, now answered the other way: a fight
    // grouped in an `encounter` callout (#182) is a body of several blocks, and Delete
    // takes all of them because they are the block's children.
    const editor = note(
      "> [!encounter] The Ambush\n> Two kobolds.\n>\n> - a rusted blade\n> - a lantern",
    );

    await deleteViaGrip(editor);

    const out = saved(editor);
    expect(out).not.toContain("Two kobolds.");
    expect(out).not.toContain("a rusted blade");
    expect(out).not.toContain("a lantern");
  });

  it("is one undo step, which puts the box and its contents back", async () => {
    const md = "> [!tip] Ask the ferryman\n> He knows the crossing.";
    const editor = note(md);

    await deleteViaGrip(editor);
    editor.commands.undo();

    expect(saved(editor)).toBe(md);
  });

  it("leaves the prose around it alone", async () => {
    const editor = note(
      "Before the box.\n\n> [!note] Aside\n> Inside the box.\n\nAfter the box.",
    );

    await deleteViaGrip(editor);

    expect(saved(editor)).toBe("Before the box.\n\nAfter the box.");
  });
});
