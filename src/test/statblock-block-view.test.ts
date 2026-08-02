// The Statblock's view (#177, #178) — the GM's gestures and what the document says
// afterwards. The format is pinned in statblock-block.test.ts, the fence claim in
// block-markdown.test.ts, and value syntax in statblock-play.test.ts; here the subject
// is the block being used: authored behind the pencil, played on in front of it.
//
// The Row List's own controls are tested in row-list.test.ts. What these tests assert
// is that a Statblock is a working consumer of them at all three levels — the first
// block in the pattern to nest one Row List inside another.
//
// Every authoring test opens the mode first, through `edit()`. That is the ticket's
// central claim in the shape of a test helper: the structure is not reachable without
// a deliberate gesture, so a mis-click during a fight cannot edit the creature.
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
  /** Opens the structure, the way the GM does: the pencil in the block's chrome. */
  const edit = () => fireEvent.click(rendered.getByLabelText("Edit statblock structure"));
  return { ...rendered, onCommit, edit };
}

/** The statblock as the block last handed it to the document. */
function committed(onCommit: ReturnType<typeof vi.fn>, call = 0): Statblock {
  return onCommit.mock.calls[call][0] as Statblock;
}

/** The statblock as the block last handed it to the document, whatever call that was. */
function lastCommitted(onCommit: ReturnType<typeof vi.fn>): Statblock {
  return onCommit.mock.calls[onCommit.mock.calls.length - 1][0] as Statblock;
}

// ─── Drawing ──────────────────────────────────────────────────────────────────

