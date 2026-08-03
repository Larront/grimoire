import { describe, it, expect } from "vitest";
import {
  parseWikiTarget,
  stripWikiFragment,
  wikiStem,
} from "$lib/editor/wiki-link";

// ─── parseWikiTarget ──────────────────────────────────────────────────────────
// Drives both the [[...]] input rule (stub-link escape hatch) and display titles.

describe("parseWikiTarget", () => {
  it("bare name → path and title are the same", () => {
    expect(parseWikiTarget("Blackreach")).toEqual({ path: "Blackreach", title: "Blackreach" });
  });

  it("nested path → title is the last segment", () => {
    expect(parseWikiTarget("Places/Blackreach")).toEqual({
      path: "Places/Blackreach",
      title: "Blackreach",
    });
  });

  it("strips a trailing .md from the derived title only", () => {
    expect(parseWikiTarget("Places/Blackreach.md")).toEqual({
      path: "Places/Blackreach.md",
      title: "Blackreach",
    });
  });

  it("pipe alias → explicit display title, path untouched", () => {
    expect(parseWikiTarget("Places/Blackreach.md|The Deep City")).toEqual({
      path: "Places/Blackreach.md",
      title: "The Deep City",
    });
  });

  it("trims surrounding whitespace on both sides of the pipe", () => {
    expect(parseWikiTarget("  Places/Blackreach.md  |  The Deep City  ")).toEqual({
      path: "Places/Blackreach.md",
      title: "The Deep City",
    });
  });

  it("heading link: path keeps the fragment (round-trip), title drops it", () => {
    expect(parseWikiTarget("The Severance#The Night of Silence")).toEqual({
      path: "The Severance#The Night of Silence",
      title: "The Severance",
    });
  });
});

// ─── stripWikiFragment / wikiStem ─────────────────────────────────────────────
// Resolution and display ignore #heading / #^block fragments; the node's path
// attribute keeps them so the original markdown round-trips unchanged.

describe("stripWikiFragment", () => {
  it("strips a #heading fragment", () => {
    expect(stripWikiFragment("The Severance#The Night of Silence")).toBe("The Severance");
  });

  it("strips a #^block fragment", () => {
    expect(stripWikiFragment("Note#^abc123")).toBe("Note");
  });

  it("leaves fragment-free targets untouched", () => {
    expect(stripWikiFragment("Places/Blackreach.md")).toBe("Places/Blackreach.md");
  });
});

describe("wikiStem", () => {
  it("drops the fragment before deriving the stem", () => {
    expect(wikiStem("Events/The Severance.md#Aftermath")).toBe("The Severance");
  });

  it("last segment with .md stripped", () => {
    expect(wikiStem("Places/Blackreach.md")).toBe("Blackreach");
  });
});
