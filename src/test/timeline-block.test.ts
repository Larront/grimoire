import { describe, it, expect } from "vitest";
// Event order is no longer this block's business — it moved to the Row List
// (#173), and its arithmetic is tested in row-list.test.ts with Timeline's use of
// it in timeline-row-list.test.ts. What is left here is the fence format.
import {
  parseTimelineBody,
  serializeTimelineEvents,
  createBlankEvent,
  renderTimelineText,
  TimelineBlock,
  type TimelineEvent,
} from "$lib/editor/timeline-block";

// ─── parseTimelineBody ────────────────────────────────────────────────────────
//
// The grammar these exercise is the migrated one (#184): an event begins at a
// column-zero `#` heading carrying its title, then an optional `Date:` line,
// then free description prose in which blank lines are legal. The old grammar's
// `Title:` line and blank-line record boundary are gone — a blank line inside a
// description used to start a second, untitled event on the next autosave, which
// is the corruption this format change exists to fix.

describe("parseTimelineBody", () => {
  it("title only — minimal valid record", () => {
    expect(parseTimelineBody("# The Shattering")).toEqual([
      { date: "", title: "The Shattering", description: "" },
    ]);
  });

  it("title + date", () => {
    expect(parseTimelineBody("# The Shattering\nDate: 3rd of Frostfall")).toEqual([
      { date: "3rd of Frostfall", title: "The Shattering", description: "" },
    ]);
  });

  it("title + single description line", () => {
    expect(parseTimelineBody("# The Shattering\n\nThe council voted.")).toEqual([
      { date: "", title: "The Shattering", description: "The council voted." },
    ]);
  });

  it("all fields — title, date, multi-line description", () => {
    const body = "# The Shattering\nDate: 3rd of Frostfall\n\nThe council voted.\nIt began the war.";
    expect(parseTimelineBody(body)).toEqual([
      {
        date: "3rd of Frostfall",
        title: "The Shattering",
        description: "The council voted.\nIt began the war.",
      },
    ]);
  });

  it("a blank line inside a description is description, not a record boundary", () => {
    // The bug the grammar change fixes, at the parser: two paragraphs, one event.
    const body = "# The Shattering\n\nThe council voted.\n\nThe war began that winter.";
    expect(parseTimelineBody(body)).toEqual([
      {
        date: "",
        title: "The Shattering",
        description: "The council voted.\n\nThe war began that winter.",
      },
    ]);
  });

  it("two events — the next heading ends the previous event", () => {
    const body = "# The Shattering\nDate: 3rd of Frostfall\n\n# Siege of Highvale\nDate: Midwinter";
    expect(parseTimelineBody(body)).toEqual([
      { date: "3rd of Frostfall", title: "The Shattering", description: "" },
      { date: "Midwinter", title: "Siege of Highvale", description: "" },
    ]);
  });

  it("three events, mixed optional fields", () => {
    const body = [
      "# Alpha",
      "",
      "# Beta",
      "Date: Year 2",
      "",
      "Some notes.",
      "",
      "# Gamma",
      "",
      "Final event.",
    ].join("\n");
    expect(parseTimelineBody(body)).toEqual([
      { date: "", title: "Alpha", description: "" },
      { date: "Year 2", title: "Beta", description: "Some notes." },
      { date: "", title: "Gamma", description: "Final event." },
    ]);
  });

  it("colons in date value — only the first colon delimits the label", () => {
    expect(parseTimelineBody("# The Pact\nDate: Year 812: dawn")).toEqual([
      { date: "Year 812: dawn", title: "The Pact", description: "" },
    ]);
  });

  it("pipes in title are preserved verbatim", () => {
    expect(parseTimelineBody("# [[path|display]] text")).toEqual([
      { date: "", title: "[[path|display]] text", description: "" },
    ]);
  });

  it("wikilinks in title and date survive", () => {
    expect(
      parseTimelineBody("# [[The Shattering]]\nDate: [[Calendar#Frostfall]]"),
    ).toEqual([
      { date: "[[Calendar#Frostfall]]", title: "[[The Shattering]]", description: "" },
    ]);
  });

  it("empty body returns empty array", () => {
    expect(parseTimelineBody("")).toEqual([]);
    expect(parseTimelineBody("   ")).toEqual([]);
  });

  it("an empty heading is an untitled event, not a dropped one", () => {
    // What a freshly inserted, still-blank event serializes to.
    expect(parseTimelineBody("# ")).toEqual([{ date: "", title: "", description: "" }]);
    expect(parseTimelineBody("#")).toEqual([{ date: "", title: "", description: "" }]);
  });

  it("`#hashtag` at column zero is not a heading", () => {
    // No space after the `#`, so it is not a markdown heading either. Without a
    // heading above it there is no event for it to belong to.
    expect(parseTimelineBody("#hashtag")).toEqual([]);
  });

  it("a Date: line that is not the first line after the heading is description", () => {
    const body = "# Alpha\n\nDate: not a date field\n # also description";
    expect(parseTimelineBody(body)).toEqual([
      {
        date: "",
        title: "Alpha",
        description: "Date: not a date field\n # also description",
      },
    ]);
  });

  it("a description beginning with a Date: line is not read as the date", () => {
    // The serializer's blank line between header and description is what makes
    // this unambiguous: `Date:` counts only immediately under the heading.
    const result = parseTimelineBody("# Alpha\n\nDate: only a description line");
    expect(result).toEqual([
      { date: "", title: "Alpha", description: "Date: only a description line" },
    ]);
  });

  it("prose before the first heading belongs to no event", () => {
    expect(parseTimelineBody("stray text\n\n# Alpha")).toEqual([
      { date: "", title: "Alpha", description: "" },
    ]);
  });

  it("a description with no blank line under the heading is still read", () => {
    // Hand-authored in Obsidian without the separating blank line. Read
    // forgivingly; the next save writes it back in the canonical shape.
    expect(parseTimelineBody("# Alpha\nThe council voted.")).toEqual([
      { date: "", title: "Alpha", description: "The council voted." },
    ]);
    expect(parseTimelineBody("# Alpha\nDate: Year 1\nThe council voted.")).toEqual([
      { date: "Year 1", title: "Alpha", description: "The council voted." },
    ]);
  });
});

