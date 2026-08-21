import { describe, it, expect } from "vitest";
import {
  SHIPPED_PRESETS,
  availablePresets,
  fenceBody,
  isShippedName,
  resolvePreset,
  statblockFromPreset,
  type StatblockPreset,
} from "$lib/editor/statblock-presets";
import {
  parseStatblockBody,
  serializeStatblock,
  DEFAULT_STATBLOCK_WIDTH,
} from "$lib/editor/statblock-block";

const authored = (name: string, body: string): StatblockPreset => ({
  name,
  fence: ["```statblock", body, "```"].join("\n"),
});

// ── The shipped two ───────────────────────────────────────────────────────────

describe("shipped presets", () => {
  it("ships exactly 5E SRD and Large Orc", () => {
    expect(SHIPPED_PRESETS.map((p) => p.name)).toEqual(["5E SRD", "Large Orc"]);
  });

  it("round-trip through the format byte for byte", () => {
    for (const preset of SHIPPED_PRESETS) {
      expect(serializeStatblock(parseStatblockBody(fenceBody(preset.fence)))).toBe(preset.fence);
    }
  });

  it("5E SRD is a skeleton of labels with no values", () => {
    const block = parseStatblockBody(fenceBody(SHIPPED_PRESETS[0].fence));
    expect(block.rows.length).toBeGreaterThan(0);
    expect(block.rows.every((row) => row.value === "")).toBe(true);
    expect(block.sections.every((section) => section.entries.length === 0)).toBe(true);
  });

  // Four rows, four lessons: a pool, a mark track, an inert value, a named entry.
  it("Large Orc teaches every value shape and nothing more", () => {
    const block = parseStatblockBody(fenceBody(SHIPPED_PRESETS[1].fence));
    expect(block.name).toBe("Large Orc");
    expect(block.rows).toHaveLength(3);
    expect(block.rows.some((row) => /^\d+\s*\/\s*\d+$/.test(row.value))).toBe(true);
    expect(block.rows.some((row) => /\[[ x]\]/.test(row.value))).toBe(true);
    expect(block.rows.some((row) => /^\d+$/.test(row.value))).toBe(true);
    expect(block.sections[0].entries[0].name).toBeTruthy();
  });

  // A condition is not a Grimoire concept, so no shipped shape may name one.
  it("names no condition anywhere", () => {
    for (const preset of SHIPPED_PRESETS) {
      expect(preset.fence.toLowerCase()).not.toContain("condition");
    }
  });

  it("reserves the shipped names, case-insensitively", () => {
    expect(isShippedName("large orc")).toBe(true);
    expect(isShippedName("  5E SRD  ")).toBe(true);
    expect(isShippedName("Goblin")).toBe(false);
  });
});

// ── What a GM can choose from ─────────────────────────────────────────────────

describe("availablePresets", () => {
  it("lists the shipped two when the store is empty", () => {
    expect(availablePresets([]).map((p) => p.name)).toEqual(["5E SRD", "Large Orc"]);
  });

  it("appends authored presets after the shipped ones", () => {
    const list = availablePresets([authored("Goblin", "HP: 7/7")]);
    expect(list.map((p) => p.name)).toEqual(["5E SRD", "Large Orc", "Goblin"]);
  });

  // Saving over a shipped name is refused before it reaches the store, so this state
  // is unreachable through the app; if a hand-edited file produces it, the shipped
  // constant still wins, which is what "cannot be edited" has to mean.
  it("keeps the shipped preset ahead of a same-named stored one", () => {
    const list = availablePresets([authored("large orc", "HP: 1/1")]);
    expect(resolvePreset("Large Orc", list, null)?.fence).not.toContain("HP: 1/1");
  });
});

// ── Resolution ────────────────────────────────────────────────────────────────

