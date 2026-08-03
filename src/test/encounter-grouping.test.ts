// Encounter grouping (#182) — a fight, grouped, and played on.
//
// **There is no Encounter block, and nothing here adds one.** #151 found that an
// [[Encounter]] is a *note*: grouping is the heading or the callout the GM wrapped the
// fight in, ordering is where the fences sit, per-instance naming is `# Kobold A`
// inside the fence, and collapse is already per-block. Grimoire acquires no concept of
// a fight, so every assertion below is about a Statblock and a Callout doing their own
// jobs in each other's company.
//
// This is the integration neither ticket alone proves. Before blocks declared
// themselves to the markdown reader (#174), the raw fence scan only worked at column
// zero — so a statblock inside `> [!encounter] The Ambush` round-tripped through the
// file intact and rendered as a **dead grey code box** (#158). The declaration model
// and the container node view meet here, in the case that would have shipped broken.
//
// The seam is a real editor with real node views (`fixtures/note-editor.ts`): markdown
// in, a gesture, markdown out. The fence's grammar is pinned in statblock-block.test.ts,
// the claim in block-markdown.test.ts, the view's own gestures in
// statblock-block-view.test.ts. What only this file can show is those parts at depth.
import { fireEvent } from "@testing-library/svelte";
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { Editor } from "@tiptap/core";
import { parseFrontmatter } from "$lib/utils";
import { closeNote, dom, note, saved } from "./fixtures/note-editor";

vi.mock("$lib/stores/link-resolver.svelte", () => ({
  linkResolver: { isKnown: () => true, prime: vi.fn(), resolve: vi.fn() },
}));

afterEach(closeNote);

// ─── Harness ──────────────────────────────────────────────────────────────────

/** Every statblock the GM can see, in document order. */
function statblocks(editor: Editor): HTMLElement[] {
  return [...dom(editor).querySelectorAll<HTMLElement>(".statblock-block")];
}

/** One control inside one statblock, addressed the way a GM points at it. */
function control(editor: Editor, index: number, label: string): HTMLElement {
  const found = statblocks(editor)[index]?.querySelector<HTMLElement>(
    `[aria-label="${label}"]`,
  );
  expect(found, `statblock ${index + 1} has a "${label}"`).toBeTruthy();
  return found!;
}

/** A hit taken on a nested statblock's pool, typed and committed as a GM types it. */
async function hit(editor: Editor, index: number, delta: string) {
  await fireEvent.click(control(editor, index, "Row 1 current value"));
  const field = control(editor, index, "Row 1 current value");
  await fireEvent.input(field, { target: { value: delta } });
  await fireEvent.keyDown(field, { key: "Enter" });
}

/** A fight of `count` kobolds, each its own fence, inside one callout. */
function ambush(count: number): string {
  const names = "ABCDEFGHIJKL".slice(0, count).split("");
  return [
    "> [!encounter] The Ambush",
    ...names.flatMap((name, index) => [
      ...(index > 0 ? [">"] : []),
      "> ```statblock",
      `> # Kobold ${name}`,
      "> HP: 5/5",
      "> ```",
    ]),
  ].join("\n");
}

/**
 * One kobold in a box, carrying both playable shapes — a pool on row 1 and a mark
 * track on row 2, which is a fight in miniature.
 */
const ONE_KOBOLD = [
  "> [!encounter] The Ambush",
  "> ```statblock",
  "> # Kobold A",
  "> HP: 5/5",
  "> Conditions: [ ] Prone [ ] Charmed",
  "> ```",
].join("\n");

/** The same note one container further down, so "at depth" is one call rather than a copy. */
function oneDeeper(markdown: string): string {
  return [
    "> [!note] The Lower Halls",
    ...markdown.split("\n").map((line) => `> ${line}`),
  ].join("\n");
}

// ─── Rendering at depth ───────────────────────────────────────────────────────

