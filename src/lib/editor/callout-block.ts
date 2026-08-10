// The Callout — a boxed aside that is a *real Obsidian callout* in the file (#180).
//
// Not a new node: the ordinary blockquote carrying two optional attributes, a
// type and a title. One node, because in the file they are the same construct —
// a quote with neither attribute *is* an ordinary quote, and Obsidian did not
// build a second node either. So this extension replaces StarterKit's Blockquote
// (`note-extensions.ts` turns that one off) rather than sitting beside it.
//
// On disk:
//
//     > [!warning] The bridge is out
//     > The eastern crossing collapsed last winter.
//
// which degrades to a coloured callout in Obsidian and an indented quote
// anywhere else.
//
// ── How the header reaches the parser ────────────────────────────────────────
//
// The reader hands a blockquote's body to its own block lexer, which is where
// the `[!type]` line lives. Rather than re-implement blockquote boundaries and
// lazy continuation, Callout declares a *block tokenizer for the header line
// alone* (ADR-0016 §3): marked keeps doing all the quote-shaped work, and the
// header arrives as `token.tokens[0]` of the blockquote it opened, ready to be
// lifted onto the node's attributes.
//
// Two consequences of that choice, both deliberate:
//
//   * `start` returns -1 — never interrupt a paragraph. A `[!x]` line *inside* a
//     quote's prose is prose, and the lexer reaches the header's real position
//     (the first line of a body) on its own.
//   * The header token carries a paragraph child. A `[!x]` line typed at the top
//     of a note has no callout to belong to, and the reader drops a token it has
//     no handler for; the child is the fallback that keeps the GM's characters as
//     a paragraph instead.
import { Blockquote } from "@tiptap/extension-blockquote";
import { mergeAttributes } from "@tiptap/core";
import type { Editor, JSONContent, MarkdownToken } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { ResolvedPos } from "@tiptap/pm/model";
import CalloutBlockView from "$lib/components/editor/CalloutBlockView.svelte";
import { createBlockNodeView } from "$lib/editor/node-view-connector";

// ─── The type vocabulary ──────────────────────────────────────────────────────
//
// Open, not closed: a type is a word the GM typed. These ten are the ones
// `/callout` offers and the ones with a colour; anything else is a callout too,
// drawn neutrally. No autocomplete, no validation, nothing to fail.
//
// `encounter` is here under ADR-0016 §8's rule, earned in #158: *presentation may
// name a domain concept; the model may not.* A picker entry and a colour add no
// roster, no node and no query — nothing here knows what an encounter is.

export interface CalloutTypeSpec {
  /** The word written into the file, in its canonical lower-case spelling. */
  type: string;
  /** How the type is named in the `/callout` picker. */
  label: string;
  /** Lucide icon name, resolved to a component by SlashCommandMenu. */
  icon: string;
  /** Extra search terms for the slash-command filter. Lower case. */
  keywords: string[];
}

export const CALLOUT_TYPES: readonly CalloutTypeSpec[] = [
  { type: "note", label: "Note", icon: "StickyNote", keywords: ["callout", "aside", "remark"] },
  { type: "info", label: "Info", icon: "Info", keywords: ["callout", "information"] },
  { type: "tip", label: "Tip", icon: "Lightbulb", keywords: ["callout", "hint", "advice"] },
  { type: "warning", label: "Warning", icon: "TriangleAlert", keywords: ["callout", "caution"] },
  { type: "danger", label: "Danger", icon: "OctagonAlert", keywords: ["callout", "error", "deadly"] },
  { type: "question", label: "Question", icon: "CircleQuestionMark", keywords: ["callout", "faq", "unknown"] },
  { type: "example", label: "Example", icon: "ListChecks", keywords: ["callout", "sample"] },
  { type: "quote", label: "Quote", icon: "Quote", keywords: ["callout", "cite", "saying"] },
  { type: "read-aloud", label: "Read Aloud", icon: "Speech", keywords: ["callout", "boxed", "text", "players"] },
  { type: "encounter", label: "Encounter", icon: "Swords", keywords: ["callout", "fight", "combat", "monsters"] },
];