// ─── serializeTimelineEvents ──────────────────────────────────────────────────

describe("serializeTimelineEvents", () => {
  it("single event — title only", () => {
    const events: TimelineEvent[] = [{ date: "", title: "The Shattering", description: "" }];
    expect(serializeTimelineEvents(events)).toBe("```timeline\n# The Shattering\n```");
  });

  it("single event — title + date", () => {
    const events: TimelineEvent[] = [
      { date: "3rd of Frostfall", title: "The Shattering", description: "" },
    ];
    expect(serializeTimelineEvents(events)).toBe(
      "```timeline\n# The Shattering\nDate: 3rd of Frostfall\n```",
    );
  });

  it("single event — title + description, separated by a blank line", () => {
    const events: TimelineEvent[] = [
      { date: "", title: "The Shattering", description: "The council voted." },
    ];
    expect(serializeTimelineEvents(events)).toBe(
      "```timeline\n# The Shattering\n\nThe council voted.\n```",
    );
  });

  it("single event — all fields", () => {
    const events: TimelineEvent[] = [
      {
        date: "3rd of Frostfall",
        title: "The Shattering",
        description: "The council voted.\nIt began the war.",
      },
    ];
    expect(serializeTimelineEvents(events)).toBe(
      "```timeline\n# The Shattering\nDate: 3rd of Frostfall\n\nThe council voted.\nIt began the war.\n```",
    );
  });

  it("a multi-paragraph description is written as written", () => {
    const events: TimelineEvent[] = [
      { date: "", title: "The Shattering", description: "One.\n\nTwo." },
    ];
    expect(serializeTimelineEvents(events)).toBe(
      "```timeline\n# The Shattering\n\nOne.\n\nTwo.\n```",
    );
  });

  it("two events — blank line between records", () => {
    const events: TimelineEvent[] = [
      { date: "3rd of Frostfall", title: "The Shattering", description: "" },
      { date: "Midwinter", title: "Siege of Highvale", description: "" },
    ];
    expect(serializeTimelineEvents(events)).toBe(
      "```timeline\n# The Shattering\nDate: 3rd of Frostfall\n\n# Siege of Highvale\nDate: Midwinter\n```",
    );
  });

  it("date omitted when empty string", () => {
    const events: TimelineEvent[] = [{ date: "", title: "Alpha", description: "" }];
    expect(serializeTimelineEvents(events)).not.toContain("Date:");
  });

  it("description omitted when empty string", () => {
    const events: TimelineEvent[] = [{ date: "Day 1", title: "Alpha", description: "" }];
    const output = serializeTimelineEvents(events);
    const lines = output.split("\n");
    expect(lines.filter((l) => l.trim() === "")).toHaveLength(0);
  });

  it("wikilinks in values are preserved verbatim", () => {
    const events: TimelineEvent[] = [
      { date: "[[Calendar#Frostfall]]", title: "[[The Shattering]]", description: "" },
    ];
    const output = serializeTimelineEvents(events);
    expect(output).toContain("# [[The Shattering]]");
    expect(output).toContain("Date: [[Calendar#Frostfall]]");
  });

  it("a description line that is itself a heading is space-prefixed", () => {
    // The one place the serializer edits what the GM typed, and it has to: left
    // alone, that line would read back as the start of a new event. The [[Format
    // Migration]] applies the same rule (and warns about it) because migrating
    // *is* parsing the old grammar and serializing the new one.
    const events: TimelineEvent[] = [
      { date: "", title: "Alpha", description: "# Not a new event\nordinary line" },
    ];
    expect(serializeTimelineEvents(events)).toBe(
      "```timeline\n# Alpha\n\n # Not a new event\nordinary line\n```",
    );
  });

  it("`#hashtag` in a description is left alone", () => {
    const events: TimelineEvent[] = [
      { date: "", title: "Alpha", description: "#lore and #ashfen" },
    ];
    expect(serializeTimelineEvents(events)).toContain("\n#lore and #ashfen\n");
  });
});

