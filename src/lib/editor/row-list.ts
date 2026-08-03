// The Row List's order arithmetic (ADR-0016 §4, #173) — extracted from Timeline,
// which is its first consumer and was the reference implementation.
//
// A Row List is an ordered list of rows inside a Note Block, and it knows nothing
// about what a row contains: these functions are generic over the row type, and
// RowList.svelte draws the controls that call them while each block draws its own
// row. Timeline events are not `Label: value` at all, which is why this primitive
// is separate from the labelled-row format (that arrives with Infobox, its first
// consumer).
//
// Everything here is pure and returns a new array — the caller writes the result
// back, so a block keeps deciding when an order change becomes a document write.

/**
 * What one control did to the order, handed to a consumer alongside the new rows.
 * A block that keys view state by row index (Timeline's expanded set) needs this
 * to move that state with the rows; `remapRowIndices` applies it.
 */
export type RowChange =
  | { kind: "insert"; index: number }
  | { kind: "delete"; index: number }
  | { kind: "move"; from: number; to: number };

/** `rows` with `row` inserted at `index`. An index past the end appends. */
export function insertRowAt<T>(rows: T[], index: number, row: T): T[] {
  const result = [...rows];
  result.splice(index, 0, row);
  return result;
}

/** `rows` without the row at `index`. An index out of range changes nothing. */
export function deleteRowAt<T>(rows: T[], index: number): T[] {
  if (index < 0 || index >= rows.length) return rows;
  return rows.filter((_, i) => i !== index);
}

/**
 * `rows` with the row at `from` moved to `to`. Either index out of range changes
 * nothing, which is what makes the move-up control at the top row and move-down
 * at the bottom row harmless rather than a special case at every call site.
 */
export function moveRow<T>(rows: T[], from: number, to: number): T[] {
  if (from < 0 || from >= rows.length) return rows;
  if (to < 0 || to >= rows.length) return rows;
  if (from === to) return rows;
  const result = [...rows];
  const [moved] = result.splice(from, 1);
  result.splice(to, 0, moved);
  return result;
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
