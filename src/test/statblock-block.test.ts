// The Statblock's format (#177) — the fenced ```statblock body: an optional `#` name,
// a header of Labelled Rows, then `## Section`s of named entries.
//
// The seam is the one ADR-0016 §2 rule 3 mandates: exported pure functions, no editor
// and no DOM. Text in, records out, text back. Playability is #178's; here a value is
// structure, and `HP: 12/12` is characters like any other.
import { describe, it, expect } from "vitest";
import { fireEvent } from "@testing-library/svelte";
import { Editor } from "@tiptap/core";
import {
  parseStatblockBody,
  serializeStatblock,
  blankStatblock,
  entryBodyText,
  type Statblock,
} from "$lib/editor/statblock-block";
import { noteExtensions } from "$lib/editor/note-extensions";
import { filterCommands } from "$lib/editor/slash-command";

/** The body of a fence, as the markdown reader hands it over. */
function body(...lines: string[]): string {
  return lines.join("\n");
}

/** A statblock record, with the parts a case is not about left at their empty values. */
function record(partial: Partial<Statblock>): Statblock {
  return { name: "", rows: [], sections: [], ...partial };
}

/** The body inside a serialized fence — what the markdown reader hands back. */
function fenceBody(fence: string): string {
  const lines = fence.split("\n");
  expect(lines[0]).toBe("```statblock");
  expect(lines[lines.length - 1]).toBe("```");
  return lines.slice(1, -1).join("\n");
}

const GOBLIN = body(
  "# Goblin Scout",
  "HP: 12",
  "Armor Class: 15",
  "",
  "## Actions",
  "Shortbow: +4 to hit, 1d6+2 piercing.",
  "",
  "Nimble Escape: Disengages or hides as a bonus action.",
);

// ─── Parsing ──────────────────────────────────────────────────────────────────

