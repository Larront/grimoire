// The Statblock's view (#177) — the GM's gestures and what the document says
// afterwards. The format is pinned in statblock-block.test.ts and the fence claim in
// block-markdown.test.ts; here the subject is the block being *authored*: rows,
// sections and entries added, reordered and deleted, and text edited in place.
//
// The Row List's own controls are tested in row-list.test.ts. What these tests assert
// is that a Statblock is a working consumer of them at all three levels — the first
// block in the pattern to nest one Row List inside another.
//
// Nothing here plays. `120/135` is text a field opens for typing, which is the line
// this ticket draws and #178 crosses.
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import { describe, it, expect, afterEach, vi } from "vitest";
import StatblockBlockView from "$lib/components/editor/StatblockBlockView.svelte";
import type { Statblock, StatblockSection } from "$lib/editor/statblock-block";
import type { LabelledRow } from "$lib/editor/labelled-row";

vi.mock("$lib/stores/link-resolver.svelte", () => ({
  linkResolver: { isKnown: () => true, prime: vi.fn(), resolve: vi.fn() },
}));

afterEach(cleanup);

const HEADER: LabelledRow[] = [
  { label: "HP", value: "12" },
  { label: "Armor Class", value: "15" },
];

const ACTIONS: StatblockSection[] = [
  {
    heading: "Actions",
    entries: [
      { name: "Shortbow", body: "+4 to hit, 1d6+2 piercing." },
      { name: "Nimble Escape", body: "Disengages or hides as a bonus action." },
    ],
  },
];

function statblock(
  props: { name?: string; rows?: LabelledRow[]; sections?: StatblockSection[] } = {},
) {
  const onCommit = vi.fn();
  const rendered = render(StatblockBlockView, {
    props: {
      name: "Goblin Scout",
      rows: HEADER,
      sections: ACTIONS,
      onCommit,
      ...props,
    },
  });
  return { ...rendered, onCommit };
}

/** The statblock as the block last handed it to the document. */
function committed(onCommit: ReturnType<typeof vi.fn>, call = 0): Statblock {
  return onCommit.mock.calls[call][0] as Statblock;
}

// ─── Drawing ──────────────────────────────────────────────────────────────────

describe("a Statblock draws its structure", () => {
  it("draws the name, the header rows and the sections", () => {
    const { getByLabelText } = statblock();

    expect(getByLabelText("Statblock name")).toHaveTextContent("Goblin Scout");
    expect(getByLabelText("Row 1 label")).toHaveTextContent("HP");
    expect(getByLabelText("Row 1 value")).toHaveTextContent("12");
    expect(getByLabelText("Section 1 heading")).toHaveTextContent("Actions");
    expect(getByLabelText("Section 1 entry 1 name")).toHaveTextContent("Shortbow");
    expect(getByLabelText("Section 1 entry 1 body")).toHaveTextContent(
      "+4 to hit, 1d6+2 piercing.",
    );
  });

  it("draws an empty name as nothing but its placeholder", () => {
    const { getByLabelText } = statblock({ name: "" });
    expect(getByLabelText("Statblock name")).toHaveTextContent("Unnamed statblock");
  });

  it("says so when there are no header rows yet", () => {
    const { getByText } = statblock({ rows: [] });
    expect(getByText("No header rows yet")).toBeInTheDocument();
  });

  it("draws a header-only statblock, which is an Infobox with pools", () => {
    const { queryByLabelText } = statblock({ sections: [] });
    expect(queryByLabelText("Section 1 heading")).toBeNull();
  });

  it("draws unnamed prose with an empty name rather than another shape", () => {
    const { getByLabelText } = statblock({
      sections: [{ heading: "Description", entries: [{ name: "", body: "It remembers." }] }],
    });

    expect(getByLabelText("Section 1 entry 1 name")).toHaveTextContent("Name (optional)");
    expect(getByLabelText("Section 1 entry 1 body")).toHaveTextContent("It remembers.");
  });

  it("draws a wikilink in a row value as a live link", () => {
    const { container } = statblock({
      rows: [{ label: "Served", value: "[[Captain Ash]]" }],
      sections: [],
    });
    const link = container.querySelector("[data-wiki-link]");

    expect(link).toHaveAttribute("data-path", "Captain Ash");
    expect(link).toHaveTextContent("Captain Ash");
  });

  it("draws a wikilink in an entry body as a live link", () => {
    const { container } = statblock({
      rows: [],
      sections: [{ heading: "Lore", entries: [{ name: "Bound", body: "Sworn to [[Captain Ash]]." }] }],
    });

    expect(container.querySelectorAll("[data-wiki-link]")).toHaveLength(1);
  });

  it("draws every section the GM wrote, in their order", () => {
    const { getByLabelText } = statblock({
      sections: [
        { heading: "Traits", entries: [] },
        { heading: "Actions", entries: [] },
      ],
    });

    expect(getByLabelText("Section 1 heading")).toHaveTextContent("Traits");
    expect(getByLabelText("Section 2 heading")).toHaveTextContent("Actions");
  });
});

