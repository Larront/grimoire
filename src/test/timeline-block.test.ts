import { describe, it, expect } from "vitest";
import {
  parseTimelineBody,
  serializeTimelineEvents,
  preprocessTimelineBlocks,
  createBlankEvent,
  insertEventAt,
  moveEventUp,
  moveEventDown,
  renderTimelineText,
  TimelineBlock,
  type TimelineEvent,
} from "$lib/editor/timeline-block";

// ─── parseTimelineBody ────────────────────────────────────────────────────────

describe("parseTimelineBody", () => {
  it("title only — minimal valid record", () => {
    expect(parseTimelineBody("Title: The Shattering")).toEqual([
      { date: "", title: "The Shattering", description: "" },
    ]);
  });

  it("date + title", () => {
    expect(parseTimelineBody("Date: 3rd of Frostfall\nTitle: The Shattering")).toEqual([
      { date: "3rd of Frostfall", title: "The Shattering", description: "" },
    ]);
  });

  it("title + single description line", () => {
    expect(parseTimelineBody("Title: The Shattering\nThe council voted.")).toEqual([
      { date: "", title: "The Shattering", description: "The council voted." },
    ]);
  });

  it("all fields — date, title, multi-line description", () => {
    const body = "Date: 3rd of Frostfall\nTitle: The Shattering\nThe council voted.\nIt began the war.";
    expect(parseTimelineBody(body)).toEqual([
      {
        date: "3rd of Frostfall",
        title: "The Shattering",
        description: "The council voted.\nIt began the war.",
      },
    ]);
  });

  it("two events separated by blank line", () => {
    const body = "Date: 3rd of Frostfall\nTitle: The Shattering\n\nDate: Midwinter\nTitle: Siege of Highvale";
    expect(parseTimelineBody(body)).toEqual([
      { date: "3rd of Frostfall", title: "The Shattering", description: "" },
      { date: "Midwinter", title: "Siege of Highvale", description: "" },
    ]);
  });

  it("three events, mixed optional fields", () => {
    const body = [
      "Title: Alpha",
      "",
      "Date: Year 2\nTitle: Beta\nSome notes.",
      "",
      "Title: Gamma\nFinal event.",
    ].join("\n");
    expect(parseTimelineBody(body)).toEqual([
      { date: "", title: "Alpha", description: "" },
      { date: "Year 2", title: "Beta", description: "Some notes." },
      { date: "", title: "Gamma", description: "Final event." },
    ]);
  });

  it("colons in date value — only the first colon delimits the label", () => {
    expect(parseTimelineBody("Date: Year 812: dawn\nTitle: The Pact")).toEqual([
      { date: "Year 812: dawn", title: "The Pact", description: "" },
    ]);
  });

  it("pipes in title are preserved verbatim", () => {
    expect(parseTimelineBody("Title: [[path|display]] text")).toEqual([
      { date: "", title: "[[path|display]] text", description: "" },
    ]);
  });

  it("wikilinks in date and title survive", () => {
    expect(
      parseTimelineBody("Date: [[Calendar#Frostfall]]\nTitle: [[The Shattering]]"),
    ).toEqual([
      { date: "[[Calendar#Frostfall]]", title: "[[The Shattering]]", description: "" },
    ]);
  });

  it("empty body returns empty array", () => {
    expect(parseTimelineBody("")).toEqual([]);
    expect(parseTimelineBody("   ")).toEqual([]);
  });

  it("skips blank records (consecutive blank lines)", () => {
    const body = "Title: Alpha\n\n\n\nTitle: Beta";
    const result = parseTimelineBody(body);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("Alpha");
    expect(result[1].title).toBe("Beta");
  });

  it("Date:/Title: lines after the title are description, not fields", () => {
    const body = "Title: Alpha\nDate: not a date field\nTitle: also description";
    // The Title: line ends the header; everything after it is description, even
    // when it starts with a Date:/Title: label. This protects description content.
    const result = parseTimelineBody(body);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Alpha");
    expect(result[0].date).toBe("");
    expect(result[0].description).toBe("Date: not a date field\nTitle: also description");
  });

  it("description whose first line looks like a label is not clobbered", () => {
    // Event has no date, so the serializer emits only "Title: " then the description.
    const body = "Title: \nDate: only a description line";
    const result = parseTimelineBody(body);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("");
    expect(result[0].date).toBe("");
    expect(result[0].description).toBe("Date: only a description line");
  });
});

// ─── serializeTimelineEvents ──────────────────────────────────────────────────

