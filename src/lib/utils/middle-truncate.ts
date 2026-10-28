// Where to cut a long name so the part that tells it apart survives (2026-10 design
// review). Lists cut names at the end, and a GM's siblings differ at the end:
// "Annals of the Iron Hand, Volume 12" and "…Volume 13" read the same once the
// numbers go. `MiddleTruncate` lets the head shrink to an ellipsis and keeps the
// tail whole; this decides which is which.

/** The tail is the trailing words, at least this long… */
const TAIL_MIN = 6;
/** …and no longer than this, or the head has nothing left to give. */
const TAIL_MAX = 18;
/** A name this short is cut at the end like any other: there is no middle worth keeping. */
const SPLIT_FROM = 16;

export interface Split {
  head: string;
  /** Kept whole; starts with the separator it was cut at. Empty: cut at the end. */
  tail: string;
}

/**
 * A name's head and tail: the last words, as many as reach `TAIL_MIN` characters
 * without passing `TAIL_MAX`. "Annals of the Iron Hand, Volume 13" keeps
 * " Volume 13"; a last word longer than `TAIL_MAX` keeps nothing, and the name is
 * cut at its end as before.
 */
export function splitName(text: string): Split {
  if (text.length < SPLIT_FROM) return { head: text, tail: "" };
  let cut = text.length;
  while (text.length - cut < TAIL_MIN) {
    const space = text.lastIndexOf(" ", cut - 1);
    if (space <= 0 || text.length - space > TAIL_MAX) break;
    cut = space;
  }
  if (cut === text.length) return { head: text, tail: "" };
  return { head: text.slice(0, cut), tail: text.slice(cut) };
}

/**
 * A path's head and tail: the last segment, which is the file or world it names.
 * "C:/Users/gm/Worlds/Gods Ascendant" keeps "/Gods Ascendant".
 */
export function splitPath(text: string): Split {
  const slash = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\"));
  if (slash <= 0 || slash === text.length - 1) return { head: text, tail: "" };
  return { head: text.slice(0, slash), tail: text.slice(slash) };
}
