import { describe, it, expect } from "vitest";
import { filterCommands, slashArgument, type PresetContext } from "$lib/editor/slash-command";
import { SHIPPED_PRESETS } from "$lib/editor/statblock-presets";

const labels = (query: string, ctx?: PresetContext) =>
  filterCommands(query, ctx).map((item) => item.label);

const SHIPPED: PresetContext = { presets: [...SHIPPED_PRESETS], defaultName: null };

// ── The bare menu ────────────────────────────────────────────────────────────

describe("filterCommands — a bare /", () => {
  it("offers Grimoire's own blocks first, then text, then lists", () => {
    const items = filterCommands("");
    expect([...new Set(items.map((item) => item.group))]).toEqual(["Note blocks", "Text", "List"]);
    expect(items.slice(0, 6).map((item) => item.label)).toEqual([
      "Statblock",
      "Scene",
      "Infobox",
      "Timeline",
      "Image",
      "Callout",
    ]);
  });

  it("folds the ten callout types into one Callout row", () => {
    // They were 42% of the list, offered to a GM who had typed nothing.
    expect(labels("")).toHaveLength(15);
    expect(labels("")).not.toContain("Warning");
  });

  it("says what a statblock will be stamped from", () => {
    const statblock = filterCommands("", SHIPPED)[0];
    expect(statblock.hint).toBe("Blank");
    expect(filterCommands("", { ...SHIPPED, defaultName: "large orc" })[0].hint).toBe("Large Orc");
  });
});

// ── The menu without an argument ─────────────────────────────────────────────

describe("filterCommands — a word typed", () => {
  it("matches a label or a keyword, case-insensitively", () => {
    expect(labels("statbl")).toEqual(["Statblock"]);
    // "monster" is also the Encounter callout's keyword, so both answer to it.
    expect(labels("MONSTER")).toEqual(["Statblock", "Encounter"]);
  });

  it("ranks the label being typed above a keyword that merely contains it", () => {
    // Registry order used to decide: `/st` was Bullet List, whose keyword "unordered"
    // holds "st", and Enter made a list.
    expect(labels("st")[0]).toBe("Statblock");
    expect(labels("no")[0]).toBe("Note");
    expect(labels("im")[0]).toBe("Image");
    expect(labels("h")[0]).toBe("Heading 1");
    expect(labels("d")[0]).toBe("Divider");
  });

  it("reaches a folded callout type by name, marked as a callout", () => {
    const [warning] = filterCommands("warn");
    expect(warning.label).toBe("Warning");
    expect(warning.hint).toBe("Callout");
  });

  it("offers the types rather than the folded row once a callout is asked for", () => {
    const offered = labels("callout");
    expect(offered).toHaveLength(10);
    expect(offered[0]).toBe("Note");
  });

  it("tells the plain quote from the quote callout", () => {
    const quotes = filterCommands("quote").filter((item) => item.label === "Quote");
    expect(quotes.map((item) => item.hint)).toEqual([undefined, "Callout"]);
  });

  it("offers nothing for a word no command answers to", () => {
    expect(labels("zzzz")).toEqual([]);
  });
});

// ── Statblock presets ────────────────────────────────────────────────────────

describe("filterCommands — statblock presets", () => {
  it("lists the presets under Statblock once the word is plain", () => {
    // Then the Infobox, whose keyword "stats" answers too.
    expect(labels("stat", SHIPPED)).toEqual(["Statblock", "5E SRD", "Large Orc", "Infobox"]);
    expect(labels("monster", SHIPPED).slice(0, 3)).toEqual(["Statblock", "5E SRD", "Large Orc"]);
    expect(filterCommands("stat", SHIPPED)[1].hint).toBe("Preset");
  });

  it("does not bury the menu in presets for two letters", () => {
    expect(labels("st", SHIPPED)).not.toContain("Large Orc");
  });

  it("names a creature that is no preset, and says the shape it gets", () => {
    const [row] = filterCommands("statblock Goblin", SHIPPED);
    expect(row.label).toBe("Statblock “Goblin”");
    expect(row.hint).toBe("Blank");
  });

  it("puts a preset named whole first, as Enter has always stamped it", () => {
    const [row] = filterCommands("statblock large orc", SHIPPED);
    expect(row.label).toBe("Large Orc");
    expect(row.hint).toBe("Preset");
  });

  it("offers the presets a name starts below it, never in Enter's place", () => {
    // A GM naming a new creature "Lar" keeps that on Enter; Large Orc is one arrow away.
    expect(labels("statblock lar", SHIPPED)).toEqual(["Statblock “lar”", "Large Orc"]);
  });
});

// ── The menu once a space is typed ───────────────────────────────────────────
//
// A space is what used to end the session outright. It now survives only for the
// commands that take an argument, which is what keeps `/quote ` from staying open
// mid-sentence while `/statblock goblin` reaches its preset.

describe("filterCommands — after a space", () => {
  it("keeps an argument-taking command whose name matched exactly", () => {
    expect(labels("statblock goblin")).toEqual(["Statblock “goblin”"]);
    expect(labels("Statblock Large Orc")).toEqual(["Statblock “Large Orc”"]);
    expect(labels("monster goblin")).toEqual(["Statblock “goblin”"]);
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
