// Reading a Note Block's structured attribute back off the DOM.
//
// A block whose content is a list — Timeline's events, an Infobox's rows, a
// Statblock's rows and sections — carries that list as one node attribute, and a
// block copied *inside* the editor travels as HTML rather than as markdown. So the
// attribute goes out through `renderHTML` as URI-encoded JSON and has to come back
// in through `parseHTML`, or copy-paste silently drops everything but the shape.
//
// One function rather than one per block, because the three copies it replaces were
// character-identical and the failure mode is silent: a `try` that returns the wrong
// empty value loses a GM's rows with no error anywhere.
//
// Deliberately *not* a fourth piece of shared machinery in ADR-0016 §4's sense — it
// is a five-line guard, not a contract, and nothing collects it. It sits beside
// `fence-claim` for the same reason that does: a fact a block needs, kept in one
// place, still declared by each block itself.

/**
 * A list attribute stored as URI-encoded JSON on a dataset entry, or an empty list
 * when the entry is absent or will not read.
 *
 * Empty rather than throwing, because the caller is ProseMirror parsing pasted HTML:
 * a block that renders with no rows is recoverable, and a parse error that reaches
 * the schema is not.
 */
export function jsonListAttr(raw: string | undefined): unknown[] {
  try {
    const parsed = JSON.parse(decodeURIComponent(raw ?? "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
