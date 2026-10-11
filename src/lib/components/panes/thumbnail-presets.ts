import {
  Skull,
  Flame,
  Shield,
  Wand2,
  Swords,
  Moon,
  Crown,
  Eye,
  ScrollText,
  BookOpen,
} from "@lucide/svelte";
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

/*
  A scene's thumbnail colours, for every surface that draws one — the dashboard card and
  the in-note scene player. A colour the GM chose is theirs, with the icon in that
  preset's own swatch; a scene with none chosen wears Iron Raised and a muted icon.

  The unchosen case used to cycle the accent presets by id, so an untouched ledger read
  as a random purple, green and blue grid and the same random hues bled into every note
  that embedded a scene. That was the app assigning colour to tell things apart, which
  DESIGN.md's No Decorative Color Rule refuses: scenes are told apart by name and icon.
  The PDF scene-link layer keeps the cycle above on purpose — there a hue pairs one
  highlight on the page with its chip, which is identity, not decoration.
*/
export function sceneThumbColors(scene: { thumbnail_color: string | null }): {
  bg: string;
  fg: string;
} {
  if (!scene.thumbnail_color) {
    return { bg: "var(--background-elevated)", fg: "var(--foreground-muted)" };
  }
  const preset = ACCENT_PRESETS.find((p) => p.bg === scene.thumbnail_color);
  return { bg: scene.thumbnail_color, fg: preset?.swatch ?? "var(--foreground)" };
}
