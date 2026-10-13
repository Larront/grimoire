// Playability, decided by value syntax alone (#178).
//
// A fence carries no schema, so nothing can be asked whether a row is a hit-point
// pool — the characters the GM typed are the whole declaration. These assertions were
// verified in #153's prototype before it was deleted and are lifted here, because they
// encode the decision more precisely than the prose does.
import { describe, it, expect } from "vitest";
import {
  applyArithmetic,
  parseArithmetic,
  classifyValue,
  serializePool,
  serializeTrack,
  type Mark,
} from "$lib/editor/statblock-play";

// ─── Classification ───────────────────────────────────────────────────────────

describe("a value declares its own playability", () => {
  it("reads N/M as a pool", () => {
    expect(classifyValue("120/135")).toMatchObject({
      kind: "pool",
      current: 120,
      max: 135,
    });
  });

  it("reads a pool whose halves the GM spaced out", () => {
    expect(classifyValue("3 / 12")).toMatchObject({
      kind: "pool",
      current: 3,
      max: 12,
    });
  });

  it("reads a negative half, which no clamping makes reachable", () => {
    expect(classifyValue("-6/12")).toMatchObject({
      kind: "pool",
      current: -6,
      max: 12,
    });
  });

  it("leaves a bare integer inert", () => {
    expect(classifyValue("14")).toEqual({ kind: "inert" });
  });

  it("leaves a signed number inert, because a modifier column is not a pool", () => {
    // `+3` and `-1` fill a column in every system, and a modifier that became
    // clickable would be a pool the GM never asked for.
    expect(classifyValue("+3")).toEqual({ kind: "inert" });
    expect(classifyValue("-1")).toEqual({ kind: "inert" });
  });

  it("leaves prose and dice inert", () => {
    expect(classifyValue("2d6 + 4 slashing")).toEqual({ kind: "inert" });
    expect(classifyValue("")).toEqual({ kind: "inert" });
  });

  it("reads a run of boxes as a mark track", () => {
    expect(classifyValue("[x][ ][ ]")).toEqual({
      kind: "track",
      marks: [
        { checked: true, label: "" },
        { checked: false, label: "" },
        { checked: false, label: "" },
      ],
      spaced: false,
    });
  });

  it("reads labels the GM typed after each box", () => {
    expect(classifyValue("[x] Prone [ ] Charmed")).toEqual({
      kind: "track",
      marks: [
        { checked: true, label: "Prone" },
        { checked: false, label: "Charmed" },
      ],
      spaced: false,
    });
  });

  it("takes an upper-case tick, which Obsidian's own task lists write", () => {
    expect(classifyValue("[X]")).toMatchObject({ kind: "track" });
  });

  it("leaves a line that only starts with a box inert", () => {
    // A run is the whole value or it is nothing: `[x]` inside a sentence is prose.
    expect(classifyValue("Roll [x] or better")).toEqual({ kind: "inert" });
  });
});

// ─── Serialization ────────────────────────────────────────────────────────────

describe("a played value writes itself back", () => {
  it("keeps the separator the GM typed", () => {
    const pool = classifyValue("3 / 12");
    if (pool.kind !== "pool") throw new Error("expected a pool");
    expect(serializePool(pool, 5)).toBe("5 / 12");
  });

  it("writes a negative current value, which reads back as a pool", () => {
    const pool = classifyValue("3/12");
    if (pool.kind !== "pool") throw new Error("expected a pool");
    expect(serializePool(pool, -6)).toBe("-6/12");
    expect(classifyValue("-6/12")).toMatchObject({ kind: "pool", current: -6 });
  });

  it("joins unlabelled marks with nothing", () => {
    const marks: Mark[] = [
      { checked: true, label: "" },
      { checked: false, label: "" },
    ];
    expect(serializeTrack(marks)).toBe("[x][ ]");
  });

  it("joins marks with a space once any of them carries a label", () => {
    const marks: Mark[] = [
      { checked: true, label: "Prone" },
      { checked: false, label: "" },
    ];
    expect(serializeTrack(marks)).toBe("[x] Prone [ ]");
  });

  it("normalises a mixed run to the labelled form, once the GM touches it", () => {
    // `[x][ ] Prone` is neither form: it has a label, so the separator rule spaces the
    // whole run. The rewrite happens only on a row the GM has just changed, and the
    // result is stable from then on — the alternative is a per-mark separator nobody
    // can see in the file.
    const track = classifyValue("[x][ ] Prone");
    if (track.kind !== "track") throw new Error("expected a track");
    expect(serializeTrack(track.marks)).toBe("[x] [ ] Prone");
    expect(classifyValue("[x] [ ] Prone")).toMatchObject({ marks: track.marks });
  });

  it("keeps unlabelled boxes apart when the GM wrote them apart", () => {
    // The bundled Lurker writes `[ ] [ ]`; its first tick used to close them up.
    const track = classifyValue("[ ] [ ]");
    if (track.kind !== "track") throw new Error("expected a track");
    const ticked = track.marks.map((m, i) => (i === 0 ? { ...m, checked: true } : m));
    expect(serializeTrack(ticked, track.spaced)).toBe("[x] [ ]");
  });

  it("round-trips both forms byte-identically", () => {
    // One fixed separator breaks whichever form it was not chosen for, which is why
    // the rule is conditional on there being a label at all.
    for (const value of ["[x][ ][ ]", "[x] Prone [ ] Charmed", "[ ] Prone [ ]"]) {
      const track = classifyValue(value);
      if (track.kind !== "track") throw new Error("expected a track");
      expect(serializeTrack(track.marks)).toBe(value);
    }
  });
});

// ─── Arithmetic ───────────────────────────────────────────────────────────────

describe("pool arithmetic", () => {
  it("reads a signed number as a delta", () => {
    expect(applyArithmetic(120, "-20")).toBe(100);
    expect(applyArithmetic(120, "+5")).toBe(125);
  });

  it("reads an unsigned number as an absolute", () => {
    expect(applyArithmetic(120, "20")).toBe(20);
  });

  it("does nothing with an empty input", () => {
    expect(applyArithmetic(120, "")).toBe(120);
    expect(applyArithmetic(120, "   ")).toBe(120);
  });

  it("rejects dice and junk rather than parsing them", () => {
    expect(applyArithmetic(120, "-2d6")).toBe(120);
    expect(applyArithmetic(120, "half")).toBe(120);
  });

  it("does not clamp, at either end", () => {
    expect(applyArithmetic(3, "-9")).toBe(-6);
    expect(applyArithmetic(3, "+400")).toBe(403);
  });

  it("takes a sign with a space after it, and the typographic minus", () => {
    // The same hit a GM meant by -12; dropping them read as a hit that landed.
    expect(applyArithmetic(68, "- 12")).toBe(56);
    expect(applyArithmetic(68, "−12")).toBe(56);
    expect(applyArithmetic(68, "+ 5")).toBe(73);
  });

  it("tells junk apart from an empty input, so junk can be refused out loud", () => {
    expect(parseArithmetic("")).toEqual({ kind: "empty" });
    expect(parseArithmetic("-2d6")).toEqual({ kind: "invalid" });
    expect(parseArithmetic("12-")).toEqual({ kind: "invalid" });
    expect(parseArithmetic("-12")).toEqual({ kind: "delta", amount: -12 });
    expect(parseArithmetic("30")).toEqual({ kind: "absolute", value: 30 });
  });
});
