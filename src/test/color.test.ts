import { describe, it, expect } from "vitest";
import {
  normalizeHex,
  hexToHsv,
  hsvToHex,
  wash,
  storedColorHex,
} from "../lib/color";
import { sceneLinkHue } from "../lib/components/panes/thumbnail-presets";

describe("normalizeHex", () => {
  it("accepts the forms a person types and returns #rrggbb", () => {
    expect(normalizeHex("#C2483D")).toBe("#c2483d");
    expect(normalizeHex("c2483d")).toBe("#c2483d");
    expect(normalizeHex(" #abc ")).toBe("#aabbcc");
  });

  it("refuses anything else", () => {
    expect(normalizeHex("#c2483")).toBeNull();
    expect(normalizeHex("crimson")).toBeNull();
    expect(normalizeHex("")).toBeNull();
  });
});

describe("hex ⇄ hsv", () => {
  it("round-trips through the picker's coordinates", () => {
    for (const hex of ["#c2483d", "#9b6bbf", "#5c9e6e", "#000000", "#ffffff", "#808080"]) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });

  it("puts pure red at hue 0, full saturation and value", () => {
    expect(hexToHsv("#ff0000")).toEqual({ h: 0, s: 1, v: 1 });
  });
});

describe("storedColorHex", () => {
  it("reads rgb() and short hex as stored by older pins", () => {
    expect(storedColorHex("rgb(184, 154, 94)")).toBe("#b89a5e");
    expect(storedColorHex("#abc")).toBe("#aabbcc");
  });

  it("reads a freely picked colour as stored", () => {
    expect(storedColorHex("#3a7fa8")).toBe("#3a7fa8");
  });

  it("reads an old preset wash back as the hue it washes", () => {
    expect(storedColorHex(wash("#c2483d", 0.18))).toBe("#c2483d");
  });

  it("is null when nothing was chosen", () => {
    expect(storedColorHex(null)).toBeNull();
  });
});

describe("sceneLinkHue", () => {
  it("is the GM's chosen colour when there is one", () => {
    expect(sceneLinkHue({ id: 3, thumbnail_color: "#d9a21b" })).toBe("#d9a21b");
    // An old preset wash reads back as its hue.
    expect(sceneLinkHue({ id: 3, thumbnail_color: wash("#5c9e6e", 0.18) })).toBe("#5c9e6e");
  });

  it("falls back to the preset the scene's id lands on, so every link has a hue", () => {
    expect(sceneLinkHue({ id: 1, thumbnail_color: null })).toBe("#9b6bbf");
    expect(sceneLinkHue({ id: 6, thumbnail_color: null })).toBe("#9b6bbf");
  });
});
