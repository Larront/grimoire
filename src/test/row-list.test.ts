// Tests for the Row List (ADR-0016 §4, #173) — the shared machinery for an
// ordered list of rows inside a Note Block, extracted from Timeline.
//
// Two seams. What a change *means* — where per-row view state goes, and whether the
// change reaches the document — is pure and tested directly. The controls, splicing
// included, are tested through a fixture consumer whose rows are plain strings:
// deliberately not `Label: value`, because the primitive's whole claim is that it knows
// nothing about what a row contains, and a fixture that looked like an Infobox row would
// not prove it.
//
// The three array helpers that used to be tested here on their own are gone (#218). They
// had one caller each and no decision in them, and every claim those eighty lines made is
// made again below through the control that performs it — which is the seam a GM reaches.
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import { describe, it, expect, afterEach, vi } from "vitest";
import { remapRowIndices, settleRowChange } from "$lib/editor/row-list";
import RowListFixture from "./fixtures/RowListFixture.svelte";

afterEach(cleanup);

// ─── The commit rule ──────────────────────────────────────────────────────────
//
// The decision that used to be copied into five blocks with a comment each and no test
// at all, which is the wrong way round: the splicing was trivially correct and heavily
// covered, and this is the half that can lose a GM's row.

describe("settleRowChange", () => {
  /** The two things a block does about a change, recorded rather than performed. */
  function block() {
    return { focus: vi.fn(), commit: vi.fn() };
  }

  it("focuses a freshly inserted row and does not write it", () => {
    // A blank row serializes to nothing, so committing it would write the fence that is
    // already on disk — an undo step that takes nothing back, on a note marked dirty for
    // a change the GM cannot see.
    const b = block();
    settleRowChange({ kind: "insert", index: 2 }, b);

    expect(b.focus).toHaveBeenCalledWith(2);
    expect(b.commit).not.toHaveBeenCalled();
  });

  it("writes a delete at once, and focuses nothing", () => {
    const b = block();
    settleRowChange({ kind: "delete", index: 1 }, b);

    expect(b.commit).toHaveBeenCalledTimes(1);
    expect(b.focus).not.toHaveBeenCalled();
  });

  it("writes a move at once, and focuses nothing", () => {
    // What the GM asked for is already fully expressed by the rows in front of them.
    const b = block();
    settleRowChange({ kind: "move", from: 2, to: 1 }, b);

    expect(b.commit).toHaveBeenCalledTimes(1);
    expect(b.focus).not.toHaveBeenCalled();
  });
});

// ─── remapRowIndices ──────────────────────────────────────────────────────────

describe("remapRowIndices", () => {
  it("insert shifts indices at or after it down the list", () => {
    expect([...remapRowIndices([0, 1, 3], { kind: "insert", index: 1 })]).toEqual([0, 2, 4]);
  });

  it("insert does not add the new row's own index", () => {
    expect([...remapRowIndices([], { kind: "insert", index: 0 })]).toEqual([]);
  });

  it("delete drops its own index and pulls later ones up", () => {
    expect([...remapRowIndices([0, 1, 2], { kind: "delete", index: 1 })].sort()).toEqual([0, 1]);
  });

  it("delete leaves earlier indices alone", () => {
    expect([...remapRowIndices([0], { kind: "delete", index: 2 })]).toEqual([0]);
  });

  it("move up swaps membership of the two adjacent rows", () => {
    // Row 1 is expanded, row 0 is not; moving 1 up must keep the expansion with
    // the row the GM moved, not with position 1.
    expect([...remapRowIndices([1], { kind: "move", from: 1, to: 0 })]).toEqual([0]);
    expect([...remapRowIndices([0], { kind: "move", from: 1, to: 0 })]).toEqual([1]);
  });

  it("move down swaps membership of the two adjacent rows", () => {
    expect([...remapRowIndices([0], { kind: "move", from: 0, to: 1 })]).toEqual([1]);
    expect([...remapRowIndices([1], { kind: "move", from: 0, to: 1 })]).toEqual([0]);
  });

  it("a longer move shifts every index it displaced", () => {
    expect([...remapRowIndices([0, 1, 2, 3], { kind: "move", from: 0, to: 2 })].sort()).toEqual([
      0, 1, 2, 3,
    ]);
    expect([...remapRowIndices([0], { kind: "move", from: 0, to: 2 })]).toEqual([2]);
    expect([...remapRowIndices([2], { kind: "move", from: 0, to: 2 })]).toEqual([1]);
    expect([...remapRowIndices([3], { kind: "move", from: 0, to: 2 })]).toEqual([3]);
  });
});

