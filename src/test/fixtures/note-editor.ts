// A real note editor, for the tests whose subject is a block *being used*.
//
// The seam is markdown in, a gesture, markdown out — a real `Editor` with real node
// views, mounted into a real element. Claims about ProseMirror-owned children, a caret
// that reaches a boundary, or an edit that must land in one fence and not its
// neighbour are all facts about the document after an event, and a component mounted
// on its own has no document to be right about.
//
// Extracted when the second consumer arrived (#182): the Callout's node view (#181)
// and encounter grouping are the same harness driven at two depths, and the jsdom
// stubs below in particular are the kind of thing that goes subtly stale in a copy.
import { fireEvent } from "@testing-library/svelte";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { noteExtensions, type NoteExtensionOptions } from "$lib/editor/note-extensions";

// jsdom has no layout, and ProseMirror asks the DOM where the selection is whenever it
// scrolls it into view — which an undo and a gap-cursor arrow key both do. A text node
// has no `getClientRects` in jsdom at all, so these stand in with a zero rect: nothing
// under test depends on a coordinate, only on not throwing on the way past.
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

// `posAtCoords` reaches for this on every mousedown ProseMirror sees, and jsdom does not
// implement it *at all* — not "returns nothing", but absent, so the call throws. Vitest
// counts a throw inside an event handler as an unhandled error and fails the run with
// every test still green, which reads as a phantom failure with no failing assertion.
//
// Null is the honest answer: nothing is at any point in a document with no layout.
// ProseMirror handles that answer already — it falls back to its own box, finds the
// coordinates outside it, and resolves no position, which is what a test that never meant
// to depend on a coordinate wants.
Document.prototype.elementFromPoint = () => null;

let open: { editor: Editor; element: HTMLElement } | null = null;

/** Tears down the editor a test opened. Every consumer registers this as `afterEach`. */
export function closeNote(): void {
  open?.editor.destroy();
  open?.element.remove();
  open = null;
}

/**
 * A note's markdown, in an editor whose node views are mounted.
 *
 * `options` are the extension callbacks — the overlays' way of reporting what the GM's
 * gesture asked for. They belong at construction because Tiptap builds its schema and its
 * plugins once, from the list it is given.
 */
export function note(markdown: string, options: NoteExtensionOptions = {}): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: noteExtensions(options),
    content: markdown,
    contentType: "markdown",
  });
  open = { editor, element };
  return editor;
}

/** The note as it would be written back to disk — what an autosave does. */
export function saved(editor: Editor): string {
  return editor.getMarkdown().trimEnd();
}

/** The editor's DOM, for asking what the GM can see and click. */
export function dom(editor: Editor): HTMLElement {
  return editor.view.dom as HTMLElement;
}

/** Puts the caret at a document position, as a click or an arrow key would. */
export function caretAt(editor: Editor, pos: number): void {
  const { state } = editor;
  editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos)));
}

/**
 * A key, pressed on the editor the way a GM presses it. Deliberately a real event on
 * the editor's own DOM rather than `keyboardShortcut()`: that command replays only a
 * handler's document *steps*, so a boundary whose whole job is to move the caret would
 * report success and change nothing. What is asserted is always the outcome.
 */
export function press(editor: Editor, key: string, modifiers: KeyModifiers = {}): void {
  fireEvent.keyDown(editor.view.dom, { key, ...modifiers });
}

/** The chord keys a shortcut is pressed with, for the bindings that take one. */
export interface KeyModifiers {
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/** The textblock the caret is in, by its text — where a boundary left the GM. */
export function caretIn(editor: Editor): string {
  return editor.state.selection.$from.parent.textContent;
}

/** The first caret position inside a quote's body — the nth quote in the note. */
export function bodyStart(editor: Editor, index = 0): number {
  const quotes: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "blockquote") quotes.push(pos);
  });
  return TextSelection.near(editor.state.doc.resolve(quotes[index] + 1), 1).from;
}
