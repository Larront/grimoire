// Finding a parked thought again (#232).
//
// ADR-0018 settles what this is allowed to be: **a text filter over the rows the
// pane has already loaded, never Tantivy.** The Search Index is blind to Quick
// Notes on purpose, so retrieval inside the pen is a `String.includes` over three
// dozen lines — which is also why this is a pure function rather than a store, an
// index, or a command.
//
// The one subtlety is what a query is matched *against*. A Quick Note's body holds
// `[[People/Mira Ashvale.md]]` and the pane draws "Mira Ashvale", so two readings
// of one line both have to match: **the line as it appears**, because a GM types
// what they can see, and **the targets behind it**, because the GM who wrote the
// path remembers the path. Matching the raw body instead would do neither well —
// it would miss an aliased link's title and hit on the `[[`, `|` and `.md` that
// are on nobody's screen.
import { linkedPlainText, wikiTargetsIn } from "$lib/editor/linked-text";
import type { QuickNote } from "$lib/bindings.gen";

/**
 * Everything a query is matched against: the line as drawn, then every target.
 *
 * The drawn line is one continuous string, so a query *may* span a link and the
 * prose beside it — `ask the road about` is what the GM is looking at, whatever
 * brackets the body holds. The targets are appended on their own lines instead of
 * inline, so matching stops at each one's edges rather than running from a path
 * into the words after the link.
 */
function haystack(body: string): string {
  return [linkedPlainText(body), ...wikiTargetsIn(body)].join("\n").toLowerCase();
}

/**
 * The Quick Notes a query keeps, in the order they arrived.
 *
 * Substring, case-insensitive, and no query syntax at all: this is a list that
 * should be shrinking, not a corpus to be interrogated. An empty query is not a
 * filter and returns the list as given.
 */
export function filterQuickNotes(notes: QuickNote[], query: string): QuickNote[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return notes;
  return notes.filter((note) => haystack(note.body).includes(needle));
}