describe("a statblock inside a callout is a statblock", () => {
  it("renders as a statblock rather than a dead grey code box", () => {
    const editor = note(ONE_KOBOLD);

    expect(statblocks(editor)).toHaveLength(1);
    expect(statblocks(editor)[0]).toHaveTextContent("Kobold A");
    expect(dom(editor).querySelector("pre")).toBeNull();
  });

  it("sits inside the callout's body rather than beside it", () => {
    // The box groups them visually because the fences are the callout's children —
    // which is the whole of the grouping mechanism. Nothing draws a group.
    const editor = note(ONE_KOBOLD);
    const hole = dom(editor).querySelector("[data-node-view-content]");

    expect(hole?.contains(statblocks(editor)[0])).toBe(true);
  });

  it("renders at any nesting depth, not just one down", () => {
    const editor = note(oneDeeper(ONE_KOBOLD));

    expect(statblocks(editor)).toHaveLength(1);
    expect(dom(editor).querySelector("pre")).toBeNull();
  });

  it("renders inside a list inside a callout", () => {
    const editor = note(
      [
        "> [!encounter] The Ambush",
        "> - the one with the sling",
        ">",
        ">   ```statblock",
        ">   # Kobold A",
        ">   HP: 5/5",
        ">   ```",
      ].join("\n"),
    );

    expect(statblocks(editor)).toHaveLength(1);
    expect(dom(editor).querySelector("pre")).toBeNull();
  });
});

// ─── Playing on one ───────────────────────────────────────────────────────────

describe("a nested statblock is played on normally", () => {
  it("takes a hit, writing the arithmetic into the fence it came from", async () => {
    const editor = note(ONE_KOBOLD);
    await hit(editor, 0, "-2");

    expect(saved(editor)).toBe(ONE_KOBOLD.replace("HP: 5/5", "HP: 3/5"));
  });

  it("ticks a mark, leaving every other line of the fence alone", async () => {
    const editor = note(ONE_KOBOLD);
    await fireEvent.click(control(editor, 0, "Row 2 mark 1: Prone"));

    expect(saved(editor)).toBe(ONE_KOBOLD.replace("[ ] Prone", "[x] Prone"));
  });

  it("keeps the callout's own header untouched by a hit", async () => {
    // The write is `setNodeMarkup` at the statblock's position, so the quote around it
    // is not rewritten — the title and type the GM typed are not in the blast radius.
    const editor = note(ONE_KOBOLD);
    await hit(editor, 0, "-2");

    expect(saved(editor).split("\n")[0]).toBe("> [!encounter] The Ambush");
  });

  it("makes a hit one undo step, taking back the damage and nothing else", async () => {
    const editor = note(ONE_KOBOLD);
    await hit(editor, 0, "-2");
    editor.commands.undo();

    expect(saved(editor)).toBe(ONE_KOBOLD);
  });

  it("ticks the mark of the creature the GM clicked, not its identical neighbour", async () => {
    // Two fences of the same shape in one box is the case a position that drifted by
    // one node would pass silently — every creature in a fight looks like this.
    const md = [
      "> [!encounter] The Ambush",
      "> ```statblock",
      "> # Kobold A",
      "> Conditions: [ ] Prone",
      "> ```",
      ">",
      "> ```statblock",
      "> # Kobold B",
      "> Conditions: [ ] Prone",
      "> ```",
    ].join("\n");
    const editor = note(md);
    await fireEvent.click(control(editor, 1, "Row 1 mark 1: Prone"));

    expect(saved(editor)).toBe(
      md.replace("> # Kobold B\n> Conditions: [ ] Prone", "> # Kobold B\n> Conditions: [x] Prone"),
    );
  });

  it("plays on a statblock two containers deep just as readily", async () => {
    // Rendering at depth is pinned above; this is the other half of "at any nesting
    // depth" — the write finds its fence through two blockquotes as well as one.
    const md = oneDeeper(ONE_KOBOLD);
    const editor = note(md);
    await hit(editor, 0, "-2");
    await fireEvent.click(control(editor, 0, "Row 2 mark 1: Prone"));

    expect(saved(editor)).toBe(
      md.replace("HP: 5/5", "HP: 3/5").replace("[ ] Prone", "[x] Prone"),
    );
  });
});