describe("parseStatblockBody", () => {
  it("reads the block the spec shows", () => {
    expect(parseStatblockBody(GOBLIN)).toEqual(
      record({
        name: "Goblin Scout",
        rows: [
          { label: "HP", value: "12" },
          { label: "Armor Class", value: "15" },
        ],
        sections: [
          {
            heading: "Actions",
            entries: [
              { name: "Shortbow", body: "+4 to hit, 1d6+2 piercing." },
              { name: "Nimble Escape", body: "Disengages or hides as a bonus action." },
            ],
          },
        ],
      }),
    );
  });

  it("reads an empty fence as an empty statblock", () => {
    expect(parseStatblockBody("")).toEqual(record({}));
  });

  it("reads a header with no name, which is a statblock without one", () => {
    expect(parseStatblockBody(body("HP: 12"))).toEqual(
      record({ rows: [{ label: "HP", value: "12" }] }),
    );
  });

  it("reads a fence with no sections as header-only", () => {
    expect(parseStatblockBody(body("# Aboleth", "HP: 120/135")).sections).toEqual([]);
  });

  it("reads a name-only fence", () => {
    expect(parseStatblockBody(body("# Aboleth"))).toEqual(record({ name: "Aboleth" }));
  });

  it("reads a lone hash as an empty name, the line below staying a row", () => {
    expect(parseStatblockBody(body("#", "# Not a name, a row")).rows).toEqual([
      { label: "", value: "# Not a name, a row" },
    ]);
  });

  it("reads a hash with no space as a row, not a name", () => {
    expect(parseStatblockBody(body("#Aboleth")).name).toBe("");
  });

  it("reads header rows exactly as an Infobox row is read", () => {
    // The one shared implementation, byte-identical per #150: a first-colon split,
    // one separating space, a colon in the value left whole.
    expect(parseStatblockBody(body("Attack: Melee: +9 to hit", "Speed:10 ft.")).rows).toEqual([
      { label: "Attack", value: "Melee: +9 to hit" },
      { label: "Speed", value: "10 ft." },
    ]);
  });

  it("drops the blank lines a GM put between header rows", () => {
    // The documented asymmetry: the serializer writes rows contiguously, so a blank
    // line between two of them is decoration and goes on the next autosave.
    expect(parseStatblockBody(body("HP: 12", "", "Armor Class: 15")).rows).toHaveLength(2);
  });

  it("reads a section with no entries", () => {
    expect(parseStatblockBody(body("## Actions")).sections).toEqual([
      { heading: "Actions", entries: [] },
    ]);
  });

  it("reads a bare double hash as a section with no heading", () => {
    expect(parseStatblockBody(body("##", "Bite: 1d6")).sections).toEqual([
      { heading: "", entries: [{ name: "Bite", body: "1d6" }] },
    ]);
  });

  it("reads several sections, keeping the GM's order", () => {
    expect(
      parseStatblockBody(body("## Traits", "Amphibious: It breathes water.", "", "## Actions", "Bite: 1d6")).sections.map(
        (s) => s.heading,
      ),
    ).toEqual(["Traits", "Actions"]);
  });

  it("reads an entry whose body holds colons", () => {
    expect(
      parseStatblockBody(body("## Actions", "Tentacle: Melee Weapon Attack: +9 to hit")).sections[0]
        .entries,
    ).toEqual([{ name: "Tentacle", body: "Melee Weapon Attack: +9 to hit" }]);
  });

  it("reads an entry whose body wraps across lines", () => {
    expect(
      parseStatblockBody(
        body(
          "## Actions",
          "Tentacle: Melee Weapon Attack: +9 to hit, reach 10 ft.,",
          "one target. Hit: 12 (2d6 + 5) bludgeoning damage.",
        ),
      ).sections[0].entries,
    ).toEqual([
      {
        name: "Tentacle",
        body: "Melee Weapon Attack: +9 to hit, reach 10 ft.,\none target. Hit: 12 (2d6 + 5) bludgeoning damage.",
      },
    ]);
  });

  it("reads a paragraph with no colon on its first line as unnamed prose", () => {
    expect(
      parseStatblockBody(body("## Legendary Actions", "The aboleth takes three actions.")).sections[0]
        .entries,
    ).toEqual([{ name: "", body: "The aboleth takes three actions." }]);
  });

  it("reads a section preamble before its first named entry", () => {
    expect(
      parseStatblockBody(
        body("## Legendary Actions", "It can take three, choosing from below.", "", "Detect: It makes a Wisdom check."),
      ).sections[0].entries,
    ).toEqual([
      { name: "", body: "It can take three, choosing from below." },
      { name: "Detect", body: "It makes a Wisdom check." },
    ]);
  });

  it("reads a leading colon as unnamed prose whose first line holds one", () => {
    // The shield `serializeStatblock` writes; read here so the pair stays inverse.
    expect(parseStatblockBody(body("## Lore", ": Rumour: the deep remembers.")).sections[0].entries).toEqual(
      [{ name: "", body: "Rumour: the deep remembers." }],
    );
  });

  it("keeps lines before the first section in the header, however they read", () => {
    // Position, not syntax: the same line is a row above the first `##`.
    expect(parseStatblockBody(body("Tentacle: Melee Weapon Attack: +9 to hit")).rows).toEqual([
      { label: "Tentacle", value: "Melee Weapon Attack: +9 to hit" },
    ]);
  });

  it("reads a hash-shaped line inside a section as prose, not as a name", () => {
    // The name is read at one position only, so a `#` line further down is content.
    expect(parseStatblockBody(body("## Lore", "# Not a name")).sections[0].entries).toEqual([
      { name: "", body: "# Not a name" },
    ]);
  });

  it("reads a triple hash as prose, because a section heading is exactly two", () => {
    expect(parseStatblockBody(body("## Lore", "### Deeper")).sections[0].entries).toEqual([
      { name: "", body: "### Deeper" },
    ]);
  });

  it("finds the name under leading blank lines", () => {
    expect(parseStatblockBody(body("", "# Aboleth", "HP: 12")).name).toBe("Aboleth");
  });

  it("stores nothing about an entry's kind", () => {
    // #150's load-bearing refusal: `## Actions` and `Relentless (3) - Passive:` are
    // alike just characters the GM typed, and no record here can say otherwise.
    const parsed = parseStatblockBody(
      body("## Features", "Relentless (3) - Passive: It rises once more."),
    );

    expect(Object.keys(parsed.sections[0])).toEqual(["heading", "entries"]);
    expect(Object.keys(parsed.sections[0].entries[0])).toEqual(["name", "body"]);
  });
});

