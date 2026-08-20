// Finding a parked thought again (#232) — the pen's whole retrieval story.
//
// ADR-0018 is explicit that a Quick Note is invisible to the Search Index, so
// "find one" is a text filter over the rows the pane already holds. That makes it
// pure, and these are the claims the pane rests on: what a query matches, and
// that matching never touches what is stored.
import { describe, it, expect } from "vitest";
import { filterQuickNotes } from "$lib/utils/quick-note-search";
import type { QuickNote } from "$lib/bindings.gen";

function note(id: number, body: string): QuickNote {
  return { id, body, captured_at: "2026-08-19T09:00:00+00:00" };
}

const ROWS = [
  note(1, "[[People/Mira Ashvale.md]] should already know about the fires"),
  note(2, "the marsh road is impassable"),
  note(3, "ask [[Places/Marsh Road.md|the road]] whether the toll changed"),
];

describe("filterQuickNotes", () => {
  it("returns everything for an empty query, and the same rows it was given", () => {
    expect(filterQuickNotes(ROWS, "")).toEqual(ROWS);
    expect(filterQuickNotes(ROWS, "   ")).toEqual(ROWS);
  });

  it("matches prose, ignoring case", () => {
    expect(filterQuickNotes(ROWS, "IMPASSABLE").map((n) => n.id)).toEqual([2]);
  });

  it("matches a link by what it reads as — `mira` finds [[Mira Ashvale]]", () => {
    // The stored body says `People/Mira Ashvale.md`; the pane draws
    // "Mira Ashvale". Typing what is on screen has to be what works.
    expect(filterQuickNotes(ROWS, "mira ashvale").map((n) => n.id)).toEqual([1]);
  });

  it("matches a link by its target, alias and all", () => {
    // Aliased, so the target is nowhere on screen — and "including link targets"
    // is the ticket's wording, because a GM who wrote the path remembers it.
    expect(filterQuickNotes(ROWS, "Places/Marsh Road").map((n) => n.id)).toEqual([3]);
    expect(filterQuickNotes(ROWS, "the road").map((n) => n.id)).toEqual([3]);
  });

  it("matches across a link and the prose beside it, because the line is drawn as one", () => {
    // Nothing separates them on screen: the row reads "Mira Ashvale should already
    // know…", so a query reading straight through the link has to hit.
    expect(filterQuickNotes(ROWS, "Ashvale should").map((n) => n.id)).toEqual([1]);
    expect(filterQuickNotes(ROWS, "the road whether").map((n) => n.id)).toEqual([3]);
  });

  it("does not run a match out of a target and into the words after the link", () => {
    // `.md` is part of the target and "whether" is part of the line, but nowhere
    // do the two touch — a hit here would be a hit on text nobody can see.
    expect(filterQuickNotes(ROWS, "Marsh Road.md whether")).toEqual([]);
  });

  it("matches nothing that is only in the brackets", () => {
    expect(filterQuickNotes(ROWS, "[[")).toEqual([]);
  });

  it("leaves the stored rows untouched", () => {
    const before = JSON.stringify(ROWS);
    filterQuickNotes(ROWS, "marsh");
    expect(JSON.stringify(ROWS)).toBe(before);
  });
});
