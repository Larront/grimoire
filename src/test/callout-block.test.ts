// The Callout's model, away from the markdown reader (#180).
//
// The round-trip and parse assertions live in block-markdown.test.ts, against
// the real extension list. What is here is the vocabulary and the header line:
// which words are recognised, what a callout displays when the GM wrote no
// title, and what the fold marker means.
import { describe, it, expect } from "vitest";
import { Editor, generateHTML, generateJSON } from "@tiptap/core";
import { noteExtensions } from "$lib/editor/note-extensions";
import { filterCommands } from "$lib/editor/slash-command";
import {
  CALLOUT_TYPES,
  calloutHeaderLine,
  isInitiallyCollapsed,
  recognisedCalloutType,
  titleCaseCalloutType,
} from "$lib/editor/callout-block";

// ─── The vocabulary ───────────────────────────────────────────────────────────

describe("the shipped types", () => {
  it("ships the ten the picker offers", () => {
    expect(CALLOUT_TYPES.map((t) => t.type)).toEqual([
      "note",
      "info",
      "tip",
      "warning",
      "danger",
      "question",
      "example",
      "quote",
      "read-aloud",
      "encounter",
    ]);
  });

  it("recognises a shipped type", () => {
    expect(recognisedCalloutType("warning")?.label).toBe("Warning");
  });

  it("recognises a type whatever the GM's casing", () => {
    expect(recognisedCalloutType("WARNING")?.type).toBe("warning");
    expect(recognisedCalloutType("Warning")?.type).toBe("warning");
    expect(recognisedCalloutType("wArNiNg")?.type).toBe("warning");
  });

  // The vocabulary is open: an unrecognised word is a callout with no colour,
  // never a validation failure and never a fallback to a default type.
  it("recognises nothing in a word it does not ship", () => {
    expect(recognisedCalloutType("prophecy")).toBe(null);
  });

  it("recognises nothing in a quote that is not a callout", () => {
    expect(recognisedCalloutType(null)).toBe(null);
  });

  it("names a domain concept in presentation only", () => {
    // ADR-0016 §8: an `encounter` picker entry with an icon is fine. What this
    // test guards is that the entry is *all* it is — a label and an icon name.
    const encounter = recognisedCalloutType("encounter");

    expect(Object.keys(encounter ?? {}).sort()).toEqual(["icon", "keywords", "label", "type"]);
  });
});

// ─── The fallback title ───────────────────────────────────────────────────────
//
// What a callout displays when the GM wrote no title. It is never written to the
// file, which since #181 is true by construction rather than by care: the node view
// hands it to the title field as a *placeholder*, so there is no value to commit and
// no attribute carrying it. These tests are the type-word rule alone.

describe("the fallback title", () => {
  it("is the type word in title case", () => {
    expect(titleCaseCalloutType("warning")).toBe("Warning");
  });

  it("title-cases each word of a hyphenated type", () => {
    expect(titleCaseCalloutType("read-aloud")).toBe("Read Aloud");
  });

  it("title-cases an unrecognised type the same way", () => {
    expect(titleCaseCalloutType("prophecy")).toBe("Prophecy");
  });

  it("keeps the GM's casing of a type they shouted", () => {
    expect(titleCaseCalloutType("WARNING")).toBe("WARNING");
  });
});

// ─── The header line ──────────────────────────────────────────────────────────

describe("the header line", () => {
  it("writes type and title", () => {
    expect(
      calloutHeaderLine({
        calloutType: "warning",
        calloutTitle: "The bridge is out",
        foldMarker: null,
      }),
    ).toBe("> [!warning] The bridge is out");
  });

  it("writes the type alone when there is no title", () => {
    expect(
      calloutHeaderLine({
        calloutType: "warning",
        calloutTitle: null,
        foldMarker: null,
      }),
    ).toBe("> [!warning]");
  });

  it("preserves the GM's casing", () => {
    expect(
      calloutHeaderLine({
        calloutType: "Warning",
        calloutTitle: null,
        foldMarker: null,
      }),
    ).toBe("> [!Warning]");
  });

  it("replays a fold marker it did not write", () => {
    expect(
      calloutHeaderLine({
        calloutType: "warning",
        calloutTitle: "Careful",
        foldMarker: "-",
      }),
    ).toBe("> [!warning]- Careful");
  });

  it("is nothing at all for an ordinary quote", () => {
    expect(
      calloutHeaderLine({
        calloutType: null,
        calloutTitle: null,
        foldMarker: null,
      }),
    ).toBe(null);
  });

  // The tokenizer accepts a line only when this function would reproduce it, so
  // these are the shapes it must not quietly tidy on the way back out.
  it("writes a title's own whitespace back untouched", () => {
    expect(
      calloutHeaderLine({
        calloutType: "note",
        calloutTitle: "Trailing  ",
        foldMarker: null,
      }),
    ).toBe("> [!note] Trailing  ");
  });

  it("writes an empty title as no title at all", () => {
    expect(
      calloutHeaderLine({
        calloutType: "note",
        calloutTitle: "",
        foldMarker: null,
      }),
    ).toBe("> [!note]");
  });
});

// ─── What the editor draws ────────────────────────────────────────────────────
//
// The node view — a live title field, keyboard boundaries — is the next ticket.
// What the element must already carry is enough for the stylesheet: the type
// under Obsidian's own `data-callout` name, and the displayed title.