/** The shipped type a word names, matched case-insensitively — or null. */
export function recognisedCalloutType(type: string | null): CalloutTypeSpec | null {
  if (!type) return null;
  const lower = type.toLowerCase();
  return CALLOUT_TYPES.find((spec) => spec.type === lower) ?? null;
}

/**
 * `read-aloud` → `Read Aloud`. What a callout displays when the GM wrote no
 * title — never written into the file, so an omitted title stays omitted.
 */
export function titleCaseCalloutType(type: string): string {
  return type
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// ─── Attributes ───────────────────────────────────────────────────────────────

export interface CalloutAttrs {
  /** The type word exactly as the GM cased it, or null for an ordinary quote. */
  calloutType: string | null;
  /** The title the GM wrote, or null when they wrote none. */
  calloutTitle: string | null;
  /**
   * Obsidian's fold marker, verbatim, or null when the file carries none.
   *
   * Read as an authored *starting* state and otherwise a no-op. Grimoire never
   * writes a marker and never removes one: a callout with no marker is not
   * foldable in Obsidian at all, so the two tools cannot agree, and Grimoire
   * yields on the axis that costs nothing — byte stability kept, Grimoire merely
   * more permissive. Per-block collapse is view state and never reaches the file.
   */
  foldMarker: string | null;
}

/** Whether the file asked for this callout to start collapsed. */
export function isInitiallyCollapsed(attrs: Pick<CalloutAttrs, "foldMarker">): boolean {
  return attrs.foldMarker === "-";
}

// There is no `calloutLabel(attrs)` resolving *title else type word* any more. The
// node view (#181) draws the title as a Linked Text Field whose value is the GM's
// title and whose **placeholder** is the type word, so the two halves of the old
// composition now sit either side of the field's own empty state — and the fallback
// has no path to the file by construction rather than by a caller remembering.

// ─── The header line ──────────────────────────────────────────────────────────

/**
 * `[!warning]- The bridge is out` — a type word, an optional fold marker, and the
 * rest of the line. The type is a single word because that is what Obsidian
 * accepts; a bracketed phrase is prose and stays prose.
 *
 * The rest of the line is captured raw rather than tidied, because what decides
 * whether this *is* a header is `writesBackExactly` below.
 */
const CALLOUT_HEADER_RE = /^\[!([^\]\s]+)\]([-+])?([^\n]*)/;

/** The marked token type the header line lexes to. */
export const CALLOUT_HEADER_TOKEN = "calloutHeader";

interface CalloutHeaderToken extends MarkdownToken {
  calloutType: string;
  calloutTitle: string | null;
  calloutFold: string | null;
}

/** The header a blockquote's first body token declares, or null for a plain quote. */
function headerOf(tokens: MarkdownToken[]): CalloutHeaderToken | null {
  const first = tokens[0];
  return first?.type === CALLOUT_HEADER_TOKEN ? (first as CalloutHeaderToken) : null;
}

/** `> [!Warning]- The bridge is out` — the line, quote marker included. */
export function calloutHeaderLine(attrs: CalloutAttrs): string | null {
  if (!attrs.calloutType) return null;
  const fold = attrs.foldMarker ?? "";
  const title = attrs.calloutTitle ? ` ${attrs.calloutTitle}` : "";
  return `> [!${attrs.calloutType}]${fold}${title}`;
}

// ─── Serialization ────────────────────────────────────────────────────────────

/**
 * A callout whose body holds nothing a GM typed. Its file form is the header
 * line alone, so the empty paragraph the schema requires must not become a
 * stray `>` line on the next autosave.
 */
function isEmptyBody(content: JSONContent[]): boolean {
  if (content.length === 0) return true;
  if (content.length > 1) return false;
  const only = content[0];
  return only.type === "paragraph" && !only.content?.length;
}