// ─── Serializing ──────────────────────────────────────────────────────────────

describe("serializeStatblock", () => {
  it("writes an empty statblock as an empty fence", () => {
    expect(serializeStatblock(record({}))).toBe("```statblock\n```");
  });

  it("drops a row the GM typed nothing into rather than writing a blank line", () => {
    expect(serializeStatblock(blankStatblock())).toBe("```statblock\n```");
  });

  it("writes the name, the header and the sections in that order", () => {
    expect(
      serializeStatblock(
        record({
          name: "Goblin Scout",
          rows: [{ label: "HP", value: "12" }],
          sections: [{ heading: "Actions", entries: [{ name: "Bite", body: "1d6" }] }],
        }),
      ),
    ).toBe(body("```statblock", "# Goblin Scout", "HP: 12", "", "## Actions", "Bite: 1d6", "```"));
  });

  it("separates entries with a blank line, which is what makes them separate", () => {
    expect(
      serializeStatblock(
        record({
          sections: [
            {
              heading: "Actions",
              entries: [
                { name: "Bite", body: "1d6" },
                { name: "Claw", body: "1d4" },
              ],
            },
          ],
        }),
      ),
    ).toBe(body("```statblock", "## Actions", "Bite: 1d6", "", "Claw: 1d4", "```"));
  });

  it("writes a section with no entries as its heading alone", () => {
    expect(serializeStatblock(record({ sections: [{ heading: "Actions", entries: [] }] }))).toBe(
      "```statblock\n## Actions\n```",
    );
  });

  it("writes an empty heading as a bare double hash", () => {
    expect(
      serializeStatblock(record({ sections: [{ heading: "", entries: [{ name: "Bite", body: "1d6" }] }] })),
    ).toBe(body("```statblock", "##", "Bite: 1d6", "```"));
  });

  it("writes unnamed prose as itself", () => {
    expect(
      serializeStatblock(
        record({ sections: [{ heading: "Lore", entries: [{ name: "", body: "It remembers." }] }] }),
      ),
    ).toBe(body("```statblock", "## Lore", "It remembers.", "```"));
  });

  it("shields unnamed prose whose first line holds a colon", () => {
    // Unshielded it would read back as an entry named "Rumour" — the Labelled Row's
    // own leading-`: ` marker, doing the same job one region down.
    expect(
      serializeStatblock(
        record({
          sections: [{ heading: "Lore", entries: [{ name: "", body: "Rumour: the deep remembers." }] }],
        }),
      ),
    ).toBe(body("```statblock", "## Lore", ": Rumour: the deep remembers.", "```"));
  });

  it("shields unnamed prose whose first line would read back as a section", () => {
    expect(
      serializeStatblock(
        record({ sections: [{ heading: "Lore", entries: [{ name: "", body: "## Deeper" }] }] }),
      ),
    ).toBe(body("```statblock", "## Lore", ": ## Deeper", "```"));
  });

  it("shields a header row that would read back as a section", () => {
    expect(serializeStatblock(record({ rows: [{ label: "", value: "## Actions" }] }))).toBe(
      body("```statblock", ": ## Actions", "```"),
    );
  });

  it("shields a first row that would read back as the name", () => {
    expect(serializeStatblock(record({ rows: [{ label: "", value: "# The deep" }] }))).toBe(
      body("```statblock", "#", "# The deep", "```"),
    );
  });

  it("needs no name shield when the statblock has a name", () => {
    expect(
      serializeStatblock(record({ name: "Aboleth", rows: [{ label: "", value: "# The deep" }] })),
    ).toBe(body("```statblock", "# Aboleth", "# The deep", "```"));
  });

  it("drops a row holding nothing but whitespace, which reads back as nothing", () => {
    expect(serializeStatblock(record({ rows: [{ label: "", value: " " }] }))).toBe(
      "```statblock\n```",
    );
  });

  it("drops an entry the GM typed nothing into", () => {
    expect(
      serializeStatblock(
        record({ sections: [{ heading: "Actions", entries: [{ name: "", body: "" }] }] }),
      ),
    ).toBe("```statblock\n## Actions\n```");
  });

  it("writes an entry with a name and no body as a bare label", () => {
    expect(
      serializeStatblock(
        record({ sections: [{ heading: "Actions", entries: [{ name: "Bite", body: "" }] }] }),
      ),
    ).toBe(body("```statblock", "## Actions", "Bite:", "```"));
  });

  it("writes a value that looks playable as the characters it is", () => {
    // Playability is #178's. Here `120/135` and `[x][ ]` are text, and the format
    // neither knows nor writes anything about them.
    expect(
      serializeStatblock(
        record({
          rows: [
            { label: "HP", value: "120/135" },
            { label: "Conditions", value: "[x] Prone [ ] Charmed" },
          ],
        }),
      ),
    ).toBe(body("```statblock", "HP: 120/135", "Conditions: [x] Prone [ ] Charmed", "```"));
  });
});