function html(
  attrs: Partial<Record<string, unknown>>,
  body = "The eastern crossing fell.",
): string {
  return generateHTML(
    {
      type: "doc",
      content: [
        {
          type: "blockquote",
          attrs,
          content: [{ type: "paragraph", content: [{ type: "text", text: body }] }],
        },
      ],
    },
    noteExtensions(),
  );
}

describe("the callout element", () => {
  it("carries the type under Obsidian's own attribute name", () => {
    expect(html({ calloutType: "warning", calloutTitle: "The bridge is out" })).toContain(
      'data-callout="warning"',
    );
  });

  it("carries the GM's casing, so the stylesheet is what matches loosely", () => {
    expect(html({ calloutType: "WaRnInG" })).toContain('data-callout="WaRnInG"');
  });

  it("marks a shipped type as recognised, whatever its casing", () => {
    // Recognition is decided in the model, so the stylesheet needs one rule and
    // the vocabulary is not restated in CSS.
    expect(html({ calloutType: "warning" })).toContain("data-callout-known");
    expect(html({ calloutType: "WaRnInG" })).toContain("data-callout-known");
  });

  it("carries an unrecognised type as itself and marks it recognised by nothing", () => {
    // Styled neutrally: not a substituted type, and not a broken one either.
    const rendered = html({ calloutType: "prophecy" });

    expect(rendered).toContain('data-callout="prophecy"');
    expect(rendered).not.toContain("data-callout-known");
  });

  it("carries no title attribute when the GM wrote none", () => {
    // The displayed fallback is the node view's placeholder and lives nowhere else
    // (#181), so there is no attribute here that could be read back as a real title.
    const rendered = html({ calloutType: "warning" });

    expect(rendered).not.toContain("data-callout-title");
    expect(rendered).not.toContain("Warning");
  });

  it("leaves an ordinary quote an ordinary blockquote", () => {
    const rendered = html({
      calloutType: null,
      calloutTitle: null,
      foldMarker: null,
    });

    expect(rendered).not.toContain("data-callout");
  });

  // Copy and paste inside the app goes out to HTML and comes back, so the
  // element has to carry everything the file does — and nothing it does not.
  it("survives a copy and paste with its type, title and marker", () => {
    const attrs = {
      calloutType: "Warning",
      calloutTitle: "The bridge is out",
      foldMarker: "-",
    };
    const pasted = generateJSON(html(attrs), noteExtensions()).content?.[0];

    expect(pasted.attrs).toMatchObject(attrs);
  });

  it("brings back no title through a paste when the GM wrote none", () => {
    const pasted = generateJSON(html({ calloutType: "warning" }), noteExtensions()).content?.[0];

    expect(pasted.attrs.calloutTitle).toBe(null);
    expect(pasted.attrs.foldMarker).toBe(null);
  });
});

// ─── The picker ───────────────────────────────────────────────────────────────

describe("the /callout picker", () => {
  it("offers the ten shipped types", () => {
    expect(filterCommands("callout").map((item) => item.label)).toEqual(
      CALLOUT_TYPES.map((spec) => spec.label),
    );
  });

  it("finds a type by its own word", () => {
    expect(filterCommands("encounter").map((item) => item.label)).toEqual(["Encounter"]);
  });

  it("keeps the plain quote and the quote callout apart", () => {
    expect(filterCommands("quote").map((item) => `${item.group}/${item.label}`)).toEqual([
      "Text/Quote",
      "Callout/Quote",
    ]);
  });

  it("draws every type with an icon the menu can resolve", () => {
    for (const spec of CALLOUT_TYPES) {
      expect(spec.icon).toMatch(/^[A-Z][A-Za-z]+$/);
    }
  });

  // The picker is the one place a type is offered, so this is the only test that
  // runs a real editor: what it proves is that choosing an entry lands the GM
  // inside a callout of that type whose file form is the header line alone.
  it("wraps the cursor's paragraph in a callout of the chosen type", () => {
    const editor = new Editor({
      extensions: noteExtensions(),
      content: "<p>Mind the gap.</p>",
    });
    const encounter = filterCommands("encounter")[0];

    try {
      encounter.command(editor, { from: 1, to: 1 }, "");

      const quote = editor.getJSON().content?.[0];
      expect(quote?.type).toBe("blockquote");
      expect(quote?.attrs?.calloutType).toBe("encounter");
      // Trimmed because the editor keeps a trailing paragraph after any block —
      // pre-existing and nothing to do with callouts.
      expect(editor.getMarkdown().trimEnd()).toBe("> [!encounter]\n> Mind the gap.");
    } finally {
      editor.destroy();
    }
  });

  it("writes no title and no fold marker for a freshly picked callout", () => {
    const editor = new Editor({
      extensions: noteExtensions(),
      content: "<p></p>",
    });
    const warning = filterCommands("warning")[0];

    try {
      warning.command(editor, { from: 1, to: 1 }, "");

      expect(editor.getMarkdown().trimEnd()).toBe("> [!warning]");
    } finally {
      editor.destroy();
    }
  });
});

// ─── The fold marker ──────────────────────────────────────────────────────────

describe("the fold marker", () => {
  it("starts a callout collapsed when the file says so", () => {
    expect(isInitiallyCollapsed({ foldMarker: "-" })).toBe(true);
  });

  it("starts a callout open when the marker asks for open", () => {
    expect(isInitiallyCollapsed({ foldMarker: "+" })).toBe(false);
  });

  it("starts a callout open when the file carries no marker", () => {
    expect(isInitiallyCollapsed({ foldMarker: null })).toBe(false);
  });
});
