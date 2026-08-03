// The wikilink hover preview's text (#168).
//
// The reported bug: a Bestiary note opens with a ```statblock fence, so the GM
// hovering a link to it saw backticks. The fix has to survive the harder half of
// that case — a note that is *nothing but* fence, where stripping the fences would
// leave an empty tooltip rather than a wrong one.
//
// What is deliberately *not* asserted away here is the brackets on a wikilink:
// #156 ruled out showing a filed link as flat text, and the excerpt keeps its
// notation honest rather than dressing a dead link up as a live one.
import { describe, it, expect } from "vitest";
import { noteExcerpt } from "$lib/editor/note-excerpt";
import { wikiFragment } from "$lib/editor/wiki-target";

// ─── The reported bug ─────────────────────────────────────────────────────────

describe("a fence", () => {
  it("becomes its name rather than its backticks", () => {
    const body = "```statblock\n# Goblin Scout\nHP: 3/12\nArmor Class: 15\n```";
    expect(noteExcerpt(body)).toBe("Statblock — Goblin Scout");
  });

  it("leaves a note that is all fence with something to read", () => {
    const body =
      "```statblock\n# Goblin Scout\nHP: 3/12\n```\n\n```statblock\n# Goblin Boss\nHP: 21\n```";
    expect(noteExcerpt(body)).toBe(
      "Statblock — Goblin Scout\n\nStatblock — Goblin Boss",
    );
  });

  it("names an Infobox and a Scene by the same convention", () => {
    expect(
      noteExcerpt("```infobox\n# Harbor's End\nRuler: [[Aldric]]\n```"),
    ).toBe("Infobox — Harbor's End");
    expect(noteExcerpt("```scene\n# Boss Battle\nId: 4\n```")).toBe(
      "Scene — Boss Battle",
    );
  });

  it("falls back to the bare type when the block has no name", () => {
    expect(noteExcerpt("```statblock\nHP: 3/12\n```")).toBe("Statblock");
    expect(noteExcerpt("```infobox\n#\nRuler: Aldric\n```")).toBe("Infobox");
  });

  it("counts a Timeline instead of naming it after its first event", () => {
    const body =
      "```timeline\n# The Ambush\nDate: 1247\n\n# The Retreat\nDate: 1248\n```";
    expect(noteExcerpt(body)).toBe("Timeline — 2 events");
  });

  it("counts one event in the singular, and an empty timeline not at all", () => {
    expect(noteExcerpt("```timeline\n# The Ambush\n```")).toBe(
      "Timeline — 1 event",
    );
    expect(noteExcerpt("```timeline\n```")).toBe("Timeline");
  });

  it("calls a GM's code fence code, not a Grimoire block", () => {
    expect(noteExcerpt("```python\nprint('hi')\n```")).toBe("Code — python");
    expect(noteExcerpt("```\nplain\n```")).toBe("Code");
  });

  it("reads a tilde fence, and one that is never closed", () => {
    expect(noteExcerpt("~~~statblock\n# Goblin Scout\n~~~")).toBe(
      "Statblock — Goblin Scout",
    );
    expect(noteExcerpt("Intro\n\n```statblock\n# Goblin Scout\nHP: 3")).toBe(
      "Intro\n\nStatblock — Goblin Scout",
    );
  });
});

// ─── The notation around it ───────────────────────────────────────────────────

describe("block notation", () => {
  it("drops heading hashes and list markers, keeping the words", () => {
    const body =
      "# Goblin Scout\n\n## Tactics\n\n- Flanks the party\n1. Then flees";
    expect(noteExcerpt(body)).toBe(
      "Goblin Scout\n\nTactics\n\nFlanks the party\nThen flees",
    );
  });

  it("unwraps a blockquote and names a callout by its type and title", () => {
    expect(
      noteExcerpt("> [!warning] The bridge is out\n> Cross at your peril"),
    ).toBe("Warning — The bridge is out\nCross at your peril");
    expect(noteExcerpt("> [!read-aloud]\n> The door creaks")).toBe(
      "Read Aloud\nThe door creaks",
    );
  });

  it("sees a fence nested inside a callout", () => {
    const body =
      "> [!note] The Ambush\n> ```statblock\n> # Goblin Scout\n> ```";
    expect(noteExcerpt(body)).toBe(
      "Note — The Ambush\nStatblock — Goblin Scout",
    );
  });

  it("names an image by its alt text", () => {
    expect(noteExcerpt("![The harbor at dusk](media/harbor.png)")).toBe(
      "Image — The harbor at dusk",
    );
    expect(noteExcerpt("![](media/harbor.png)")).toBe("Image");
  });

  it("drops a thematic break and an empty heading without leaving a gap", () => {
    expect(noteExcerpt("Above\n\n---\n\nBelow")).toBe("Above\n\nBelow");
  });
});

describe("inline notation", () => {
  it("strips emphasis, strikethrough and inline code", () => {
    expect(
      noteExcerpt("The **bridge** is *out* and ~~safe~~ per `config.toml`"),
    ).toBe("The bridge is out and safe per config.toml");
  });

  it("keeps a wikilink's brackets, and takes a markdown link's text", () => {
    expect(
      noteExcerpt("Ruled by [[People/Aldric|Aldric]], see [the map](map.png)"),
    ).toBe("Ruled by [[People/Aldric|Aldric]], see the map");
  });

  it("leaves underscores alone so file_names survive", () => {
    expect(noteExcerpt("See goblin_scout.md for the stat_block")).toBe(
      "See goblin_scout.md for the stat_block",
    );
  });
});

// ─── The fragment a link points at ────────────────────────────────────────────

describe("a link into a section", () => {
  const body =
    "# Goblin Scout\n\nA small raider.\n\n## Tactics\n\nFlanks, then flees.";

  it("opens the excerpt at the heading rather than the top of the note", () => {
    expect(noteExcerpt(body, "Tactics")).toBe("Tactics\n\nFlanks, then flees.");
  });

  it("matches a heading without minding its case", () => {
    expect(noteExcerpt(body, "tactics")).toBe("Tactics\n\nFlanks, then flees.");
  });

  it("shows the whole note when the fragment names nothing", () => {
    expect(noteExcerpt(body, "Loot")).toBe(noteExcerpt(body));
    expect(noteExcerpt(body, "^abc123")).toBe(noteExcerpt(body));
  });

  it("is not fooled by a fence's name line", () => {
    const fenced =
      "```statblock\n# Tactics\n```\n\n## Tactics\n\nFlanks, then flees.";
    expect(noteExcerpt(fenced, "Tactics")).toBe(
      "Tactics\n\nFlanks, then flees.",
    );
  });

  it("reads the fragment off the path the preview is given", () => {
    expect(wikiFragment("Bestiary/Goblin Scout#Tactics")).toBe("Tactics");
    expect(wikiFragment("Bestiary/Goblin Scout")).toBe("");
  });
});
