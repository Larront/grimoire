// The Labelled Row — the `Label: value` format (ADR-0016 §4). One parser and one
// serializer for the shape every fenced Note Block's rows read as: Infobox's rows
// and, once it ships, Statblock's header rows, which #150 fixed as byte-identical.
//
// Named apart from the Row List, whose memberships differ: the Row List is order and
// controls and knows nothing about a row's content, and Timeline's events are not
// `Label: value` at all. One merged primitive would half-fit four places.
//
// The rule is *split on the first colon*, and everything here follows from it:
//
//   Population: 4,200            → { label: "Population", value: "4,200" }
//   Ruler: Ash, styled: the Grey → { label: "Ruler", value: "Ash, styled: the Grey" }
//   ![a](b.png)                  → { label: "", value: "![a](b.png)" }
//
// The pair is *inverse* over every record `parseLabelledRow` can produce, which is
// what ADR-0016 §2 rule 3 asks for: the whole document round-trips through
// `getMarkdown()` on every autosave, so a parser and serializer that disagree
// corrupt a GM's note with no user action.
//
// Two normalisations happen on the way *in*, both whitespace-only and both at the
// edges of what the format can say. A line whose colon carries no space after it
// (`Population:4,200`) gains that space when it is written back, and a lone trailing
// space after the colon is dropped. Nothing else about a GM's line moves.

export interface LabelledRow {
  /** The label the GM typed, or "" for a row that is only a value. */
  label: string;
  /** Everything after the first colon, one separating space removed. */
  value: string;
}

/** A row with nothing in it — what an inserted row starts as. */
export function blankLabelledRow(): LabelledRow {
  return { label: "", value: "" };
}

/** Whether a row holds nothing a GM typed, and so is not content. */
export function isBlankLabelledRow(row: LabelledRow): boolean {
  return !row.label && !row.value;
}

/**
 * One line of a fence body as a row. A line with no colon is a value with no label,
 * which is how a line the format has no other reading for survives being read —
 * the markdown-flavoured image line the Infobox spec shows among them.
 */
export function parseLabelledRow(line: string): LabelledRow {
  const colon = line.indexOf(":");
  if (colon < 0) return { label: "", value: line };

  const label = line.slice(0, colon);
  const rest = line.slice(colon + 1);
  // One space is the separator. Any further leading space is the GM's and stays in
  // the value, so `Founded:   812 AR` comes back with its spacing intact.
  return { label, value: rest.startsWith(" ") ? rest.slice(1) : rest };
}

/**
 * A row as its line. An empty label writes the value alone — unless the value holds
 * a colon, which would read back as a label, so a leading `: ` marks it as a value.
 *
 * A row holding nothing writes an empty line, which the consuming block drops rather
 * than emitting: a blank line in a fence is decoration, and re-reading it would grow
 * the GM's file on every save.
 */
export function serializeLabelledRow(row: LabelledRow): string {
  if (!row.label) return row.value.includes(":") ? `: ${row.value}` : row.value;
  return row.value ? `${row.label}: ${row.value}` : `${row.label}:`;
}

/**
 * A label as the format can hold it: no colon, because the first colon is the
 * separator, and no newline, because a row is one line. Applied by the field that
 * edits a label — parsing can never produce either, so keeping the field honest is
 * what makes the round trip total rather than nearly total.
 *
 * A colon is removed and a newline becomes a space: a colon typed mid-word should not
 * split it, where a pasted line break is holding two words apart.
 */
export function labelText(raw: string): string {
  return oneLine(raw.replace(/:/g, ""));
}

/**
 * Text as a line-oriented fence can hold it: one line. A pasted line break becomes a
 * space rather than splitting a row — or, for an Infobox's title, its `#` line — in
 * two. Colons are left alone: they are a value's to keep and only a label's to lose.
 */
export function oneLine(raw: string): string {
  return raw.replace(/\r?\n/g, " ");
}
