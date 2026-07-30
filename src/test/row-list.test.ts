// Tests for the Row List (ADR-0016 §4, #173) — the shared machinery for an
// ordered list of rows inside a Note Block, extracted from Timeline.
//
// Two seams. The order arithmetic is pure and tested directly. The controls are
// tested through a fixture consumer whose rows are plain strings — deliberately
// not `Label: value`, because the primitive's whole claim is that it knows
// nothing about what a row contains, and a fixture that looked like an Infobox
// row would not prove it.
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import { describe, it, expect, afterEach } from "vitest";
import {
  insertRowAt,
  deleteRowAt,
  moveRow,
  remapRowIndices,
} from "$lib/editor/row-list";
import RowListFixture from "./fixtures/RowListFixture.svelte";

afterEach(cleanup);

// ─── insertRowAt ──────────────────────────────────────────────────────────────

describe("insertRowAt", () => {
  it("inserts at the top", () => {
    expect(insertRowAt(["a", "b"], 0, "new")).toEqual(["new", "a", "b"]);
  });

  it("inserts in the middle", () => {
    expect(insertRowAt(["a", "c"], 1, "b")).toEqual(["a", "b", "c"]);
  });

  it("inserts at the end (index === length)", () => {
    expect(insertRowAt(["a", "b"], 2, "c")).toEqual(["a", "b", "c"]);
  });

  it("inserts into an empty list", () => {
    expect(insertRowAt([], 0, "a")).toEqual(["a"]);
  });

  it("does not mutate the original", () => {
    const original = ["a", "b"];
    insertRowAt(original, 1, "x");
    expect(original).toEqual(["a", "b"]);
  });
});

// ─── deleteRowAt ──────────────────────────────────────────────────────────────

describe("deleteRowAt", () => {
  it("removes the row at the index", () => {
    expect(deleteRowAt(["a", "b", "c"], 1)).toEqual(["a", "c"]);
  });

  it("removes the only row", () => {
    expect(deleteRowAt(["a"], 0)).toEqual([]);
  });

  it("is a no-op for an index out of range", () => {
    expect(deleteRowAt(["a", "b"], 2)).toEqual(["a", "b"]);
    expect(deleteRowAt(["a", "b"], -1)).toEqual(["a", "b"]);
  });

  it("does not mutate the original", () => {
    const original = ["a", "b"];
    deleteRowAt(original, 0);
    expect(original).toEqual(["a", "b"]);
  });
});

// ─── moveRow ──────────────────────────────────────────────────────────────────

describe("moveRow", () => {
  it("moves a row up one position (the move-up control)", () => {
    expect(moveRow(["a", "b", "c"], 1, 0)).toEqual(["b", "a", "c"]);
  });

  it("moves a row down one position (the move-down control)", () => {
    expect(moveRow(["a", "b", "c"], 1, 2)).toEqual(["a", "c", "b"]);
  });

  it("moves across more than one position", () => {
    expect(moveRow(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("is a no-op moving off either end", () => {
    expect(moveRow(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(moveRow(["a", "b"], 1, 2)).toEqual(["a", "b"]);
  });

  it("is a no-op when from === to", () => {
    expect(moveRow(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });

  it("down then up returns the original order", () => {
    const rows = ["a", "b", "c"];
    expect(moveRow(moveRow(rows, 1, 2), 2, 1)).toEqual(rows);
  });

  it("does not mutate the original", () => {
    const original = ["a", "b"];
    moveRow(original, 0, 1);
    expect(original).toEqual(["a", "b"]);
  });
});

// ─── remapRowIndices ──────────────────────────────────────────────────────────

describe("remapRowIndices", () => {
  it("insert shifts indices at or after it down the list", () => {
    expect([...remapRowIndices([0, 1, 3], { kind: "insert", index: 1 })]).toEqual(
      [0, 2, 4],
    );
  });

  it("insert does not add the new row's own index", () => {
    expect([...remapRowIndices([], { kind: "insert", index: 0 })]).toEqual([]);
  });

  it("delete drops its own index and pulls later ones up", () => {
    expect(
      [...remapRowIndices([0, 1, 2], { kind: "delete", index: 1 })].sort(),
    ).toEqual([0, 1]);
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
    expect(
      [...remapRowIndices([0, 1, 2, 3], { kind: "move", from: 0, to: 2 })].sort(),
    ).toEqual([0, 1, 2, 3]);
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

  it("the trailing insertion point is always visible", () => {
    const { getByLabelText } = render(RowListFixture, { rows: ["alpha"] });
    expect(getByLabelText("Add thing").classList.contains("opacity-0")).toBe(false);
  });

  it("an empty list still offers a way to add the first row", () => {
    const { getByLabelText } = render(RowListFixture, { rows: [] });
    expect(getByLabelText("Add thing")).toBeTruthy();
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

  it("focus leaving a row reaches the consumer with the row's element", async () => {
    const { getAllByRole, getByText, component } = render(RowListFixture, {
      rows: ["alpha", "beta"],
    });
    const rows = getAllByRole("group", { name: /^Thing \d+$/ });
    await fireEvent.focusOut(getByText("beta"));
    expect(component.focusOuts()).toHaveLength(1);
    expect(component.focusOuts()[0].index).toBe(1);
    expect(component.focusOuts()[0].contained).toBe(rows[1]);
  });
});
