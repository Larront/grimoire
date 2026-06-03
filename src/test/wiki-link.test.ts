import { describe, it, expect } from "vitest";
import { parseWikiTarget, preprocessWikiLinks } from "$lib/editor/wiki-link";

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
});

// ─── preprocessWikiLinks (existing load-time behavior) ────────────────────────

describe("preprocessWikiLinks", () => {
  it("converts [[Name]] to a data-wiki-link span", () => {
    const out = preprocessWikiLinks("See [[Blackreach]] now");
    expect(out).toContain("data-wiki-link");
    expect(out).toContain('data-path="Blackreach"');
  });
});
