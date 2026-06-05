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

  it("bare path: data-title is the stem (no .md)", () => {
    const out = preprocessWikiLinks("[[Places/Blackreach.md]]");
    expect(out).toContain('data-path="Places/Blackreach.md"');
    expect(out).toContain('data-title="Blackreach"');
  });

  it("pipe display: data-path is path only, data-title is the alias", () => {
    const out = preprocessWikiLinks("[[Locations/The Ember Keep.md|the keep]]");
    expect(out).toContain('data-path="Locations/The Ember Keep.md"');
    expect(out).toContain('data-title="the keep"');
    expect(out).toContain(">the keep<");
  });

  it("pipe display: path does not include the pipe or alias", () => {
    const out = preprocessWikiLinks("[[Notes/Something.md|short]]");
    expect(out).not.toContain("data-path=\"Notes/Something.md|short\"");
    expect(out).toContain('data-path="Notes/Something.md"');
  });

  it("multiple links including one with display alias", () => {
    const out = preprocessWikiLinks("[[Alpha]] and [[Beta/Note.md|B]]");
    expect(out).toContain('data-path="Alpha"');
    expect(out).toContain('data-path="Beta/Note.md"');
    expect(out).toContain('data-title="B"');
  });
});
