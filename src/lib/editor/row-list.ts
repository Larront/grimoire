// What a change to a Row List *means* (ADR-0016 §4, #173).
//
// A Row List is an ordered list of rows inside a Note Block, and it knows nothing about
// what a row contains. `RowList.svelte` draws the controls and does the splicing; each
// block draws its own row. Timeline events are not `Label: value` at all, which is why
// this primitive is separate from the labelled-row format.
//
// What is left in this module is the two things a consumer has to get right and cannot
// read off the new array: where its per-row view state went, and whether the change
// reaches the document.
//
// It used to hold three array helpers as well — `insertRowAt`, `deleteRowAt`, `moveRow`.
// Each had exactly one caller and no decision in it, and a `splice` behind a module seam
// is a `splice` with a seam in front of it; `moveRow`'s "returns the same array when
// nothing moved" had even become reference equality read for control flow *across* that
// seam. They are inline in `RowList.svelte` now, and what stands here in their place is
// the rule that was copied into five blocks with a comment each and no test at all (#218).

/**
 * What one control did to the order, handed to a consumer alongside the new rows.
 * A block that keys view state by row index (Timeline's expanded set) needs this
 * to move that state with the rows; `remapRowIndices` applies it.
 */
export type RowChange =
  | { kind: "insert"; index: number }
  | { kind: "delete"; index: number }
  | { kind: "move"; from: number; to: number };

/** The two things a block does about a row change, in its own spelling. */
export interface RowChangeOutcome {
  /** Open the row at this index for typing — the insert case, and only that one. */
  focus: (index: number) => void;
  /** Write the rows into the document. */
  commit: () => void;
}

/**
 * The rule that decides whether a GM's row reaches their note: **an insert focuses and
 * does not commit; everything else commits.**
 *
 * A freshly inserted row is blank, and a blank row serializes to nothing at all — so
 * committing it would write a fence identical to the one already on disk, spending an
 * undo step that takes nothing back and marking the note dirty for a change the GM cannot
 * see. It opens for typing instead, and becomes a document write on the first keystroke,
 * through the field's own commit-on-blur.
 *
 * A move and a delete have nothing to wait for: what the GM asked for is already fully
 * expressed by the rows in front of them, so it goes to the document at once.
 *
 * Callbacks rather than a returned verdict, because every block spells "focus" its own
 * way — Timeline expands the event it opens, a Statblock names a level as well as an
 * index — while the branch between the two is the same sentence in all five places it was
 * copied to, and is the one part of this that can lose a row.
 */
export function settleRowChange(change: RowChange, block: RowChangeOutcome): void {
  if (change.kind === "insert") {
    block.focus(change.index);
    return;
  }
  block.commit();
}

/**
 * The given row indices as they read after `change`. An insert shifts everything
 * at or after it down the list; a delete drops its own index and pulls the rest
 * up; a move carries its index along and shifts whatever it displaced.
 *
 * An insert does *not* add the new row's index — whether a freshly inserted row
 * starts out expanded, selected or editing is the consumer's business.
 */
export function remapRowIndices(
  indices: Iterable<number>,
  change: RowChange,
): Set<number> {
  const out = new Set<number>();
  for (const index of indices) {
    if (change.kind === "insert") {
      out.add(index >= change.index ? index + 1 : index);
    } else if (change.kind === "delete") {
      if (index === change.index) continue;
      out.add(index > change.index ? index - 1 : index);
    } else {
      const { from, to } = change;
      if (index === from) out.add(to);
      else if (from < to && index > from && index <= to) out.add(index - 1);
      else if (to < from && index >= to && index < from) out.add(index + 1);
      else out.add(index);
    }
  }
  return out;
}