// ─── Round trip ───────────────────────────────────────────────────────────────
//
// ADR-0016 §2 rule 3, and this ticket's leading criterion: `parse(serialize(x))`
// equals `x`, byte for byte — asserted without trimming, because a trailing newline
// the round trip quietly normalised is exactly the silent self-corruption the rule
// exists to catch.

describe("a statblock round-trips byte for byte", () => {
  const BLOCKS: [string, Statblock][] = [
    ["an empty statblock", record({})],
    ["a name only", record({ name: "Aboleth" })],
    ["a header with no name", record({ rows: [{ label: "HP", value: "12" }] })],
    [
      "the block the spec shows",
      record({
        name: "Goblin Scout",
        rows: [
          { label: "HP", value: "12" },
          { label: "Armor Class", value: "15" },
        ],
        sections: [
          {
            heading: "Actions",
            entries: [
              { name: "Shortbow", body: "+4 to hit, 1d6+2 piercing." },
              { name: "Nimble Escape", body: "Disengages or hides as a bonus action." },
            ],
          },
        ],
      }),
    ],
    [
      "the same line as a header row and as an entry",
      record({
        rows: [{ label: "Tentacle", value: "Melee Weapon Attack: +9 to hit" }],
        sections: [
          {
            heading: "Actions",
            entries: [{ name: "Tentacle", body: "Melee Weapon Attack: +9 to hit" }],
          },
        ],
      }),
    ],
    [
      "an entry whose body holds colons",
      record({
        sections: [
          {
            heading: "Actions",
            entries: [{ name: "Tentacle", body: "Hit: 12 (2d6 + 5) bludgeoning damage." }],
          },
        ],
      }),
    ],
    [
      "an entry whose body wraps across lines",
      record({
        sections: [
          {
            heading: "Actions",
            entries: [
              {
                name: "Tentacle",
                body: "Melee Weapon Attack: +9 to hit, reach 10 ft.,\none target. Hit: 12 damage.",
              },
            ],
          },
        ],
      }),
    ],
    [
      "unnamed prose",
      record({
        sections: [{ heading: "Description", entries: [{ name: "", body: "It remembers." }] }],
      }),
    ],
    [
      "unnamed prose holding a colon",
      record({
        sections: [{ heading: "Lore", entries: [{ name: "", body: "Rumour: the deep remembers." }] }],
      }),
    ],
    [
      "a section with a preamble before its first named entry",
      record({
        sections: [
          {
            heading: "Legendary Actions",
            entries: [
              { name: "", body: "It can take three, choosing from below." },
              { name: "Detect", body: "It makes a Wisdom check." },
            ],
          },
        ],
      }),
    ],
    ["a section with no entries", record({ sections: [{ heading: "Actions", entries: [] }] })],
    [
      "an empty section heading",
      record({ sections: [{ heading: "", entries: [{ name: "Bite", body: "1d6" }] }] }),
    ],
    [
      "several sections",
      record({
        name: "Aboleth",
        rows: [{ label: "HP", value: "120/135" }],
        sections: [
          { heading: "Traits", entries: [{ name: "Amphibious", body: "It breathes air and water." }] },
          { heading: "Actions", entries: [{ name: "Tentacle", body: "+9 to hit." }] },
          { heading: "Legendary Actions", entries: [{ name: "", body: "Three per round." }] },
        ],
      }),
    ],
    ["an empty row value", record({ rows: [{ label: "HP", value: "" }] })],
    ["an unlabelled header row", record({ rows: [{ label: "", value: "A creature of the deep" }] })],
    [
      "an unlabelled header row holding a colon",
      record({ rows: [{ label: "", value: "see: the ledger" }] }),
    ],
    ["a header row that looks like the name", record({ rows: [{ label: "", value: "# The deep" }] })],
    [
      "a header row that looks like a section",
      record({ rows: [{ label: "", value: "## Actions" }] }),
    ],
    ["a row whose label is a space", record({ rows: [{ label: " ", value: "" }] })],
    ["a value that is only spaces", record({ rows: [{ label: "Note", value: "  " }] })],
    [
      "unnamed prose that looks like a section",
      record({ sections: [{ heading: "Lore", entries: [{ name: "", body: "## Deeper" }] }] }),
    ],
    [
      "unnamed prose that looks like the name",
      record({ sections: [{ heading: "Lore", entries: [{ name: "", body: "# The deep" }] }] }),
    ],
    ["an entry with a name and no body", record({ sections: [{ heading: "Actions", entries: [{ name: "Bite", body: "" }] }] })],
    [
      "a value the next ticket will make playable",
      record({
        rows: [
          { label: "HP", value: "120/135" },
          { label: "Spell Slots", value: "[x][ ][ ]" },
          { label: "Conditions", value: "[x] Prone [ ] Charmed" },
        ],
      }),
    ],
    [
      "wikilinks in a row value and an entry body",
      record({
        rows: [{ label: "Served", value: "[[People/Ash.md|the Captain]]" }],
        sections: [
          { heading: "Lore", entries: [{ name: "Bound", body: "Sworn to [[Captain Ash]]." }] },
        ],
      }),
    ],
    [
      "a system Grimoire has never heard of",
      record({
        name: "Kobold A",
        rows: [
          { label: "Difficulty", value: "14" },
          { label: "Thresholds", value: "8/15" },
          { label: "港", value: "四千二百" },
        ],
        sections: [
          {
            heading: "Features",
            entries: [{ name: "Relentless (3) - Passive", body: "It rises once more." }],
          },
        ],
      }),
    ],
  ];

  it.each(BLOCKS)("round-trips %s", (_what, block) => {
    expect(parseStatblockBody(fenceBody(serializeStatblock(block)))).toEqual(block);
  });

  it("round-trips a body a GM hand-wrote in Obsidian", () => {
    const parsed = parseStatblockBody(GOBLIN);

    expect(serializeStatblock(parsed)).toBe(["```statblock", GOBLIN, "```"].join("\n"));
    expect(parseStatblockBody(fenceBody(serializeStatblock(parsed)))).toEqual(parsed);
  });
});

