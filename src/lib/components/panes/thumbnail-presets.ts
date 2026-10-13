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
import { storedColorHex, wash } from "$lib/color";

/** The strength of a scene colour's fill behind its icon — the presets' own 18%. */
const SCENE_WASH_ALPHA = 0.18;

/*
  A scene's hue on a PDF page: the colour its links are underlined in, and the colour its
  chip wears in the link's bubble and the picker. On a page a hue is identity, not
  decoration — it pairs a passage with its scene — so a scene the GM has not coloured
  still needs one, and takes the accent preset its id lands on.

  One function for all three. The underline, the chip's wash and the chip's icon used to
  read three different sources, so a scene coloured gold had a gold chip behind a blue
  icon over a blue underline. Every other surface draws a scene through
  `sceneThumbColors` and `sceneIcon` below, where an uncoloured scene stays neutral.
*/
const LINK_CYCLE = ACCENT_PRESETS.map((p) => p.swatch);

export function sceneLinkHue(scene: { id: number; thumbnail_color: string | null }): string {
  return storedColorHex(scene.thumbnail_color) ?? LINK_CYCLE[scene.id % LINK_CYCLE.length];
}

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
  const hex = storedColorHex(scene.thumbnail_color);
  if (!hex) {
    return { bg: "var(--background-elevated)", fg: "var(--foreground-muted)" };
  }
  // Any colour the GM picks is drawn as a preset always was: an 18% wash behind the
  // icon, the icon in the colour itself.
  return { bg: wash(hex, SCENE_WASH_ALPHA), fg: hex };
}
