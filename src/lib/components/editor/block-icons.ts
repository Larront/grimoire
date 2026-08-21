// The one place a Lucide icon *name* becomes a component.
//
// Several editor surfaces carry an icon name as a string rather than a component:
// `SLASH_COMMANDS` entries and `CALLOUT_TYPES` specs both do, because a name is
// serializable data a model may hold while a Svelte component is not. Something has
// to turn one into the other, and it cannot be a dynamic import — Lucide's icons are
// individual modules, so the set has to be named somewhere for the bundler to see.
//
// Named *once*, here, rather than per surface. This started as one map in
// SlashCommandMenu; the Callout's node view (#181) needed ten of the same entries to
// draw its per-type header icon, and a second copy of a list whose whole job is to be
// exhaustive is the copy that goes stale.
import {
  CalendarDays,
  ChevronDown,
  CircleQuestionMark,
  Code,
  Copy,
  CopyPlus,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Info,
  Lightbulb,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Music2,
  OctagonAlert,
  PanelRight,
  Pilcrow,
  Quote,
  Shield,
  Speech,
  StickyNote,
  Swords,
  Trash2,
  TriangleAlert,
} from "@lucide/svelte";

/**
 * Typed loosely on purpose: every Lucide icon is a distinct component type, and a
 * caller holds one of them off a model rather than a statically known component.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IconComponent = any;

/**
 * Every icon an editor surface names.
 *
 * Deliberately **not** annotated `Record<string, IconComponent>`: that annotation made
 * the keys `string`, so a name with no entry type-checked and drew nothing — a mistyped
 * icon was a silently missing glyph in a shipped menu (#220). Left inferred, the keys are
 * literals and `BlockIconName` below is the set of them, so the same typo is a build
 * error and every surface holding a name can stop guarding against undefined.
 */
export const BLOCK_ICONS = {
  CalendarDays,
  ChevronDown,
  CircleQuestionMark,
  Code,
  Copy,
  CopyPlus,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Info,
  Lightbulb,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Music2,
  OctagonAlert,
  PanelRight,
  Pilcrow,
  Quote,
  Shield,
  Speech,
  StickyNote,
  Swords,
  Trash2,
  TriangleAlert,
};

/** The name of an icon that exists. What every surface carrying an icon name holds. */
export type BlockIconName = keyof typeof BLOCK_ICONS;
