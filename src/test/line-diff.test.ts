import { describe, it, expect } from "vitest";
import { diffLines, diffHunks } from "../lib/utils/line-diff";

describe("diffLines", () => {
  it("finds nothing between two copies", () => {
    expect(diffLines("a\nb", "a\nb").every((l) => l.kind === "same")).toBe(true);
  });

  it("says which side a changed line is from", () => {
    expect(diffLines("a\nmine\nc", "a\ntheirs\nc")).toEqual([
      { kind: "same", text: "a" },
      { kind: "theirs", text: "theirs" },
      { kind: "mine", text: "mine" },
      { kind: "same", text: "c" },
    ]);
  });

  it("keeps lines only one side added", () => {
    const lines = diffLines("a\nc", "a\nb\nc");
    expect(lines.filter((l) => l.kind !== "same")).toEqual([{ kind: "theirs", text: "b" }]);
  });
});

describe("diffHunks", () => {
  it("keeps one shared line either side of a change, and drops the rest", () => {
    const text = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`);
    const mine = text(20);
    const theirs = [...mine];
    theirs[10] = "changed";
    const hunks = diffHunks(diffLines(mine.join("\n"), theirs.join("\n")));
    expect(hunks).toHaveLength(1);
    expect(hunks[0].map((l) => l.text)).toEqual(["line 9", "changed", "line 10", "line 11"]);
  });

  it("splits changes far apart into separate runs", () => {
    const mine = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    const theirs = [...mine];
    theirs[2] = "early";
    theirs[17] = "late";
    expect(diffHunks(diffLines(mine.join("\n"), theirs.join("\n")))).toHaveLength(2);
  });
});