/** The slice of @tiptap/markdown's renderer helpers a blockquote needs. */
interface QuoteRenderHelpers {
  renderChild?: (node: JSONContent, index: number) => string;
  renderChildren: (nodes: JSONContent[]) => string;
}

/**
 * Every child prefixed with `>`, children separated by a bare `>` line — the
 * upstream Blockquote algorithm, kept byte-for-byte because plain quotes still
 * come through here. Nested quotes bring their own prefixes and gain one more.
 */
function quoteChildren(content: JSONContent[], h: QuoteRenderHelpers): string {
  return content
    .map((child, index) => {
      const rendered = h.renderChild?.(child, index) ?? h.renderChildren([child]);
      return rendered
        .split("\n")
        .map((line) => (line.trim() === "" ? ">" : `> ${line}`))
        .join("\n");
    })
    .join("\n>\n");
}

/** Whether a body's first child is the blank line the GM left under the header. */
function opensWithBlankLine(content: JSONContent[]): boolean {
  return content.length > 1 && content[0].type === "paragraph" && !content[0].content?.length;
}

/**
 * A blockquote as markdown — a callout when it carries a type, an ordinary quote
 * when it does not.
 *
 * The header normally joins the body with a single newline, which is the form
 * both Obsidian and Grimoire write. A blank line the GM left directly under the
 * header arrives as a leading empty paragraph, and that paragraph *is* the blank
 * line: it becomes the separator rather than a `>` of its own, or the file would
 * gain a line on every load-and-save.
 */
export function serializeBlockquote(
  node: { attrs?: Partial<CalloutAttrs>; content?: JSONContent[] },
  h: QuoteRenderHelpers,
): string {
  const attrs: CalloutAttrs = {
    calloutType: node.attrs?.calloutType ?? null,
    calloutTitle: node.attrs?.calloutTitle ?? null,
    foldMarker: node.attrs?.foldMarker ?? null,
  };
  const header = calloutHeaderLine(attrs);
  const content = node.content ?? [];

  if (!header) return content.length ? quoteChildren(content, h) : "";
  if (isEmptyBody(content)) return header;
  if (opensWithBlankLine(content)) return `${header}\n>\n${quoteChildren(content.slice(1), h)}`;
  return `${header}\n${quoteChildren(content, h)}`;
}

// ─── Keyboard boundaries ──────────────────────────────────────────────────────
//
// The named cost of a non-editable header above an editable body (#181), paid here once
// so the shipped-block migration and every future container inherit it.
//
// The body is ordinary content, so ProseMirror already handles everything *inside* it
// and everything below it — the boundary that needs help is the top edge, where the
// header sits. A `contenteditable="false"` element above the caret is somewhere the
// browser will happily put a caret the document has no position for, and the GM's arrow
// key then appears to do nothing.
//
// Both handlers fire only at the *first* position inside a callout and only for a
// collapsed selection, so every other keystroke reaches ProseMirror's own defaults
// untouched. Which position that is comes from ProseMirror rather than from arithmetic
// about paragraph depths: a caret inside a list inside a callout is at the top of the
// body just as much as one in a leading paragraph.

/** The innermost callout the caret sits inside, as its depth — or null. */
function calloutDepth($from: ResolvedPos): number | null {
  for (let depth = $from.depth; depth >= 1; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "blockquote" && node.attrs.calloutType) return depth;
  }
  return null;
}

/** The depth of the callout whose body the caret sits at the very top of, or null. */
function calloutAtBodyTop(state: EditorState): number | null {
  const { selection, doc } = state;
  if (!selection.empty) return null;

  const depth = calloutDepth(selection.$from);
  if (depth === null) return null;

  const top = TextSelection.near(doc.resolve(selection.$from.start(depth)), 1);
  return top.from === selection.from ? depth : null;
}