describe("resolvePreset — with an argument", () => {
  const presets = availablePresets([authored("Goblin", "HP: 7/7")]);

  it("matches a whole argument case-insensitively", () => {
    expect(resolvePreset("goblin", presets, null)?.name).toBe("Goblin");
    expect(resolvePreset("GOBLIN", presets, null)?.name).toBe("Goblin");
  });

  it("does not match a prefix, a substring or a suffix", () => {
    const shadowed = availablePresets([
      authored("Orc", "HP: 5/5"),
      authored("Orc Warlord", "HP: 40/40"),
    ]);
    expect(resolvePreset("Orc Warl", shadowed, null)).toBeNull();
    expect(resolvePreset("Warlord", shadowed, null)).toBeNull();
    expect(resolvePreset("Orc Warlord", shadowed, null)?.name).toBe("Orc Warlord");
    // Least forgivable of all, and the reason app-wide scope forces exactness.
    expect(resolvePreset("Orc Warlord", shadowed, null)?.fence).toContain("40/40");
  });

  // The asymmetry that justifies matching exactly: a miss lands on the shape the GM
  // chose — one restamp from fixed — where a loose misfire hands over a shape nobody
  // asked for and looks deliberate.
  it("falls through to the vault default when the argument misses", () => {
    expect(resolvePreset("Kobold", presets, "Goblin")?.name).toBe("Goblin");
  });

  it("yields nothing when the argument misses and there is no default", () => {
    expect(resolvePreset("Kobold", presets, null)).toBeNull();
  });

  it("yields nothing when neither the argument nor the default resolves", () => {
    expect(resolvePreset("Kobold", presets, "Bugbear")).toBeNull();
  });

  it("tolerates surrounding whitespace in the argument", () => {
    expect(resolvePreset("  goblin  ", presets, null)?.name).toBe("Goblin");
  });
});

describe("resolvePreset — with no argument", () => {
  const presets = availablePresets([authored("Goblin", "HP: 7/7")]);

  it("uses the vault default, matched case-insensitively", () => {
    expect(resolvePreset("", presets, "goblin")?.name).toBe("Goblin");
  });

  it("yields nothing when there is no default", () => {
    expect(resolvePreset("", presets, null)).toBeNull();
  });

  it("yields nothing when the default does not resolve", () => {
    expect(resolvePreset("", presets, "Bugbear")).toBeNull();
  });
});

// ── Stamping ──────────────────────────────────────────────────────────────────

describe("statblockFromPreset", () => {
  const goblin = authored("Goblin", "# Goblin\nHP: 7/7\nAC: 15");

  it("stamps the preset's shape", () => {
    const block = statblockFromPreset(goblin, "");
    expect(block.rows).toEqual([
      { label: "HP", value: "7/7" },
      { label: "AC", value: "15" },
    ]);
  });

  it("leaves no preset id or reference behind", () => {
    const stamped = JSON.stringify(statblockFromPreset(goblin, "Goblin"));
    expect(stamped).not.toContain("preset");
    expect(Object.keys(statblockFromPreset(goblin, ""))).toEqual([
      "name",
      "rows",
      "sections",
      "width",
    ]);
  });

  // The fall-through case: the argument named nothing, so the shape is the vault's
  // default and the title is what the GM typed, character for character.
  it("titles the block with the argument verbatim when it matched no preset", () => {
    expect(statblockFromPreset(null, "goblin scout").name).toBe("goblin scout");
    const fallen = statblockFromPreset(goblin, "goblin scout");
    expect(fallen.name).toBe("goblin scout");
    expect(fallen.rows[0]).toEqual({ label: "HP", value: "7/7" });
  });

  it("takes the preset's casing when the argument matched it", () => {
    expect(statblockFromPreset(goblin, "goblin").name).toBe("Goblin");
    expect(statblockFromPreset(goblin, "  GOBLIN ").name).toBe("Goblin");
  });

  it("never uses the # name inside the preset's fence when an argument was typed", () => {
    const orc = authored("Orc", "# Grukk the Unwashed\nHP: 15/15");
    expect(statblockFromPreset(orc, "Bugbear").name).toBe("Bugbear");
  });

  it("keeps the preset's own name when there is no argument", () => {
    expect(statblockFromPreset(goblin, "").name).toBe("Goblin");
  });

  it("with no preset yields a blank statblock titled by the argument", () => {
    const block = statblockFromPreset(null, "Bugbear");
    expect(block).toEqual({
      name: "Bugbear",
      rows: [{ label: "", value: "" }],
      sections: [],
      width: DEFAULT_STATBLOCK_WIDTH,
    });
  });

  it("with neither preset nor argument yields a blank statblock", () => {
    expect(statblockFromPreset(null, "")).toEqual({
      name: "",
      rows: [{ label: "", value: "" }],
      sections: [],
      width: DEFAULT_STATBLOCK_WIDTH,
    });
  });
});

// ── Capture ───────────────────────────────────────────────────────────────────

// Capture itself is `serializeStatblock` — the block's own serializer, so a preset
// can only ever hold what the fence would have held. What that means for a *played*
// block is asserted in save-preset-dialog.test.ts, where the gesture lives.

describe("fenceBody", () => {
  it("strips the fence delimiters", () => {
    expect(fenceBody("```statblock\nHP: 7/7\n```")).toBe("HP: 7/7");
  });

  it("reads a hand-written body with no delimiters as itself", () => {
    expect(fenceBody("HP: 7/7")).toBe("HP: 7/7");
  });
});
