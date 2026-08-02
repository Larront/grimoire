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
  TriangleAlert,
} from "@lucide/svelte";

/**
 * Typed loosely on purpose: every Lucide icon is a distinct component type, and the
 * callers hold a `string` off a model rather than a known key.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IconComponent = any;

/** Every icon an editor surface names. A name with no entry resolves to nothing. */
export const BLOCK_ICONS: Record<string, IconComponent> = {
  CalendarDays,
  ChevronDown,
  CircleQuestionMark,
  Code,
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
  TriangleAlert,
};
