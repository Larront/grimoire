// Blocks declare themselves to the markdown reader (#174).
//
// The seam under test is text in, document out, and text back out again — the
// markdown reader built from the note editor's real extension list, with no
// editor view and no node views. That list is the subject as much as the blocks
// are: the reader tries a token's handlers in registration order, and StarterKit's
// code block claims every fence, so the order in note-extensions.ts is what makes
// a block's claim reachable at all.
//
// Round-trip assertions are byte-for-byte on purpose (ADR-0016 §2 rule 3):
// getMarkdown() rewrites the whole document on every autosave, so a block whose
// parse and serialize disagree corrupts a GM's note with no user action.
import { describe, it, expect } from "vitest";
import { MarkdownManager } from "@tiptap/markdown";
import { noteExtensions } from "$lib/editor/note-extensions";
import { parseFrontmatter } from "$lib/utils";
import type { JSONContent } from "@tiptap/core";

// ─── Harness ──────────────────────────────────────────────────────────────────

const manager = new MarkdownManager({ extensions: noteExtensions() });

/** The document a note's markdown reads as. */
function read(markdown: string): JSONContent {
  return manager.parse(markdown);
}

/** That document written back out as markdown. */
function write(doc: JSONContent): string {
  return manager.serialize(doc);
}

/** A note's markdown through the editor and back — what an autosave does. */
function roundTrip(markdown: string): string {
  return write(read(markdown));
}

/** Every node of a type anywhere in a document, at any nesting depth. */
function nodesOfType(doc: JSONContent, type: string): JSONContent[] {
  const found: JSONContent[] = [];
  const walk = (node: JSONContent) => {
    if (node.type === type) found.push(node);
    node.content?.forEach(walk);
  };
  walk(doc);
  return found;
}

