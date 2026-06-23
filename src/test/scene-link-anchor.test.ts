import { describe, it, expect } from "vitest";
import {
  offsetsFromRange,
  highlightRangesForOffsets,
  quoteForOffsets,
  rangeWithinDiv,
  type ItemRange,
} from "../lib/pdf/scene-link-anchor";

// Build a fake PDF.js text layer: one <span> per item, each holding a single
// text node — the shape `TextLayer` produces (PDF.js is mocked: we only need the
// DOM the anchoring math reads). Returns the span elements (the `textDivs`).
function makeTextLayer(items: string[]): HTMLElement[] {
  const layer = document.createElement("div");
  const divs = items.map((s) => {
    const span = document.createElement("span");
    span.textContent = s;
    layer.append(span);
    return span;
  });
  document.body.replaceChildren(layer);
  return divs;
}

function rangeOver(
  startDiv: HTMLElement,
  startOffset: number,
  endDiv: HTMLElement,
  endOffset: number,
): Range {
  const range = document.createRange();
  range.setStart(startDiv.firstChild!, startOffset);
  range.setEnd(endDiv.firstChild!, endOffset);
  return range;
}

describe("offsetsFromRange", () => {
  it("maps a selection inside one span to global char offsets", () => {
    const divs = makeTextLayer(["The ", "quick", " fox"]);
    // Select "uic" inside the second span ("quick").
    const range = rangeOver(divs[1], 1, divs[1], 4);
    expect(offsetsFromRange(divs, range)).toEqual({ start: 5, end: 8 });
  });

  it("maps a selection spanning two spans to global offsets", () => {
    const divs = makeTextLayer(["The ", "quick", " fox"]);
    // Select from "ick" in span 1 through " f" in span 2 → global 6..11.
    const range = rangeOver(divs[1], 2, divs[2], 2);
    expect(offsetsFromRange(divs, range)).toEqual({ start: 6, end: 11 });
  });

  it("selecting an entire span yields its full extent", () => {
    const divs = makeTextLayer(["The ", "quick", " fox"]);
    const range = rangeOver(divs[0], 0, divs[0], 4);
    expect(offsetsFromRange(divs, range)).toEqual({ start: 0, end: 4 });
  });

  it("returns null for a collapsed (empty) selection", () => {
    const divs = makeTextLayer(["The ", "quick"]);
    const range = rangeOver(divs[0], 2, divs[0], 2);
    expect(offsetsFromRange(divs, range)).toBeNull();
  });

  it("returns null when the range is not within the text layer", () => {
    const divs = makeTextLayer(["The ", "quick"]);
    const outside = document.createElement("p");
    outside.textContent = "elsewhere";
    document.body.append(outside);
    const range = document.createRange();
    range.setStart(outside.firstChild!, 0);
    range.setEnd(outside.firstChild!, 4);
    expect(offsetsFromRange(divs, range)).toBeNull();
  });

  it("resolves offsets when the container is the span element itself", () => {
    // Some selections land on the element with a child-index offset rather than
    // on the inner text node.
    const divs = makeTextLayer(["alpha", "beta"]);
    const range = document.createRange();
    range.setStart(divs[0], 0); // before the text node
    range.setEnd(divs[0], 1); // after the (single) text node → whole "alpha"
    expect(offsetsFromRange(divs, range)).toEqual({ start: 0, end: 5 });
  });
});

describe("highlightRangesForOffsets", () => {
  it("maps an offset range inside one item to a single ItemRange", () => {
    expect(highlightRangesForOffsets(["The quick fox"], 4, 9)).toEqual<ItemRange[]>([
      { itemIndex: 0, from: 4, to: 9 },
    ]);
  });

  it("splits an offset range that spans items into a range per item", () => {
    expect(highlightRangesForOffsets(["quick", "fox"], 0, 8)).toEqual<ItemRange[]>([
      { itemIndex: 0, from: 0, to: 5 },
      { itemIndex: 1, from: 0, to: 3 },
    ]);
  });

  it("trims the edges of a range spanning three items", () => {
    expect(highlightRangesForOffsets(["aXX", "YY", "ZZb"], 1, 7)).toEqual<ItemRange[]>([
      { itemIndex: 0, from: 1, to: 3 },
      { itemIndex: 1, from: 0, to: 2 },
      { itemIndex: 2, from: 0, to: 2 },
    ]);
  });
});

describe("quoteForOffsets", () => {
  it("extracts the selected text across item boundaries", () => {
    expect(quoteForOffsets(["The ", "quick", " fox"], 4, 9)).toBe("quick");
    expect(quoteForOffsets(["The ", "quick", " fox"], 0, 13)).toBe("The quick fox");
  });
});

describe("rangeWithinDiv", () => {
  it("builds a DOM range covering exactly the requested characters", () => {
    const divs = makeTextLayer(["The quick fox"]);
    const range = rangeWithinDiv(divs[0], 4, 9);
    expect(range?.toString()).toBe("quick");
  });

  it("returns null for an empty div", () => {
    const div = document.createElement("span");
    expect(rangeWithinDiv(div, 0, 0)).toBeNull();
  });
});
