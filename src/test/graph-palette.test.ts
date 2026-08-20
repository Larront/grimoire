import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { VIZ_SLOTS, assignTagSlots, resolveTagColor, mutedColor } from "../lib/graph-palette";

/*
  The module exists because two surfaces disagreed: the graph painted a tag from the ramp
  while the Tag Manager drew it as a flat `#888888`, so Settings showed a grey list
  describing a colourful graph. These tests are mostly about the properties that make
  disagreement impossible rather than about any particular hex — a test that restated the
  shipped values would be a second copy of the palette, which is the failure mode this
  whole change is about.
*/

const MUTED = "#a39e99";

beforeEach(() => {
  vi.spyOn(window, "getComputedStyle").mockReturnValue({
    getPropertyValue: (prop: string) => {
      if (prop === "--foreground-muted") return MUTED;
      const viz = prop.match(/^--viz-cat-(\d)$/);
      return viz ? `#viz${viz[1]}` : "";
    },
  } as unknown as CSSStyleDeclaration);
});

afterEach(() => vi.restoreAllMocks());

const noExplicitColors = () => false;

describe("assignTagSlots", () => {
  it("assigns slots in sorted order, not the order tags arrive", () => {
    const fromOneOrder = assignTagSlots(["quest", "npc", "location"], noExplicitColors);
    const fromAnother = assignTagSlots(["location", "quest", "npc"], noExplicitColors);
    expect([...fromOneOrder]).toEqual([...fromAnother]);
    expect(fromOneOrder.get("location")).toBe(0);
    expect(fromOneOrder.get("npc")).toBe(1);
    expect(fromOneOrder.get("quest")).toBe(2);
  });

  /*
    The property the reported bug violated. Two callers holding the same tag list must
    reach the same answer without coordinating — that is the whole contract.
  */
  it("is a pure function of the tag list", () => {
    const tags = ["beach", "alley", "castle"];
    expect([...assignTagSlots(tags, noExplicitColors)]).toEqual([
      ...assignTagSlots([...tags], noExplicitColors),
    ]);
  });

  it("skips tags that carry an explicit colour", () => {
    const slots = assignTagSlots(["alpha", "beta", "gamma"], (tag) => tag === "beta");
    expect(slots.has("beta")).toBe(false);
    // ...and the tags around it close up rather than leaving a hole.
    expect(slots.get("alpha")).toBe(0);
    expect(slots.get("gamma")).toBe(1);
  });

  it("leaves tags past the ramp unassigned rather than cycling", () => {
    const many = Array.from({ length: VIZ_SLOTS + 4 }, (_, i) => String(i).padStart(2, "0"));
    const slots = assignTagSlots(many, noExplicitColors);
    expect(slots.size).toBe(VIZ_SLOTS);
    // No two tags share a slot — the collision the old cycling assignment produced.
    expect(new Set(slots.values()).size).toBe(VIZ_SLOTS);
  });

  it("tolerates duplicate tag names", () => {
    const slots = assignTagSlots(["npc", "npc", "quest"], noExplicitColors);
    expect(slots.get("npc")).toBe(0);
    expect(slots.get("quest")).toBe(1);
  });
});

describe("resolveTagColor", () => {
  it("prefers an explicit colour over the ramp", () => {
    const slots = assignTagSlots(["npc"], noExplicitColors);
    expect(resolveTagColor("npc", "#ff0000", slots)).toBe("#ff0000");
  });

  it("falls back to the tag's ramp slot", () => {
    const slots = assignTagSlots(["npc", "quest"], noExplicitColors);
    expect(resolveTagColor("npc", null, slots)).toBe("#viz1");
    expect(resolveTagColor("quest", null, slots)).toBe("#viz2");
  });

  it("falls back to muted past the ramp, never to a repeated slot", () => {
    const slots = assignTagSlots([], noExplicitColors);
    expect(resolveTagColor("unslotted", null, slots)).toBe(MUTED);
    expect(mutedColor()).toBe(MUTED);
  });

  /*
    The reported symptom, as a test: the graph and the Tag Manager derive a tag's colour
    from the same call, so neither can invent a value the other does not know about.
  */
  it("gives the graph and the tag manager the same answer", () => {
    const allTags = ["location", "npc", "quest"];
    const styles: Record<string, string | null> = { npc: "#ff0000" };
    const hasColor = (tag: string) => !!styles[tag];

    const graphSlots = assignTagSlots(allTags, hasColor);
    const settingsSlots = assignTagSlots(allTags, hasColor);

    for (const tag of allTags) {
      expect(resolveTagColor(tag, styles[tag], graphSlots)).toBe(
        resolveTagColor(tag, styles[tag], settingsSlots),
      );
    }
    // And specifically: an unstyled tag is never the flat grey the picker used to show.
    expect(resolveTagColor("quest", null, graphSlots)).not.toBe("#888888");
  });
});
