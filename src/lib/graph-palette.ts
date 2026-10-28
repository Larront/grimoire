/*
  The graph's categorical ramp, and the one place that turns a tag's style into a colour.

  It lives here rather than inside GraphPane because two surfaces have to agree about it
  and, until they did, they did not: the graph painted a tag from the ramp while the Tag
  Manager drew the same tag as a hardcoded `#888888`, so a GM looking at their tags in
  Settings saw a grey list describing a colourful graph. A palette assignment that exists
  in one component is a palette assignment the rest of the app has to guess at.

  WHICH STEP A TAG WEARS IS STORED, NOT DERIVED. It used to be a function of the sorted
  tag list, which kept the two surfaces agreeing but meant a new tag moved every tag
  after it alphabetically along one colour — a GM's "NPCs are gold" broke the day they
  added "bandit". The backend now pins a step to a tag once given (`graph_styles.rs`,
  `ensure_tag_slots`) and hands it over as `slot`; both surfaces read the same field.

  The values themselves are `--viz-cat-1` … `--viz-cat-8` in app.css, which is where the
  validator output and the reasoning for the eight steps live.
*/

import { readToken } from "$lib/design-tokens";

/** How many tags can be told apart by colour before the ramp runs out. */
export const VIZ_SLOTS = 8;

/** What a surface knows about a tag's look — the backend's `TagGraphStyleResponse`. */
export interface TagLook {
  color: string | null;
  slot?: number | null;
}

/** The muted step — untagged notes, stubs, and any tag past the eighth. */
export function mutedColor(): string {
  return readToken("--foreground-muted", "#a39e99");
}

/** The ramp step `slot` (0-based) draws in. */
export function slotColor(slot: number): string {
  return readToken(`--viz-cat-${slot + 1}`, mutedColor());
}

/**
 * The colour a tag is drawn in, anywhere in the app.
 *
 * Explicit colour → its ramp step → muted, in that order. A tag with no step is
 * past the eighth: a ninth tag repeating step 1 would be two tags wearing one
 * identity, which is a worse answer than "too many to colour".
 */
export function resolveTagColor(look: TagLook | undefined): string {
  if (look?.color) return look.color;
  if (look?.slot == null) return mutedColor();
  return slotColor(look.slot);
}
