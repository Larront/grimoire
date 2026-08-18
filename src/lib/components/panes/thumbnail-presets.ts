import { Skull, Flame, Shield, Wand2, Swords, Moon, Crown, Eye, ScrollText, BookOpen } from "@lucide/svelte";
import { ACCENT_PRESETS } from "$lib/entity-colors";

/*
  A scene thumbnail's colour layer is the accent presets and nothing else. This file used
  to state the five of them a second time, under a name of its own, which is how the
  pickers in one app came to disagree about what colour "crimson" is (#222). They live in
  `$lib/entity-colors` now, with the pin and annotation rows drawn from the same table,
  and the scene pickers iterate `ACCENT_PRESETS` directly rather than through an alias
  here — one name for one thing.

  What stays is the two CYCLES below, which are this file's own and belong to scenes:
  a scene with no colour chosen wears the preset its id lands on, so an unstyled ledger
  is still a legible grid rather than five hundred identical cards.
*/
export const ACCENT_BG = ACCENT_PRESETS.map((p) => p.bg);
export const ACCENT_FG = ACCENT_PRESETS.map((p) => p.swatch);

export const ICON_OPTIONS = [
  { name: "Skull", icon: Skull },
  { name: "Flame", icon: Flame },
  { name: "Shield", icon: Shield },
  { name: "Wand2", icon: Wand2 },
  { name: "Swords", icon: Swords },
  { name: "Moon", icon: Moon },
  { name: "Crown", icon: Crown },
  { name: "Eye", icon: Eye },
  { name: "ScrollText", icon: ScrollText },
  { name: "BookOpen", icon: BookOpen },
];

export const ICON_MAP: Record<string, typeof Skull> = Object.fromEntries(
  ICON_OPTIONS.map(({ name, icon }) => [name, icon]),
);
