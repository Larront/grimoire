// Pure find-in-page logic for the PDF viewer.
//
// PDF.js exposes each page's text as an ordered array of item strings — one per
// text-layer span. To find a query we join those items into a single page
// string, locate matches, then map each match back to the (item, local-offset)
// ranges so the viewer can wrap exactly the matched characters in highlight
// spans. A match can straddle several adjacent items, so one match can produce
// several ranges.
//
// This module is deliberately free of PDF.js and the DOM so the offset
// arithmetic is unit-testable without a canvas (issue #100 — rendering itself is
// verified manually, but the match math is not).

export interface PageTextIndex {
  /** Every item string concatenated, in order. */
  text: string;
  /** `itemStarts[i]` is the offset into `text` where item `i` begins. */
  itemStarts: number[];
}

export interface CharMatch {
  /** Inclusive global start offset into the page text. */
  start: number;
  /** Exclusive global end offset. */
  end: number;
}

export interface ItemRange {
  /** Index of the text item (text-layer span) this range falls in. */
  itemIndex: number;
  /** Local start offset within the item string (inclusive). */
  from: number;
  /** Local end offset within the item string (exclusive). */
  to: number;
}

/** Concatenate a page's item strings and record where each item begins. */
export function buildPageIndex(items: readonly string[]): PageTextIndex {
  const itemStarts: number[] = [];
  let text = "";
  for (const item of items) {
    itemStarts.push(text.length);
    text += item;
  }
  return { text, itemStarts };
}

/**
 * All non-overlapping, case-insensitive occurrences of `query` in the page,
 * in document order. An empty query matches nothing.
 */
export function findMatches(index: PageTextIndex, query: string): CharMatch[] {
  const matches: CharMatch[] = [];
  if (!query) return matches;
  const haystack = index.text.toLowerCase();
  const needle = query.toLowerCase();
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    matches.push({ start: at, end: at + needle.length });
    from = at + needle.length; // non-overlapping
  }
  return matches;
}

/**
 * Split one match into the per-item ranges that cover it. Items are visited in
 * order and only those overlapping the match contribute a range, so a match
 * spanning two spans yields a tail range on the first and a head range on the
 * second.
 */
export function rangesForMatch(index: PageTextIndex, match: CharMatch): ItemRange[] {
  const ranges: ItemRange[] = [];
  const { itemStarts, text } = index;
  for (let i = 0; i < itemStarts.length; i++) {
    const itemStart = itemStarts[i];
    const itemEnd = i + 1 < itemStarts.length ? itemStarts[i + 1] : text.length;
    if (itemEnd <= match.start) continue; // item ends before the match starts
    if (itemStart >= match.end) break; // item starts after the match ends
    const from = Math.max(match.start, itemStart) - itemStart;
    const to = Math.min(match.end, itemEnd) - itemStart;
    if (to > from) ranges.push({ itemIndex: i, from, to });
  }
  return ranges;
}