// ─── The mode, at depth ───────────────────────────────────────────────────────

describe("the structure-scoped mode works on a nested statblock", () => {
  it("puts the definitions out of reach until the pencil is pressed", async () => {
    const editor = note(ONE_KOBOLD);

    expect(
      statblocks(editor)[0].querySelector('[aria-label="Row 1 label"]'),
    ).toBeNull();

    await fireEvent.click(control(editor, 0, "Edit statblock structure"));

    expect(control(editor, 0, "Row 1 label")).toHaveTextContent("HP");
    expect(control(editor, 0, "Row 1 value")).toHaveTextContent("5/5");
  });

  it("commits a structure edit into the nested fence", async () => {
    const editor = note(ONE_KOBOLD);
    await fireEvent.click(control(editor, 0, "Edit statblock structure"));

    await fireEvent.click(control(editor, 0, "Row 1 label"));
    await fireEvent.input(control(editor, 0, "Row 1 label"), {
      target: { value: "Hit Points" },
    });
    await fireEvent.blur(control(editor, 0, "Row 1 label"));

    expect(saved(editor)).toBe(ONE_KOBOLD.replace("HP: 5/5", "Hit Points: 5/5"));
  });

  it("opens one creature's structure without opening its neighbour's", async () => {
    const editor = note(ambush(2));
    await fireEvent.click(control(editor, 0, "Edit statblock structure"));

    expect(statblocks(editor)[0].className).toContain("statblock-editing");
    expect(statblocks(editor)[1].className).not.toContain("statblock-editing");
  });

  it("never writes the mode to the file", async () => {
    const editor = note(ONE_KOBOLD);
    await fireEvent.click(control(editor, 0, "Edit statblock structure"));

    expect(saved(editor)).toBe(ONE_KOBOLD);
  });
});

// ─── The group's bytes ────────────────────────────────────────────────────────

describe("a callout of several statblocks round-trips byte for byte", () => {
  it.each([
    ["two statblocks", ambush(2)],
    ["twelve statblocks", ambush(12)],
    [
      "statblocks under a blank line and a line of prose",
      [
        "> [!encounter] The Ambush",
        "> Four of them, and one holding the door.",
        ">",
        "> ```statblock",
        "> # Kobold A",
        "> HP: 5/5",
        "> ```",
        ">",
        "> ```statblock",
        "> # Kobold B",
        "> HP: 5/5",
        "> ```",
      ].join("\n"),
    ],
    [
      "a fully written creature inside the box",
      [
        "> [!encounter] The Ambush",
        "> ```statblock",
        "> # Kobold Boss",
        "> HP: 24/24",
        "> Armor Class: 15",
        "> Legendary: [x][ ][ ]",
        ">",
        "> ## Actions",
        "> Shortbow: +4 to hit, 1d6+2 piercing.",
        ">",
        "> Rally: Sworn to [[Captain Ash]], and says so.",
        "> ```",
      ].join("\n"),
    ],
    ["a nest of callouts around the fight", oneDeeper(ambush(2))],
  ])("round-trips %s", (_what, md) => {
    const editor = note(md);
    expect(saved(editor)).toBe(md);
  });

  it("keeps every creature distinct rather than merging the run", () => {
    // Per-instance naming is `# Kobold A` inside the fence, and twelve fences are
    // twelve creatures — not one creature with a count beside it.
    const editor = note(ambush(12));
    const letters = "ABCDEFGHIJKL".split("");

    statblocks(editor).forEach((block, index) => {
      expect(block).toHaveTextContent(`Kobold ${letters[index]}`);
    });
  });
});