// ─── The normalisations, stated rather than discovered ────────────────────────
//
// Two things a hand-authored fence loses on the next autosave. Both are decided
// here rather than left to fall out of the code, because an undecided answer means
// the round-trip test passes while autosave rewrites the GM's file.

describe("a statblock normalises decoration and nothing else", () => {
  it("drops a hand-authored blank line between header rows", () => {
    // The one asymmetry #150 documented: the serializer writes rows contiguously.
    const parsed = parseStatblockBody(body("HP: 12", "", "Armor Class: 15"));

    expect(serializeStatblock(parsed)).toBe(
      body("```statblock", "HP: 12", "Armor Class: 15", "```"),
    );
  });

  it("drops a trailing newline inside the fence", () => {
    // The boundary the prototype papered over by comparing against `s.trim()`.
    // Decided: a trailing blank line is decoration, like every other blank line
    // outside an entry, and is normalised away rather than preserved.
    expect(serializeStatblock(parseStatblockBody(body("HP: 12", "", "")))).toBe(
      body("```statblock", "HP: 12", "```"),
    );
  });

  it("drops a blank line under a section heading", () => {
    expect(
      serializeStatblock(parseStatblockBody(body("## Actions", "", "Bite: 1d6"))),
    ).toBe(body("```statblock", "## Actions", "Bite: 1d6", "```"));
  });

  it("keeps a blank line inside nothing, because an entry cannot hold one", () => {
    // A blank line is what separates two entries, so it is never inside one — which
    // is ADR-0007's Timeline wart, inherited knowingly rather than rediscovered.
    const parsed = parseStatblockBody(body("## Actions", "Bite: 1d6", "", "still biting"));

    expect(parsed.sections[0].entries).toEqual([
      { name: "Bite", body: "1d6" },
      { name: "", body: "still biting" },
    ]);
  });

  it("reads two adjacent entry-shaped lines as one entry with a wrapped body", () => {
    // Blank-line separation is the rule, so adjacency means continuation. Stated as
    // a test because the shape reads like two entries to a GM who has not met it.
    expect(
      parseStatblockBody(body("## Actions", "Shortbow: +4 to hit.", "Nimble Escape: It hides."))
        .sections[0].entries,
    ).toEqual([{ name: "Shortbow", body: "+4 to hit.\nNimble Escape: It hides." }]);
  });
});