/** The one node of a type a document is expected to hold. */
function onlyNode(doc: JSONContent, type: string): JSONContent {
  const found = nodesOfType(doc, type);
  expect(found).toHaveLength(1);
  return found[0];
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

describe("Timeline claims its fence", () => {
  it("reads a timeline fence as a timeline block", () => {
    const doc = read("```timeline\nDate: 3rd of Frostfall\nTitle: The Shattering\n```");

    expect(onlyNode(doc, "timelineBlock").attrs?.events).toEqual([
      { date: "3rd of Frostfall", title: "The Shattering", description: "" },
    ]);
    expect(nodesOfType(doc, "codeBlock")).toHaveLength(0);
  });

  it("round-trips a timeline fence byte for byte", () => {
    const md = "```timeline\nDate: 3rd of Frostfall\nTitle: The Shattering\nThe council voted.\n```";
    expect(roundTrip(md)).toBe(md);
  });

  it("reads two timeline fences in one note", () => {
    const md = [
      "Some prose.",
      "",
      "```timeline\nTitle: Alpha\n```",
      "",
      "More prose.",
      "",
      "```timeline\nTitle: Beta\n```",
    ].join("\n");

    expect(nodesOfType(read(md), "timelineBlock")).toHaveLength(2);
    expect(roundTrip(md)).toBe(md);
  });
});

// ─── Infobox ──────────────────────────────────────────────────────────────────
//
// The format itself is pinned by infobox-block.test.ts. What only this seam can show
// is the fence being *claimed* — read as a panel rather than as a grey code box —
// including inside a Callout, which is where #158's column-zero scan failed.

describe("Infobox claims its fence", () => {
  const PANEL = [
    "```infobox",
    "# Harbor's End",
    "Population: 4,200",
    "Ruler: [[Captain Ash]]",
    "Founded: 812 AR",
    "```",
  ].join("\n");

  it("reads an infobox fence as an infobox block", () => {
    const doc = read(PANEL);
    const panel = onlyNode(doc, "infoboxBlock");

    expect(panel.attrs?.title).toBe("Harbor's End");
    expect(panel.attrs?.rows).toEqual([
      { label: "Population", value: "4,200" },
      { label: "Ruler", value: "[[Captain Ash]]" },
      { label: "Founded", value: "812 AR" },
    ]);
    expect(nodesOfType(doc, "codeBlock")).toHaveLength(0);
  });

  it("round-trips an infobox fence byte for byte", () => {
    expect(roundTrip(PANEL)).toBe(PANEL);
  });

  it("keeps a wikilink in a row value as the characters the GM typed", () => {
    // The link extractor is a fence-blind raw scan, so this is already a real link in
    // the Link Index, Backlinks and the graph (ADR-0016 §2). What must not happen is
    // the editor lifting it into a node and losing the `[[…]]` on the next autosave.
    expect(nodesOfType(read(PANEL), "wikiLink")).toHaveLength(0);
    expect(roundTrip(PANEL)).toContain("Ruler: [[Captain Ash]]");
  });

  it("reads two infoboxes in one note", () => {
    const md = [
      "Some prose.",
      "",
      "```infobox\n# Harbor's End\nPopulation: 4,200\n```",
      "",
      "More prose.",
      "",
      "```infobox\n# The Ember Keep\nGarrison: 40\n```",
    ].join("\n");

    expect(nodesOfType(read(md), "infoboxBlock")).toHaveLength(2);
    expect(roundTrip(md)).toBe(md);
  });

  it("reads an infobox fence nested inside a callout", () => {
    const md = "> [!note] The Bay\n> ```infobox\n> Population: 4,200\n> ```";
    const quote = onlyNode(read(md), "blockquote");

    expect(nodesOfType(quote, "infoboxBlock")).toHaveLength(1);
    expect(nodesOfType(read(md), "codeBlock")).toHaveLength(0);
    expect(roundTrip(md)).toBe(md);
  });

  it.each([
    ["a panel with no title", "```infobox\nPopulation: 4,200\n```"],
    ["an empty panel", "```infobox\n```"],
    ["a title and no rows", "```infobox\n# Harbor's End\n```"],
    ["a row labelled Image", "```infobox\nImage: a woodcut of the harbour\n```"],
    ["a value holding a colon", "```infobox\nRuler: Ash, styled: the Grey\n```"],
    ["a title holding a colon", "```infobox\n# Harbor's End: the docks\n```"],
    ["an unlabelled row", "```infobox\n![The harbour](images/harbor.png)\n```"],
    ["a shielded title-shaped row", "```infobox\n#\n# The docks\n```"],
  ])("round-trips %s byte for byte", (_what, md) => {
    expect(roundTrip(md)).toBe(md);
  });

  it("drops the blank lines a GM used as decoration and nothing else", () => {
    // Blank lines inside the fence are decoration: they are not re-emitted, which is
    // the same reason a load-and-save cannot grow one either.
    const md = "```infobox\n# Harbor's End\n\nPopulation: 4,200\n```";

    expect(roundTrip(md)).toBe("```infobox\n# Harbor's End\nPopulation: 4,200\n```");
  });

  it("neither reads frontmatter into its rows nor writes it from them", () => {
    // Independent by doctrine (#175): frontmatter holds what the tool consumes, an
    // Infobox holds what the reader sees. No promotion either direction — which the
    // seam makes structural, because frontmatter is split off before the editor sees
    // a byte of the note and foreign keys never come near a row.
    const raw = [
      "---",
      "tags: [location]",
      "aliases: [The Harbour]",
      "---",
      "```infobox",
      "Population: 4,200",
      "```",
    ].join("\n");
    const { body } = parseFrontmatter(raw);

    expect(onlyNode(read(body), "infoboxBlock").attrs?.rows).toEqual([
      { label: "Population", value: "4,200" },
    ]);
    expect(roundTrip(body)).toBe(body);
    expect(raw.slice(0, raw.length - body.length)).toBe(
      "---\ntags: [location]\naliases: [The Harbour]\n---\n",
    );
  });

  it("declines a fence whose info string carries more than the block's name", () => {
    const md = "```infobox wide\nPopulation: 4,200\n```";

    expect(nodesOfType(read(md), "infoboxBlock")).toHaveLength(0);
    expect(nodesOfType(read(md), "codeBlock")).toHaveLength(1);
    expect(roundTrip(md)).toBe(md);
  });
});

// ─── Callout ──────────────────────────────────────────────────────────────────
//
// Callout is not a new node: it is the ordinary blockquote carrying an optional
// type and title (#180). So every assertion here is about `blockquote` — what
// makes one a callout is the attributes, and a quote with neither *is* a quote.

describe("Callout is a blockquote with a type", () => {
  it("reads a header line as a type and a title", () => {
    const md = "> [!warning] The bridge is out\n> The eastern crossing collapsed last winter.";
    const quote = onlyNode(read(md), "blockquote");

    expect(quote.attrs?.calloutType).toBe("warning");
    expect(quote.attrs?.calloutTitle).toBe("The bridge is out");
    expect(quote.attrs?.foldMarker).toBe(null);
  });

  it("keeps the header out of the body", () => {
    const md = "> [!warning] The bridge is out\n> The eastern crossing collapsed last winter.";
    const quote = onlyNode(read(md), "blockquote");

    expect(quote.content).toHaveLength(1);
    expect(quote.content?.[0].content?.[0].text).toBe(
      "The eastern crossing collapsed last winter.",
    );
  });

  it("reads a header with no title", () => {
    const quote = onlyNode(read("> [!warning]\n> Mind the gap."), "blockquote");

    expect(quote.attrs?.calloutType).toBe("warning");
    expect(quote.attrs?.calloutTitle).toBe(null);
  });

  it("reads a title-only callout, giving its empty body somewhere to type", () => {
    const quote = onlyNode(read("> [!warning] The bridge is out"), "blockquote");

    expect(quote.attrs?.calloutTitle).toBe("The bridge is out");
    expect(quote.content).toEqual([{ type: "paragraph", content: [] }]);
  });

  it("leaves a quote with no header an ordinary quote", () => {
    const quote = onlyNode(read("> Just a quotation."), "blockquote");

    expect(quote.attrs?.calloutType).toBe(null);
    expect(quote.attrs?.calloutTitle).toBe(null);
  });

  // The vocabulary is open — a type is a word the GM typed, styled if Grimoire
  // recognises it and neutrally if not. Nothing here validates or substitutes.
  it("reads an unrecognised type as itself, not as a default", () => {
    const quote = onlyNode(read("> [!prophecy] The Ashen King returns"), "blockquote");

    expect(quote.attrs?.calloutType).toBe("prophecy");
    expect(quote.attrs?.calloutTitle).toBe("The Ashen King returns");
  });

  it("keeps the GM's casing of the type word", () => {
    expect(onlyNode(read("> [!WaRnInG] Careful"), "blockquote").attrs?.calloutType).toBe(
      "WaRnInG",
    );
  });

  it("reads a fold marker without acting on the file", () => {
    const quote = onlyNode(read("> [!warning]- The bridge is out\n> Mind the gap."), "blockquote");

    expect(quote.attrs?.foldMarker).toBe("-");
    expect(quote.attrs?.calloutTitle).toBe("The bridge is out");
  });

  it("leaves a bracketed phrase in a quote as prose", () => {
    // A type is one word. `[!not a type]` is text a GM typed, and stays text.
    const quote = onlyNode(read("> [!not a type] hello"), "blockquote");

    expect(quote.attrs?.calloutType).toBe(null);
  });

  it("leaves a title welded to the marker as prose", () => {
    // A line is a header only if Grimoire would write it back exactly. Claiming
    // `[!note]Body` would insert the missing space on the next autosave.
    const quote = onlyNode(read("> [!note]Body inline"), "blockquote");

    expect(quote.attrs?.calloutType).toBe(null);
  });

  it("leaves a header line further down a quote as prose", () => {
    const quote = onlyNode(read("> Some prose.\n> [!warning] not a header"), "blockquote");

    expect(quote.attrs?.calloutType).toBe(null);
  });

  it("leaves a header line with no quote around it as the paragraph it is", () => {
    // Nothing is banned, because a ban has nowhere to bite: the file is the
    // store, so a construct Grimoire did not expect must survive being read.
    const doc = read("[!warning] The bridge is out");

    expect(nodesOfType(doc, "blockquote")).toHaveLength(0);
    expect(onlyNode(doc, "paragraph").content?.[0].text).toBe("[!warning] The bridge is out");
  });
});

describe("Callout round-trips byte for byte", () => {
  it.each([
    ["a title", "> [!warning] The bridge is out\n> The eastern crossing collapsed last winter."],
    ["no title", "> [!warning]\n> Mind the gap."],
    ["an empty body", "> [!warning]"],
    ["a title-only callout", "> [!warning] The bridge is out"],
    ["an unrecognised type", "> [!prophecy] The Ashen King returns\n> Three moons, then ash."],
    ["mixed casing", "> [!WaRnInG] Careful\n> Mind the gap."],
    ["a fold marker", "> [!warning]- The bridge is out\n> Mind the gap."],
    ["a fold marker and no title", "> [!warning]-\n> Mind the gap."],
    ["an open fold marker", "> [!warning]+ The bridge is out\n> Mind the gap."],
    ["a hyphenated type", "> [!read-aloud] The Ember Gate\n> The doors stand open."],
    ["an ordinary quote", "> Just a quotation."],
    ["a header line outside a quote", "[!warning] The bridge is out"],
    // A blank line under the header is the GM's, and a load-and-save that grew
    // one every time would rewrite their file with no user action.
    ["a blank line under the header", "> [!note] The Ledger\n>\n> Signed in ash."],
    ["a blank line and several blocks", "> [!note] The Ledger\n>\n> One.\n>\n> Two."],
    // Lines Grimoire could not write back exactly, and so does not claim.
    ["a title welded to the marker", "> [!note]Body inline"],
    ["a title with trailing spaces", "> [!note] Trailing  "],
    ["a marker with a lone trailing space", "> [!note] "],
  ])("round-trips %s", (_what, md) => {
    expect(roundTrip(md)).toBe(md);
  });

  it("round-trips two callouts and a quote in one note", () => {
    const md = [
      "> [!warning] The bridge is out",
      "> Mind the gap.",
      "",
      "Some prose.",
      "",
      "> Just a quotation.",
      "",
      "> [!encounter] The Ambush",
      "> Four goblins.",
    ].join("\n");

    expect(nodesOfType(read(md), "blockquote")).toHaveLength(3);
    expect(roundTrip(md)).toBe(md);
  });
});

// Nothing is banned inside a callout, because markdown permits any block inside
// a `>` and the file is the store — a banned construct is never *prevented*,
// only met on load, where flatten, drop and refuse are all silent corruption.

describe("a callout holds arbitrary block content", () => {
  const CASES: [string, string][] = [
    [
      "two paragraphs",
      "> [!note] The Ledger\n> First thought.\n>\n> Second thought.",
    ],
    [
      "a bullet list",
      "> [!encounter] The Ambush\n> Four goblins:\n>\n> - one with a sling\n> - three with knives",
    ],
    [
      "a heading",
      "> [!note] The Ledger\n> ## The terms\n>\n> Signed in ash.",
    ],
    [
      "a timeline fence",
      "> [!encounter] The Ambush\n> ```timeline\n> Title: Goblins strike\n> ```",
    ],
    [
      "a timeline fence under a blank line",
      "> [!encounter] The Ambush\n>\n> ```timeline\n> Title: Goblins strike\n> ```",
    ],
    [
      "a python fence",
      "> [!note] The Ledger\n> ```python\n> print('hello')\n> ```",
    ],
    [
      "a nested callout",
      "> [!note] The Ledger\n> > [!warning] The bridge is out\n> > Mind the gap.",
    ],
    [
      "a nested ordinary quote",
      "> [!note] The Ledger\n> > Someone else said it first.",
    ],
    [
      "a wikilink",
      "> [!read-aloud] The Ember Gate\n> The road runs on to [[Blackreach]].",
    ],
    [
      "an aligned image",
      "> [!read-aloud] The Ember Gate\n> ![portrait](images/a.png){align=left width=60%}",
    ],
    [
      "a horizontal rule",
      "> [!note] The Ledger\n> Before.\n>\n> ---\n>\n> After.",
    ],
  ];

  it.each(CASES)("round-trips %s unchanged", (_what, md) => {
    expect(roundTrip(md)).toBe(md);
  });

  it("rejects, flattens and drops nothing", () => {
    // Read as one document so a block that survives its own case but eats a
    // neighbour's bytes has nowhere to hide.
    const md = CASES.map(([, m]) => m).join("\n\n");

    expect(roundTrip(md)).toBe(md);
  });

  it("keeps a nested block's own identity", () => {
    const quote = onlyNode(
      read("> [!encounter] The Ambush\n> ```timeline\n> Title: Goblins strike\n> ```"),
      "blockquote",
    );

    expect(quote.attrs?.calloutType).toBe("encounter");
    expect(nodesOfType(quote, "timelineBlock")).toHaveLength(1);
  });

  it("keeps an inner callout's type distinct from its outer one", () => {
    const quotes = nodesOfType(
      read("> [!note] The Ledger\n> > [!warning] The bridge is out\n> > Mind the gap."),
      "blockquote",
    );

    expect(quotes.map((q) => q.attrs?.calloutType)).toEqual(["note", "warning"]);
  });
});

// ─── Depth blindness ──────────────────────────────────────────────────────────
//
// The reason this ticket exists (#158): the scan it replaces only ever matched at
// column zero, so a fence indented inside a blockquote — which is how a GM will
// group a fight once Callout ships — rendered as a dead grey code box.

describe("a claim is depth-blind", () => {
  const NESTED_TIMELINE = "> The Ambush\n>\n> ```timeline\n> Title: Goblins strike\n> ```";
  const NESTED_SCENE =
    '> The Ambush\n>\n> <scene-block data-id="7" data-expanded="false"></scene-block>';
  const NESTED_IMAGE = "> Read aloud:\n>\n> ![portrait](images/a.png){align=left width=60%}";

  it("reads a timeline fence nested inside a blockquote", () => {
    const doc = read(NESTED_TIMELINE);

    const quote = onlyNode(doc, "blockquote");
    expect(nodesOfType(quote, "timelineBlock")).toHaveLength(1);
    expect(nodesOfType(quote, "timelineBlock")[0].attrs?.events).toEqual([
      { date: "", title: "Goblins strike", description: "" },
    ]);
    expect(nodesOfType(doc, "codeBlock")).toHaveLength(0);
  });

  it("reads a scene reference nested inside a blockquote", () => {
    const doc = read(NESTED_SCENE);

    const quote = onlyNode(doc, "blockquote");
    expect(nodesOfType(quote, "sceneBlock")).toHaveLength(1);
    expect(nodesOfType(quote, "sceneBlock")[0].attrs?.sceneId).toBe(7);
  });

  it("reads an aligned image nested inside a blockquote", () => {
    const doc = read(NESTED_IMAGE);

    const image = onlyNode(doc, "image");
    expect(image.attrs?.align).toBe("left");
    expect(image.attrs?.width).toBe("60%");
  });

  // Being read is half the requirement: a nested block that renders correctly and
  // then rewrites its own blockquote on save would still corrupt the note.
  it.each([
    ["timeline fence", NESTED_TIMELINE],
    ["scene reference", NESTED_SCENE],
    ["aligned image", NESTED_IMAGE],
  ])("round-trips a nested %s byte for byte", (_what, md) => {
    expect(roundTrip(md)).toBe(md);
  });
});

// ─── Declining ────────────────────────────────────────────────────────────────

describe("a block declines what is not its own", () => {
  it("leaves a python fence an ordinary code block", () => {
    const doc = read("```python\nprint('hello')\n```");

    expect(onlyNode(doc, "codeBlock").attrs?.language).toBe("python");
    expect(nodesOfType(doc, "timelineBlock")).toHaveLength(0);
  });

  it("leaves a fence with no language an ordinary code block", () => {
    const doc = read("```\nplain text\n```");

    expect(nodesOfType(doc, "codeBlock")).toHaveLength(1);
    expect(nodesOfType(doc, "timelineBlock")).toHaveLength(0);
  });

  it("round-trips a python fence byte for byte", () => {
    const md = "```python\nprint('hello')\n```";
    expect(roundTrip(md)).toBe(md);
  });

  it("declines a fence whose info string carries more than the block's name", () => {
    // Claiming this and re-emitting ```timeline alone would delete the rest of the
    // GM's info string on the next autosave. Declining keeps every byte.
    const md = "```timeline extra\nTitle: Goblins strike\n```";

    expect(nodesOfType(read(md), "timelineBlock")).toHaveLength(0);
    expect(nodesOfType(read(md), "codeBlock")).toHaveLength(1);
    expect(roundTrip(md)).toBe(md);
  });

  it("leaves a wikilink typed inside a fence as fence text", () => {
    // The link extractor is a fence-blind raw scan, so this is already a real
    // link in the index (ADR-0016 §2). What must not happen is the editor
    // rewriting it into a node and losing the characters the GM typed.
    const md = "```python\nprint('[[Blackreach]]')\n```";

    expect(nodesOfType(read(md), "wikiLink")).toHaveLength(0);
    expect(roundTrip(md)).toBe(md);
  });

  it("leaves HTML that is not a scene block alone", () => {
    const doc = read('<div class="note">Hand-written HTML</div>');
    expect(nodesOfType(doc, "sceneBlock")).toHaveLength(0);
  });
});

// ─── Image ────────────────────────────────────────────────────────────────────
//
// Image's syntax is not a fence, so its declaration is a tokenizer rather than a
// fence claim — the alignment suffix is one token with the image it belongs to.
// Its on-disk form is unchanged by this ticket, including the suffix.

describe("Image declares its alignment suffix", () => {
  it("reads align and width off the suffix", () => {
    const image = onlyNode(read("![portrait](images/a.png){align=left width=60%}"), "image");

    expect(image.attrs?.src).toBe("images/a.png");
    expect(image.attrs?.alt).toBe("portrait");
    expect(image.attrs?.align).toBe("left");
    expect(image.attrs?.width).toBe("60%");
  });

  it("reads an alt text holding brackets, parens and quotes", () => {
    const image = onlyNode(read(`!["ancient" café (portrait)](images/a.png){width=80%}`), "image");

    expect(image.attrs?.alt).toBe(`"ancient" café (portrait)`);
    expect(image.attrs?.width).toBe("80%");
  });

  it("reads a src holding spaces, which a copied image's filename may", () => {
    const md = "![](.grimoire/images/my map.png){align=left}";
    const image = onlyNode(read(md), "image");

    expect(image.attrs?.src).toBe(".grimoire/images/my map.png");
    expect(image.attrs?.align).toBe("left");
    expect(roundTrip(md)).toBe(md);
  });

  it("reads a plain image as centred and full width", () => {
    const image = onlyNode(read("![portrait](images/a.png)"), "image");

    expect(image.attrs?.align).toBe("center");
    expect(image.attrs?.width).toBe("100%");
  });

  it.each([
    "![portrait](images/a.png)",
    "![](images/a.png)",
    "![portrait](images/a.png){align=left}",
    "![portrait](images/a.png){width=50%}",
    "![portrait](images/a.png){align=right width=75%}",
    "![人物の肖像](images/a.png){width=80%}",
    "![café (portrait)](images/a.png){width=80%}",
  ])("round-trips %s byte for byte", (md) => {
    expect(roundTrip(md)).toBe(md);
  });

  it("leaves an empty suffix alone rather than eating it", () => {
    const md = "![portrait](images/a.png){}";
    expect(roundTrip(md)).toBe(md);
  });

  it("keeps an image transclusion as text, not an image", () => {
    // `![[...]]` is Obsidian's embed syntax, which Grimoire does not render.
    const md = "![[ImagePlaceholder.png|cover hsmall]]";

    expect(nodesOfType(read(md), "image")).toHaveLength(0);
    expect(nodesOfType(read(md), "wikiLink")).toHaveLength(0);
    expect(roundTrip(md)).toBe(md);
  });
});

// ─── Scene ────────────────────────────────────────────────────────────────────
//
// Scene's on-disk form is still the `<scene-block>` tag — the ```scene fence
// carrying id and name is the vault migration's business, behind the format
// version stamp. What changes here is that Scene *claims* that tag rather than
// leaning on the reader's generic HTML fallback.

describe("Scene claims its tag", () => {
  it("reads the tag as a scene block", () => {
    const doc = read('<scene-block data-id="7" data-expanded="false"></scene-block>');

    expect(onlyNode(doc, "sceneBlock").attrs?.sceneId).toBe(7);
  });

  it("reads a tag with no id as a scene block bound to nothing", () => {
    const doc = read('<scene-block data-id="" data-expanded="false"></scene-block>');

    expect(onlyNode(doc, "sceneBlock").attrs?.sceneId).toBe(null);
  });

  it("reads a hand-written self-closing tag", () => {
    const doc = read('<scene-block data-id="7" />');

    expect(onlyNode(doc, "sceneBlock").attrs?.sceneId).toBe(7);
  });

  it("round-trips the tag byte for byte", () => {
    const md = '<scene-block data-id="7" data-expanded="false"></scene-block>';
    expect(roundTrip(md)).toBe(md);
  });
});

// ─── Wikilinks ────────────────────────────────────────────────────────────────
//
// Not a block, but the third of the three hand-rolled preprocessors this ticket
// deletes, and the one whose raw-text pass could reach inside a fence.

describe("WikiLink declares itself", () => {
  it("reads a wikilink in prose", () => {
    const link = onlyNode(read("See [[Blackreach]] now"), "wikiLink");

    expect(link.attrs?.path).toBe("Blackreach");
    expect(link.attrs?.title).toBe("Blackreach");
  });

  it("reads a nested path's title as its stem", () => {
    const link = onlyNode(read("[[Places/Blackreach.md]]"), "wikiLink");

    expect(link.attrs?.path).toBe("Places/Blackreach.md");
    expect(link.attrs?.title).toBe("Blackreach");
  });

  it("reads a wikilink's alias, keeping the pipe out of the path", () => {
    const link = onlyNode(read("See [[Locations/The Ember Keep.md|the keep]]"), "wikiLink");

    expect(link.attrs?.path).toBe("Locations/The Ember Keep.md");
    expect(link.attrs?.title).toBe("the keep");
  });

  it("reads two wikilinks in one paragraph", () => {
    const links = nodesOfType(read("[[Alpha]] and [[Beta/Note.md|B]]"), "wikiLink");

    expect(links.map((l) => l.attrs?.path)).toEqual(["Alpha", "Beta/Note.md"]);
    expect(links.map((l) => l.attrs?.title)).toEqual(["Alpha", "B"]);
  });

  it("reads a link next to a transclusion without touching the transclusion", () => {
    const md = "![[banner.png]] then [[Real Note]]";
    const links = nodesOfType(read(md), "wikiLink");

    expect(links).toHaveLength(1);
    expect(links[0].attrs?.path).toBe("Real Note");
    expect(roundTrip(md)).toBe(md);
  });

  it.each([
    "See [[Blackreach]] now",
    "[[Places/Blackreach.md]]",
    "[[Locations/The Ember Keep.md|the keep]]",
    "[[Alpha]] and [[Beta/Note.md|B]]",
  ])("round-trips %s byte for byte", (md) => {
    expect(roundTrip(md)).toBe(md);
  });

  it.each([
    ["a blockquote", "> See [[Blackreach]]"],
    ["a heading", "## The road to [[Blackreach]]"],
    ["a list item", "- travel to [[Blackreach]]"],
  ])("reads a wikilink nested inside %s", (_where, md) => {
    expect(nodesOfType(read(md), "wikiLink")).toHaveLength(1);
  });

  it("leaves a wikilink inside inline code as code", () => {
    const md = "type `[[Blackreach]]` to link";

    expect(nodesOfType(read(md), "wikiLink")).toHaveLength(0);
    expect(roundTrip(md)).toBe(md);
  });

  it("leaves unclosed brackets as the text they are", () => {
    const md = "See [[Blackreach and nothing else";

    expect(nodesOfType(read(md), "wikiLink")).toHaveLength(0);
    expect(roundTrip(md)).toBe(md);
  });
});
