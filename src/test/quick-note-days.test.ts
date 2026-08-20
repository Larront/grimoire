// Capture-day grouping (#230) — the pane's whole story about *when*.
//
// A Quick Note shows no timestamp: the day heading is the only date information
// there is, so what the grouping puts under which heading, and in what order, is
// the feature rather than a detail of it. All of it is pure, so none of these
// claims needs a rendered pane.
import { describe, it, expect } from "vitest";
import { groupByCaptureDay } from "$lib/utils/quick-note-days";
import type { QuickNote } from "$lib/bindings.gen";

/** A Quick Note captured at a local wall-clock time. */
function note(id: number, local: string, body = `note ${id}`): QuickNote {
  return { id, body, captured_at: new Date(local).toISOString() };
}

// A fixed "now", so Today and Yesterday are pinned rather than borrowed from the
// clock the suite happens to run on.
const NOW = new Date("2026-08-20T14:00:00");

describe("groupByCaptureDay", () => {
  it("puts the newest day first and reads chronologically inside a day", () => {
    const groups = groupByCaptureDay(
      [
        note(1, "2026-08-18T21:40:00", "the marsh fires"),
        note(2, "2026-08-20T09:15:00", "morning thought"),
        note(3, "2026-08-20T11:05:00", "later thought"),
        note(4, "2026-08-19T20:00:00", "mid thought"),
      ],
      NOW,
    );

    expect(groups.map((g) => g.key)).toEqual(["2026-08-20", "2026-08-19", "2026-08-18"]);
    expect(groups[0].notes.map((n) => n.body)).toEqual(["morning thought", "later thought"]);
  });

  it("groups by the GM's local day, so a late-night thought stays under tonight", () => {
    // 23:40 local. Grouped by UTC this would fall on the following day for any
    // GM west of Greenwich — and a thought parked tonight belongs to tonight.
    const groups = groupByCaptureDay([note(1, "2026-08-19T23:40:00")], NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("2026-08-19");
  });

  it("names today and yesterday rather than dating them", () => {
    const groups = groupByCaptureDay(
      [note(1, "2026-08-20T09:00:00"), note(2, "2026-08-19T09:00:00")],
      NOW,
    );
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday"]);
  });

  it("writes an older day out, and only spells the year when it is not this one", () => {
    const [thisYear] = groupByCaptureDay([note(1, "2026-03-04T09:00:00")], NOW);
    expect(thisYear.label).toContain("March");
    expect(thisYear.label).not.toContain("2026");

    const [lastYear] = groupByCaptureDay([note(2, "2025-03-04T09:00:00")], NOW);
    expect(lastYear.label).toContain("2025");
  });

  it("orders a same-instant pair by id, so two fast captures keep the typing order", () => {
    const stamp = new Date("2026-08-20T10:00:00").toISOString();
    const groups = groupByCaptureDay(
      [
        { id: 7, body: "typed second", captured_at: stamp },
        { id: 6, body: "typed first", captured_at: stamp },
      ],
      NOW,
    );
    expect(groups[0].notes.map((n) => n.body)).toEqual(["typed first", "typed second"]);
  });

  it("groups nothing into nothing", () => {
    expect(groupByCaptureDay([], NOW)).toEqual([]);
  });
});

describe("groupByCaptureDay — oldest first (#232)", () => {
  // Oldest-first exists because clearing a list is work you do from the bottom:
  // the thought that has been waiting longest is the one to deal with next.
  const ROWS = [
    note(1, "2026-08-18T21:40:00", "the marsh fires"),
    note(2, "2026-08-20T09:15:00", "morning thought"),
    note(3, "2026-08-20T11:05:00", "later thought"),
  ];

  it("reverses the day groups and the notes inside them", () => {
    const groups = groupByCaptureDay(ROWS, NOW, "oldest");
    expect(groups.map((g) => g.key)).toEqual(["2026-08-18", "2026-08-20"]);
    expect(groups[1].notes.map((n) => n.body)).toEqual(["later thought", "morning thought"]);
  });

  it("labels a day the same whichever way round the list reads", () => {
    const oldest = groupByCaptureDay(ROWS, NOW, "oldest");
    const newest = groupByCaptureDay(ROWS, NOW, "newest");
    expect(oldest.find((g) => g.key === "2026-08-20")?.label).toBe("Today");
    expect(newest.find((g) => g.key === "2026-08-20")?.label).toBe("Today");
  });

  it("still reads newest first when no order is asked for", () => {
    expect(groupByCaptureDay(ROWS, NOW).map((g) => g.key)).toEqual(["2026-08-20", "2026-08-18"]);
  });

  it("orders a same-instant pair by id in both directions", () => {
    const stamp = new Date("2026-08-20T10:00:00").toISOString();
    const rows = [
      { id: 7, body: "typed second", captured_at: stamp },
      { id: 6, body: "typed first", captured_at: stamp },
    ];
    expect(groupByCaptureDay(rows, NOW, "oldest")[0].notes.map((n) => n.body)).toEqual([
      "typed second",
      "typed first",
    ]);
  });
});
