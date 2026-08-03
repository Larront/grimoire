import { describe, it, expect } from "vitest";
import { filterCommands, slashArgument } from "$lib/editor/slash-command";

const labels = (query: string) =>
  filterCommands(query).map((item) => item.label);

// ── The menu without an argument ─────────────────────────────────────────────

describe("filterCommands — no argument", () => {
  it("an empty query offers everything", () => {
    expect(filterCommands("").length).toBeGreaterThan(10);
  });

  it("matches a label or a keyword, case-insensitively", () => {
    expect(labels("statbl")).toEqual(["Statblock"]);
    // "monster" is also the Encounter callout's keyword — a substring match offers both.
    expect(labels("MONSTER")).toEqual(["Statblock", "Encounter"]);
  });

  it("offers nothing for a word no command answers to", () => {
    expect(labels("zzzz")).toEqual([]);
  });
});

// ── The menu once a space is typed ───────────────────────────────────────────
//
// A space is what used to end the session outright. It now survives only for the
// commands that take an argument, which is what keeps `/quote ` from staying open
// mid-sentence while `/statblock goblin` reaches its preset.

describe("filterCommands — after a space", () => {
  it("keeps an argument-taking command whose name matched exactly", () => {
    expect(labels("statblock goblin")).toEqual(["Statblock"]);
    expect(labels("Statblock Large Orc")).toEqual(["Statblock"]);
    expect(labels("monster goblin")).toEqual(["Statblock"]);
  });

  it("keeps it while the argument is still empty", () => {
    expect(labels("statblock ")).toEqual(["Statblock"]);
  });

  it("drops a command that takes no argument", () => {
    expect(labels("quote ")).toEqual([]);
    expect(labels("quote something")).toEqual([]);
  });

  it("drops a partially typed name — the head has to match whole", () => {
    expect(labels("statbl goblin")).toEqual([]);
  });

  it("offers nothing for prose after a stray slash", () => {
    expect(labels(" or the other")).toEqual([]);
    expect(labels("ordered list of things")).toEqual([]);
  });
});

// ── The argument itself ──────────────────────────────────────────────────────

describe("slashArgument", () => {
  it("is everything after the command word", () => {
    expect(slashArgument("/statblock goblin")).toBe("goblin");
    expect(slashArgument("/statblock Large Orc")).toBe("Large Orc");
  });

  it("is empty when nothing was typed after the command", () => {
    expect(slashArgument("/statblock")).toBe("");
    expect(slashArgument("/statblock   ")).toBe("");
  });

  it("keeps the argument's own casing and inner spacing", () => {
    expect(slashArgument("/statblock  the  Old  King ")).toBe("the  Old  King");
  });
});