// ─── The header ───────────────────────────────────────────────────────────────

describe("Statblock header rows", () => {
  it("moving a row up reorders it and commits", async () => {
    const { getAllByLabelText, onCommit } = statblock();
    await fireEvent.click(getAllByLabelText("Move row up")[1]);

    expect(committed(onCommit).rows.map((r) => r.label)).toEqual(["Armor Class", "HP"]);
  });

  it("deleting a row removes it and commits", async () => {
    const { getAllByLabelText, onCommit } = statblock();
    await fireEvent.click(getAllByLabelText("Delete row")[0]);

    expect(committed(onCommit).rows).toEqual([{ label: "Armor Class", value: "15" }]);
  });

  it("adding a row opens it for typing and waits before writing", async () => {
    const { getByLabelText, onCommit } = statblock();
    await fireEvent.click(getByLabelText("Add row"));

    expect(getByLabelText("Row 3 label").tagName).toBe("INPUT");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits the added row once the GM has typed into it", async () => {
    const { getByLabelText, onCommit } = statblock();
    await fireEvent.click(getByLabelText("Add row"));

    const label = getByLabelText("Row 3 label");
    await fireEvent.input(label, { target: { value: "Speed" } });
    await fireEvent.blur(label);

    expect(committed(onCommit).rows).toEqual([...HEADER, { label: "Speed", value: "" }]);
  });

  it("commits an edited value", async () => {
    const { getByLabelText, onCommit } = statblock();
    await fireEvent.click(getByLabelText("Row 1 value"));
    await fireEvent.input(getByLabelText("Row 1 value"), { target: { value: "9" } });
    await fireEvent.blur(getByLabelText("Row 1 value"));

    expect(committed(onCommit).rows[0]).toEqual({ label: "HP", value: "9" });
  });

  it("keeps a colon out of a label, which the format cannot represent", async () => {
    const { getByLabelText, onCommit } = statblock();
    await fireEvent.click(getByLabelText("Row 1 label"));
    await fireEvent.input(getByLabelText("Row 1 label"), { target: { value: "HP: max" } });
    await fireEvent.blur(getByLabelText("Row 1 label"));

    expect(committed(onCommit).rows[0].label).toBe("HP max");
  });

  it("keeps a section marker out of a label, which would end the header", async () => {
    // `## Actions: 3` is a section heading, not a row — so the field will not let the
    // GM type a label that would silently move everything below it.
    const { getByLabelText, onCommit } = statblock();
    await fireEvent.click(getByLabelText("Row 1 label"));
    await fireEvent.input(getByLabelText("Row 1 label"), { target: { value: "## Actions" } });
    await fireEvent.blur(getByLabelText("Row 1 label"));

    expect(committed(onCommit).rows[0].label).toBe("Actions");
  });

  it("keeps the name and the sections when a row changes", async () => {
    const { getAllByLabelText, onCommit } = statblock();
    await fireEvent.click(getAllByLabelText("Delete row")[0]);

    expect(committed(onCommit).name).toBe("Goblin Scout");
    expect(committed(onCommit).sections).toEqual(ACTIONS);
  });
});

