// Statblock Presets (#179) — so a GM stops typing `Armor Class:` for the two hundredth
// time.
//
// **A preset is verbatim fence text**, stamped copy-on-insert with no id left behind.
// That is the whole of what legitimises storing presets *outside* the ledger: no note
// ever depends on a preset existing, so a vault opened on a fresh machine loses a
// convenience and never a word of content. Any future "should this be app data?"
// question is measured against that test.
//
// Presets are **app-wide** — one JSON file in the app data directory, shared by every
// campaign on the machine — while the pointer at *which* one a vault stamps is that
// vault's preference. The store holds only GM-authored shapes; the two shipped presets
// below are code constants that are never written into it.
//
// **Resolution is silent.** `/statblock` stamps the vault's default, `/statblock <arg>`
// stamps the `<arg>` preset on an exact, case-insensitive, whole-argument match, and
// an unset or unresolvable pointer yields a blank statblock with no toast — a toast
// fires mid-fight, where the GM cannot act on it. The diagnosis lives in Settings.
//
// **Blank is not a preset but the absence of one**, which is why every function here
// returns `null` rather than a "Blank" entry: there is no shape to store for it, and
// an entry would need a row in Settings that could not be renamed or deleted.
//
// Nothing here cleans a value on the way in. It is not merely undesirable but
// *impossible*: pools count in opposite directions, so a clean `HP: 3/12` is `12/12`
// to one GM and `0/12` to another, and Grimoire cannot know which.
import {
  blankStatblock,
  parseStatblockBody,
  type Statblock,
} from "$lib/editor/statblock-block";

/**
 * One saved shape. The fence is exactly what the block serialized to — delimiters and
 * all — because the thing being stored is the text a GM would see in Obsidian, not a
 * parsed model that would have to be kept in step with the format.
 */
export interface StatblockPreset {
  name: string;
  fence: string;
}

// ─── The two shipped shapes ───────────────────────────────────────────────────
//
// Read-only code constants, never injected into the store. They are what a GM meets
// before authoring anything of their own, so between them they have to cover both
// halves of what a preset is for: a system's labels, and a worked example.

/** The fence delimiters, written once so the constants below read as their bodies. */
const fence = (body: string) => ["```statblock", body, "```"].join("\n");

/**
 * A bare skeleton of the labels a 5E statblock carries, and no values at all. It
 * belongs to a system, so it says nothing Grimoire had to invent.
 */
const SRD_5E: StatblockPreset = {
  name: "5E SRD",
  fence: fence(
    [
      "Armor Class:",
      "Hit Points:",
      "Speed:",
      "STR:",
      "DEX:",
      "CON:",
      "INT:",
      "WIS:",
      "CHA:",
      "Saving Throws:",
      "Skills:",
      "Senses:",
      "Languages:",
      "Challenge:",
      "",
      "## Traits",
      "",
      "## Actions",
      "",
      "## Reactions",
    ].join("\n"),
  ),
};

/**
 * Grimoire's own teaching example, belonging to no system — its labels are ordinary
 * English words, not any game's vocabulary.
 *
 * It **carries values on purpose**. Playability is authored, not inferred (ADR-0016
 * §7), which leaves nothing on screen to teach a GM that a slash makes a pool — and
 * `HP: /` is just a slash. A GM who stamps this, clicks `12/12` and types `-5` has
 * learned the whole syntax without reading anything.
 *
 * **Four rows, four lessons**, and no more: a pool, a mark track, an inert value, and
 * a named prose entry. Deliberately not a playable creature — a real game outgrows it
 * in one session, and every extra row is a label a GM has to delete. No `Conditions:`
 * row, because a condition is not a Grimoire concept and a row named for one would
 * teach that it is.
 */
const LARGE_ORC: StatblockPreset = {
  name: "Large Orc",
  fence: fence(
    [
      "# Large Orc",
      "HP: 12/12",
      "Wounds: [ ][ ][ ]",
      "Defence: 14",
      "",
      "## Actions",
      "Greataxe: Hits hard enough to matter. Roll it however your game rolls.",
    ].join("\n"),
  ),
};

/** The presets that ship with Grimoire. Neither can be renamed, edited or deleted. */
export const SHIPPED_PRESETS: readonly StatblockPreset[] = [SRD_5E, LARGE_ORC];

// ─── Reading a preset ─────────────────────────────────────────────────────────

/**
 * A preset's fence as the body the format parses.
 *
 * Tolerant of a body with no delimiters, because the store is a JSON file a determined
 * GM may still hand-edit — fence text inside a JSON string makes that an unrealistic
 * route, not an impossible one, and a file that had been edited down to a bare body
 * should stamp rather than produce a statblock whose first row is ```` ```statblock ````.
 */
export function fenceBody(text: string): string {
  const lines = text.split("\n");
  if (lines[0]?.startsWith("```")) lines.shift();
  if (lines[lines.length - 1]?.trim() === "```") lines.pop();
  return lines.join("\n");
}

// ─── Choosing a preset ────────────────────────────────────────────────────────

/** The one name comparison this feature has: whole, trimmed, case-insensitive. */
export const sameName = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/** Whether a name belongs to a shipped preset, and so is not the GM's to take. */
export function isShippedName(name: string): boolean {
  return SHIPPED_PRESETS.some((preset) => sameName(preset.name, name));
}

/** Everything a GM can stamp: the shipped two, then their own. */
export function availablePresets(stored: StatblockPreset[]): StatblockPreset[] {
  return [...SHIPPED_PRESETS, ...stored];
}

/** The preset a name resolves to, or `null` — the whole of the matching rule. */
export function findPreset(
  presets: StatblockPreset[],
  name: string | null,
): StatblockPreset | null {
  const wanted = name?.trim();
  if (!wanted) return null;
  return presets.find((preset) => sameName(preset.name, wanted)) ?? null;
}

/**
 * The preset a `/statblock` stamps, or `null` for a blank one.
 *
 * The argument's match is **exact and whole**, not loose, and the failure modes are
 * why: a miss falls through to the vault's default — the shape the GM chose, one
 * restamp from fixed — while a loose misfire would silently hand over a shape nobody
 * asked for. Because the store is app-wide, a loose match would also let a preset
 * named `Orc` shadow `Orc Warlord` in every campaign on the machine.
 */
export function resolvePreset(
  argument: string,
  presets: StatblockPreset[],
  defaultName: string | null,
): StatblockPreset | null {
  return findPreset(presets, argument) ?? findPreset(presets, defaultName);
}

/**
 * The attributes `/statblock` inserts — a copy of the preset's shape and nothing else.
 * No id, no reference, nothing pointing back: editing or deleting a preset afterwards
 * cannot reach a note that was stamped from it.
 *
 * **The argument is always the title**, whether it matched a preset or not — never the
 * `# Name` inside the preset's own fence, which is what the preset's author called it
 * rather than what this GM just did.
 *
 * The one place the argument is not copied character for character is its *casing*,
 * and only when it matched: `/statblock goblin` titles the block `# Goblin`, because
 * the match was case-insensitive and the GM plainly meant that preset. A miss keeps
 * the argument exactly as typed — there is no name to prefer, and inventing a casing
 * for it would be Grimoire rewriting what the GM wrote.
 */
export function statblockFromPreset(
  preset: StatblockPreset | null,
  argument: string,
): Statblock {
  const block = preset
    ? parseStatblockBody(fenceBody(preset.fence))
    : blankStatblock();
  const name = argument.trim();
  if (!name) return block;
  const matched = preset && sameName(preset.name, name);
  return { ...block, name: matched ? preset.name.trim() : name };
}