describe("a Statblock draws its structure", () => {
  it("draws the name, the header rows and the sections", () => {
    const { getByText } = statblock();

    expect(getByText("Goblin Scout")).toBeInTheDocument();
    expect(getByText("HP")).toBeInTheDocument();
    expect(getByText("Actions")).toBeInTheDocument();
    expect(getByText("Shortbow")).toBeInTheDocument();
    expect(getByText("+4 to hit, 1d6+2 piercing.")).toBeInTheDocument();
  });

  it("draws an empty name as nothing but its placeholder", () => {
    const { getByText } = statblock({ name: "" });
    expect(getByText("Unnamed statblock")).toBeInTheDocument();
  });

  it("says so when there are no header rows yet", () => {
    const { getByText } = statblock({ rows: [] });
    expect(getByText("No header rows yet")).toBeInTheDocument();
  });

  it("draws a header-only statblock, which is an Infobox with pools", () => {
    const { queryByText } = statblock({ sections: [] });
    expect(queryByText("Actions")).toBeNull();
  });

  it("draws unnamed prose with an empty name rather than another shape", async () => {
    const { getByLabelText, edit } = statblock({
      sections: [{ heading: "Description", entries: [{ name: "", body: "It remembers." }] }],
    });
    await edit();

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

  it("draws a wikilink in an entry body as a live link, mode or no mode", async () => {
    const { container, edit } = statblock({
      rows: [],
      sections: [
        { heading: "Lore", entries: [{ name: "Bound", body: "Sworn to [[Captain Ash]]." }] },
      ],
    });

    expect(container.querySelectorAll("[data-wiki-link]")).toHaveLength(1);
    await edit();
    expect(container.querySelectorAll("[data-wiki-link]")).toHaveLength(1);
  });

  it("draws every section the GM wrote, in their order", async () => {
    const { getByLabelText, edit } = statblock({
      sections: [
        { heading: "Traits", entries: [] },
        { heading: "Actions", entries: [] },
      ],
    });
    await edit();

    expect(getByLabelText("Section 1 heading")).toHaveTextContent("Traits");
    expect(getByLabelText("Section 2 heading")).toHaveTextContent("Actions");
  });
});

// ─── The header ───────────────────────────────────────────────────────────────

describe("Statblock header rows", () => {
  it("moving a row up reorders it and commits", async () => {
    const { getAllByLabelText, onCommit, edit } = statblock();
    await edit();
    await fireEvent.click(getAllByLabelText("Move row up")[1]);

    expect(committed(onCommit).rows.map((r) => r.label)).toEqual(["Armor Class", "HP"]);
  });

  it("deleting a row removes it and commits", async () => {
    const { getAllByLabelText, onCommit, edit } = statblock();
    await edit();
    await fireEvent.click(getAllByLabelText("Delete row")[0]);

    expect(committed(onCommit).rows).toEqual([{ label: "Armor Class", value: "15" }]);
  });

  it("adding a row opens it for typing and waits before writing", async () => {
    const { getByLabelText, onCommit, edit } = statblock();
    await edit();
    await fireEvent.click(getByLabelText("Add row"));

    expect(getByLabelText("Row 3 label").tagName).toBe("INPUT");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits the added row once the GM has typed into it", async () => {
    const { getByLabelText, onCommit, edit } = statblock();
    await edit();
    await fireEvent.click(getByLabelText("Add row"));

    const label = getByLabelText("Row 3 label");
    await fireEvent.input(label, { target: { value: "Speed" } });
    await fireEvent.blur(label);

    expect(committed(onCommit).rows).toEqual([...HEADER, { label: "Speed", value: "" }]);
  });

  it("commits an edited value", async () => {
    const { getByLabelText, onCommit, edit } = statblock();
    await edit();
    await fireEvent.click(getByLabelText("Row 1 value"));
    await fireEvent.input(getByLabelText("Row 1 value"), { target: { value: "9" } });
    await fireEvent.blur(getByLabelText("Row 1 value"));

    expect(committed(onCommit).rows[0]).toEqual({ label: "HP", value: "9" });
  });

  it("keeps a colon out of a label, which the format cannot represent", async () => {
    const { getByLabelText, onCommit, edit } = statblock();
    await edit();
    await fireEvent.click(getByLabelText("Row 1 label"));
    await fireEvent.input(getByLabelText("Row 1 label"), { target: { value: "HP: max" } });
    await fireEvent.blur(getByLabelText("Row 1 label"));

    expect(committed(onCommit).rows[0].label).toBe("HP max");
  });

  it("keeps a section marker out of a label, which would end the header", async () => {
    // `## Actions: 3` is a section heading, not a row — so the field will not let the
    // GM type a label that would silently move everything below it.
    const { getByLabelText, onCommit, edit } = statblock();
    await edit();
    await fireEvent.click(getByLabelText("Row 1 label"));
    await fireEvent.input(getByLabelText("Row 1 label"), { target: { value: "## Actions" } });
    await fireEvent.blur(getByLabelText("Row 1 label"));

    expect(committed(onCommit).rows[0].label).toBe("Actions");
  });

  it("keeps the name and the sections when a row changes", async () => {
    const { getAllByLabelText, onCommit, edit } = statblock();
    await edit();
    await fireEvent.click(getAllByLabelText("Delete row")[0]);

    expect(committed(onCommit).name).toBe("Goblin Scout");
    expect(committed(onCommit).sections).toEqual(ACTIONS);
  });
});

// ─── Sections ─────────────────────────────────────────────────────────────────

describe("Statblock sections", () => {
  it("adding a section opens its heading for typing and waits before writing", async () => {
    const { getByLabelText, onCommit, edit } = statblock();
    await edit();
    await fireEvent.click(getByLabelText("Add section"));

    expect(getByLabelText("Section 2 heading").tagName).toBe("INPUT");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits the added section once the GM has named it", async () => {
    const { getByLabelText, onCommit, edit } = statblock();
    await edit();
    await fireEvent.click(getByLabelText("Add section"));

    const heading = getByLabelText("Section 2 heading");
    await fireEvent.input(heading, { target: { value: "Traits" } });
    await fireEvent.blur(heading);

    expect(committed(onCommit).sections.map((s) => s.heading)).toEqual(["Actions", "Traits"]);
  });

  it("takes any heading the GM invents, imposing no vocabulary", async () => {
    const { getByLabelText, onCommit, edit } = statblock();
    await edit();
    await fireEvent.click(getByLabelText("Section 1 heading"));
    await fireEvent.input(getByLabelText("Section 1 heading"), {
      target: { value: "Relentless (3) - Passive" },
    });
    await fireEvent.blur(getByLabelText("Section 1 heading"));

    expect(committed(onCommit).sections[0].heading).toBe("Relentless (3) - Passive");
  });

  it("moving a section down reorders it and commits", async () => {
    const { getAllByLabelText, onCommit, edit } = statblock({
      sections: [
        { heading: "Traits", entries: [] },
        { heading: "Actions", entries: [] },
      ],
    });
    await edit();
    await fireEvent.click(getAllByLabelText("Move section down")[0]);

    expect(committed(onCommit).sections.map((s) => s.heading)).toEqual(["Actions", "Traits"]);
  });

  it("deleting a section removes it and its entries", async () => {
    const { getAllByLabelText, onCommit, edit } = statblock();
    await edit();
    await fireEvent.click(getAllByLabelText("Delete section")[0]);

    expect(committed(onCommit).sections).toEqual([]);
    expect(committed(onCommit).rows).toEqual(HEADER);
  });
});

// ─── Entries ──────────────────────────────────────────────────────────────────

describe("Statblock entries", () => {
  it("moving an entry up reorders it inside its own section", async () => {
    const { getAllByLabelText, onCommit, edit } = statblock();
    await edit();
    await fireEvent.click(getAllByLabelText("Move entry up")[1]);

    expect(committed(onCommit).sections[0].entries.map((e) => e.name)).toEqual([
      "Nimble Escape",
      "Shortbow",
    ]);
  });

  it("deleting an entry removes it and commits", async () => {
    const { getAllByLabelText, onCommit, edit } = statblock();
    await edit();
    await fireEvent.click(getAllByLabelText("Delete entry")[0]);

    expect(committed(onCommit).sections[0].entries.map((e) => e.name)).toEqual([
      "Nimble Escape",
    ]);
  });

  it("adding an entry opens its name for typing and waits before writing", async () => {
    const { getAllByLabelText, getByLabelText, onCommit, edit } = statblock();
    await edit();
    await fireEvent.click(getAllByLabelText("Add entry")[0]);

    expect(getByLabelText("Section 1 entry 3 name").tagName).toBe("INPUT");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits the added entry once the GM has typed into it", async () => {
    const { getAllByLabelText, getByLabelText, onCommit, edit } = statblock();
    await edit();
    await fireEvent.click(getAllByLabelText("Add entry")[0]);

    const name = getByLabelText("Section 1 entry 3 name");
    await fireEvent.input(name, { target: { value: "Bite" } });
    await fireEvent.blur(name);

    expect(committed(onCommit).sections[0].entries[2]).toEqual({ name: "Bite", body: "" });
  });

  it("edits an entry in one section without touching another", async () => {
    const { getByLabelText, onCommit, edit } = statblock({
      sections: [
        { heading: "Traits", entries: [{ name: "Amphibious", body: "It breathes water." }] },
        { heading: "Actions", entries: [{ name: "Bite", body: "1d6" }] },
      ],
    });
    await edit();

    await fireEvent.click(getByLabelText("Section 2 entry 1 body"));
    await fireEvent.input(getByLabelText("Section 2 entry 1 body"), { target: { value: "1d8" } });
    await fireEvent.blur(getByLabelText("Section 2 entry 1 body"));

    expect(committed(onCommit).sections[0].entries[0].body).toBe("It breathes water.");
    expect(committed(onCommit).sections[1].entries[0].body).toBe("1d8");
  });

  it("takes a body that wraps across lines, which the fence can hold", async () => {
    const { getByLabelText, onCommit, edit } = statblock();
    await edit();
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
    const { getByLabelText, edit } = statblock();
    await edit();
    await fireEvent.click(getByLabelText("Section 1 entry 1 body"));

    expect(getByLabelText("Section 1 entry 1 body").tagName).toBe("TEXTAREA");
  });

  it("lets the GM press Enter, which the body's own restriction must not undo", async () => {
    // The restriction removes blank lines, and the instant after Enter the new line
    // *is* a trailing blank one — so applying it per keystroke would mean a body could
    // never be broken by typing, only by pasting. It is applied when the field is left.
    const { getByLabelText, edit } = statblock();
    await edit();
    await fireEvent.click(getByLabelText("Section 1 entry 1 body"));
    await fireEvent.input(getByLabelText("Section 1 entry 1 body"), {
      target: { value: "It shoots.\n" },
    });

    expect(getByLabelText("Section 1 entry 1 body")).toHaveValue("It shoots.\n");
  });

  it("cleans a trailing line break when the GM leaves the field", async () => {
    const { getByLabelText, onCommit, edit } = statblock();
    await edit();
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
    const { getByLabelText, onCommit, edit } = statblock();
    await edit();
    await fireEvent.click(getByLabelText("Section 1 entry 1 body"));
    await fireEvent.input(getByLabelText("Section 1 entry 1 body"), {
      target: { value: "## Reactions" },
    });
    await fireEvent.blur(getByLabelText("Section 1 entry 1 body"));

    expect(committed(onCommit).sections[0].entries[0].body).toBe("## Reactions");
  });

  it("keeps a blank line out of a body, which would split the entry in two", async () => {
    const { getByLabelText, onCommit, edit } = statblock();
    await edit();
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
    const { getByLabelText, onCommit, edit } = statblock();
    await edit();
    await fireEvent.click(getByLabelText("Section 1 entry 1 body"));
    await fireEvent.input(getByLabelText("Section 1 entry 1 body"), {
      target: { value: "It shoots.\n## Reactions" },
    });
    await fireEvent.blur(getByLabelText("Section 1 entry 1 body"));

    expect(committed(onCommit).sections[0].entries[0].body).toBe("It shoots.\nReactions");
  });

  it("keeps a colon in a body, which is a body's to hold", async () => {
    const { getByLabelText, onCommit, edit } = statblock();
    await edit();
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

// ─── Pools ────────────────────────────────────────────────────────────────────

describe("a pool is played on", () => {
  const wounded = { rows: [{ label: "HP", value: "43/59" }], sections: [] };

  it("opens the current half for arithmetic, and only the current half", async () => {
    const { getByLabelText, queryByLabelText } = statblock(wounded);

    expect(getByLabelText("Row 1 current value")).toBeInTheDocument();
    // The maximum is drawn and nothing else. There is no control to slip onto, which
    // is the whole reason the mode exists.
    expect(queryByLabelText("Row 1 maximum")).toBeNull();
    expect(queryByLabelText("Row 1 value")).toBeNull();
  });

  it("takes a hit as a signed delta", async () => {
    const { getByLabelText, onCommit } = statblock(wounded);
    await fireEvent.click(getByLabelText("Row 1 current value"));
    await fireEvent.input(getByLabelText("Row 1 current value"), { target: { value: "-7" } });
    await fireEvent.keyDown(getByLabelText("Row 1 current value"), { key: "Enter" });

    expect(committed(onCommit).rows[0]).toEqual({ label: "HP", value: "36/59" });
  });

  it("takes an unsigned number as an absolute", async () => {
    const { getByLabelText, onCommit } = statblock(wounded);
    await fireEvent.click(getByLabelText("Row 1 current value"));
    await fireEvent.input(getByLabelText("Row 1 current value"), { target: { value: "20" } });
    await fireEvent.blur(getByLabelText("Row 1 current value"));

    expect(committed(onCommit).rows[0].value).toBe("20/59");
  });

  it("writes nothing at all for an empty input", async () => {
    const { getByLabelText, onCommit } = statblock(wounded);
    await fireEvent.click(getByLabelText("Row 1 current value"));
    await fireEvent.blur(getByLabelText("Row 1 current value"));

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("does not clamp a pool below zero", async () => {
    const { getByLabelText, onCommit } = statblock({
      rows: [{ label: "HP", value: "3/12" }],
      sections: [],
    });
    await fireEvent.click(getByLabelText("Row 1 current value"));
    await fireEvent.input(getByLabelText("Row 1 current value"), { target: { value: "-9" } });
    await fireEvent.keyDown(getByLabelText("Row 1 current value"), { key: "Enter" });

    expect(committed(onCommit).rows[0].value).toBe("-6/12");
  });

  it("abandons the edit on Escape", async () => {
    const { getByLabelText, onCommit } = statblock(wounded);
    await fireEvent.click(getByLabelText("Row 1 current value"));
    await fireEvent.input(getByLabelText("Row 1 current value"), { target: { value: "-7" } });
    await fireEvent.keyDown(getByLabelText("Row 1 current value"), { key: "Escape" });

    expect(onCommit).not.toHaveBeenCalled();
    expect(getByLabelText("Row 1 current value").tagName).toBe("BUTTON");
  });

  it("offers no reset, restore or clear-all, at any scope", () => {
    // Pools count in opposite directions — `HP: 120/135` down, `Stress: 0/3` up — so
    // "full" has no meaning Grimoire can infer, and a button claiming otherwise would
    // be wrong half the time.
    const { container } = statblock({
      rows: [
        { label: "HP", value: "43/59" },
        { label: "Stress", value: "0/3" },
      ],
      sections: [],
    });
    const labels = [...container.querySelectorAll("button")].map((b) =>
      (b.getAttribute("aria-label") ?? "").toLowerCase(),
    );

    // Word-anchored: "Save shape as preset" (#179) contains the letters of "reset"
    // and is not one.
    expect(labels.some((l) => /\b(reset|restore|clear|full|heal)/.test(l))).toBe(false);
  });
});

// ─── Mark tracks ──────────────────────────────────────────────────────────────

describe("a mark track is ticked", () => {
  it("draws one control per box and nothing for the run itself", () => {
    const { getByLabelText, queryByLabelText } = statblock({
      rows: [{ label: "Legendary", value: "[x][ ][ ]" }],
      sections: [],
    });

    expect(getByLabelText("Row 1 mark 1")).toHaveAttribute("aria-pressed", "true");
    expect(getByLabelText("Row 1 mark 2")).toHaveAttribute("aria-pressed", "false");
    expect(queryByLabelText("Row 1 value")).toBeNull();
  });

  it("ticking a box writes the whole run back", async () => {
    const { getByLabelText, onCommit } = statblock({
      rows: [{ label: "Legendary", value: "[x][ ][ ]" }],
      sections: [],
    });
    await fireEvent.click(getByLabelText("Row 1 mark 2"));

    expect(committed(onCommit).rows[0].value).toBe("[x][x][ ]");
  });

  it("un-ticking works the same way, because a mark is not a counter", async () => {
    const { getByLabelText, onCommit } = statblock({
      rows: [{ label: "Legendary", value: "[x][x][ ]" }],
      sections: [],
    });
    await fireEvent.click(getByLabelText("Row 1 mark 1"));

    expect(committed(onCommit).rows[0].value).toBe("[ ][x][ ]");
  });

  it("keeps the labels the GM typed, and the spacing they need", async () => {
    const { getByLabelText, onCommit } = statblock({
      rows: [{ label: "Conditions", value: "[ ] Prone [ ] Charmed" }],
      sections: [],
    });
    await fireEvent.click(getByLabelText("Row 1 mark 1: Prone"));

    expect(committed(onCommit).rows[0].value).toBe("[x] Prone [ ] Charmed");
  });

  it("draws a wikilink in a mark's label as a live link", () => {
    // A label is free text the GM typed, so it is a Linked Text Field like every other
    // value in the pattern (ADR-0016 §8) — not raw characters that happen to look
    // like a link.
    const { container } = statblock({
      rows: [{ label: "Conditions", value: "[x] Cursed by [[Vecna]]" }],
      sections: [],
    });

    expect(container.querySelector("[data-wiki-link]")).toHaveAttribute("data-path", "Vecna");
  });

  it("knows nothing about what a label says", () => {
    // A condition is a label the GM typed. No vocabulary, no icon, no rules lookup —
    // one the GM invented this session draws exactly like one from the rulebook.
    const { getByLabelText, container } = statblock({
      rows: [{ label: "Conditions", value: "[x] Prone [ ] Ectoplasm-slick" }],
      sections: [],
    });

    const invented = getByLabelText("Row 1 mark 2: Ectoplasm-slick");
    const known = getByLabelText("Row 1 mark 1: Prone");
    expect(invented.className).toBe(known.className);
    expect(container.querySelector("[data-condition]")).toBeNull();
  });
});

// ─── The mode ─────────────────────────────────────────────────────────────────

describe("the mode is scoped to structure", () => {
  const creature = {
    rows: [
      { label: "HP", value: "43/59" },
      { label: "Notes", value: "Bloodied" },
    ],
    sections: ACTIONS,
  };

  it("makes every value live in view mode, whatever its syntax", () => {
    const { getByLabelText } = statblock(creature);

    expect(getByLabelText("Row 1 current value")).toBeInTheDocument();
    // Anything else is a plain text input, one click — which is how a free-text
    // `Conditions:` row stays editable without a mode round-trip.
    expect(getByLabelText("Row 2 value")).toBeInTheDocument();
  });

  it("gives a bare integer a text input rather than a pool's arithmetic", async () => {
    // "A bare integer is inert" is a statement about *playability*: `14` gets no
    // arithmetic and no maximum, because there is no pool there to have one. It is
    // still one of "every value", so it opens as plain text — the ticket's comment is
    // explicit that anything not a pool or a track is "a plain text input, one click".
    const { getByLabelText, queryByLabelText, onCommit } = statblock({
      rows: [{ label: "Speed", value: "30" }],
      sections: [],
    });

    expect(queryByLabelText("Row 1 current value")).toBeNull();
    await fireEvent.click(getByLabelText("Row 1 value"));
    await fireEvent.input(getByLabelText("Row 1 value"), { target: { value: "-20" } });
    await fireEvent.blur(getByLabelText("Row 1 value"));

    // And the text is taken literally: no delta was applied, because there is no pool.
    expect(committed(onCommit).rows[0].value).toBe("-20");
  });

  it("puts no label, heading, entry or row control within reach in view mode", () => {
    const { container } = statblock(creature);
    const labels = [...container.querySelectorAll("button")]
      .map((b) => b.getAttribute("aria-label"))
      .filter((label): label is string => label !== null);

    expect([...new Set(labels)].sort()).toEqual(
      [
        "Collapse statblock",
        "Edit statblock structure",
        // Authoring, but of a *preset* rather than of this creature — it opens a
        // dialog and cannot change the block (#179).
        "Save shape as preset",
        "Row 1 current value",
        "Row 2 value",
      ].sort(),
    );
  });

  it("opens labels, maximums, headings and entry prose behind the pencil", async () => {
    const { getByLabelText, edit } = statblock(creature);
    await edit();

    // The maximum becomes reachable only here, as one half of the row's whole value.
    expect(getByLabelText("Row 1 value")).toHaveTextContent("43/59");
    expect(getByLabelText("Row 1 label")).toHaveTextContent("HP");
    expect(getByLabelText("Section 1 heading")).toHaveTextContent("Actions");
    expect(getByLabelText("Section 1 entry 1 body")).toBeInTheDocument();
    expect(getByLabelText("Add row")).toBeInTheDocument();
  });

  it("tells the two apart by input chrome and a dashed accent rail, with no banner", async () => {
    const { container, getAllByLabelText, edit } = statblock(creature);
    const block = container.querySelector(".statblock-block")!;

    expect(block.className).not.toContain("statblock-editing");
    await edit();
    expect(block.className).toContain("statblock-editing");
    // Input chrome: every value gains an underline the view-mode block does not draw.
    expect(container.querySelectorAll(".statblock-field").length).toBeGreaterThan(0);
    // And no banner: nothing announces the mode in words.
    expect(getAllByLabelText("Done editing statblock")).toHaveLength(1);
    expect(container.textContent).not.toMatch(/edit mode|editing mode/i);
  });

  it("leaves the mode on Escape", async () => {
    const { container, getByLabelText, edit } = statblock(creature);
    await edit();
    await fireEvent.keyDown(getByLabelText("Row 1 label"), { key: "Escape" });

    expect(container.querySelector(".statblock-block")!.className).not.toContain(
      "statblock-editing",
    );
  });

  it("leaves the mode on the check", async () => {
    const { container, getByLabelText, edit } = statblock(creature);
    await edit();
    await fireEvent.click(getByLabelText("Done editing statblock"));

    expect(container.querySelector(".statblock-block")!.className).not.toContain(
      "statblock-editing",
    );
  });

  it("never lets the mode or the collapse reach the document", async () => {
    const { getByLabelText, onCommit, edit } = statblock(creature);
    await edit();
    await fireEvent.click(getByLabelText("Row 1 value"));
    await fireEvent.input(getByLabelText("Row 1 value"), { target: { value: "40/59" } });
    await fireEvent.blur(getByLabelText("Row 1 value"));

    expect(Object.keys(lastCommitted(onCommit)).sort()).toEqual(["name", "rows", "sections"]);
  });
});

// ─── Collapsed ────────────────────────────────────────────────────────────────

describe("a collapsed statblock is a combat row", () => {
  const creature = {
    name: "Aboleth",
    rows: [
      { label: "HP", value: "43/59" },
      { label: "Armor Class", value: "17" },
      { label: "Legendary", value: "[x][ ][ ]" },
    ],
    sections: ACTIONS,
  };

  const collapse = (getByLabelText: (t: string) => HTMLElement) =>
    fireEvent.click(getByLabelText("Collapse statblock"));

  it("shows the name and every playable row, and nothing else", async () => {
    const { getByLabelText, getByText, queryByText, queryByLabelText } = statblock(creature);
    await collapse(getByLabelText);

    expect(getByText("Aboleth")).toBeInTheDocument();
    expect(getByLabelText("Row 1 current value")).toBeInTheDocument();
    expect(getByLabelText("Row 3 mark 1")).toBeInTheDocument();
    // The inert row and the sections are what collapse takes away.
    expect(queryByLabelText("Row 2 value")).toBeNull();
    expect(queryByText("Shortbow")).toBeNull();
  });

  it("keeps those rows interactive", async () => {
    const { getByLabelText, onCommit } = statblock(creature);
    await collapse(getByLabelText);
    await fireEvent.click(getByLabelText("Row 3 mark 2"));

    expect(committed(onCommit).rows[2].value).toBe("[x][x][ ]");
  });

  it("expands again to the whole creature", async () => {
    const { getByLabelText, getByText } = statblock(creature);
    await collapse(getByLabelText);
    await fireEvent.click(getByLabelText("Expand statblock"));

    expect(getByText("Shortbow")).toBeInTheDocument();
  });
});

// ─── The document's word is final ─────────────────────────────────────────────

describe("a Statblock follows the document", () => {
  it("redraws from the attributes it is given, as after an undo", async () => {
    const { getByText, component } = statblock();

    (component as unknown as { setAttrs: (a: unknown) => void }).setAttrs({
      name: "Aboleth",
      rows: [{ label: "HP", value: "120/135" }],
      sections: [{ heading: "Traits", entries: [{ name: "Amphibious", body: "Water." }] }],
    });
    await Promise.resolve();

    expect(getByText("Aboleth")).toBeInTheDocument();
    expect(getByText("HP")).toBeInTheDocument();
    expect(getByText("Traits")).toBeInTheDocument();
  });

  it("keeps the collapse an undo elsewhere in the note has no business changing", async () => {
    const { getByLabelText, component, queryByText } = statblock();
    await fireEvent.click(getByLabelText("Collapse statblock"));

    (component as unknown as { setAttrs: (a: unknown) => void }).setAttrs({
      name: "Goblin Scout",
      rows: HEADER,
      sections: ACTIONS,
    });
    await Promise.resolve();

    expect(queryByText("Shortbow")).toBeNull();
  });

  it("opens the row a fresh insert asks it to, and the mode with it", async () => {
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