// ─── Sections ─────────────────────────────────────────────────────────────────

describe("Statblock sections", () => {
  it("adding a section opens its heading for typing and waits before writing", async () => {
    const { getByLabelText, onCommit } = statblock();
    await fireEvent.click(getByLabelText("Add section"));

    expect(getByLabelText("Section 2 heading").tagName).toBe("INPUT");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits the added section once the GM has named it", async () => {
    const { getByLabelText, onCommit } = statblock();
    await fireEvent.click(getByLabelText("Add section"));

    const heading = getByLabelText("Section 2 heading");
    await fireEvent.input(heading, { target: { value: "Traits" } });
    await fireEvent.blur(heading);

    expect(committed(onCommit).sections.map((s) => s.heading)).toEqual(["Actions", "Traits"]);
  });

  it("takes any heading the GM invents, imposing no vocabulary", async () => {
    const { getByLabelText, onCommit } = statblock();
    await fireEvent.click(getByLabelText("Section 1 heading"));
    await fireEvent.input(getByLabelText("Section 1 heading"), {
      target: { value: "Relentless (3) - Passive" },
    });
    await fireEvent.blur(getByLabelText("Section 1 heading"));

    expect(committed(onCommit).sections[0].heading).toBe("Relentless (3) - Passive");
  });

  it("moving a section down reorders it and commits", async () => {
    const { getAllByLabelText, onCommit } = statblock({
      sections: [
        { heading: "Traits", entries: [] },
        { heading: "Actions", entries: [] },
      ],
    });
    await fireEvent.click(getAllByLabelText("Move section down")[0]);

    expect(committed(onCommit).sections.map((s) => s.heading)).toEqual(["Actions", "Traits"]);
  });

  it("deleting a section removes it and its entries", async () => {
    const { getAllByLabelText, onCommit } = statblock();
    await fireEvent.click(getAllByLabelText("Delete section")[0]);

    expect(committed(onCommit).sections).toEqual([]);
    expect(committed(onCommit).rows).toEqual(HEADER);
  });
});

// ─── Entries ──────────────────────────────────────────────────────────────────

