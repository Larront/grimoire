// The Linked Text Field's splitting rule (#156, #175) — the text rules behind the
// one text surface a block has for free-text values.
//
// A field renders by splitting its string into **text and link segments Svelte draws
// normally**, never by building an HTML string. That is the whole reason this returns
// records rather than markup: the escaping problem is *deleted* rather than
// consolidated into two escapers that will eventually disagree. `renderTimelineText` was
// the escaper this replaced, and it is gone: Timeline's own ticket moved its rows onto
// this path (#214), so every free-text value in every block now draws through here.
//
// Deliberately free of TipTap, ProseMirror and Svelte: the field draws these, the
// Link Resolver answers whether each one resolves, and neither concern is here.
import { parseWikiTarget } from "$lib/editor/wiki-target";

/** One piece of a field's value: characters, or a link to a note. */
export type LinkedTextSegment =
  | { kind: "text"; text: string }
  | {
      kind: "link";
      /** The target as written, `#heading` fragment included — what navigation takes. */
      path: string;
      /** What the link reads as: its alias, else the path's stem. */
      title: string;
    };

/**
 * Every `[[…]]` in a value, matched the same way the fence-blind link scanner
 * matches — which is why there is no opt-in: a link a field declined to draw would
 * already be in the Link Index, Backlinks and the graph.
 */
const WIKI_LINK_RE = /\[\[([^\]]+)\]\]/g;

/**
 * A value as the segments that draw it, in order. Text is verbatim: no escaping, no
 * quoting, no encoding, because nothing downstream concatenates markup.
 */
export function splitLinkedText(text: string): LinkedTextSegment[] {
  const segments: LinkedTextSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(WIKI_LINK_RE)) {
    const start = match.index ?? 0;
    if (start > cursor) segments.push({ kind: "text", text: text.slice(cursor, start) });

    const { path, title } = parseWikiTarget(match[1]);
    segments.push({ kind: "link", path, title });
    cursor = start + match[0].length;
  }

  if (cursor < text.length) segments.push({ kind: "text", text: text.slice(cursor) });
  return segments;
}

/**
 * The targets a value links to, for warming the Link Resolver's cache before the
 * field draws them. Order is the value's; duplicates are left in, because the
 * resolver's own cache is what deduplicates the lookups.
 */
export function wikiTargetsIn(text: string): string[] {
  return splitLinkedText(text)
    .filter(
      (segment): segment is Extract<LinkedTextSegment, { kind: "link" }> => segment.kind === "link",
    )
    .map((segment) => segment.path);
}

/**
 * A value as it reads on screen — every link replaced by its title, nothing else
 * changed.
 *
 * The third member of this family, beside the segments a field draws and the
 * targets it primes: what a *reader* of the value sees, for the places that need
 * the line as prose rather than as a drawing. The Quick Notes Pane echoes it into
 * an undo toast and matches a filter against it (#232) — a GM types what is on
 * screen, and on screen a link is its title.
 */
export function linkedPlainText(text: string): string {
  return splitLinkedText(text)
    .map((segment) => (segment.kind === "text" ? segment.text : segment.title))
    .join("");
}
