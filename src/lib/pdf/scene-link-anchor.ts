// Scene-link anchoring: the bridge between a text selection on a PDF page and a
// stored Scene-link's character range, and back to the per-span ranges the text
// layer renders an underline over.
//
// PDF.js is isolated behind this module (ADR-0011 / CONTEXT: "PDF.js is isolated
// behind a frontend Scene-link anchoring module so the offset-range ↔
// highlight-geometry mapping is testable without a canvas"). It reuses the same
// item-string → offset model as find-in-page (`pdf-find`): a page's text is the
// concatenation of its text-layer span strings, so a Scene-link is a `[start,
// end)` char range over that concatenation, mapped to `(span, local-offset)`
// ranges for rendering — exactly the find-highlight currency `PdfPage` already
// draws.

import { buildPageIndex, rangesForMatch, type ItemRange } from "./pdf-find";

export type { ItemRange };

/** A fresh text selection on a page, reported up for the Link-Scene flow. */
export interface SceneLinkSelection {
  page: number;
  /** Inclusive global char offset into the page text. */
  start: number;
  /** Exclusive global char offset. */
  end: number;
  /** The selected text, stored as the link's `quote`. */
  quote: string;
  /** Selection bounding box in viewport coords, for placing the action bubble. */
  rect: { left: number; top: number; bottom: number; right: number };
}

/** Char length of a node's text content (0 for nodes without any). */
function textLength(node: Node): number {
  return node.textContent?.length ?? 0;
}

/** Index of the text-layer span (in `textDivs`) that owns `node`, or -1. */
function owningDivIndex(textDivs: HTMLElement[], node: Node): number {
  let el: Node | null = node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
  while (el) {
    const idx = textDivs.indexOf(el as HTMLElement);
    if (idx !== -1) return idx;
    el = el.parentNode;
  }
  return -1;
}

/**
 * Local char offset of a selection point `(container, offset)` within the span
 * `div`, counting text in document order. Handles both a point inside a text node
 * (the common case) and a point on the span element itself (offset = child
 * index), so find-rebuilt spans with several child nodes still resolve.
 */
function localOffsetWithin(div: HTMLElement, container: Node, offset: number): number {
  if (container === div) {
    let total = 0;
    for (let i = 0; i < offset && i < div.childNodes.length; i++) {
      total += textLength(div.childNodes[i]);
    }
    return total;
  }
  let total = 0;
  const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    if (n === container) return total + offset;
    total += textLength(n);
  }
  return total;
}

/**
 * Map a DOM selection `range` over the text layer to global `[start, end)` char
 * offsets into the page text. Returns null when the selection is collapsed or
 * falls outside the given spans (e.g. a stray selection on the toolbar).
 *
 * A selection may straddle several spans; the start and end are resolved
 * independently against their owning spans, so a multi-span selection collapses
 * to one contiguous char range — the form a Scene-link is stored as.
 */
export function offsetsFromRange(
  textDivs: HTMLElement[],
  range: Range,
): { start: number; end: number } | null {
  if (range.collapsed) return null;

  const itemStarts: number[] = [];
  let acc = 0;
  for (const div of textDivs) {
    itemStarts.push(acc);
    acc += textLength(div);
  }

  const startDiv = owningDivIndex(textDivs, range.startContainer);
  const endDiv = owningDivIndex(textDivs, range.endContainer);
  if (startDiv === -1 || endDiv === -1) return null;

  const start = itemStarts[startDiv] + localOffsetWithin(textDivs[startDiv], range.startContainer, range.startOffset);
  const end = itemStarts[endDiv] + localOffsetWithin(textDivs[endDiv], range.endContainer, range.endOffset);
  if (end <= start) return null;
  return { start, end };
}

/**
 * Map a stored `[start, end)` char range to the per-span ranges that cover it —
 * the highlight geometry `PdfPage` renders. Reuses the find-highlight splitter so
 * a Scene-link spanning several spans yields one range per affected span.
 */
export function highlightRangesForOffsets(
  itemStrings: readonly string[],
  start: number,
  end: number,
): ItemRange[] {
  const index = buildPageIndex(itemStrings);
  return rangesForMatch(index, { start, end });
}

/** The selected text for a `[start, end)` range — stored as the link's `quote`. */
export function quoteForOffsets(itemStrings: readonly string[], start: number, end: number): string {
  return buildPageIndex(itemStrings).text.slice(start, end);
}

/**
 * Whether the text now at a Scene-link's stored `[start, end)` range still equals
 * the `quote` captured when the link was made. A PDF is path-addressed (ADR-0011),
 * so a different edition dropped at the same path keeps the offsets but changes the
 * underlying text — the range would then underline unrelated words. Callers use
 * this to surface the drift instead of silently mis-highlighting. `quote` was
 * itself produced by `quoteForOffsets`, so an unchanged PDF compares exactly.
 */
export function quoteMatchesAtOffsets(
  itemStrings: readonly string[],
  start: number,
  end: number,
  quote: string,
): boolean {
  return quoteForOffsets(itemStrings, start, end) === quote;
}

/**
 * Build a DOM Range spanning chars `[from, to)` of a span's text, so the caller
 * can measure it (`getBoundingClientRect`) to position an underline. Returns null
 * for an empty span. Walks the span's text nodes so it works whether the span
 * holds one text node or several (a find-rebuilt span).
 */
export function rangeWithinDiv(div: HTMLElement, from: number, to: number): Range | null {
  const range = document.createRange();
  let placedStart = false;
  let placedEnd = false;
  let consumed = 0;
  const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const len = textLength(node);
    if (!placedStart && from <= consumed + len) {
      range.setStart(node, Math.max(0, from - consumed));
      placedStart = true;
    }
    if (!placedEnd && to <= consumed + len) {
      range.setEnd(node, Math.max(0, to - consumed));
      placedEnd = true;
      break;
    }
    consumed += len;
  }
  if (!placedStart || !placedEnd) return null;
  return range;
}