/**
 * Moves the caret to just before the callout at `depth`, as a command joining the
 * editor's own transaction — a keymap handler dispatching a transaction of its own would
 * have it overwritten by the chain that called it.
 *
 * Answers false when there is nowhere above the callout to go: one opening the note, or
 * one opening another callout's body.
 */
function moveCaretBefore(depth: number) {
  return ({ tr, dispatch }: { tr: Transaction; dispatch?: () => void }): boolean => {
    const before = tr.selection.$from.before(depth);
    const target = TextSelection.near(tr.doc.resolve(before), -1);
    if (target.from >= before) return false;

    if (dispatch) tr.setSelection(target).scrollIntoView();
    return true;
  };
}

/** Whether a callout holds nothing a GM typed — the one empty textblock the schema needs. */
function hasEmptyBody($from: ResolvedPos, depth: number): boolean {
  const callout = $from.node(depth);
  return (
    callout.childCount === 1 &&
    callout.firstChild!.isTextblock &&
    callout.firstChild!.content.size === 0
  );
}

/**
 * Backspace at the top of an **empty** body leaves the callout rather than deleting it.
 * An empty body is a valid state — a GM titles a box before filling it — and the title
 * beside it is content they typed, so swallowing the whole callout on one keystroke
 * would delete what they wrote. Leaving puts them outside it, where ProseMirror's own
 * backspace selects the node and a second press removes it.
 *
 * A body with anything in it is not this case, and falls through to the defaults.
 *
 * The key is claimed even when there is nowhere above the box to land. Falling through
 * there would hand the keystroke to ProseMirror's own backspace, which lifts or removes
 * the quote and takes the GM's title with it — the corruption this rule exists to
 * prevent, arriving in the one case the caret has no escape from. Removing such a
 * callout is a node selection away and never one keystroke.
 */
function exitEmptyCallout(editor: Editor): boolean {
  return editor.commands.command((props) => {
    const depth = calloutAtBodyTop(props.state);
    if (depth === null) return false;
    if (!hasEmptyBody(props.state.selection.$from, depth)) return false;

    moveCaretBefore(depth)(props);
    return true;
  });
}

/** An arrow key at the top of a body moves past the header instead of into it. */
function leaveCalloutBodyTop(editor: Editor): boolean {
  return editor.commands.command((props) => {
    const depth = calloutAtBodyTop(props.state);
    return depth === null ? false : moveCaretBefore(depth)(props);
  });
}

/**
 * Moves the caret out of the callout at `pos`, if it is in there.
 *
 * Called as a body is collapsed. The body is real document content, so a caret left
 * inside a hidden one would type invisibly — an edit to a note the GM cannot see. The
 * caret goes where the keyboard boundary above sends it, to just before the box: one
 * idea about leaving a callout, reached by two gestures.
 *
 * Nothing here touches the document's content, so a collapse still writes no bytes.
 */
function caretOutOfCallout(editor: Editor, getPos: () => number | undefined): void {
  const pos = getPos();
  if (pos == null) return;

  const { state } = editor;
  const callout = state.doc.nodeAt(pos);
  if (!callout) return;

  // Only this callout's own caret is ours to move. A caret elsewhere in the note — or
  // in a *different* collapsed box — is none of this view's business.
  const { from } = state.selection;
  if (from <= pos || from >= pos + callout.nodeSize) return;

  const target = TextSelection.near(state.doc.resolve(pos), -1);
  // Nowhere above to land: a callout opening the note, whose body is the only place in
  // it to type. Leaving the caret alone is the lesser wrong — the GM can expand again,
  // where dropping them into a paragraph this code invented is a document write.
  if (target.from > pos) return;

  editor.view.dispatch(state.tr.setSelection(target).scrollIntoView());
}

