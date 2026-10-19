// The `[[` dropdown's grammar (#215) — the part of wikilink autocomplete that is the
// same wherever the GM types, tested without either surface.
//
// What is *not* here is trigger spotting in prose, which is ProseMirror's and stays
// there. The field's own spotter is, because it is Grimoire's and pure.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  findWikiTrigger,
  looksLikeProse,
  parseWikiQuery,
  readWikiSuggestKey,
  searchWikiTargets,
  wikiLinkTarget,
  wikiMenuAnchor,
} from "$lib/editor/wiki-suggest";
import wikiLinkSource from "$lib/editor/wiki-link.ts?raw";
import fieldSource from "$lib/components/editor/LinkedTextField.svelte?raw";

const ASH = { id: 1, title: "Captain Ash", path: "People/Ash.md", folder: "People", alias: null };
const searchLinkTargets = vi.fn(async (_query: string, _exclude: string | null) => [ASH]);

vi.mock("$lib/api", () => ({
  api: {
    silent: {
      searchLinkTargets: (q: string, exclude: string | null) => searchLinkTargets(q, exclude),
    },
  },
}));

beforeEach(() => searchLinkTargets.mockClear());

// ─── Spotting `[[` in a field ─────────────────────────────────────────────────

describe("findWikiTrigger", () => {
  it("finds an open `[[` behind the caret, and the query typed into it", () => {
    const text = "Ruled by [[Ash";
    expect(findWikiTrigger(text, text.length)).toEqual({
      start: 9,
      query: "Ash",
    });
  });

  it("offers an empty query the moment the brackets open", () => {
    expect(findWikiTrigger("Ruled by [[", 11)).toEqual({ start: 9, query: "" });
  });

  it("finds nothing when no brackets are open", () => {
    expect(findWikiTrigger("Ruled by Ash", 12)).toBeNull();
  });

  it("finds nothing once the GM has closed the brackets themselves", () => {
    const text = "Ruled by [[Captain Ash]]";
    expect(findWikiTrigger(text, text.length)).toBeNull();
  });

  it("reads only what is behind the caret, so a link ahead of it is not the trigger", () => {
    // Caret sits inside the first pair; the second pair is later in the value.
    const text = "Ruled by [[Ash and [[Vale]]";
    expect(findWikiTrigger(text, 14)).toEqual({ start: 9, query: "Ash" });
  });

  it("takes the nearest `[[` when two are open", () => {
    const text = "[[Ash and [[Va";
    expect(findWikiTrigger(text, text.length)).toEqual({
      start: 10,
      query: "Va",
    });
  });
});

// ─── What a key means to an open dropdown ─────────────────────────────────────

describe("readWikiSuggestKey", () => {
  const list = { itemCount: 3, selectedIndex: 0 };

  it("moves down the list, wrapping at the end", () => {
    expect(readWikiSuggestKey("ArrowDown", list)).toEqual({
      kind: "move",
      selectedIndex: 1,
    });
    expect(readWikiSuggestKey("ArrowDown", { itemCount: 3, selectedIndex: 2 })).toEqual({
      kind: "move",
      selectedIndex: 0,
    });
  });

  it("moves up the list, wrapping at the start", () => {
    expect(readWikiSuggestKey("ArrowUp", list)).toEqual({
      kind: "move",
      selectedIndex: 2,
    });
  });

  it("accepts the highlighted note on Enter", () => {
    expect(readWikiSuggestKey("Enter", { itemCount: 3, selectedIndex: 2 })).toEqual({
      kind: "accept",
      selectedIndex: 2,
    });
  });

  it("dismisses on Escape", () => {
    expect(readWikiSuggestKey("Escape", list)).toEqual({ kind: "dismiss" });
  });

  it("walks with Tab and Shift+Tab, as the slash menu does", () => {
    // Tab used to move real focus into the list, and Enter then took the focused row
    // rather than the lit one.
    expect(readWikiSuggestKey("Tab", list)).toEqual({ kind: "move", selectedIndex: 1 });
    expect(readWikiSuggestKey("Tab", { ...list, shiftKey: true })).toEqual({
      kind: "move",
      selectedIndex: 2,
    });
  });

  it("pages, stopping at the ends", () => {
    const long = { itemCount: 20, selectedIndex: 2 };
    expect(readWikiSuggestKey("PageDown", long)).toEqual({ kind: "move", selectedIndex: 8 });
    expect(readWikiSuggestKey("PageUp", long)).toEqual({ kind: "move", selectedIndex: 0 });
    expect(readWikiSuggestKey("PageDown", { itemCount: 20, selectedIndex: 18 })).toEqual({
      kind: "move",
      selectedIndex: 19,
    });
  });

  it("claims no other key", () => {
    expect(readWikiSuggestKey("a", list)).toBeNull();
    expect(readWikiSuggestKey("ArrowLeft", list)).toBeNull();
  });

  // An empty dropdown says "No notes found" and has nothing to move through or take.
  // Claiming a key there would swallow it from the surface underneath — a caret that
  // will not move, an Enter that breaks no line — for a list with no entries.
  describe("an empty list claims only Escape", () => {
    const empty = { itemCount: 0, selectedIndex: 0 };

    it.each(["ArrowDown", "ArrowUp", "Enter"])("leaves %s to the surface", (key) => {
      expect(readWikiSuggestKey(key, empty)).toBeNull();
    });

    it("still dismisses on Escape", () => {
      expect(readWikiSuggestKey("Escape", empty)).toEqual({ kind: "dismiss" });
    });
  });
});