describe("serializeTimelineEvents", () => {
  it("single event — title only", () => {
    const events: TimelineEvent[] = [{ date: "", title: "The Shattering", description: "" }];
    expect(serializeTimelineEvents(events)).toBe(
      "```timeline\nTitle: The Shattering\n```",
    );
  });

  it("single event — date + title", () => {
    const events: TimelineEvent[] = [
      { date: "3rd of Frostfall", title: "The Shattering", description: "" },
    ];
    expect(serializeTimelineEvents(events)).toBe(
      "```timeline\nDate: 3rd of Frostfall\nTitle: The Shattering\n```",
    );
  });

  it("single event — title + description", () => {
    const events: TimelineEvent[] = [
      { date: "", title: "The Shattering", description: "The council voted." },
    ];
    expect(serializeTimelineEvents(events)).toBe(
      "```timeline\nTitle: The Shattering\nThe council voted.\n```",
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
      "```timeline\nDate: 3rd of Frostfall\nTitle: The Shattering\nThe council voted.\nIt began the war.\n```",
    );
  });

  it("two events — blank line between records", () => {
    const events: TimelineEvent[] = [
      { date: "3rd of Frostfall", title: "The Shattering", description: "" },
      { date: "Midwinter", title: "Siege of Highvale", description: "" },
    ];
    expect(serializeTimelineEvents(events)).toBe(
      "```timeline\nDate: 3rd of Frostfall\nTitle: The Shattering\n\nDate: Midwinter\nTitle: Siege of Highvale\n```",
    );
  });

  it("date omitted when empty string", () => {
    const events: TimelineEvent[] = [{ date: "", title: "Alpha", description: "" }];
    const output = serializeTimelineEvents(events);
    expect(output).not.toContain("Date:");
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
    expect(output).toContain("Date: [[Calendar#Frostfall]]");
    expect(output).toContain("Title: [[The Shattering]]");
  });
});

// ─── preprocessTimelineBlocks ─────────────────────────────────────────────────

describe("preprocessTimelineBlocks", () => {
  it("converts a fenced timeline block to a timeline-block element", () => {
    const md = "```timeline\nTitle: The Shattering\n```";
    const result = preprocessTimelineBlocks(md);
    expect(result).toContain("<timeline-block");
    expect(result).toContain("data-events=");
    expect(result).not.toContain("```timeline");
  });

  it("leaves non-timeline fences unchanged", () => {
    const md = "```javascript\nconsole.log('hi');\n```";
    expect(preprocessTimelineBlocks(md)).toBe(md);
  });

  it("leaves plain text unchanged", () => {
    const md = "# Hello\n\nSome paragraph.";
    expect(preprocessTimelineBlocks(md)).toBe(md);
  });

  it("the encoded events survive decode and parse correctly", () => {
    const events: TimelineEvent[] = [
      { date: "3rd of Frostfall", title: "The Shattering", description: "" },
    ];
    const md = serializeTimelineEvents(events);
    const html = preprocessTimelineBlocks(md);

    // Extract data-events value
    const match = html.match(/data-events="([^"]+)"/);
    expect(match).not.toBeNull();
    const decoded: TimelineEvent[] = JSON.parse(decodeURIComponent(match![1]));
    expect(decoded).toEqual(events);
  });

  it("handles multiple timeline blocks in one document", () => {
    const md = [
      "Some prose.",
      "",
      "```timeline\nTitle: Alpha\n```",
      "",
      "More prose.",
      "",
      "```timeline\nTitle: Beta\n```",
    ].join("\n");
    const result = preprocessTimelineBlocks(md);
    expect(result.match(/<timeline-block/g)).toHaveLength(2);
  });
});

// ─── Round-trip (serialize → preprocess → parse) ─────────────────────────────

