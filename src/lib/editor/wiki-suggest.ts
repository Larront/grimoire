// The `[[` dropdown's grammar (#215) — everything about wikilink autocomplete that is
// the same wherever the GM is typing, held apart from both surfaces that use it.
//
// Two surfaces offer the dropdown and they have almost nothing in common structurally:
// prose is a ProseMirror plugin whose state lives in a closure and reaches Svelte
// through a callback, and a Linked Text Field is a component holding `$state`. What
// they *do* share is everything the GM can perceive — which keys the menu claims, what
// a query returns, and where the menu sits — and that is what lives here.
//
// So the seam is not the dropdown and not a session object: it is four decisions, each
// a pure function of what the caller already knows. That keeps the ProseMirror half
// free of Svelte and the Svelte half free of ProseMirror, while leaving nowhere for the
// two to disagree about what Enter means.
//
// **Spotting the `[[` is deliberately not shared**, because the two surfaces genuinely
// do it differently: prose has ProseMirror's own `Suggestion` plugin watching the
// document, and a field has a string and a caret. `findWikiTrigger` below is the
// field's half — here rather than in the component because it is the one piece of it
// that is pure, and a rule about brackets is worth testing without rendering an input.
import { api } from "$lib/api";

/**
 * A note the dropdown offers. Narrower than the ledger's own search row on purpose —
 * the menu draws a title over a path and nothing else, and taking the wide row would
 * make every caller and test carry an excerpt and a match count they never read.
 */
export interface NoteSearchResult {
  id: number;
  title: string;
  path: string;
}

/** Where the caret is, as the menu needs it. */
export interface WikiMenuAnchor {
  x: number;
  y: number;
  /** The anchor's top edge, which is what the menu sits above when it flips. */
  anchorTop: number;
}

/** An open `[[` behind the caret, and what has been typed into it so far. */
export interface WikiTrigger {
  /** Where the `[[` sits, so accepting a note replaces from there. */
  start: number;
  /** The text between the brackets and the caret — the search's query. */
  query: string;
}

/** What a key means to an open dropdown; `null` means the key was never its business. */
export type WikiSuggestVerdict =
  | { kind: "move"; selectedIndex: number }
  | { kind: "accept"; selectedIndex: number }
  | { kind: "dismiss" };

/**
 * The `[[` the caret is currently inside, if any — the field's trigger spotting.
 *
 * Only the text *behind* the caret is evidence: a link further along the value is
 * already written and is not what the GM is typing into. An opened pair the GM closed
 * themselves is finished, so it offers nothing — that is the deterministic escape hatch
 * from a loose match, matching prose's `[[target]]` input rule.
 */
export function findWikiTrigger(
  text: string,
  caret: number,
): WikiTrigger | null {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf("[[");
  if (start === -1) return null;
  const query = before.slice(start + 2);
  if (query.includes("]]")) return null;
  return { start, query };
}

/**
 * The notes a query matches.
 *
 * A failed lookup is an empty list rather than a rejection: the GM is mid-word, and a
 * search that cannot answer should show *no notes found* rather than break the keystroke
 * that asked.
 */
export async function searchWikiTargets(
  query: string,
): Promise<NoteSearchResult[]> {
  try {
    return await api.searchNotes(query);
  } catch {
    return [];
  }
}

/** Places the menu just under whatever it is anchored to. */
export function wikiMenuAnchor(
  rect: DOMRect | null | undefined,
): WikiMenuAnchor {
  return {
    x: rect?.left ?? 0,
    y: (rect?.bottom ?? 0) + 4,
    anchorTop: rect?.top ?? 0,
  };
}

/**
 * What an open dropdown does with a key, or `null` when the key is not its business and
 * belongs to the surface underneath.
 *
 * **An empty list claims only Escape.** The menu still draws — *no notes found* is the
 * useful answer to a query that matched nothing — but there is nothing to move through
 * and nothing to take, so an arrow key must still move the caret and Enter must still
 * break the line. Both copies of this previously kept the list's length at a minimum of
 * one to keep a modulo safe, and swallowed all three keys as a result.
 */
export function readWikiSuggestKey(
  key: string,
  { itemCount, selectedIndex }: { itemCount: number; selectedIndex: number },
): WikiSuggestVerdict | null {
  if (key === "Escape") return { kind: "dismiss" };
  if (itemCount === 0) return null;

  switch (key) {
    case "ArrowDown":
      return { kind: "move", selectedIndex: (selectedIndex + 1) % itemCount };
    case "ArrowUp":
      return {
        kind: "move",
        selectedIndex: (selectedIndex - 1 + itemCount) % itemCount,
      };
    case "Enter":
      return { kind: "accept", selectedIndex };
    default:
      return null;
  }
}