describe("Statblock entries", () => {
  it("moving an entry up reorders it inside its own section", async () => {
    const { getAllByLabelText, onCommit } = statblock();
    await fireEvent.click(getAllByLabelText("Move entry up")[1]);

    expect(committed(onCommit).sections[0].entries.map((e) => e.name)).toEqual([
      "Nimble Escape",
      "Shortbow",
    ]);
  });

  it("deleting an entry removes it and commits", async () => {
    const { getAllByLabelText, onCommit } = statblock();
    await fireEvent.click(getAllByLabelText("Delete entry")[0]);

    expect(committed(onCommit).sections[0].entries.map((e) => e.name)).toEqual(["Nimble Escape"]);
  });

  it("adding an entry opens its name for typing and waits before writing", async () => {
    const { getAllByLabelText, getByLabelText, onCommit } = statblock();
    await fireEvent.click(getAllByLabelText("Add entry")[0]);

    expect(getByLabelText("Section 1 entry 3 name").tagName).toBe("INPUT");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits the added entry once the GM has typed into it", async () => {
    const { getAllByLabelText, getByLabelText, onCommit } = statblock();
    await fireEvent.click(getAllByLabelText("Add entry")[0]);

    const name = getByLabelText("Section 1 entry 3 name");
    await fireEvent.input(name, { target: { value: "Bite" } });
    await fireEvent.blur(name);

    expect(committed(onCommit).sections[0].entries[2]).toEqual({ name: "Bite", body: "" });
  });

  it("edits an entry in one section without touching another", async () => {
    const { getByLabelText, onCommit } = statblock({
      sections: [
        { heading: "Traits", entries: [{ name: "Amphibious", body: "It breathes water." }] },
        { heading: "Actions", entries: [{ name: "Bite", body: "1d6" }] },
      ],
    });

    await fireEvent.click(getByLabelText("Section 2 entry 1 body"));
    await fireEvent.input(getByLabelText("Section 2 entry 1 body"), { target: { value: "1d8" } });
    await fireEvent.blur(getByLabelText("Section 2 entry 1 body"));

    expect(committed(onCommit).sections[0].entries[0].body).toBe("It breathes water.");
    expect(committed(onCommit).sections[1].entries[0].body).toBe("1d8");
  });

  it("takes a body that wraps across lines, which the fence can hold", async () => {
    const { getByLabelText, onCommit } = statblock();
    await fireEvent.click(getByLabelText("Section 1 entry 1 body"));
    await fireEvent.input(getByLabelText("Section 1 entry 1 body"), {
      target: { value: "+4 to hit, reach 10 ft.,\none target." },
    });
    await fireEvent.blur(getByLabelText("Section 1 entry 1 body"));

    expect(committed(onCommit).sections[0].entries[0].body).toBe(
      "+4 to hit, reach 10 ft.,\none target.",
    );
  });

  it("edits a body in a field that takes line breaks", async () => {
    const { getByLabelText } = statblock();
    await fireEvent.click(getByLabelText("Section 1 entry 1 body"));

    expect(getByLabelText("Section 1 entry 1 body").tagName).toBe("TEXTAREA");
  });

  it("lets the GM press Enter, which the body's own restriction must not undo", async () => {
    // The restriction removes blank lines, and the instant after Enter the new line
    // *is* a trailing blank one — so applying it per keystroke would mean a body could
    // never be broken by typing, only by pasting. It is applied when the field is left.
    const { getByLabelText } = statblock();
    await fireEvent.click(getByLabelText("Section 1 entry 1 body"));
    await fireEvent.input(getByLabelText("Section 1 entry 1 body"), {
      target: { value: "It shoots.\n" },
    });

    expect(getByLabelText("Section 1 entry 1 body")).toHaveValue("It shoots.\n");
  });

  it("cleans a trailing line break when the GM leaves the field", async () => {
    const { getByLabelText, onCommit } = statblock();
    await fireEvent.click(getByLabelText("Section 1 entry 1 body"));
    await fireEvent.input(getByLabelText("Section 1 entry 1 body"), {
      target: { value: "It shoots.\n" },
    });
    await fireEvent.blur(getByLabelText("Section 1 entry 1 body"));

    expect(committed(onCommit).sections[0].entries[0].body).toBe("It shoots.");
  });

  it("keeps a section marker on a body's first line, which is shielded instead", async () => {
    // Only a *later* line has nowhere to carry a shield. The first line keeps every
    // character the GM typed and is written as `: ## …`.
    const { getByLabelText, onCommit } = statblock();
    await fireEvent.click(getByLabelText("Section 1 entry 1 body"));
    await fireEvent.input(getByLabelText("Section 1 entry 1 body"), {
      target: { value: "## Reactions" },
    });
    await fireEvent.blur(getByLabelText("Section 1 entry 1 body"));

    expect(committed(onCommit).sections[0].entries[0].body).toBe("## Reactions");
  });

  it("keeps a blank line out of a body, which would split the entry in two", async () => {
    const { getByLabelText, onCommit } = statblock();
    await fireEvent.click(getByLabelText("Section 1 entry 1 body"));
    await fireEvent.input(getByLabelText("Section 1 entry 1 body"), {
      target: { value: "First thought.\n\nSecond thought." },
    });
    await fireEvent.blur(getByLabelText("Section 1 entry 1 body"));

    expect(committed(onCommit).sections[0].entries[0].body).toBe(
      "First thought.\nSecond thought.",
    );
  });

  it("keeps a section marker out of a body's later line, which would end the entry", async () => {
    const { getByLabelText, onCommit } = statblock();
    await fireEvent.click(getByLabelText("Section 1 entry 1 body"));
    await fireEvent.input(getByLabelText("Section 1 entry 1 body"), {
      target: { value: "It shoots.\n## Reactions" },
    });
    await fireEvent.blur(getByLabelText("Section 1 entry 1 body"));

    expect(committed(onCommit).sections[0].entries[0].body).toBe("It shoots.\nReactions");
  });

  it("keeps a colon in a body, which is a body's to hold", async () => {
    const { getByLabelText, onCommit } = statblock();
    await fireEvent.click(getByLabelText("Section 1 entry 1 body"));
    await fireEvent.input(getByLabelText("Section 1 entry 1 body"), {
      target: { value: "Melee Weapon Attack: +9 to hit" },
    });
    await fireEvent.blur(getByLabelText("Section 1 entry 1 body"));

    expect(committed(onCommit).sections[0].entries[0].body).toBe(
      "Melee Weapon Attack: +9 to hit",
    );
  });
});

