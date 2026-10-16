// The `[[` dropdown's grammar (#215) — everything about wikilink autocomplete that is
// the same wherever the GM is typing, held apart from both surfaces that use it.
//
// Two surfaces offer the dropdown and they have almost nothing in common structurally:
// prose is a ProseMirror plugin whose state lives in a closure and reaches Svelte
// through a callback, and a Linked Text Field is a component holding `$state`. What
// they *do* share is everything the GM can perceive — which keys the menu claims, what
// a query returns, what accepting it writes, and where the menu sits — and that is what
// lives here.
//
// So the seam is not the dropdown and not a session object: it is a handful of decisions,
// each a pure function of what the caller already knows. That keeps the ProseMirror half
// free of Svelte and the Svelte half free of ProseMirror, while leaving nowhere for the
// two to disagree about what Enter means.
//
// **Spotting the `[[` is deliberately not shared**, because the two surfaces genuinely
// do it differently: prose has ProseMirror's own `Suggestion` plugin watching the
// document, and a field has a string and a caret. `findWikiTrigger` below is the
// field's half — here rather than in the component because it is the one piece of it
// that is pure, and a rule about brackets is worth testing without rendering an input.
import { api } from "$lib/api";
import type { LinkTarget } from "$lib/bindings.gen";
import { stripWikiFragment, wikiStem } from "./wiki-target";

/**
 * One row of the dropdown: a note that exists, or the name the GM is coining.
 *
 * The second is what a worldbuilder does most at the table — an NPC gets a name and the
 * GM wants it linked now and written later. It used to have no row at all: a name that
 * matched nothing was a dead end, and the only way through was typing `]]`, which nothing
 * said.
 */
export type WikiSuggestion =
  | ({ kind: "note" } & LinkTarget)
  | { kind: "new"; name: string };

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

/**
 * What was typed inside the brackets, in Obsidian's three parts: `name#heading|display`.
 *
 * Only the name is searched. The other two used to be searched as part of it — and then
 * thrown away on Enter, so `[[keep|the Keep` wrote a bare `[[The Ember Keep]]`.
 */
export interface WikiQuery {
  name: string;
  heading: string | null;
  display: string | null;
}

/** What a key means to an open dropdown; `null` means the key was never its business. */
export type WikiSuggestVerdict =
  | { kind: "move"; selectedIndex: number }
  | { kind: "accept"; selectedIndex: number }
  | { kind: "dismiss" };

/** Rows a PageUp or PageDown moves by — about two thirds of the menu, as the slash menu's. */
const PAGE = 6;

/**
 * The `[[` the caret is currently inside, if any — the field's trigger spotting.
 *
 * Only the text *behind* the caret is evidence: a link further along the value is
 * already written and is not what the GM is typing into. An opened pair the GM closed
 * themselves is finished, so it offers nothing — that is the deterministic escape hatch
 * from a loose match, matching prose's `[[target]]` input rule.
 */
export function findWikiTrigger(text: string, caret: number): WikiTrigger | null {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf("[[");
  if (start === -1) return null;
  const query = before.slice(start + 2);
  if (query.includes("]]")) return null;
  return { start, query };
}

/** Splits what was typed into its name, heading and display text. */
export function parseWikiQuery(raw: string): WikiQuery {
  const pipe = raw.indexOf("|");
  const target = pipe >= 0 ? raw.slice(0, pipe) : raw;
  const display = pipe >= 0 ? raw.slice(pipe + 1).trim() || null : null;
  const hash = target.indexOf("#");
  return {
    name: (hash >= 0 ? target.slice(0, hash) : target).trim(),
    heading: hash >= 0 ? target.slice(hash + 1).trim() || null : null,
    display,
  };
}

/**
 * Whether the GM has plainly gone on writing rather than naming a note.
 *
 * Spaces are allowed in the query now — "The Ember Keep" is a name with two of them, and
 * the first space used to end the search. So something else has to notice a stray `[[`
 * followed by a sentence: a sentence break, or more words than any title runs to. Without
 * it the menu would sit open offering "New note “and then the party…”" for Enter to take.
 */
export function looksLikeProse(raw: string): boolean {
  const { name } = parseWikiQuery(raw);
  return /[.!?,;:]\s/.test(name) || name.split(/\s+/).length > 8;
}

