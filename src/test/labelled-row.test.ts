// The Labelled Row — the `Label: value` format (ADR-0016 §4, #175). One parser
// and one serializer, shared with Statblock's header rows, which are byte-identical
// to Infobox's rows.
//
// The seam is text in, text out: a line of a fence body in, a record out, and the
// same line back again. What these tests pin is the pair being *inverse* over every
// record a parse can produce — the whole document round-trips on every autosave, so
// a parser and serializer that disagree corrupt a GM's note with no user action.
import { describe, it, expect } from "vitest";
import {
  parseLabelledRow,
  serializeLabelledRow,
  blankLabelledRow,
  labelText,
  oneLine,
  type LabelledRow,
} from "$lib/editor/labelled-row";

// ─── Parsing ──────────────────────────────────────────────────────────────────

describe("parseLabelledRow", () => {
  it("splits a row on its first colon", () => {
    expect(parseLabelledRow("Population: 4,200")).toEqual({
      label: "Population",
      value: "4,200",
    });
  });

  it("splits on the *first* colon, leaving later ones in the value", () => {
    expect(parseLabelledRow("Ruler: Ash, styled: the Grey")).toEqual({
      label: "Ruler",
      value: "Ash, styled: the Grey",
    });
  });

  it("reads a row labelled Image, which is a row like any other", () => {
    // No reserved labels: the meta lines of the format are markdown-flavoured, so a
    // row a GM genuinely labelled `Image:` is never silently eaten.
    expect(parseLabelledRow("Image: a woodcut of the harbour")).toEqual({
      label: "Image",
      value: "a woodcut of the harbour",
    });
  });

  it("reads a label with no value", () => {
    expect(parseLabelledRow("Ruler:")).toEqual({ label: "Ruler", value: "" });
  });

  it("keeps a wikilink in a value exactly as the GM typed it", () => {
    expect(parseLabelledRow("Ruler: [[Captain Ash]]")).toEqual({
      label: "Ruler",
      value: "[[Captain Ash]]",
    });
  });

  it("takes one space after the colon as the separator and keeps the rest", () => {
    expect(parseLabelledRow("Founded:   812 AR")).toEqual({
      label: "Founded",
      value: "  812 AR",
    });
  });

  it("reads a line with no colon as a value with no label", () => {
    expect(parseLabelledRow("![The harbour at dusk](images/harbor.png)")).toEqual({
      label: "",
      value: "![The harbour at dusk](images/harbor.png)",
    });
  });

  it("reads a leading colon as an unlabelled value", () => {
    expect(parseLabelledRow(": see: the ledger")).toEqual({
      label: "",
      value: "see: the ledger",
    });
  });
});

// ─── Serializing ──────────────────────────────────────────────────────────────

describe("serializeLabelledRow", () => {
  it("writes label, colon, space, value", () => {
    expect(serializeLabelledRow({ label: "Population", value: "4,200" })).toBe("Population: 4,200");
  });

  it("writes no trailing space for an empty value", () => {
    expect(serializeLabelledRow({ label: "Ruler", value: "" })).toBe("Ruler:");
  });

  it("writes an unlabelled value as the bare line", () => {
    expect(serializeLabelledRow({ label: "", value: "![a](b.png)" })).toBe("![a](b.png)");
  });

  it("shields an unlabelled value that holds a colon with a leading colon", () => {
    // Without the marker the line would read back as a label — the one place the
    // format's own splitting rule can turn a value into something else.
    expect(serializeLabelledRow({ label: "", value: "see: the ledger" })).toBe(": see: the ledger");
  });

  it("writes an empty row as an empty line", () => {
    expect(serializeLabelledRow(blankLabelledRow())).toBe("");
  });
});

// ─── Round trip ───────────────────────────────────────────────────────────────

describe("a labelled row round-trips byte for byte", () => {
  const ROWS: [string, LabelledRow][] = [
    ["a plain row", { label: "Population", value: "4,200" }],
    ["a value holding a colon", { label: "Ruler", value: "Ash, styled: the Grey" }],
    ["a row labelled Image", { label: "Image", value: "a woodcut" }],
    ["an empty value", { label: "Ruler", value: "" }],
    ["a wikilink value", { label: "Ruler", value: "[[Captain Ash]]" }],
    ["an aliased wikilink value", { label: "Ruler", value: "[[People/Ash.md|the Captain]]" }],
    ["a value of only spaces after the separator", { label: "Founded", value: "  812 AR" }],
    ["a value with a trailing space", { label: "Note", value: "unfinished " }],
    ["an unlabelled value", { label: "", value: "![a](b.png)" }],
    ["an unlabelled value holding a colon", { label: "", value: "see: the ledger" }],
    ["a label holding a hash", { label: "#1 Rule", value: "no colons in labels" }],
    ["a value holding brackets and braces", { label: "Sigil", value: "{[(ash)]}" }],
    ["a non-ASCII label and value", { label: "港", value: "四千二百" }],
  ];

  it.each(ROWS)("round-trips %s", (_what, row) => {
    expect(parseLabelledRow(serializeLabelledRow(row))).toEqual(row);
  });
});

// ─── The label's one restriction ──────────────────────────────────────────────
//
// The format splits on the first colon, so a colon inside a *label* is the one
// thing it cannot represent — `Ruler: the Grey: Ash` would read its label back as
// `Ruler`. Parsing can never produce such a label; the field that edits one keeps
// it that way, which is what makes the round trip above total.

describe("labelText", () => {
  it("passes an ordinary label through", () => {
    expect(labelText("Population")).toBe("Population");
  });

  it("drops a colon, which the format cannot represent in a label", () => {
    expect(labelText("Ruler: styled")).toBe("Ruler styled");
  });

  it("drops a newline, which would split one row into two", () => {
    expect(labelText("Ruler\nof the bay")).toBe("Ruler of the bay");
  });
});

describe("oneLine", () => {
  it("keeps a colon, which a value may hold", () => {
    expect(oneLine("Ash, styled: the Grey")).toBe("Ash, styled: the Grey");
  });

  it("folds a pasted newline into a space, because a row is one line", () => {
    expect(oneLine("4,200\n(at the last census)")).toBe("4,200 (at the last census)");
  });

  it("folds a Windows newline into one space", () => {
    expect(oneLine("a\r\nb")).toBe("a b");
  });
});
