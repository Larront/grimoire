/*
  The graph's categorical ramp, and the one place that decides which tag wears which step.

  It lives here rather than inside GraphPane because two surfaces have to agree about it
  and, until they did, they did not: the graph painted a tag from the ramp while the Tag
  Manager drew the same tag as a hardcoded `#888888`, so a GM looking at their tags in
  Settings saw a grey list describing a colourful graph. A palette assignment that exists
  in one component is a palette assignment the rest of the app has to guess at.

  THE ASSIGNMENT IS A PURE FUNCTION OF THE LEDGER'S TAG LIST — sorted, so it is stable —
  and never of the graph's contents. Deriving it from the nodes on screen was the earlier
  bug in a quieter form: filtering the graph, or opening it before a note had loaded,
  changed the universe being sorted and could hand a tag a different colour than the one
  Settings had just shown for it.

  The values themselves are `--viz-cat-1` … `--viz-cat-8` in app.css, which is where the
  validator output and the reasoning for the eight steps live.
*/

/** How many tags can be told apart by colour before the ramp runs out. */
export const VIZ_SLOTS = 8;

/**
 * Which ramp slot each tag gets, keyed by tag name.
 *
 * Only tags with no explicit colour of their own are assigned — an explicit colour is the
 * GM overriding the ramp, and it wins everywhere. Past `VIZ_SLOTS` a tag is left
 * unassigned and resolves to the muted step: a ninth tag repeating slot 1 would be two
 * tags wearing one identity, which is a worse answer than "too many to colour".
 */
export function assignTagSlots(
  allTags: string[],
  hasExplicitColor: (tag: string) => boolean,
): Map<string, number> {
  const assignments = new Map<string, number>();
  [...new Set(allTags)]
    .filter((tag) => !hasExplicitColor(tag))
    .sort()
    .forEach((tag, i) => {
      if (i < VIZ_SLOTS) assignments.set(tag, i);
    });
  return assignments;
}

/** Read a custom property off <html> at call time, so it follows light/dark. */
export function readToken(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  return (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
    fallback
  );
}

/** The muted step — untagged notes, stubs, and any tag past the eighth. */
export function mutedColor(): string {
  return readToken("--foreground-muted", "#a39e99");
}

/**
 * The colour a tag is drawn in, anywhere in the app.
 *
 * Explicit colour → ramp slot → muted, in that order.
 */
export function resolveTagColor(
  tag: string,
  explicitColor: string | null | undefined,
  slots: Map<string, number>,
): string {
  if (explicitColor) return explicitColor;
  const slot = slots.get(tag);
  if (slot === undefined) return mutedColor();
  return readToken(`--viz-cat-${slot + 1}`, mutedColor());
}
