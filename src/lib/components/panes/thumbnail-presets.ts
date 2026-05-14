import { Skull, Flame, Shield, Wand2, Swords, Moon, Crown, Eye, ScrollText, BookOpen } from "@lucide/svelte";

export const COLOR_PRESETS = [
  { name: "crimson", label: "Crimson", bg: "rgba(194,72,61,0.18)", swatch: "#c2483d" },
  { name: "arcane", label: "Arcane", bg: "rgba(155,107,191,0.18)", swatch: "#9b6bbf" },
  { name: "verdant", label: "Verdant", bg: "rgba(92,158,110,0.18)", swatch: "#5c9e6e" },
  { name: "ice", label: "Ice", bg: "rgba(91,158,201,0.18)", swatch: "#5b9ec9" },
  { name: "amber", label: "Amber", bg: "rgba(196,154,60,0.18)", swatch: "#c49a3c" },
];

export const ACCENT_BG = COLOR_PRESETS.map((p) => p.bg);
export const ACCENT_FG = COLOR_PRESETS.map((p) => p.swatch);

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
