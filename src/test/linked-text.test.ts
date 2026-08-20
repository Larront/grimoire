// The Linked Text Field's splitting rule (#175, #156) — the pure half of the one
// text surface a block has for free-text values.
//
// It renders by splitting its string into **text and link segments Svelte draws
// normally**, never by building an HTML string. That is what these tests pin: the
// function's job is to say where the links are, and nothing here escapes, quotes or
// encodes anything, because nothing downstream concatenates markup.
import { describe, it, expect } from "vitest";
import { splitLinkedText, wikiTargetsIn, linkedPlainText } from "$lib/editor/linked-text";

describe("splitLinkedText", () => {
  it("returns nothing for an empty string", () => {
    expect(splitLinkedText("")).toEqual([]);
  });

  it("returns text with no links as one text segment", () => {
    expect(splitLinkedText("4,200")).toEqual([{ kind: "text", text: "4,200" }]);
  });

  it("returns a bare link as one link segment", () => {
    expect(splitLinkedText("[[Captain Ash]]")).toEqual([
      { kind: "link", path: "Captain Ash", title: "Captain Ash" },
    ]);
  });

  it("splits text around a link, keeping both sides verbatim", () => {
    expect(splitLinkedText("ruled by [[Captain Ash]] since 812")).toEqual([
      { kind: "text", text: "ruled by " },
      { kind: "link", path: "Captain Ash", title: "Captain Ash" },
      { kind: "text", text: " since 812" },
    ]);
  });

  it("splits two links in one value", () => {
    expect(splitLinkedText("[[Ash]] and [[Vale]]")).toEqual([
      { kind: "link", path: "Ash", title: "Ash" },
      { kind: "text", text: " and " },
      { kind: "link", path: "Vale", title: "Vale" },
    ]);
  });

  it("takes a link's title from its stem", () => {
    expect(splitLinkedText("[[People/Captain Ash.md]]")).toEqual([
      { kind: "link", path: "People/Captain Ash.md", title: "Captain Ash" },
    ]);
  });

  it("takes a link's title from its alias, keeping the pipe out of the path", () => {
    expect(splitLinkedText("[[People/Ash.md|the Captain]]")).toEqual([
      { kind: "link", path: "People/Ash.md", title: "the Captain" },
    ]);
  });

  it("keeps a heading fragment on the path, where navigation expects it", () => {
    expect(splitLinkedText("[[Ash.md#Background]]")).toEqual([
      { kind: "link", path: "Ash.md#Background", title: "Ash" },
    ]);
  });

  it("leaves unclosed brackets as the text they are", () => {
    expect(splitLinkedText("[[Captain Ash")).toEqual([{ kind: "text", text: "[[Captain Ash" }]);
  });

  it("emits no empty text segments", () => {
    expect(splitLinkedText("[[Ash]][[Vale]]")).toEqual([
      { kind: "link", path: "Ash", title: "Ash" },
      { kind: "link", path: "Vale", title: "Vale" },
    ]);
  });

  it("hands markup back as text, because nothing downstream builds HTML", () => {
    expect(splitLinkedText("<b>Ash</b> & co")).toEqual([{ kind: "text", text: "<b>Ash</b> & co" }]);
  });
});

describe("wikiTargetsIn", () => {
  it("collects every target a value links to", () => {
    expect(wikiTargetsIn("[[Ash]] and [[People/Vale.md|V]]")).toEqual(["Ash", "People/Vale.md"]);
  });

  it("collects nothing from text with no links", () => {
    expect(wikiTargetsIn("4,200")).toEqual([]);
  });
});

describe("linkedPlainText", () => {
  it("reads a value the way a field draws it, links as their titles", () => {
    expect(linkedPlainText("ask [[People/Vale.md]] about the toll")).toBe(
      "ask Vale about the toll",
    );
  });

  it("takes an alias over the path's stem, as the drawing does", () => {
    expect(linkedPlainText("ask [[People/Vale.md|the captain]] first")).toBe(
      "ask the captain first",
    );
  });

  it("hands plain text back unchanged", () => {
    expect(linkedPlainText("no links here")).toBe("no links here");
  });
});