// ─── The lookup ───────────────────────────────────────────────────────────────

describe("searchWikiTargets", () => {
  it("searches the name alone, leaving out the note being written", async () => {
    await searchWikiTargets("Ash#Early life|the Captain", "People/Me.md");
    expect(searchLinkTargets).toHaveBeenCalledWith("Ash", "People/Me.md");
  });

  it("offers the notes it finds, then the name as a new note", async () => {
    await expect(searchWikiTargets("Capt")).resolves.toEqual([
      { kind: "note", ...ASH },
      { kind: "new", name: "Capt" },
    ]);
  });

  it("counts a note's file name as its name too", async () => {
    // People/Ash.md is already "Ash".
    const rows = await searchWikiTargets("ash");
    expect(rows.map((r) => r.kind)).toEqual(["note"]);
  });

  it("offers no new note once a note has that very name", async () => {
    const rows = await searchWikiTargets("captain ash");
    expect(rows.map((r) => r.kind)).toEqual(["note"]);
  });

  it("offers no new note for nothing typed", async () => {
    const rows = await searchWikiTargets("");
    expect(rows.map((r) => r.kind)).toEqual(["note"]);
  });

  it("still offers the new name when the search fails, rather than throwing at a typist", async () => {
    searchLinkTargets.mockRejectedValueOnce(new Error("ledger closed"));
    await expect(searchWikiTargets("Brannoc")).resolves.toEqual([
      { kind: "new", name: "Brannoc" },
    ]);
  });
});

// ─── What is typed, and what is written ───────────────────────────────────────

describe("parseWikiQuery", () => {
  it("splits a name from its heading and display text", () => {
    expect(parseWikiQuery("keep#History|the Keep")).toEqual({
      name: "keep",
      heading: "History",
      display: "the Keep",
    });
    expect(parseWikiQuery("The Ember Keep")).toEqual({
      name: "The Ember Keep",
      heading: null,
      display: null,
    });
  });
});

describe("wikiLinkTarget", () => {
  const note = { kind: "note" as const, ...ASH };

  it("writes the note's path with the heading and display text the GM typed", () => {
    // `[[keep|the Keep` used to write a bare link and drop "the Keep".
    expect(wikiLinkTarget(note, parseWikiQuery("ash#Early life|the Captain"))).toBe(
      "People/Ash.md#Early life|the Captain",
    );
  });

  it("writes a new note's name as typed", () => {
    expect(wikiLinkTarget({ kind: "new", name: "Brannoc" }, parseWikiQuery("Brannoc"))).toBe(
      "Brannoc",
    );
  });
});

describe("looksLikeProse", () => {
  it("lets a name with spaces through", () => {
    expect(looksLikeProse("The Ember Keep")).toBe(false);
  });

  it("closes for a stray [[ followed by a sentence", () => {
    expect(looksLikeProse("and then, the party left")).toBe(true);
    expect(looksLikeProse("one two three four five six seven eight nine")).toBe(true);
  });
});

// ─── Where the menu sits ──────────────────────────────────────────────────────

describe("wikiMenuAnchor", () => {
  it("sits below the anchor, and remembers its top so a flip clears it", () => {
    expect(wikiMenuAnchor({ left: 10, bottom: 40, top: 24 } as DOMRect)).toEqual({
      x: 10,
      y: 44,
      anchorTop: 24,
    });
  });

  it("falls back to the origin when there is no rect to measure", () => {
    expect(wikiMenuAnchor(null)).toEqual({ x: 0, y: 4, anchorTop: 0 });
  });
});

// ─── One implementation, not two ──────────────────────────────────────────────

describe("neither surface keeps a second copy of the dropdown", () => {
  // The acceptance criterion (#215) is about the *code*, not one behaviour, so the
  // proof is a property of the sources. Arrow keys are the tell: they mean nothing to
  // a text input or to prose except *move the dropdown's highlight*, so either file
  // naming one is either file having reimplemented the navigation.
  it.each([
    ["the wikilink node's suggestion plugin", wikiLinkSource],
    ["the Linked Text Field", fieldSource],
  ])("%s names no arrow key of its own", (_what, source) => {
    expect(source).not.toMatch(/Arrow(Up|Down)/);
  });

  it("reads the keys through the shared grammar in prose", () => {
    expect(wikiLinkSource).toMatch(/readWikiSuggestKey/);
  });

  it("leaves the fields one helper between them, rather than a copy each", () => {
    expect(fieldSource).toMatch(/createFieldWikiSuggest/);
    expect(fieldSource).not.toMatch(/readWikiSuggestKey/);
  });

  it("leaves one lookup, so a failed search answers the same way on both surfaces", () => {
    expect(wikiLinkSource).not.toMatch(/api\.(silent\.)?search/);
    expect(fieldSource).not.toMatch(/api\.(silent\.)?search/);
  });
});
