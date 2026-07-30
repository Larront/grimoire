// The Infobox's view (#175) — the GM's gestures and what the document says
// afterwards. The format is pinned in infobox-block.test.ts and the fence claim in
// block-markdown.test.ts; here the subject is the panel: rows added, reordered and
// deleted, values edited, and nothing anywhere that plays.
//
// The Row List's own controls are tested in row-list.test.ts. What these tests assert
// is that the Infobox is a working consumer of them — which is why the block went
// first among the new three.
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import { describe, it, expect, afterEach, vi } from "vitest";
import InfoboxBlockView from "$lib/components/editor/InfoboxBlockView.svelte";
import type { Infobox } from "$lib/editor/infobox-block";
import type { LabelledRow } from "$lib/editor/labelled-row";

vi.mock("$lib/stores/link-resolver.svelte", () => ({
  linkResolver: { isKnown: () => true, prime: vi.fn(), resolve: vi.fn() },
}));

afterEach(cleanup);

const HARBOR: LabelledRow[] = [
  { label: "Population", value: "4,200" },
  { label: "Ruler", value: "[[Captain Ash]]" },
];

function panel(props: { title?: string; rows?: LabelledRow[] } = {}) {
  const onCommit = vi.fn();
  const rendered = render(InfoboxBlockView, {
    props: { title: "Harbor's End", rows: HARBOR, onCommit, ...props },
  });
  return { ...rendered, onCommit };
}

/** The panel as the block last handed it to the document. */
function committed(onCommit: ReturnType<typeof vi.fn>, call = 0): Infobox {
  return onCommit.mock.calls[call][0] as Infobox;
}

// ─── Drawing ──────────────────────────────────────────────────────────────────

describe("an Infobox draws its facts", () => {
  it("draws the title and every row", () => {
    const { getByLabelText } = panel();

    expect(getByLabelText("Infobox title")).toHaveTextContent("Harbor's End");
    expect(getByLabelText("Row 1 label")).toHaveTextContent("Population");
    expect(getByLabelText("Row 1 value")).toHaveTextContent("4,200");
    expect(getByLabelText("Row 2 label")).toHaveTextContent("Ruler");
  });

  it("draws a wikilink in a row value as a live link", () => {
    const { container } = panel();
    const link = container.querySelector("[data-wiki-link]");

    expect(link).toHaveAttribute("data-path", "Captain Ash");
    expect(link).toHaveTextContent("Captain Ash");
  });

  it("draws a wikilink in a row label too, because the scanner already filed it", () => {
    const { container } = panel({ rows: [{ label: "[[Ash]]", value: "the Captain" }] });
    expect(container.querySelectorAll("[data-wiki-link]")).toHaveLength(1);
  });

  it("draws an empty title as nothing but its placeholder", () => {
    const { getByLabelText } = panel({ title: "" });
    expect(getByLabelText("Infobox title")).toHaveTextContent("Untitled panel");
  });

  it("says so when there are no rows yet", () => {
    const { getByText } = panel({ rows: [] });
    expect(getByText("No rows yet")).toBeInTheDocument();
  });
});

// ─── Rows ─────────────────────────────────────────────────────────────────────

describe("Infobox rows", () => {
  it("moving a row up reorders it and commits", async () => {
    const { getAllByLabelText, onCommit } = panel();
    await fireEvent.click(getAllByLabelText("Move row up")[1]);

    expect(committed(onCommit).rows.map((r) => r.label)).toEqual(["Ruler", "Population"]);
  });

  it("moving a row down reorders it and commits", async () => {
    const { getAllByLabelText, onCommit } = panel();
    await fireEvent.click(getAllByLabelText("Move row down")[0]);

    expect(committed(onCommit).rows.map((r) => r.label)).toEqual(["Ruler", "Population"]);
  });

  it("deleting a row removes it and commits", async () => {
    const { getAllByLabelText, onCommit } = panel();
    await fireEvent.click(getAllByLabelText("Delete row")[0]);

    expect(committed(onCommit).rows).toEqual([{ label: "Ruler", value: "[[Captain Ash]]" }]);
  });

  it("adding a row opens it for typing and waits before writing", async () => {
    // An empty row serializes to nothing at all, so committing one would be a
    // document write with no content in it. It becomes a write when the GM types.
    const { getByLabelText, onCommit } = panel();
    await fireEvent.click(getByLabelText("Add row"));

    expect(getByLabelText("Row 3 label").tagName).toBe("INPUT");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits the added row once the GM has typed into it", async () => {
    const { getByLabelText, onCommit } = panel();
    await fireEvent.click(getByLabelText("Add row"));

    const label = getByLabelText("Row 3 label");
    await fireEvent.input(label, { target: { value: "Founded" } });
    await fireEvent.blur(label);

    expect(committed(onCommit).rows).toEqual([...HARBOR, { label: "Founded", value: "" }]);
  });

  it("inserts a row between two others", async () => {
    const { getByLabelText, getAllByLabelText, onCommit } = panel();
    await fireEvent.click(getByLabelText("Insert row after position 1"));

    const label = getAllByLabelText("Row 2 label")[0];
    await fireEvent.input(label, { target: { value: "Founded" } });
    await fireEvent.blur(label);

    expect(committed(onCommit).rows.map((r) => r.label)).toEqual([
      "Population",
      "Founded",
      "Ruler",
    ]);
  });

  it("keeps the panel's title when a row changes", async () => {
    const { getAllByLabelText, onCommit } = panel();
    await fireEvent.click(getAllByLabelText("Delete row")[0]);

    expect(committed(onCommit).title).toBe("Harbor's End");
  });
});

