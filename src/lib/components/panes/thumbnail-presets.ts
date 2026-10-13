import {
  Music2,
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
import { sceneColorHex, wash } from "$lib/color";

/** The strength of a scene colour's fill behind its icon — the presets' own 18%. */
const SCENE_WASH_ALPHA = 0.18;

/*
  A scene thumbnail's colour layer is the accent presets and nothing else. This file used
  to state the five of them a second time, under a name of its own, which is how the
  pickers in one app came to disagree about what colour "crimson" is (#222). They live in
  `$lib/entity-colors` now, with the pin and annotation rows drawn from the same table,
  and the scene pickers iterate `ACCENT_PRESETS` directly rather than through an alias
  here — one name for one thing.

  What stays is the two CYCLES below, and only the PDF scene-link layer reads them: there
  a hue pairs one highlight on the page with its chip, which is identity, not decoration.
  Every other surface draws a scene through `sceneThumbColors` and `sceneIcon` further
  down, so one scene looks like one thing wherever it appears.
*/
export const ACCENT_BG = ACCENT_PRESETS.map((p) => p.bg);
export const ACCENT_FG = ACCENT_PRESETS.map((p) => p.swatch);

/** `name` is what a scene stores and must never change; `label` is what a GM reads. */
export const ICON_OPTIONS = [
  { name: "Skull", label: "Skull", icon: Skull },
  { name: "Flame", label: "Flame", icon: Flame },
  { name: "Shield", label: "Shield", icon: Shield },
  { name: "Wand2", label: "Wand", icon: Wand2 },
  { name: "Swords", label: "Swords", icon: Swords },
  { name: "Moon", label: "Moon", icon: Moon },
  { name: "Crown", label: "Crown", icon: Crown },
  { name: "Eye", label: "Eye", icon: Eye },
  { name: "ScrollText", label: "Scroll", icon: ScrollText },
  { name: "BookOpen", label: "Book", icon: BookOpen },
];

export const ICON_MAP: Record<string, typeof Skull> = Object.fromEntries(
  ICON_OPTIONS.map(({ name, icon }) => [name, icon]),
);

/*
  The icon a scene wears when the GM has not chosen one: a music note, because a scene is
  sound. The dashboard alone used to draw a clapperboard here while the editor, the
  sidebar and the in-note player drew the note, so an untouched scene changed shape as it
  moved between them.
*/
export const DEFAULT_SCENE_ICON = Music2;

export function sceneIcon(scene: { thumbnail_icon: string | null }): typeof Skull {
  return (scene.thumbnail_icon && ICON_MAP[scene.thumbnail_icon]) || DEFAULT_SCENE_ICON;
}

/*
  A scene's thumbnail colours, for every surface that draws one — the dashboard card, the
  scene editor's header, the in-note scene player and its picker. A colour the GM chose is
  theirs — any colour, from the picker — with the icon drawn in it; a scene with none
  chosen wears Iron Raised and a muted icon.

  The unchosen case used to cycle the accent presets by id, so an untouched ledger read
  as a random purple, green and blue grid and the same random hues bled into every note
  that embedded a scene. That was the app assigning colour to tell things apart, which
  DESIGN.md's No Decorative Color Rule refuses: scenes are told apart by name and icon.
  The editor's header kept cycling after the dashboard stopped, so a scene with no colour
  was neutral on its card and purple, green or blue in its own editor. The PDF scene-link
  layer keeps the cycle above on purpose — there a hue pairs one highlight on the page
  with its chip, which is identity, not decoration.
*/
export function sceneThumbColors(scene: { thumbnail_color: string | null }): {
  bg: string;
  fg: string;
} {
  const hex = sceneColorHex(scene.thumbnail_color);
  if (!hex) {
    return { bg: "var(--background-elevated)", fg: "var(--foreground-muted)" };
  }
  // Any colour the GM picks is drawn as a preset always was: an 18% wash behind the
  // icon, the icon in the colour itself.
  return { bg: wash(hex, SCENE_WASH_ALPHA), fg: hex };
}
