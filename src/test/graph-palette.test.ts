import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { resolveTagColor, mutedColor, slotColor } from "../lib/graph-palette";

/*
  The module exists because two surfaces disagreed: the graph painted a tag from the ramp
  while the Tag Manager drew it as a flat `#888888`. Which step a tag wears is now stored
  by the backend (see graph_styles.rs); what is left here is the order of precedence.
  These tests stub the ramp by step rather than restating the shipped hexes — a test that
  restated them would be a second copy of the palette.
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

describe("resolveTagColor", () => {
  it("prefers an explicit colour over the ramp", () => {
    expect(resolveTagColor({ color: "#ff0000", slot: 0 })).toBe("#ff0000");
  });

  it("falls back to the tag's own ramp step, counted from zero", () => {
    expect(resolveTagColor({ color: null, slot: 0 })).toBe("#viz1");
    expect(resolveTagColor({ color: null, slot: 4 })).toBe("#viz5");
    expect(slotColor(7)).toBe("#viz8");
  });

  it("falls back to muted with no step, never to a repeated one", () => {
    expect(resolveTagColor({ color: null, slot: null })).toBe(MUTED);
    expect(resolveTagColor(undefined)).toBe(MUTED);
    expect(mutedColor()).toBe(MUTED);
  });

  it("never shows the flat grey the picker used to", () => {
    expect(resolveTagColor({ color: null, slot: 2 })).not.toBe("#888888");
  });
});