// ─── The entry body's restriction ─────────────────────────────────────────────
//
// What keeps the round trip *total* rather than nearly total: parsing can never
// produce a body holding a blank line or a section-shaped line after its first, and
// the field that edits one must not either — the same reason a Labelled Row's label
// loses a typed colon.

describe("entryBodyText", () => {
  it("leaves ordinary prose alone, wrapped lines included", () => {
    expect(entryBodyText("Melee Weapon Attack: +9 to hit,\none target.")).toBe(
      "Melee Weapon Attack: +9 to hit,\none target.",
    );
  });

  it("drops a blank line, which would split the entry in two", () => {
    expect(entryBodyText("First thought.\n\nSecond thought.")).toBe(
      "First thought.\nSecond thought.",
    );
  });

  it("takes the marker off a later line that would read back as a section", () => {
    expect(entryBodyText("It bites.\n## Actions")).toBe("It bites.\nActions");
  });

  it("leaves the first line's marker alone, because that line is shielded instead", () => {
    // The shield costs the GM no characters, so it is preferred wherever a line can
    // carry one — and only the entry's first line can.
    expect(entryBodyText("## Actions")).toBe("## Actions");
  });

  it("leaves a deeper heading alone, because only two hashes open a section", () => {
    expect(entryBodyText("### Deeper")).toBe("### Deeper");
  });

  it("leaves a colon alone, which is a body's to hold", () => {
    expect(entryBodyText("Hit: 12 damage")).toBe("Hit: 12 damage");
  });
});

// ─── Insertion ────────────────────────────────────────────────────────────────