describe("round-trip", () => {
  function roundTrip(events: TimelineEvent[]): TimelineEvent[] {
    const md = serializeTimelineEvents(events);
    const html = preprocessTimelineBlocks(md);
    const match = html.match(/data-events="([^"]+)"/);
    if (!match) throw new Error("no data-events in html");
    return JSON.parse(decodeURIComponent(match[1]));
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

  it("serialize → parse → serialize is stable (idempotent)", () => {
    const events: TimelineEvent[] = [
      { date: "3rd of Frostfall", title: "The Shattering", description: "The council voted." },
      { date: "", title: "Midwinter March", description: "" },
    ];
    const md1 = serializeTimelineEvents(events);
    const parsed = parseTimelineBody(
      md1.replace(/^```timeline\n/, "").replace(/\n```$/, ""),
    );
    const md2 = serializeTimelineEvents(parsed);
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

// ─── insertEventAt ────────────────────────────────────────────────────────────

describe("insertEventAt", () => {
  const alpha: TimelineEvent = { date: "Day 1", title: "Alpha", description: "" };
  const beta: TimelineEvent = { date: "Day 2", title: "Beta", description: "" };
  const gamma: TimelineEvent = { date: "Day 3", title: "Gamma", description: "" };
  const blank = createBlankEvent();

  it("inserts at index 0 (before all events)", () => {
    const result = insertEventAt([alpha, beta], 0, blank);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(blank);
    expect(result[1]).toEqual(alpha);
    expect(result[2]).toEqual(beta);
  });

  it("inserts in the middle", () => {
    const result = insertEventAt([alpha, gamma], 1, beta);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(alpha);
    expect(result[1]).toEqual(beta);
    expect(result[2]).toEqual(gamma);
  });

  it("inserts at the end (index === length)", () => {
    const result = insertEventAt([alpha, beta], 2, gamma);
    expect(result).toHaveLength(3);
    expect(result[2]).toEqual(gamma);
  });

  it("inserts into empty array", () => {
    const result = insertEventAt([], 0, alpha);
    expect(result).toEqual([alpha]);
  });

  it("does not mutate the original array", () => {
    const original = [alpha, beta];
    insertEventAt(original, 1, gamma);
    expect(original).toHaveLength(2);
  });

  it("insert-at-index round-trips through serialize → preprocess correctly", () => {
    const events = [alpha, gamma];
    const result = insertEventAt(events, 1, beta);
    const md = serializeTimelineEvents(result);
    const html = preprocessTimelineBlocks(md);
    const match = html.match(/data-events="([^"]+)"/);
    const decoded: TimelineEvent[] = JSON.parse(decodeURIComponent(match![1]));
    expect(decoded).toEqual([alpha, beta, gamma]);
  });
});

// ─── moveEventUp ─────────────────────────────────────────────────────────────

describe("moveEventUp", () => {
  const alpha: TimelineEvent = { date: "Day 1", title: "Alpha", description: "" };
  const beta: TimelineEvent = { date: "Day 2", title: "Beta", description: "" };
  const gamma: TimelineEvent = { date: "Day 3", title: "Gamma", description: "" };

  it("swaps event at index 1 with event at index 0", () => {
    const result = moveEventUp([alpha, beta], 1);
    expect(result[0]).toEqual(beta);
    expect(result[1]).toEqual(alpha);
  });

  it("moves last event up one position", () => {
    const result = moveEventUp([alpha, beta, gamma], 2);
    expect(result).toEqual([alpha, gamma, beta]);
  });

  it("is a no-op at index 0", () => {
    const original = [alpha, beta];
    const result = moveEventUp(original, 0);
    expect(result).toEqual(original);
  });

  it("does not mutate the original array", () => {
    const original = [alpha, beta];
    moveEventUp(original, 1);
    expect(original[0]).toEqual(alpha);
    expect(original[1]).toEqual(beta);
  });

  it("adjacent swap round-trips through serialize → preprocess correctly", () => {
    const events = [alpha, beta, gamma];
    const result = moveEventUp(events, 1);
    const md = serializeTimelineEvents(result);
    const html = preprocessTimelineBlocks(md);
    const match = html.match(/data-events="([^"]+)"/);
    const decoded: TimelineEvent[] = JSON.parse(decodeURIComponent(match![1]));
    expect(decoded).toEqual([beta, alpha, gamma]);
  });
});

// ─── moveEventDown ────────────────────────────────────────────────────────────

describe("moveEventDown", () => {
  const alpha: TimelineEvent = { date: "Day 1", title: "Alpha", description: "" };
  const beta: TimelineEvent = { date: "Day 2", title: "Beta", description: "" };
  const gamma: TimelineEvent = { date: "Day 3", title: "Gamma", description: "" };

  it("swaps event at index 0 with event at index 1", () => {
    const result = moveEventDown([alpha, beta], 0);
    expect(result[0]).toEqual(beta);
    expect(result[1]).toEqual(alpha);
  });

  it("moves middle event down one position", () => {
    const result = moveEventDown([alpha, beta, gamma], 1);
    expect(result).toEqual([alpha, gamma, beta]);
  });

  it("is a no-op at last index", () => {
    const original = [alpha, beta];
    const result = moveEventDown(original, 1);
    expect(result).toEqual(original);
  });

  it("does not mutate the original array", () => {
    const original = [alpha, beta];
    moveEventDown(original, 0);
    expect(original[0]).toEqual(alpha);
    expect(original[1]).toEqual(beta);
  });

  it("moveDown is symmetric inverse of moveUp for middle elements", () => {
    const events = [alpha, beta, gamma];
    const up = moveEventUp(events, 2);
    const down = moveEventDown(up, 1);
    expect(down).toEqual(events);
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
