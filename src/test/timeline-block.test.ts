import { describe, it, expect } from "vitest";
import {
  parseTimelineBody,
  serializeTimelineEvents,
  preprocessTimelineBlocks,
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

  it("description lines that look like Date/Title for other events are not confused", () => {
    const body = "Title: Alpha\nDate: not a date field\nTitle: also description";
    // Second Date: and Title: are description lines because they come after the first Title:
    // Actually, our parser processes line by line regardless of order — Date:/Title: label lines
    // always set their field; other lines are always description.
    const result = parseTimelineBody(body);
    expect(result).toHaveLength(1);
    // The last Title: sets title to "also description" — that's the spec behavior
    // (labeled lines always win regardless of position within a record)
    expect(result[0].title).toBe("also description");
    expect(result[0].date).toBe("not a date field");
    expect(result[0].description).toBe("");
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
});