// ─── Round-trip (serialize → parse) ──────────────────────────────────────────
//
// Timeline's parser is handed a fence body, because stripping the fence is the
// markdown reader's job and not this block's (ADR-0016 §3). The helper below
// stands in for that step; block-markdown.test.ts covers the real reader,
// including a fence nested inside a blockquote.

/** The body of a one-fence markdown string, as the reader would hand it over. */
function fenceBody(md: string): string {
  return md.replace(/^```timeline\n/, "").replace(/\n```$/, "");
}

describe("round-trip", () => {
  function roundTrip(events: TimelineEvent[]): TimelineEvent[] {
    return parseTimelineBody(fenceBody(serializeTimelineEvents(events)));
  }

  it("title only", () => {
    const events: TimelineEvent[] = [{ date: "", title: "Alpha", description: "" }];
    expect(roundTrip(events)).toEqual(events);
  });

  it("all fields", () => {
    const events: TimelineEvent[] = [
      { date: "3rd of Frostfall", title: "The Shattering", description: "The council voted.\nIt began the war." },
    ];
    expect(roundTrip(events)).toEqual(events);
  });

  it("multiple events", () => {
    const events: TimelineEvent[] = [
      { date: "3rd of Frostfall", title: "The Shattering", description: "" },
      { date: "", title: "Midwinter March", description: "The armies moved." },
      { date: "Midwinter", title: "Siege of Highvale", description: "" },
    ];
    expect(roundTrip(events)).toEqual(events);
  });

  it("pipes and colons in values survive", () => {
    const events: TimelineEvent[] = [
      { date: "Year 812: dawn", title: "[[path|display]] event", description: "A note: something." },
    ];
    expect(roundTrip(events)).toEqual(events);
  });

  it("wikilinks survive", () => {
    const events: TimelineEvent[] = [
      { date: "[[Calendar#Frostfall]]", title: "[[The Shattering]]", description: "See [[Highvale]]." },
    ];
    expect(roundTrip(events)).toEqual(events);
  });

  it("description lines that look like Date:/Title: labels survive", () => {
    const events: TimelineEvent[] = [
      { date: "", title: "Alpha", description: "Title: a quote\nDate: yesterday" },
      { date: "", title: "", description: "Date: starts with a label" },
    ];
    expect(roundTrip(events)).toEqual(events);
  });

  it("multi-paragraph descriptions survive — the bug this format change fixes", () => {
    // Asserted directly, and at the outermost seam that a load-and-save cycle
    // uses: two paragraphs go in, one event with two paragraphs comes back.
    const events: TimelineEvent[] = [
      {
        date: "Year 0",
        title: "The Order Takes the Keep",
        description: "They finished the walls before the first frost.\n\nThe library came later.",
      },
      { date: "Year 7", title: "The War Begins", description: "Three city-states." },
    ];
    const result = roundTrip(events);
    expect(result).toHaveLength(2);
    expect(result).toEqual(events);
  });

  it("a description of three paragraphs stays one event", () => {
    const events: TimelineEvent[] = [
      { date: "", title: "Alpha", description: "One.\n\nTwo.\n\nThree." },
    ];
    expect(roundTrip(events)).toEqual(events);
  });

  it("byte-for-byte over the whole battery: parse(serialize(x)) === x", () => {
    const battery: TimelineEvent[][] = [
      [],
      [{ date: "", title: "", description: "" }],
      [{ date: "", title: "Alpha", description: "" }],
      [{ date: "Year 1", title: "Alpha", description: "" }],
      [{ date: "", title: "Alpha", description: "One line." }],
      [{ date: "Year 1", title: "Alpha", description: "One.\n\nTwo.\n\nThree." }],
      [{ date: "Year 1: dawn", title: "[[A|B]]", description: "Title: x\nDate: y" }],
      [{ date: "", title: "  padded  ", description: "  indented line" }],
      [{ date: "", title: "Alpha", description: "#hashtag not a heading" }],
      [
        { date: "Year 1", title: "Alpha", description: "One.\n\nTwo." },
        { date: "", title: "Beta", description: "" },
        { date: "Year 3", title: "", description: "Only prose." },
      ],
    ];
    for (const events of battery) {
      expect(roundTrip(events), JSON.stringify(events)).toEqual(events);
    }
  });

  it("serialize → parse → serialize is stable (idempotent)", () => {
    const events: TimelineEvent[] = [
      { date: "3rd of Frostfall", title: "The Shattering", description: "The council voted.\n\nTwice." },
      { date: "", title: "Midwinter March", description: "" },
      // The one value the serializer normalises — so stability has to be shown
      // *through* that normalisation, not around it.
      { date: "", title: "Heading trouble", description: "# looks like an event" },
    ];
    const md1 = serializeTimelineEvents(events);
    const md2 = serializeTimelineEvents(parseTimelineBody(fenceBody(md1)));
    expect(md2).toBe(md1);
  });

  it("empty events array round-trips to empty array (empty state)", () => {
    expect(roundTrip([])).toEqual([]);
  });

  it("add event: appending to array round-trips with N+1 events", () => {
    const before: TimelineEvent[] = [{ date: "Day 1", title: "Alpha", description: "" }];
    const after = [...before, createBlankEvent()];
    const result = roundTrip(after);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(before[0]);
    expect(result[1]).toEqual(createBlankEvent());
  });

  it("delete event: removing from array round-trips with N-1 events", () => {
    const events: TimelineEvent[] = [
      { date: "Day 1", title: "Alpha", description: "" },
      { date: "Day 2", title: "Beta", description: "Notes." },
    ];
    const after = events.filter((_, i) => i !== 0);
    const result = roundTrip(after);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(events[1]);
  });

  it("edit event: mutating a field round-trips with updated value", () => {
    const events: TimelineEvent[] = [{ date: "", title: "Old title", description: "" }];
    const edited = events.map((e, i) => (i === 0 ? { ...e, title: "New title", date: "Year 1" } : e));
    const result = roundTrip(edited);
    expect(result[0].title).toBe("New title");
    expect(result[0].date).toBe("Year 1");
  });
});