/**
 * Take the box away and leave what was in it (#175 review).
 *
 * The container block's answer to the sealed blocks' *remove*, and deliberately not the
 * same gesture. A sealed block **is** its content, so deleting the node deletes the
 * thing the GM was looking at; a callout is a wrapper around prose the GM wrote, and a
 * trash can that swallowed a fight's worth of statblocks because they wanted the tint
 * gone would be the most expensive control in the editor. Deleting the content remains
 * available and needs nothing from us: the body is ordinary document content, so
 * selecting it and pressing Backspace already works, which is exactly what a sealed
 * block cannot offer.
 *
 * `lift` is ProseMirror's own unwrap and is reused rather than reimplemented as a
 * delete-and-reinsert, so the children move without being re-parsed and one undo puts
 * the box back.
 *
 * The selection is stretched over the **whole body** before lifting, and that is the
 * part worth not simplifying: `lift` acts on the blocks the selection touches, so a
 * caret in the first paragraph lifts that paragraph alone and leaves the rest of the
 * body inside a callout the GM just asked to remove. A fight grouped in an `encounter`
 * callout — the case #182 exists for — is exactly a body of several blocks.
 */
function unwrapCallout(editor: Editor, getPos: () => number | undefined): void {
  const pos = getPos();
  if (pos == null) return;
  const callout = editor.state.doc.nodeAt(pos);
  if (!callout) return;

  editor
    .chain()
    .focus()
    // Inside the blockquote, from before its first child to after its last. TipTap
    // clamps these to the nearest text positions, so the ends do not need to be exact.
    .setTextSelection({ from: pos + 1, to: pos + callout.nodeSize - 1 })
    .lift("blockquote")
    .run();
}

// ─── Extension ────────────────────────────────────────────────────────────────

