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
import type { JSONContent, MarkdownToken } from "@tiptap/core";

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

/** The text a callout's title bar shows: the GM's title, else the type word. */
export function calloutLabel(attrs: CalloutAttrs): string {
  if (attrs.calloutTitle) return attrs.calloutTitle;
  return attrs.calloutType ? titleCaseCalloutType(attrs.calloutType) : "";
}

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

// ─── Extension ────────────────────────────────────────────────────────────────

export const CalloutBlock = Blockquote.extend({
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
  // both tools. Two more attributes are display-only, and deliberately *not* read
  // back by any `parseHTML`:
  //
  //   * `data-callout-label` — the title as displayed, an omitted one resolved to
  //     the type word. If this reached `calloutTitle` a fallback would be written
  //     into the GM's file.
  //   * `data-callout-known` — present when the type is one of the shipped ten.
  //     Recognition is decided here, against `CALLOUT_TYPES`, so the vocabulary
  //     lives in one place and the case-insensitive match is the one in this
  //     file. The stylesheet then needs a single rule rather than ten, and an
  //     unrecognised type is styled neutrally by simply not matching it.
  //
  // The title is drawn from an attribute rather than a DOM child so the element
  // stays a plain `<blockquote>` with one content hole — the node view that turns
  // the title into a live field, and adds the per-type icon, is the next ticket.
  renderHTML({ node, HTMLAttributes }) {
    const attrs = node.attrs as CalloutAttrs;
    const display = attrs.calloutType
      ? {
          "data-callout-label": calloutLabel(attrs),
          ...(recognisedCalloutType(attrs.calloutType) ? { "data-callout-known": "" } : {}),
        }
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
});