describe("/statblock", () => {
  function editor(content = "<p></p>"): Editor {
    return new Editor({ extensions: noteExtensions(), content });
  }

  // Insertion resolves a preset first (#179), so the command is async even when — as
  // here, with no preset store and no vault default — it resolves to nothing.
  it("inserts a statblock with somewhere to type", async () => {
    const ed = editor();
    try {
      await filterCommands("statblock")[0].command(ed, { from: 1, to: 1 }, "");

      const block = ed.getJSON().content?.[0];
      expect(block?.type).toBe("statblockBlock");
      expect(block?.attrs).toEqual(blankStatblock());
      // Nothing typed yet, so the fence the GM's file would receive is empty.
      expect(ed.getMarkdown().trimEnd()).toBe("```statblock\n```");
    } finally {
      ed.destroy();
    }
  });

  it("lets a note hold more than one statblock", () => {
    const ed = editor();
    try {
      ed.commands.setContent([
        { type: "statblockBlock", attrs: { ...blankStatblock(), name: "Kobold A" } },
        { type: "paragraph", content: [{ type: "text", text: "Prose between." }] },
        { type: "statblockBlock", attrs: { ...blankStatblock(), name: "Kobold B" } },
      ]);

      expect(ed.getJSON().content?.filter((n) => n.type === "statblockBlock")).toHaveLength(2);
      expect(ed.getMarkdown().split("```statblock")).toHaveLength(3);
    } finally {
      ed.destroy();
    }
  });

  it("keeps its name, rows and sections when the block is copied inside the editor", () => {
    const source = editor();
    let html = "";
    try {
      source.commands.insertContent({
        type: "statblockBlock",
        attrs: record({
          name: "Goblin Scout",
          rows: [{ label: "HP", value: "12" }],
          sections: [{ heading: "Actions", entries: [{ name: "Bite", body: "1d6" }] }],
        }),
      });
      html = source.getHTML();
    } finally {
      source.destroy();
    }

    const pasted = editor(html);
    try {
      const block = pasted.getJSON().content?.find((n) => n.type === "statblockBlock");
      expect(block?.attrs?.name).toBe("Goblin Scout");
      expect(block?.attrs?.rows).toEqual([{ label: "HP", value: "12" }]);
      expect(block?.attrs?.sections).toEqual([
        { heading: "Actions", entries: [{ name: "Bite", body: "1d6" }] },
      ]);
    } finally {
      pasted.destroy();
    }
  });
});

// ─── Play, in a real editor ───────────────────────────────────────────────────
//
// The one assertion #153's prototype could not make, because it had no ProseMirror
// history: **a play commit starts its own undo group.** `prosemirror-history` folds
// adjacent steps together inside 500 ms, so a Ctrl+Z after typing a sentence must not
// reach back into the hit and heal the goblin.
//
// The mechanism is the shared connector's `closeHistory`, asserted directly in
// node-view-connector.test.ts. What is asserted here is the *outcome*, through a real
// gesture in a real editor: the whole path from a click on a pool to what the document
// says after one undo, which is the only place the two halves are seen together.

describe("a hit is its own undo step", () => {
  function poolControl(ed: Editor): HTMLElement {
    const el = ed.view.dom.querySelector<HTMLElement>('[aria-label="Row 1 current value"]');
    if (!el) throw new Error("the pool's current half is not on screen");
    return el;
  }

  function rows(ed: Editor): { label: string; value: string }[] {
    const block = ed.getJSON().content?.find((n) => n.type === "statblockBlock");
    return block?.attrs?.rows ?? [];
  }

  it("undoes the hit rather than the sentence typed just before it", async () => {
    const ed = new Editor({
      extensions: noteExtensions(),
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "The goblin " }] },
          { type: "statblockBlock", attrs: record({ rows: [{ label: "HP", value: "43/59" }] }) },
        ],
      },
    });

    try {
      // A prose edit immediately before the hit, at the end of the paragraph the block
      // sits under: adjacent in *time* and in *position*, which is both halves of what
      // `prosemirror-history` groups on.
      ed.commands.insertContentAt(12, "charges.");
      expect(ed.getText()).toContain("The goblin charges.");

      await fireEvent.click(poolControl(ed));
      const input = poolControl(ed) as HTMLInputElement;
      await fireEvent.input(input, { target: { value: "-7" } });
      await fireEvent.keyDown(input, { key: "Enter" });

      expect(rows(ed)[0].value).toBe("36/59");

      ed.commands.undo();

      expect(rows(ed)[0].value).toBe("43/59");
      expect(ed.getText()).toContain("The goblin charges.");
    } finally {
      ed.destroy();
    }
  });
});