// ─── Twelve kobolds ───────────────────────────────────────────────────────────
//
// Twelve kobolds are twelve fences. A count row would need Grimoire to know what
// `Count` means, and breaks the moment one takes damage; a duplicate-block affordance
// was cut, because copy-paste already does it. So the requirement is only that twelve
// separately-named creatures each take damage independently — which they do because
// each one is its own node at its own position.

describe("twelve kobolds in one callout each take damage independently", () => {
  it("mounts twelve live statblocks", () => {
    const editor = note(ambush(12));

    expect(statblocks(editor)).toHaveLength(12);
    expect(dom(editor).querySelectorAll("pre")).toHaveLength(0);
  });

  it("wounds the third and the sixth and leaves the other ten at full", async () => {
    const editor = note(ambush(12));
    await hit(editor, 2, "-3");
    await hit(editor, 5, "-4");

    const pools = saved(editor)
      .split("\n")
      .filter((line) => line.startsWith("> HP:"));

    expect(pools).toEqual([
      "> HP: 5/5",
      "> HP: 5/5",
      "> HP: 2/5",
      "> HP: 5/5",
      "> HP: 5/5",
      "> HP: 1/5",
      ...Array(6).fill("> HP: 5/5"),
    ]);
  });

  it("leaves every other byte of the group as the GM wrote it", async () => {
    const editor = note(ambush(12));
    await hit(editor, 11, "-5");

    expect(saved(editor)).toBe(
      ambush(12).replace(/> HP: 5\/5(\n> ```)$/, "> HP: 0/5$1"),
    );
  });
});

// ─── Collapse ─────────────────────────────────────────────────────────────────

describe("collapsing the group and collapsing one creature", () => {
  const AMBUSH = ambush(2);

  it("hides the whole group when the callout collapses", async () => {
    const editor = note(AMBUSH);
    await fireEvent.click(dom(editor).querySelector('[aria-label="Collapse callout"]')!);

    expect(dom(editor).querySelector("[data-node-view-content]")).toHaveAttribute(
      "hidden",
    );
    // Hidden, not deleted: the fences are real document content, and a collapse that
    // removed them would be a collapse that edited the note.
    expect(statblocks(editor)).toHaveLength(2);
    expect(saved(editor)).toBe(AMBUSH);
  });

  it("still collapses one creature inside an open group", async () => {
    const editor = note(AMBUSH);
    await fireEvent.click(control(editor, 0, "Collapse statblock"));

    expect(control(editor, 0, "Expand statblock")).toBeTruthy();
    expect(
      statblocks(editor)[1].querySelector('[aria-label="Collapse statblock"]'),
    ).toBeTruthy();
    expect(saved(editor)).toBe(AMBUSH);
  });

  it("keeps a collapsed creature's pool clickable, which is the point of collapsing", async () => {
    const editor = note(AMBUSH);
    await fireEvent.click(control(editor, 0, "Collapse statblock"));
    await hit(editor, 0, "-2");

    expect(saved(editor)).toBe(AMBUSH.replace("HP: 5/5", "HP: 3/5"));
  });

  it("survives the group being collapsed and opened again", async () => {
    const editor = note(AMBUSH);
    await fireEvent.click(control(editor, 0, "Collapse statblock"));
    await fireEvent.click(dom(editor).querySelector('[aria-label="Collapse callout"]')!);
    await fireEvent.click(dom(editor).querySelector('[aria-label="Expand callout"]')!);

    // Per-block collapse is that block's own view state, and the container hiding it
    // for a moment is none of its business.
    expect(control(editor, 0, "Expand statblock")).toBeTruthy();
    expect(saved(editor)).toBe(AMBUSH);
  });
});

// ─── The encounter note a GM already has ──────────────────────────────────────

describe("an encounter note written before this work is left alone", () => {
  // The prose form the sample world shipped with, and the form thousands of hand-written
  // encounter notes are in. Nothing migrates it, flags it or treats it as second-class:
  // Grimoire has no concept of a fight to measure it against.
  const OLD = [
    "# The Shadow in the Hall",
    "",
    "## Monsters",
    "",
    "**The Lurker** — a former archivist of [[The Order of Embers]], transformed by the library's containment seals failing slowly over three hundred years.",
    "",
    "*Suggested traits:* Darkness sense, Silent movement, Seal-bound.",
  ].join("\n");

  it("opens unchanged and writes back unchanged", () => {
    const editor = note(OLD);
    expect(saved(editor)).toBe(OLD);
  });

  it("is not quietly turned into blocks", () => {
    const editor = note(OLD);

    expect(statblocks(editor)).toHaveLength(0);
    expect(dom(editor).querySelector("blockquote")).toBeNull();
  });
});

// ─── What is not here ─────────────────────────────────────────────────────────

describe("Grimoire acquires no concept of a fight", () => {
  it("adds no node for an encounter, a roster or a fight", () => {
    const editor = note("Prose.");
    const names = Object.keys(editor.schema.nodes);

    expect(names.filter((name) => /encounter|roster|monster|combat|fight/i.test(name)))
      .toEqual([]);
  });

  it("gives a statblock no count, quantity or roster attribute", () => {
    // Twelve kobolds are twelve fences. A count row would need Grimoire to know what
    // `Count` means, and would break the moment one of them took damage.
    const editor = note("```statblock\n# Kobold A\nHP: 5/5\n```");

    expect(Object.keys(editor.schema.nodes.statblockBlock.spec.attrs ?? {}).sort()).toEqual(
      ["name", "rows", "sections"],
    );
  });

  it("offers no duplicate-block affordance in the group's chrome", () => {
    // Cut deliberately: copy-paste already does it, and a second way in is a second
    // thing to keep true.
    const editor = note(ambush(2));
    const labels = [...dom(editor).querySelectorAll("button")].map(
      (button) => button.getAttribute("aria-label") ?? "",
    );

    expect(labels.filter((label) => /duplicat|clone|copy|add creature/i.test(label)))
      .toEqual([]);
  });
});

// ─── The one shipped change ───────────────────────────────────────────────────

describe("the sample world's fight carries a real statblock fence", () => {
  // Read from the bundled ledger itself rather than a copy of it, so a later edit to
  // that note cannot pass this test while shipping a fence Grimoire mis-reads. The path
  // is relative to the runner's working directory, which is the project root.
  const raw = readFileSync(
    "src-tauri/sample-world/Encounters/The Shadow in the Hall.md",
    "utf8",
  );
  // Frontmatter is split off before the editor sees a byte of a note, so the test opens
  // what the app opens.
  const { body } = parseFrontmatter(raw);

  it("holds a statblock fence under its Monsters heading", () => {
    expect(raw).toContain("## Monsters");
    expect(raw.slice(raw.indexOf("## Monsters"))).toContain("```statblock");
  });

  it("opens as a creature the GM can play on", () => {
    const editor = note(body);
    const rows = statblocks(editor);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("The Lurker");
    // A pool and a mark track, so the shipped example shows what a Statblock is *for*
    // rather than being an Infobox that happens to describe a monster.
    expect(rows[0].querySelector('[aria-label="Row 1 current value"]')).toBeTruthy();
    expect(rows[0].querySelector('[aria-label^="Row 4 mark"]')).toBeTruthy();
  });

  it("survives an autosave byte for byte, which opening the note performs", () => {
    // The sample ledger is a writable sandbox: a GM opens the note, the editor rewrites
    // the whole body on the next save, and a fence that did not round-trip would corrupt
    // the world Grimoire ships to introduce itself.
    //
    // `saved()` trims, and so does the comparison: the file ends with the newline every
    // text file ends with and the serializer emits none, which is true of every note in
    // the vault and not this fence's business.
    expect(saved(note(body))).toBe(body.trimEnd());
  });
});