// ─── The controls, through a consumer ─────────────────────────────────────────

describe("RowList controls", () => {
  it("draws one row per item using the consumer's own row rendering", () => {
    const { getByText, getAllByRole } = render(RowListFixture, {
      rows: ["alpha", "beta"],
    });
    expect(getByText("alpha")).toBeTruthy();
    expect(getByText("beta")).toBeTruthy();
    expect(getAllByRole("group", { name: /^Thing \d+$/ })).toHaveLength(2);
  });

  it("move up reorders the rows and reports the move", async () => {
    const { getAllByLabelText, component } = render(RowListFixture, {
      rows: ["alpha", "beta"],
    });
    await fireEvent.click(getAllByLabelText("Move thing up")[1]);
    expect(component.rowsNow()).toEqual(["beta", "alpha"]);
    expect(component.changes()).toEqual([{ kind: "move", from: 1, to: 0 }]);
  });

  it("move down reorders the rows and reports the move", async () => {
    const { getAllByLabelText, component } = render(RowListFixture, {
      rows: ["alpha", "beta"],
    });
    await fireEvent.click(getAllByLabelText("Move thing down")[0]);
    expect(component.rowsNow()).toEqual(["beta", "alpha"]);
    expect(component.changes()).toEqual([{ kind: "move", from: 0, to: 1 }]);
  });

  it("move up is disabled on the first row and move down on the last", () => {
    const { getAllByLabelText } = render(RowListFixture, {
      rows: ["alpha", "beta"],
    });
    const ups = getAllByLabelText("Move thing up") as HTMLButtonElement[];
    const downs = getAllByLabelText("Move thing down") as HTMLButtonElement[];
    expect(ups[0].disabled).toBe(true);
    expect(ups[1].disabled).toBe(false);
    expect(downs[0].disabled).toBe(false);
    expect(downs[1].disabled).toBe(true);
  });

  it("delete removes the row and reports its index", async () => {
    const { getAllByLabelText, component } = render(RowListFixture, {
      rows: ["alpha", "beta", "gamma"],
    });
    await fireEvent.click(getAllByLabelText("Delete thing")[1]);
    expect(component.rowsNow()).toEqual(["alpha", "gamma"]);
    expect(component.changes()).toEqual([{ kind: "delete", index: 1 }]);
  });

  it("inserting between two rows puts the consumer's new row at that position", async () => {
    const { getByLabelText, component } = render(RowListFixture, {
      rows: ["alpha", "beta"],
    });
    await fireEvent.click(getByLabelText("Insert thing after position 1"));
    expect(component.rowsNow()).toEqual(["alpha", "fresh", "beta"]);
    expect(component.changes()).toEqual([{ kind: "insert", index: 1 }]);
  });

  it("inserting at the top and appending at the end both reach the ends", async () => {
    const { getByLabelText, component } = render(RowListFixture, {
      rows: ["alpha"],
    });
    await fireEvent.click(getByLabelText("Insert thing at top"));
    expect(component.rowsNow()).toEqual(["fresh", "alpha"]);
    await fireEvent.click(getByLabelText("Add thing"));
    expect(component.rowsNow()).toEqual(["fresh", "alpha", "fresh"]);
  });

  it("the insertion points between rows are hidden until the row is hovered", async () => {
    const { getAllByRole, getByLabelText } = render(RowListFixture, {
      rows: ["alpha", "beta"],
    });
    const gap = getByLabelText("Insert thing after position 1");
    expect(gap.classList.contains("opacity-0")).toBe(true);
    expect(gap.classList.contains("pointer-events-none")).toBe(true);

    const rows = getAllByRole("group", { name: /^Thing \d+$/ });
    await fireEvent.mouseEnter(rows[0]);
    expect(gap.classList.contains("opacity-0")).toBe(false);
    expect(gap.classList.contains("pointer-events-none")).toBe(false);

    await fireEvent.mouseLeave(rows[0]);
    expect(gap.classList.contains("opacity-0")).toBe(true);
  });

  it("the trailing insertion point is revealed with the list, not permanent", async () => {
    // It used to be always drawn, which put a dashed line and a plus under every panel
    // a GM was only reading (#175 review). Hovering the last row reveals it, as
    // hovering a row reveals the gaps beside it.
    const { getAllByRole, getByLabelText } = render(RowListFixture, {
      rows: ["alpha", "beta"],
    });
    const add = getByLabelText("Add thing");
    expect(add.classList.contains("opacity-0")).toBe(true);

    const rows = getAllByRole("group", { name: /^Thing \d+$/ });
    await fireEvent.mouseEnter(rows[1]);
    expect(add.classList.contains("opacity-0")).toBe(false);
  });

  it("the trailing insertion point stays drawn while the list is empty", () => {
    // Nothing to hover for it: an empty list whose only control were hover-revealed
    // would be a list with no way to gain a first row.
    const { getByLabelText } = render(RowListFixture, { rows: [] });
    expect(getByLabelText("Add thing").classList.contains("opacity-0")).toBe(false);
  });

  it("a gap stays revealed once the pointer is on it", async () => {
    // Leaving the row that revealed a gap fires `mouseleave` before the gap's own
    // `mouseenter`, so without the gap tracking its own hover the control vanishes as
    // the GM arrives at it.
    const { getAllByRole, getByLabelText } = render(RowListFixture, {
      rows: ["alpha", "beta"],
    });
    const gap = getByLabelText("Insert thing after position 1");
    const rows = getAllByRole("group", { name: /^Thing \d+$/ });

    await fireEvent.mouseEnter(rows[0]);
    await fireEvent.mouseEnter(gap);
    await fireEvent.mouseLeave(rows[0]);

    expect(gap.classList.contains("opacity-0")).toBe(false);
    expect(gap.classList.contains("pointer-events-none")).toBe(false);
  });

  it("an empty list still offers a way to add the first row", () => {
    const { getByLabelText } = render(RowListFixture, { rows: [] });
    expect(getByLabelText("Add thing")).toBeTruthy();
  });

  it("adding to an empty list gives it its first row", async () => {
    // The gesture the permanently-drawn trailing control exists for: with no row to
    // hover, this is the only way a list ever gains one.
    const { getByLabelText, component } = render(RowListFixture, { rows: [] });
    await fireEvent.click(getByLabelText("Add thing"));

    expect(component.rowsNow()).toEqual(["fresh"]);
    expect(component.changes()).toEqual([{ kind: "insert", index: 0 }]);
  });

  it("deleting the only row empties the list rather than leaving a husk", async () => {
    const { getByLabelText, component } = render(RowListFixture, {
      rows: ["alpha"],
    });
    await fireEvent.click(getByLabelText("Delete thing"));

    expect(component.rowsNow()).toEqual([]);
    expect(component.changes()).toEqual([{ kind: "delete", index: 0 }]);
  });

  it("a consumer's per-row view state follows its row through a move", async () => {
    const { getByText, getAllByLabelText, component } = render(RowListFixture, {
      rows: ["alpha", "beta"],
    });
    await fireEvent.click(getByText("beta")); // marks row 1
    expect(component.marked()).toEqual([1]);
    await fireEvent.click(getAllByLabelText("Move thing up")[1]);
    expect(component.rowsNow()).toEqual(["beta", "alpha"]);
    expect(component.marked()).toEqual([0]);
  });

  // The case for `onRowFocusOut` went with the prop itself (#214) — see `RowList.svelte`.
});