/**
 * The rows a query offers: the notes it names, best first, then — unless one of them *is*
 * the name typed — the name as a note still to be written.
 *
 * A bare `[[` offers the notes opened most recently; it used to answer "No notes found" in
 * a ledger full of them. `exclude` is the note being written in, which is never the link.
 *
 * A failed lookup is an empty list rather than a rejection: the GM is mid-word, and a
 * search that cannot answer should not break the keystroke that asked.
 */
export async function searchWikiTargets(
  raw: string,
  exclude: string | null = null,
): Promise<WikiSuggestion[]> {
  const { name } = parseWikiQuery(raw);
  let notes: LinkTarget[] = [];
  try {
    notes = (await api.silent.searchLinkTargets(name, exclude)) ?? [];
  } catch {
    notes = [];
  }
  const rows: WikiSuggestion[] = notes.map((note) => ({ kind: "note", ...note }));
  const named = name.toLowerCase();
  const exact = notes.some(
    (note) => note.title.toLowerCase() === named || wikiStem(note.path).toLowerCase() === named,
  );
  // A folder typed and no name after it yet (`[[Locations/`) is not a note to coin.
  if (name && !name.endsWith("/") && !exact) rows.push({ kind: "new", name });
  return rows;
}

/**
 * What goes between the brackets when a row is taken: the note's path or the new name,
 * then the heading and the display text the GM typed, as they typed them.
 */
export function wikiLinkTarget(row: WikiSuggestion, query: WikiQuery): string {
  const base = row.kind === "note" ? stripWikiFragment(row.path) : row.name;
  return (
    base + (query.heading ? `#${query.heading}` : "") + (query.display ? `|${query.display}` : "")
  );
}

/** Places the menu just under whatever it is anchored to. */
export function wikiMenuAnchor(rect: DOMRect | null | undefined): WikiMenuAnchor {
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
 * The slash menu's keys, so the two menus a GM meets in a note answer the same: arrows
 * and Tab walk, PageUp and PageDown move a page and stop at the ends. Tab used to move
 * real focus *into* the list, and Enter then took the row that had focus rather than the
 * one that was lit.
 *
 * **An empty list claims only Escape.** There is nothing to move through and nothing to
 * take, so an arrow key must still move the caret and Enter must still break the line.
 */
export function readWikiSuggestKey(
  key: string,
  {
    itemCount,
    selectedIndex,
    shiftKey = false,
  }: { itemCount: number; selectedIndex: number; shiftKey?: boolean },
): WikiSuggestVerdict | null {
  if (key === "Escape") return { kind: "dismiss" };
  if (itemCount === 0) return null;

  const wrap = (i: number) => (i + itemCount) % itemCount;
  const clamp = (i: number) => Math.max(0, Math.min(itemCount - 1, i));
  switch (key) {
    case "ArrowDown":
      return { kind: "move", selectedIndex: wrap(selectedIndex + 1) };
    case "ArrowUp":
      return { kind: "move", selectedIndex: wrap(selectedIndex - 1) };
    case "Tab":
      return { kind: "move", selectedIndex: wrap(selectedIndex + (shiftKey ? -1 : 1)) };
    case "PageDown":
      return { kind: "move", selectedIndex: clamp(selectedIndex + PAGE) };
    case "PageUp":
      return { kind: "move", selectedIndex: clamp(selectedIndex - PAGE) };
    case "Enter":
      return { kind: "accept", selectedIndex };
    default:
      return null;
  }
}

/**
 * The menu's id and its rows', so the surface typing into it can point a screen reader at
 * the selected row (`aria-activedescendant`) while focus stays where the GM is typing. One
 * is open at a time — it belongs to the field or the note being typed in.
 */
export const WIKI_MENU_ID = "wiki-link-menu";
export const wikiOptionId = (index: number) => `${WIKI_MENU_ID}-option-${index}`;

/**
 * Names the open menu and its selected row on the element the GM is typing in, or clears
 * both when it closes. Prose and the fields both call it, so a screen reader hears the same
 * thing in either.
 */
export function describeWikiMenu(
  el: HTMLElement | null | undefined,
  open: { itemCount: number; selectedIndex: number } | null,
) {
  if (!el) return;
  if (!open) {
    for (const attr of ["aria-expanded", "aria-controls", "aria-activedescendant"]) {
      el.removeAttribute(attr);
    }
    return;
  }
  el.setAttribute("aria-expanded", "true");
  el.setAttribute("aria-controls", WIKI_MENU_ID);
  if (open.itemCount) el.setAttribute("aria-activedescendant", wikiOptionId(open.selectedIndex));
  else el.removeAttribute("aria-activedescendant");
}
