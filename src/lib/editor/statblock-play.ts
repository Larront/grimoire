// Play-state (#178) — the part of a Statblock a GM plays *on*.
//
// **Play-state is the serialized value** (ADR-0016 §7). `HP: 3/12` is the whole truth:
// a hit is an ordinary edit to the fence, through the ordinary autosave and Write
// Chokepoint. There is no database row, no block id and no ephemeral store here — this
// file holds no state at all, only the reading of a string and the writing of it back.
//
// **Playability is recognised by syntax alone**, because a fence carries no schema to
// consult (#150). Three readings, and nothing else:
//
//     HP: 120/135                  a pool      — its current half takes arithmetic
//     Legend: [x][ ][ ]            a track     — each box ticks
//     Conditions: [x] Prone [ ]    a track     — with labels the GM invented
//     Speed: 30                    inert       — a bare integer is not a pool
//     Dex: +3                      inert       — nor is a modifier column
//
// **Playability is authored, not inferred.** A GM makes a value playable by writing it
// in one of those shapes, which is how a marker some rules supplement invented mid
// campaign gets tracked without Grimoire knowing what it means. It is also why `+3` is
// inert and worth its own test: a modifier column appears in every system, and a
// modifier that became clickable is a pool nobody asked for.
//
// **A [[Condition]] is not a concept** (#152). There is no vocabulary here, no storage,
// no type and no icon — a condition is a label inside a mark track, a level is a pool
// the GM wrote (`Exhaustion: 3/6`), and a duration is label text. Nothing in this file
// recognises a condition's name, and nothing anywhere else may either.

/** One box in a mark track, with the label the GM typed after it (often none). */
export interface Mark {
  checked: boolean;
  /** The text between this box and the next, trimmed. "" for a bare box. */
  label: string;
}

/** `43/59` — a current value the GM plays on, and a maximum that defines the thing. */
export interface Pool {
  kind: "pool";
  current: number;
  max: number;
  /**
   * The `/` as the GM spaced it. Carried so that taking a hit rewrites the number and
   * nothing else — `3 / 12` stays spaced when it becomes `5 / 12`.
   */
  separator: string;
}

/** `[x] Prone [ ] Charmed` — a run of boxes, each one tickable. */
export interface Track {
  kind: "track";
  marks: Mark[];
}

/** What a row's value is, decided by its characters alone. */
export type PlayValue = Pool | Track | { kind: "inert" };

/**
 * Both halves may be negative, which is a consequence of there being no clamping
 * rather than an oddity: once `3` can go to `-6`, the written form has to read back.
 *
 * Unsigned-only would be the smaller grammar and the wrong one — it would make a pool
 * silently stop being a pool at the moment the GM most needs it.
 */
const POOL = /^(-?\d+)(\s*\/\s*)(-?\d+)$/;

/**
 * A run of boxes and nothing else. The run is the *whole* value, so `Roll [x] or
 * better` is prose: a track that could start mid-sentence would make an ordinary
 * sentence tickable.
 */
const TRACK = /^(?:\[[ xX]\][^[\]]*)+$/;

const MARK = /\[([ xX])\]([^[\]]*)/g;

/** A row's value as the thing it declares itself to be. */
export function classifyValue(value: string): PlayValue {
  const pool = POOL.exec(value);
  if (pool) {
    return {
      kind: "pool",
      current: Number(pool[1]),
      max: Number(pool[3]),
      separator: pool[2],
    };
  }

  if (TRACK.test(value)) {
    const marks: Mark[] = [];
    for (const mark of value.matchAll(MARK)) {
      marks.push({ checked: mark[1].toLowerCase() === "x", label: mark[2].trim() });
    }
    return { kind: "track", marks };
  }

  return { kind: "inert" };
}

/** A pool with a new current value, spaced as the GM spaced it. */
export function serializePool(pool: Pool, current: number): string {
  return `${current}${pool.separator}${pool.max}`;
}

/**
 * A mark track as its line.
 *
 * The separator is conditional, and the round trip depends on it: marks join with a
 * space when *any* of them carries a label, and with nothing when none do. That is what
 * lets `[x][ ][ ]` and `[x] Prone [ ] Charmed` both come back byte-identical — one
 * fixed separator would rewrite whichever form it was not chosen for on the first tick.
 *
 * An upper-case `[X]` the GM (or Obsidian) wrote is normalised to `[x]` here, the one
 * rewrite in this file, and only ever on a row the GM has just changed.
 */
export function serializeTrack(marks: Mark[]): string {
  const labelled = marks.some((mark) => mark.label !== "");
  return marks
    .map((mark) => `[${mark.checked ? "x" : " "}]${mark.label ? ` ${mark.label}` : ""}`)
    .join(labelled ? " " : "");
}

/**
 * A pool's current value after the GM typed into it.
 *
 *     applyArithmetic(120, "-20")  → 100    signed is a delta
 *     applyArithmetic(120, "20")   → 20     unsigned is absolute
 *     applyArithmetic(120, "")     → 120    empty is a no-op
 *     applyArithmetic(120, "-2d6") → 120    junk is rejected, not parsed
 *     applyArithmetic(3,   "-9")   → -6     nothing clamps
 *
 * No dice: a roller would have to answer where the result is shown, whether it is
 * logged and who else sees it, none of which this ticket decides. A GM rolls their own
 * dice and types the number, which is what they were doing before Grimoire existed.
 */
export function applyArithmetic(current: number, input: string): number {
  const raw = input.trim();
  if (!raw) return current;
  if (/^[+-]\d+$/.test(raw)) return current + Number(raw);
  if (/^\d+$/.test(raw)) return Number(raw);
  return current;
}

/** Whether a row is one a GM can play on — what a collapsed statblock still shows. */
export function isPlayable(value: string): boolean {
  return classifyValue(value).kind !== "inert";
}