// ─── Extension markdown serializer wiring ────────────────────────────────────
//
// @tiptap/markdown reads a node's serializer from the `renderMarkdown` extension
// field (via getExtensionField), NOT from `storage.markdown.serialize`. If this
// field is missing or misnamed, getMarkdown() drops the node and the timeline
// silently fails to save — vanishing on the next load.
describe("TimelineBlock renderMarkdown", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderMarkdown = (TimelineBlock.config as any).renderMarkdown as
    | ((node: { attrs: { events: TimelineEvent[] } }) => string)
    | undefined;

  it("exposes a renderMarkdown serializer (the field @tiptap/markdown reads)", () => {
    expect(typeof renderMarkdown).toBe("function");
  });

  it("serializes node attrs to the fenced timeline block", () => {
    const events: TimelineEvent[] = [
      { date: "3rd of Frostfall", title: "The Shattering", description: "The council voted." },
    ];
    expect(renderMarkdown!({ attrs: { events } })).toBe(serializeTimelineEvents(events));
  });
});

// ─── createBlankEvent ─────────────────────────────────────────────────────────

describe("createBlankEvent", () => {
  it("returns an event with all fields empty", () => {
    expect(createBlankEvent()).toEqual({ date: "", title: "", description: "" });
  });

  it("returns a new object each call (no shared reference)", () => {
    const a = createBlankEvent();
    const b = createBlankEvent();
    a.title = "mutated";
    expect(b.title).toBe("");
  });
});


