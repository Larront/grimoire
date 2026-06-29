import { describe, it, expect } from "vitest";
import {
  buildPageIndex,
  findMatches,
  rangesForMatch,
  type ItemRange,
} from "../lib/pdf/pdf-find";

describe("buildPageIndex", () => {
  it("concatenates items and records each item's start offset", () => {
    const index = buildPageIndex(["The ", "quick", " fox"]);
    expect(index.text).toBe("The quick fox");
    expect(index.itemStarts).toEqual([0, 4, 9]);
  });

  it("handles empty items without disturbing offsets", () => {
    const index = buildPageIndex(["a", "", "b"]);
    expect(index.text).toBe("ab");
    expect(index.itemStarts).toEqual([0, 1, 1]);
  });
});

describe("findMatches", () => {
  const index = buildPageIndex(["the cat sat on the mat"]);

  it("finds every non-overlapping occurrence in order", () => {
    expect(findMatches(index, "the")).toEqual([
      { start: 0, end: 3 },
      { start: 15, end: 18 },
    ]);
  });

  it("matches case-insensitively while keeping original offsets", () => {
    expect(findMatches(index, "THE")).toEqual([
      { start: 0, end: 3 },
      { start: 15, end: 18 },
    ]);
  });

  it("does not overlap matches", () => {
    expect(findMatches(buildPageIndex(["aaaa"]), "aa")).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it("returns nothing for an empty query", () => {
    expect(findMatches(index, "")).toEqual([]);
  });

  it("returns nothing when the query is absent", () => {
    expect(findMatches(index, "dog")).toEqual([]);
  });
});

describe("rangesForMatch", () => {
  it("maps a match inside a single item to one range", () => {
    const index = buildPageIndex(["The quick fox"]);
    const [match] = findMatches(index, "quick");
    expect(rangesForMatch(index, match)).toEqual<ItemRange[]>([
      { itemIndex: 0, from: 4, to: 9 },
    ]);
  });

  it("splits a match that spans two items into a range per item", () => {
    // "quickfox" straddles the item boundary at offset 5.
    const index = buildPageIndex(["quick", "fox"]);
    const [match] = findMatches(index, "quickfox");
    expect(rangesForMatch(index, match)).toEqual<ItemRange[]>([
      { itemIndex: 0, from: 0, to: 5 },
      { itemIndex: 1, from: 0, to: 3 },
    ]);
  });

  it("covers a match that spans three items, trimming the edges", () => {
    const index = buildPageIndex(["aXX", "YY", "ZZb"]);
    const [match] = findMatches(index, "XXYYZZ");
    expect(rangesForMatch(index, match)).toEqual<ItemRange[]>([
      { itemIndex: 0, from: 1, to: 3 },
      { itemIndex: 1, from: 0, to: 2 },
      { itemIndex: 2, from: 0, to: 2 },
    ]);
  });

  it("skips empty items that sit on the boundary", () => {
    const index = buildPageIndex(["ab", "", "cd"]);
    const [match] = findMatches(index, "bc");
    expect(rangesForMatch(index, match)).toEqual<ItemRange[]>([
      { itemIndex: 0, from: 1, to: 2 },
      { itemIndex: 2, from: 0, to: 1 },
    ]);
  });
});