// ─── Editing ──────────────────────────────────────────────────────────────────

describe("editing an Infobox", () => {
  it("commits an edited value", async () => {
    const { getByLabelText, onCommit } = panel();
    await fireEvent.click(getByLabelText("Row 1 value"));
    await fireEvent.input(getByLabelText("Row 1 value"), { target: { value: "4,300" } });
    await fireEvent.blur(getByLabelText("Row 1 value"));

    expect(committed(onCommit).rows[0]).toEqual({ label: "Population", value: "4,300" });
  });

  it("commits an edited label", async () => {
    const { getByLabelText, onCommit } = panel();
    await fireEvent.click(getByLabelText("Row 1 label"));
    await fireEvent.input(getByLabelText("Row 1 label"), { target: { value: "Souls" } });
    await fireEvent.blur(getByLabelText("Row 1 label"));

    expect(committed(onCommit).rows[0]).toEqual({ label: "Souls", value: "4,200" });
  });

  it("keeps a colon out of a label, which the format cannot represent", async () => {
    const { getByLabelText, onCommit } = panel();
    await fireEvent.click(getByLabelText("Row 1 label"));
    await fireEvent.input(getByLabelText("Row 1 label"), { target: { value: "Souls: total" } });
    await fireEvent.blur(getByLabelText("Row 1 label"));

    expect(committed(onCommit).rows[0].label).toBe("Souls total");
  });

  it("keeps a colon in a value, which is a value's to hold", async () => {
    const { getByLabelText, onCommit } = panel();
    await fireEvent.click(getByLabelText("Row 1 value"));
    await fireEvent.input(getByLabelText("Row 1 value"), {
      target: { value: "Ash, styled: the Grey" },
    });
    await fireEvent.blur(getByLabelText("Row 1 value"));

    expect(committed(onCommit).rows[0].value).toBe("Ash, styled: the Grey");
  });

  it("commits an edited title", async () => {
    const { getByLabelText, onCommit } = panel();
    await fireEvent.click(getByLabelText("Infobox title"));
    await fireEvent.input(getByLabelText("Infobox title"), { target: { value: "The Docks" } });
    await fireEvent.blur(getByLabelText("Infobox title"));

    expect(committed(onCommit)).toEqual({ title: "The Docks", rows: HARBOR });
  });

  it("takes a title the GM adds to a panel that had none", async () => {
    const { getByLabelText, onCommit } = panel({ title: "" });
    await fireEvent.click(getByLabelText("Infobox title"));
    await fireEvent.input(getByLabelText("Infobox title"), { target: { value: "Harbor's End" } });
    await fireEvent.blur(getByLabelText("Infobox title"));

    expect(committed(onCommit).title).toBe("Harbor's End");
  });
});

// ─── Inert ────────────────────────────────────────────────────────────────────
//
// The line against Statblock: *an Infobox is read, a Statblock is played.* Nothing
// here recognises a pool or a mark track, so a value that looks like one is text.

describe("an Infobox has nothing that plays", () => {
  it("draws a pool-shaped value as the characters it is", () => {
    const { getByLabelText } = panel({ rows: [{ label: "Garrison", value: "43/59" }] });
    expect(getByLabelText("Row 1 value")).toHaveTextContent("43/59");
  });

  it("opens a pool-shaped value for typing rather than changing it", async () => {
    // The gesture that would decrement a Statblock's pool edits text here — which is
    // the whole difference, asserted rather than asserted about.
    const { getByLabelText } = panel({ rows: [{ label: "Garrison", value: "43/59" }] });
    await fireEvent.click(getByLabelText("Row 1 value"));

    expect(getByLabelText("Row 1 value")).toHaveValue("43/59");
  });

  it("draws a mark-track-shaped value as the characters it is", () => {
    const { getByLabelText } = panel({ rows: [{ label: "Wounds", value: "[ ][x][ ]" }] });
    expect(getByLabelText("Row 1 value")).toHaveTextContent("[ ][x][ ]");
  });

  it("offers no control beyond the fields and the Row List's own", () => {
    // Every button in the panel is either a field opened for typing or one of the Row
    // List's order controls. Nothing mutates a value in place.
    const { container, getAllByLabelText } = panel({ rows: [{ label: "HP", value: "3/12" }] });
    const labels = [...container.querySelectorAll("button")].map((b) =>
      b.getAttribute("aria-label"),
    );

    expect(labels.sort()).toEqual(
      [
        "Add row",
        "Delete row",
        "Infobox title",
        "Insert row at top",
        "Move row down",
        "Move row up",
        "Row 1 label",
        "Row 1 value",
      ].sort(),
    );
    expect(getAllByLabelText("Delete row")).toHaveLength(1);
  });
});

// ─── The document's word is final ─────────────────────────────────────────────

describe("an Infobox follows the document", () => {
  it("redraws from the attributes it is given, as after an undo", async () => {
    const { getByLabelText, component } = panel();

    (component as unknown as { setAttrs: (a: unknown) => void }).setAttrs({
      title: "The Ember Keep",
      rows: [{ label: "Garrison", value: "40" }],
    });
    await Promise.resolve();

    expect(getByLabelText("Infobox title")).toHaveTextContent("The Ember Keep");
    expect(getByLabelText("Row 1 label")).toHaveTextContent("Garrison");
  });

  it("opens the row a fresh insert asks it to", async () => {
    const { getByLabelText, component } = panel({ title: "", rows: [{ label: "", value: "" }] });

    (component as unknown as { focusRow: (i: number) => void }).focusRow(0);
    await Promise.resolve();

    expect(getByLabelText("Row 1 label").tagName).toBe("INPUT");
  });
});
