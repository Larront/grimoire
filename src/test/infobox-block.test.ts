// The Infobox's format (#175, #176) — the fenced ```infobox body: an optional `#`
// title, an optional `![alt](path)` thumbnail, and one Labelled Row per line, blank
// lines decorative.
//
// The seam is the one ADR-0016 §2 rule 3 mandates and the one the spec calls
// preferred: exported pure functions, no editor and no DOM. Text in, records out,
// text back.
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import {
  parseInfoboxBody,
  serializeInfobox,
  blankInfobox,
  type Infobox,
} from "$lib/editor/infobox-block";
import { noteExtensions } from "$lib/editor/note-extensions";
import { filterCommands } from "$lib/editor/slash-command";

/** The body of a fence, as the markdown reader hands it over. */
function body(...lines: string[]): string {
  return lines.join("\n");
}

/** A panel record, with the parts a case is not about left at their empty values. */
function record(partial: Partial<Infobox>): Infobox {
  return { title: "", image: "", imageAlt: "", rows: [], ...partial };
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

describe("parseInfoboxBody", () => {
  it("reads a title and its rows", () => {
    expect(
      parseInfoboxBody(
        body("# Harbor's End", "Population: 4,200", "Ruler: [[Captain Ash]]", "Founded: 812 AR"),
      ),
    ).toEqual(
      record({
        title: "Harbor's End",
        rows: [
          { label: "Population", value: "4,200" },
          { label: "Ruler", value: "[[Captain Ash]]" },
          { label: "Founded", value: "812 AR" },
        ],
      }),
    );
  });

  it("reads rows with no title", () => {
    expect(parseInfoboxBody(body("Population: 4,200"))).toEqual(
      record({ rows: [{ label: "Population", value: "4,200" }] }),
    );
  });

  it("reads an empty fence as an empty panel", () => {
    expect(parseInfoboxBody("")).toEqual(record({}));
  });

  it("treats blank lines as decoration", () => {
    expect(
      parseInfoboxBody(body("# Harbor's End", "", "Population: 4,200", "", "", "Ruler: Ash")),
    ).toEqual(
      record({
        title: "Harbor's End",
        rows: [
          { label: "Population", value: "4,200" },
          { label: "Ruler", value: "Ash" },
        ],
      }),
    );
  });

  it("finds a title under leading blank lines", () => {
    expect(parseInfoboxBody(body("", "# Harbor's End", "Population: 4,200")).title).toBe(
      "Harbor's End",
    );
  });

  it("reads a row genuinely labelled Image rather than eating it", () => {
    // The image line the next ticket brings is markdown-flavoured (`![alt](path)`),
    // which is exactly what keeps `Image:` an ordinary row and not a reserved label.
    expect(parseInfoboxBody(body("# Harbor's End", "Image: a woodcut of the harbour")).rows).toEqual(
      [{ label: "Image", value: "a woodcut of the harbour" }],
    );
  });

  it("keeps a title holding a colon whole", () => {
    expect(parseInfoboxBody(body("# Harbor's End: the docks", "Population: 4,200")).title).toBe(
      "Harbor's End: the docks",
    );
  });

  it("reads a lone hash as an empty title", () => {
    expect(parseInfoboxBody(body("#", "# Not a title, a row")).rows).toEqual([
      { label: "", value: "# Not a title, a row" },
    ]);
  });

  it("reads only the first line as a title, later hash lines being rows", () => {
    const parsed = parseInfoboxBody(body("# Harbor's End", "# The docks"));

    expect(parsed.title).toBe("Harbor's End");
    expect(parsed.rows).toEqual([{ label: "", value: "# The docks" }]);
  });

  it("reads a hash with no space as a row, not a title", () => {
    expect(parseInfoboxBody(body("#Harbor's End")).title).toBe("");
  });
});

// ─── The image line ───────────────────────────────────────────────────────────
//
// The thumbnail (#176) is real `![alt](path)` markdown on its own line, read at one
// position only: after the title, before the rows. Markdown-flavoured, like the
// title line, which is what keeps `Image:` an ordinary label and not a reserved one.

describe("parseInfoboxBody reads a thumbnail", () => {
  it("reads an image line under the title", () => {
    expect(
      parseInfoboxBody(
        body("# Harbor's End", "![The harbour at dusk](images/harbor.png)", "Population: 4,200"),
      ),
    ).toEqual(
      record({
        title: "Harbor's End",
        image: "images/harbor.png",
        imageAlt: "The harbour at dusk",
        rows: [{ label: "Population", value: "4,200" }],
      }),
    );
  });

  it("reads an image line in a panel with no title", () => {
    expect(parseInfoboxBody(body("![The harbour](images/harbor.png)", "Population: 4,200"))).toEqual(
      record({
        image: "images/harbor.png",
        imageAlt: "The harbour",
        rows: [{ label: "Population", value: "4,200" }],
      }),
    );
  });

  it("reads an image with no alt text", () => {
    expect(parseInfoboxBody(body("![](images/harbor.png)"))).toEqual(
      record({ image: "images/harbor.png" }),
    );
  });

  it("finds the image under blank lines, which are decoration here too", () => {
    expect(parseInfoboxBody(body("# Harbor's End", "", "![a](images/harbor.png)")).image).toBe(
      "images/harbor.png",
    );
  });

  it("reads a path holding spaces, which a copied image's filename may", () => {
    expect(parseInfoboxBody(body("![a](.grimoire/images/my map.png)")).image).toBe(
      ".grimoire/images/my map.png",
    );
  });

  it("reads a path holding parentheses, which a copied image's filename may", () => {
    // Both captures are greedy, so the *last* `](` is the separator — a filename the
    // GM's disk holds as `map (1).png` is an ordinary path rather than an edge case.
    expect(parseInfoboxBody(body("![a](.grimoire/images/map (1).png)")).image).toBe(
      ".grimoire/images/map (1).png",
    );
  });

  it("reads an alt holding a wikilink, brackets and all", () => {
    expect(parseInfoboxBody(body("![[[Captain Ash]] at the docks](images/ash.png)"))).toEqual(
      record({ image: "images/ash.png", imageAlt: "[[Captain Ash]] at the docks" }),
    );
  });

  it("reads only the meta position as an image, a later image line being a row", () => {
    // A panel has one thumbnail. The second image line is an unlabelled row, which is
    // the reading that keeps every byte of a hand-written fence.
    const parsed = parseInfoboxBody(body("![a](images/a.png)", "![b](images/b.png)"));

    expect(parsed.image).toBe("images/a.png");
    expect(parsed.rows).toEqual([{ label: "", value: "![b](images/b.png)" }]);
  });

  it("reads an image line with no path as no image at all", () => {
    // The shield `serializeInfobox` writes over a first row that would otherwise be
    // read as the thumbnail: the line is consumed, the panel has no image, and the
    // row below is still a row.
    expect(parseInfoboxBody(body("![]()", "![a](images/a.png)"))).toEqual(
      record({ rows: [{ label: "", value: "![a](images/a.png)" }] }),
    );
  });

  it("reads a row genuinely labelled Image rather than eating it, thumbnail or not", () => {
    expect(
      parseInfoboxBody(body("![a](images/a.png)", "Image: a woodcut of the harbour")).rows,
    ).toEqual([{ label: "Image", value: "a woodcut of the harbour" }]);
  });

  it("leaves a line that only looks like an image a row", () => {
    expect(parseInfoboxBody(body("![a](images/a.png) and prose after it")).image).toBe("");
  });
});

// ─── Serializing ──────────────────────────────────────────────────────────────

describe("serializeInfobox", () => {
  it("writes the fence the spec shows", () => {
    expect(
      serializeInfobox({
        title: "Harbor's End",
        image: "",
        imageAlt: "",
        rows: [
          { label: "Population", value: "4,200" },
          { label: "Ruler", value: "[[Captain Ash]]" },
          { label: "Founded", value: "812 AR" },
        ],
      }),
    ).toBe(
      [
        "```infobox",
        "# Harbor's End",
        "Population: 4,200",
        "Ruler: [[Captain Ash]]",
        "Founded: 812 AR",
        "```",
      ].join("\n"),
    );
  });

  it("writes no title line when the title is empty", () => {
    expect(serializeInfobox(record({ rows: [{ label: "Population", value: "4,200" }] }))).toBe(
      "```infobox\nPopulation: 4,200\n```",
    );
  });

  it("writes an empty panel as an empty fence", () => {
    expect(serializeInfobox(record({}))).toBe("```infobox\n```");
  });

  it("shields a first row that would read back as a title", () => {
    // An empty title above an unlabelled `# …` row is the one collision between the
    // two meta lines; a bare `#` says "the title is empty" and keeps the row a row.
    expect(serializeInfobox(record({ rows: [{ label: "", value: "# The docks" }] }))).toBe(
      "```infobox\n#\n# The docks\n```",
    );
  });

  it("drops a row holding nothing but whitespace, which reads back as nothing", () => {
    // Reachable by typing a space into an empty unlabelled row. Its line would trim to
    // nothing, so the reader would drop it — the serializer drops it first, which keeps
    // the two halves agreeing about what the file says.
    expect(serializeInfobox(record({ rows: [{ label: "", value: " " }] }))).toBe(
      "```infobox\n```",
    );
  });

  it("keeps a row whose line has something on it, however odd", () => {
    // A label of one space is a line a GM's file can hold (` :`), so it is content and
    // stays. The rule is about the *line*, not about whether a field looks empty.
    expect(serializeInfobox(record({ rows: [{ label: " ", value: "" }] }))).toBe(
      "```infobox\n :\n```",
    );
  });

  it("writes the image line under the title", () => {
    expect(
      serializeInfobox(
        record({
          title: "Harbor's End",
          image: "images/harbor.png",
          imageAlt: "The harbour at dusk",
          rows: [{ label: "Population", value: "4,200" }],
        }),
      ),
    ).toBe(
      body(
        "```infobox",
        "# Harbor's End",
        "![The harbour at dusk](images/harbor.png)",
        "Population: 4,200",
        "```",
      ),
    );
  });

  it("writes an image with no alt as an empty alt", () => {
    expect(serializeInfobox(record({ image: "images/harbor.png" }))).toBe(
      "```infobox\n![](images/harbor.png)\n```",
    );
  });

  it("writes no image line when the panel has no thumbnail", () => {
    expect(serializeInfobox(record({ rows: [{ label: "Population", value: "4,200" }] }))).toBe(
      "```infobox\nPopulation: 4,200\n```",
    );
  });

  it("shields a first row that would read back as the thumbnail", () => {
    // The image line's own collision, shielded the way the title's is: a pathless
    // `![]()` says "the panel has no thumbnail" and keeps the row below a row.
    expect(serializeInfobox(record({ rows: [{ label: "", value: "![a](images/a.png)" }] }))).toBe(
      body("```infobox", "![]()", "![a](images/a.png)", "```"),
    );
  });

  it("needs no shield for an image-shaped row under a real thumbnail", () => {
    expect(
      serializeInfobox(
        record({
          image: "images/a.png",
          imageAlt: "a",
          rows: [{ label: "", value: "![b](images/b.png)" }],
        }),
      ),
    ).toBe(body("```infobox", "![a](images/a.png)", "![b](images/b.png)", "```"));
  });

  it("drops a row the GM typed nothing into rather than writing a blank line", () => {
    // A fresh `/infobox` carries one empty row so there is somewhere to type. An
    // empty row is not content, and a blank line written into the fence would come
    // back as decoration — so it is dropped, not preserved.
    expect(serializeInfobox(blankInfobox())).toBe("```infobox\n```");
  });
});

// ─── Round trip ───────────────────────────────────────────────────────────────
//
// ADR-0016 §2 rule 3, and the acceptance criterion this ticket leads with:
// `parse(serialize(x))` equals `x`, byte for byte.

describe("an infobox round-trips byte for byte", () => {
  const PANELS: [string, Infobox][] = [
    [
      "the panel the spec shows",
      record({
        title: "Harbor's End",
        rows: [
          { label: "Population", value: "4,200" },
          { label: "Ruler", value: "[[Captain Ash]]" },
          { label: "Founded", value: "812 AR" },
        ],
      }),
    ],
    ["an empty title", record({ rows: [{ label: "Population", value: "4,200" }] })],
    ["an empty panel", record({})],
    ["a title and no rows", record({ title: "Harbor's End" })],
    [
      "a row labelled Image",
      record({
        title: "Harbor's End",
        rows: [{ label: "Image", value: "a woodcut of the harbour" }],
      }),
    ],
    ["a value holding a colon", record({ rows: [{ label: "Ruler", value: "Ash, styled: the Grey" }] })],
    ["a title holding a colon", record({ title: "Harbor's End: the docks" })],
    ["a title holding a wikilink", record({ title: "Seat of [[Captain Ash]]" })],
    ["an empty value", record({ rows: [{ label: "Ruler", value: "" }] })],
    ["an unlabelled row", record({ rows: [{ label: "", value: "a woodcut" }] })],
    ["an unlabelled row holding a colon", record({ rows: [{ label: "", value: "see: the ledger" }] })],
    ["an unlabelled row that looks like a title", record({ rows: [{ label: "", value: "# The docks" }] })],
    [
      "an unlabelled row that looks like the thumbnail",
      record({ rows: [{ label: "", value: "![a](b.png)" }] }),
    ],
    ["a row whose label is a space", record({ rows: [{ label: " ", value: "" }] })],
    ["a value that is only spaces", record({ rows: [{ label: "Note", value: "  " }] })],
    [
      "an unlabelled title-shaped row under a real title",
      record({ title: "Harbor's End", rows: [{ label: "", value: "# The docks" }] }),
    ],
    [
      "a thumbnail and a title",
      record({
        title: "Harbor's End",
        image: "images/harbor.png",
        imageAlt: "The harbour at dusk",
        rows: [{ label: "Population", value: "4,200" }],
      }),
    ],
    ["a thumbnail and no title", record({ image: "images/harbor.png", imageAlt: "The harbour" })],
    ["a thumbnail with no caption", record({ image: "images/harbor.png" })],
    [
      "a caption holding a wikilink",
      record({ image: "images/ash.png", imageAlt: "[[Captain Ash]] at the docks" }),
    ],
    ["a path holding spaces", record({ image: ".grimoire/images/my map.png", imageAlt: "a" })],
    ["a path holding parentheses", record({ image: ".grimoire/images/map (1).png", imageAlt: "a" })],
    [
      "a thumbnail above an image-shaped row",
      record({
        image: "images/a.png",
        imageAlt: "a",
        rows: [{ label: "", value: "![b](images/b.png)" }],
      }),
    ],
    [
      "a title, a thumbnail and a title-shaped row",
      record({
        title: "Harbor's End",
        image: "images/harbor.png",
        imageAlt: "The harbour",
        rows: [{ label: "", value: "# The docks" }],
      }),
    ],
    [
      "many rows",
      record({
        title: "The Ember Keep",
        image: ".grimoire/images/keep.webp",
        imageAlt: "The keep from the road",
        rows: [
          { label: "Type", value: "Fortress" },
          { label: "Ruler", value: "[[People/Ash.md|the Captain]]" },
          { label: "Garrison", value: "40" },
          { label: "Sigil", value: "{[(ash)]}" },
          { label: "港", value: "四千二百" },
        ],
      }),
    ],
  ];

  it.each(PANELS)("round-trips %s", (_what, panel) => {
    expect(parseInfoboxBody(fenceBody(serializeInfobox(panel)))).toEqual(panel);
  });

  it("round-trips a body a GM hand-wrote in Obsidian", () => {
    // Blank lines are decoration and go; every other byte the GM typed comes back.
    const hand = body(
      "# Harbor's End",
      "![The harbour at dusk](images/harbor.png)",
      "",
      "Population: 4,200",
      "Ruler: [[Captain Ash]]",
    );
    const parsed = parseInfoboxBody(hand);

    expect(serializeInfobox(parsed)).toBe(
      body(
        "```infobox",
        "# Harbor's End",
        "![The harbour at dusk](images/harbor.png)",
        "Population: 4,200",
        "Ruler: [[Captain Ash]]",
        "```",
      ),
    );
    expect(parseInfoboxBody(fenceBody(serializeInfobox(parsed)))).toEqual(parsed);
  });
});

// ─── Insertion ────────────────────────────────────────────────────────────────
//
// The two tests that run a real editor: `/infobox` is the one way a panel is
// created, and a panel the GM copies inside the editor travels as HTML rather than
// as markdown — the one path an attribute that only *writes* itself would lose.

describe("/infobox", () => {
  function editor(content = "<p></p>"): Editor {
    return new Editor({ extensions: noteExtensions(), content });
  }

  it("inserts a panel with an empty title and somewhere to type", () => {
    const ed = editor();
    try {
      filterCommands("infobox")[0].command(ed, { from: 1, to: 1 });

      const panel = ed.getJSON().content?.[0];
      expect(panel?.type).toBe("infoboxBlock");
      expect(panel?.attrs).toEqual(blankInfobox());
      // Nothing typed yet, so the fence the GM's file would receive is empty.
      expect(ed.getMarkdown().trimEnd()).toBe("```infobox\n```");
    } finally {
      ed.destroy();
    }
  });

  it("lets a note hold more than one panel", () => {
    const ed = editor();
    try {
      ed.commands.setContent([
        { type: "infoboxBlock", attrs: blankInfobox() },
        { type: "paragraph", content: [{ type: "text", text: "Prose between." }] },
        { type: "infoboxBlock", attrs: blankInfobox() },
      ]);

      expect(ed.getJSON().content?.filter((n) => n.type === "infoboxBlock")).toHaveLength(2);
      expect(ed.getMarkdown().split("```infobox")).toHaveLength(3);
    } finally {
      ed.destroy();
    }
  });

  it("keeps its title, thumbnail and rows when the panel is copied inside the editor", () => {
    const source = editor();
    let html = "";
    try {
      source.commands.insertContent({
        type: "infoboxBlock",
        attrs: record({
          title: "Harbor's End",
          image: "images/harbor.png",
          imageAlt: "The harbour at dusk",
          rows: [{ label: "Population", value: "4,200" }],
        }),
      });
      html = source.getHTML();
    } finally {
      source.destroy();
    }

    const pasted = editor(html);
    try {
      const panel = pasted.getJSON().content?.find((n) => n.type === "infoboxBlock");
      expect(panel?.attrs?.title).toBe("Harbor's End");
      expect(panel?.attrs?.image).toBe("images/harbor.png");
      expect(panel?.attrs?.imageAlt).toBe("The harbour at dusk");
      expect(panel?.attrs?.rows).toEqual([{ label: "Population", value: "4,200" }]);
    } finally {
      pasted.destroy();
    }
  });
});

/** The body inside a serialized fence — what the markdown reader hands back. */
function fenceBody(fence: string): string {
  const lines = fence.split("\n");
  expect(lines[0]).toBe("```infobox");
  expect(lines[lines.length - 1]).toBe("```");
  return lines.slice(1, -1).join("\n");
}