// ─── Nothing plays, and nothing knows a kind ──────────────────────────────────

describe("a Statblock is authored, not yet played", () => {
  it("opens a pool-shaped value for typing rather than changing it", async () => {
    // The gesture #178 will turn into a hit edits text here. Asserted so the ticket
    // boundary is a fact about the code rather than a note in a comment.
    const { getByLabelText } = statblock({ rows: [{ label: "HP", value: "120/135" }] });
    await fireEvent.click(getByLabelText("Row 1 value"));

    expect(getByLabelText("Row 1 value")).toHaveValue("120/135");
  });

  it("draws a mark-track-shaped value as the characters it is", () => {
    const { getByLabelText } = statblock({
      rows: [{ label: "Conditions", value: "[x] Prone [ ] Charmed" }],
    });

    expect(getByLabelText("Row 1 value")).toHaveTextContent("[x] Prone [ ] Charmed");
  });

  it("offers no control beyond the fields and the Row List's own", () => {
    const { container } = statblock({
      rows: [{ label: "HP", value: "12" }],
      sections: [{ heading: "Actions", entries: [{ name: "Bite", body: "1d6" }] }],
    });
    const labels = [...container.querySelectorAll("button")]
      .map((b) => b.getAttribute("aria-label"))
      .filter((label): label is string => label !== null);

    expect([...new Set(labels)].sort()).toEqual(
      [
        "Add entry",
        "Add row",
        "Add section",
        "Delete entry",
        "Delete row",
        "Delete section",
        "Insert entry at top",
        "Insert row at top",
        "Insert section at top",
        "Move entry down",
        "Move entry up",
        "Move row down",
        "Move row up",
        "Move section down",
        "Move section up",
        "Row 1 label",
        "Row 1 value",
        "Section 1 entry 1 body",
        "Section 1 entry 1 name",
        "Section 1 heading",
        "Statblock name",
      ].sort(),
    );
  });
});

// ─── The document's word is final ─────────────────────────────────────────────

describe("a Statblock follows the document", () => {
  it("redraws from the attributes it is given, as after an undo", async () => {
    const { getByLabelText, component } = statblock();

    (component as unknown as { setAttrs: (a: unknown) => void }).setAttrs({
      name: "Aboleth",
      rows: [{ label: "HP", value: "120/135" }],
      sections: [{ heading: "Traits", entries: [{ name: "Amphibious", body: "Water." }] }],
    });
    await Promise.resolve();

    expect(getByLabelText("Statblock name")).toHaveTextContent("Aboleth");
    expect(getByLabelText("Row 1 label")).toHaveTextContent("HP");
    expect(getByLabelText("Section 1 heading")).toHaveTextContent("Traits");
  });

  it("opens the row a fresh insert asks it to", async () => {
    const { getByLabelText, component } = statblock({
      name: "",
      rows: [{ label: "", value: "" }],
      sections: [],
    });

    (component as unknown as { focusRow: (i: number) => void }).focusRow(0);
    await Promise.resolve();

    expect(getByLabelText("Row 1 label").tagName).toBe("INPUT");
  });
});
