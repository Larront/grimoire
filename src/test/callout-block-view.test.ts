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
import { fireEvent } from "@testing-library/svelte";
import { describe, it, expect, afterEach, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { noteExtensions } from "$lib/editor/note-extensions";

vi.mock("$lib/stores/link-resolver.svelte", () => ({
  linkResolver: { isKnown: () => true, prime: vi.fn(), resolve: vi.fn() },
}));

// ─── Harness ──────────────────────────────────────────────────────────────────

// jsdom has no layout, and ProseMirror asks the DOM where the selection is whenever it
// scrolls it into view — which an undo and a gap-cursor arrow key both do. A text node
// has no `getClientRects` in jsdom at all, so these stand in with a zero rect: nothing
// under test here depends on a coordinate, only on not throwing on the way past.
const ZERO_RECT = {
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
  width: 0,
  height: 0,
  x: 0,
  y: 0,
  toJSON: () => ({}),
} as DOMRect;
const zeroRects = () =>
  Object.assign([ZERO_RECT], {
    item: (i: number) => (i === 0 ? ZERO_RECT : null),
  }) as unknown as DOMRectList;

// `Text` genuinely has no `getClientRects` in the DOM types either — the stub is the
// point, so the cast says so rather than pretending the property was always there.
(Text.prototype as unknown as { getClientRects: () => DOMRectList }).getClientRects =
  zeroRects;
Element.prototype.getClientRects = zeroRects;
Range.prototype.getClientRects = zeroRects;
Range.prototype.getBoundingClientRect = () => ZERO_RECT;

let open: { editor: Editor; element: HTMLElement } | null = null;

afterEach(() => {
  open?.editor.destroy();
  open?.element.remove();
  open = null;
});

/** A note's markdown, in an editor whose node views are mounted. */
function note(markdown: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: noteExtensions(),
    content: markdown,
    contentType: "markdown",
  });
  open = { editor, element };
  return editor;
}

/** The note as it would be written back to disk — what an autosave does. */
function saved(editor: Editor): string {
  return editor.getMarkdown().trimEnd();
}

/** The editor's DOM, for asking what the GM can see and click. */
function dom(editor: Editor): HTMLElement {
  return editor.view.dom as HTMLElement;
}

function titleField(editor: Editor, index = 0): HTMLElement {
  const fields = dom(editor).querySelectorAll<HTMLElement>(
    '[aria-label="Callout title"]',
  );
  return fields[index];
}

/** Puts the caret at a document position, as a click or an arrow key would. */
function caretAt(editor: Editor, pos: number) {
  const { state } = editor;
  editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos)));
}

/**
 * A key, pressed on the editor the way a GM presses it. Deliberately a real event on
 * the editor's own DOM rather than `keyboardShortcut()`: that command replays only a
 * handler's document *steps*, so a boundary whose whole job is to move the caret would
 * report success and change nothing. What is asserted below is always the outcome.
 */
function press(editor: Editor, key: string) {
  fireEvent.keyDown(editor.view.dom, { key });
}

/** The textblock the caret is in, by its text — where a boundary left the GM. */
function caretIn(editor: Editor): string {
  return editor.state.selection.$from.parent.textContent;
}

/** The first caret position inside a quote's body — the nth quote in the note. */
function bodyStart(editor: Editor, index = 0): number {
  const quotes: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "blockquote") quotes.push(pos);
  });
  return TextSelection.near(editor.state.doc.resolve(quotes[index] + 1), 1).from;
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
