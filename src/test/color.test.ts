import { describe, it, expect } from "vitest";
import {
  normalizeHex,
  hexToHsv,
  hsvToHex,
  wash,
  sceneColorHex,
} from "../lib/color";

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

describe("sceneColorHex", () => {
  it("reads a freely picked colour as stored", () => {
    expect(sceneColorHex("#3a7fa8")).toBe("#3a7fa8");
  });

  it("reads an old preset wash back as the hue it washes", () => {
    expect(sceneColorHex(wash("#c2483d", 0.18))).toBe("#c2483d");
  });

  it("is null when nothing was chosen", () => {
    expect(sceneColorHex(null)).toBeNull();
  });
});