// ─── renderTimelineText ───────────────────────────────────────────────────────

describe("renderTimelineText", () => {
  it("plain text passes through unchanged", () => {
    expect(renderTimelineText("The Shattering")).toBe("The Shattering");
  });

  it("empty string returns empty string", () => {
    expect(renderTimelineText("")).toBe("");
  });

  it("[[Path]] becomes a data-wiki-link span with correct data attributes", () => {
    const result = renderTimelineText("[[The Shattering]]");
    expect(result).toContain("data-wiki-link");
    expect(result).toContain('data-path="The Shattering"');
    expect(result).toContain('data-title="The Shattering"');
  });

  it("path with .md extension strips extension from display title", () => {
    const result = renderTimelineText("[[Characters/Aldric.md]]");
    expect(result).toContain('data-path="Characters/Aldric.md"');
    expect(result).toContain('data-title="Aldric"');
  });

  it("nested path — title is the last segment without extension", () => {
    const result = renderTimelineText("[[World/Events/The Shattering.md]]");
    expect(result).toContain('data-path="World/Events/The Shattering.md"');
    expect(result).toContain('data-title="The Shattering"');
  });

  it("plain text before and after link is preserved", () => {
    const result = renderTimelineText("See [[Aldric]] for details");
    expect(result).toContain("See ");
    expect(result).toContain("data-wiki-link");
    expect(result).toContain(" for details");
  });

  it("multiple links in one string produces multiple spans", () => {
    const result = renderTimelineText("[[Alpha]] and [[Beta]]");
    expect((result.match(/data-wiki-link/g) ?? []).length).toBe(2);
    expect(result).toContain('data-path="Alpha"');
    expect(result).toContain('data-path="Beta"');
  });

  it("HTML special chars in plain text segments are escaped", () => {
    const result = renderTimelineText("A <b> title & more");
    expect(result).not.toContain("<b>");
    expect(result).toContain("&lt;b&gt;");
    expect(result).toContain("&amp;");
  });

  it("pipe-separated display text uses the display alias as title", () => {
    const result = renderTimelineText("[[Characters/Aldric.md|Aldric the Great]]");
    expect(result).toContain('data-path="Characters/Aldric.md"');
    expect(result).toContain('data-title="Aldric the Great"');
    expect(result).toContain("Aldric the Great");
  });

  it("no [[...]] means no span elements", () => {
    const result = renderTimelineText("Just a plain description.");
    expect(result).not.toContain("<span");
    expect(result).not.toContain("data-wiki-link");
  });

  it("no resolver: links are never marked broken", () => {
    expect(renderTimelineText("[[Aldric]]")).not.toContain("data-broken");
  });

  it("resolver: unresolved path gets data-broken (faded-accent stub)", () => {
    const result = renderTimelineText("[[Ghost]]", () => false);
    expect(result).toContain("data-wiki-link data-broken");
    expect(result).toContain('data-path="Ghost"');
  });

  it("resolver: resolved path has no data-broken (full accent)", () => {
    const result = renderTimelineText("[[Aldric]]", () => true);
    expect(result).toContain("data-wiki-link");
    expect(result).not.toContain("data-broken");
  });

  it("resolver receives the path, not the display title", () => {
    const seen: string[] = [];
    renderTimelineText("[[Characters/Aldric.md|Aldric the Great]]", (p) => {
      seen.push(p);
      return true;
    });
    expect(seen).toEqual(["Characters/Aldric.md"]);
  });

  it("resolver: mixed resolved and broken links in one string", () => {
    const known = new Set(["Alpha"]);
    const result = renderTimelineText("[[Alpha]] then [[Beta]]", (p) => known.has(p));
    // Alpha resolved (no marker), Beta broken (one marker)
    expect((result.match(/data-broken/g) ?? []).length).toBe(1);
    expect(result).toMatch(/data-path="Beta"[^>]*/);
  });
});