export const CalloutBlock = Blockquote.extend({
  // Draggable so the header's grip can carry the whole box, contents included. A callout
  // is the one member whose children are real text, so a caret can already be dragged
  // *within* it; what it could not do is move as one thing.
  draggable: true,

  addAttributes() {
    return {
      calloutType: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-callout"),
        renderHTML: (attrs) =>
          attrs.calloutType ? { "data-callout": attrs.calloutType } : {},
      },
      calloutTitle: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-callout-title"),
        renderHTML: (attrs) =>
          attrs.calloutTitle ? { "data-callout-title": attrs.calloutTitle } : {},
      },
      foldMarker: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-callout-fold"),
        renderHTML: (attrs) =>
          attrs.foldMarker ? { "data-callout-fold": attrs.foldMarker } : {},
      },
    };
  },

  // `data-callout` is Obsidian's own attribute name, so the CSS reads the same in
  // both tools. One more attribute is display-only, and deliberately *not* read back
  // by any `parseHTML`:
  //
  //   * `data-callout-known` — present when the type is one of the shipped ten.
  //     Recognition is decided here, against `CALLOUT_TYPES`, so the vocabulary
  //     lives in one place and the case-insensitive match is the one in this
  //     file. The stylesheet then needs a single rule rather than ten, and an
  //     unrecognised type is styled neutrally by simply not matching it.
  //
  // There was a second such attribute, `data-callout-label`, carrying the title as
  // displayed for the stylesheet's `::before` to draw. Both are gone: the node view
  // (#181) draws the header, so the only reader disappeared, and an attribute
  // holding a *resolved fallback* is exactly the kind of thing that later gets read
  // back into `calloutTitle` and written into a GM's file.
  //
  // What is left is a plain `<blockquote>` with one content hole. The node view
  // draws its own `<blockquote>` inside this element's place, which is why these
  // attributes are still the ones the stylesheet matches on.
  renderHTML({ node, HTMLAttributes }) {
    const attrs = node.attrs as CalloutAttrs;
    const display = attrs.calloutType
      ? recognisedCalloutType(attrs.calloutType)
        ? { "data-callout-known": "" }
        : {}
      : {};

    return [
      "blockquote",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, display),
      0,
    ];
  },

  markdownTokenizer: {
    name: CALLOUT_HEADER_TOKEN,
    level: "block",
    // Never interrupt a paragraph — see the note at the top of this file.
    start: () => -1,
    tokenize: (src: string) => {
      const match = CALLOUT_HEADER_RE.exec(src);
      if (!match) return undefined;

      const [raw, type, fold, rest] = match;
      const attrs: CalloutAttrs = {
        calloutType: type,
        // A title is separated from the marker by one space, and that space is
        // the serializer's too — so it is removed here and nowhere else.
        calloutTitle: (rest.startsWith(" ") ? rest.slice(1) : null) || null,
        foldMarker: fold ?? null,
      };

      // The rule that keeps a GM's file still: *a line is a header only if the
      // serializer would write it back exactly.* Asking `calloutHeaderLine` —
      // the one writer — makes that true by construction rather than by a
      // second, hand-tightened regex that could drift from it.
      //
      // What this turns away is a line Grimoire cannot reproduce: `[!note]Body`
      // with no separating space, or a stray trailing space. Those stay prose,
      // which costs the GM nothing, where claiming them would rewrite their file
      // on the next autosave.
      if (calloutHeaderLine(attrs) !== `> ${raw}`) return undefined;

      return {
        type: CALLOUT_HEADER_TOKEN,
        raw,
        text: raw,
        calloutType: attrs.calloutType,
        calloutFold: attrs.foldMarker,
        calloutTitle: attrs.calloutTitle,
        // The fallback for a header with no blockquote around it.
        tokens: [
          { type: "paragraph", raw, text: raw, tokens: [{ type: "text", raw, text: raw }] },
        ],
      };
    },
  },

  parseMarkdown: (token, helpers) => {
    const parseBlockChildren = helpers.parseBlockChildren ?? helpers.parseChildren;
    const childTokens = token.tokens ?? [];
    const header = headerOf(childTokens);

    // One node either way, and the attributes are spelled out either way: a
    // quote with no type is a quote, not a second kind of thing.
    if (!header) {
      return helpers.createNode(
        "blockquote",
        { calloutType: null, calloutTitle: null, foldMarker: null },
        parseBlockChildren(childTokens),
      );
    }

    const body = parseBlockChildren(childTokens.slice(1));
    return helpers.createNode(
      "blockquote",
      {
        calloutType: header.calloutType,
        calloutTitle: header.calloutTitle,
        foldMarker: header.calloutFold,
      },
      // `block+`: a callout with nothing in it still needs somewhere to type.
      // `serializeBlockquote` writes the header alone rather than a stray `>`.
      body.length ? body : [helpers.createNode("paragraph", undefined, [])],
    );
  },

  renderMarkdown: serializeBlockquote,

  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      Backspace: () => exitEmptyCallout(this.editor),
      ArrowUp: () => leaveCalloutBodyTop(this.editor),
      ArrowLeft: () => leaveCalloutBodyTop(this.editor),
    };
  },

  // The **container mode** of the shared connector (ADR-0016 §4–5), built against sealed
  // consumers and executed for real here: the view marks one hole with
  // `data-node-view-content` and ProseMirror owns everything in it. Nothing node-view
  // shaped is written in this file — no `contentDOM`, no `stopEvent`, no
  // `ignoreMutation`. The connector's default event rule is already the one the title
  // input needs: an event on the block's own chrome is the block's, an event inside the
  // hole is ProseMirror's.
  //
  // The view is mounted for *every* blockquote, because a callout is not a second node —
  // a quote with no type simply draws no header, and its markup stays the ordinary
  // `<blockquote>` the stylesheet already knows.
  addNodeView() {
    const editor = this.editor;

    return createBlockNodeView({
      component: CalloutBlockView,
      domAttrs: { "data-note-block": "callout" },
      mode: "container",
      props: ({ getPos, updateAttributes }) => ({
        // A merge, so the type and the fold marker the GM never touched survive an edit
        // to the title. The connector's write-back is what makes that true.
        onTitleCommit: (calloutTitle: string | null) => updateAttributes({ calloutTitle }),
        onCollapse: () => caretOutOfCallout(editor, getPos),
        onUnwrap: () => unwrapCallout(editor, getPos),
      }),
    });
  },
});
