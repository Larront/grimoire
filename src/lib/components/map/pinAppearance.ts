import type { Pin, PinCategory, PinShape, PinIcon } from "$lib/types/vault";
import type { Component } from "svelte";
import {
  Star,
  Sword,
  Shield,
  Crown,
  Skull,
  House,
  Anchor,
  Flame,
  Eye,
  Scroll,
  Footprints,
  Castle,
  Gem,
  Cross,
  Flag,
  TreePine,
} from "@lucide/svelte";

export type ResolvedAppearance = {
  shape: PinShape;
  color: string;
  icon: PinIcon;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const CURATED_ICON_COMPONENTS = new Map<PinIcon, Component<any>>([
  ["star", Star],
  ["sword", Sword],
  ["shield", Shield],
  ["crown", Crown],
  ["skull", Skull],
  ["house", House],
  ["anchor", Anchor],
  ["flame", Flame],
  ["eye", Eye],
  ["scroll", Scroll],
  ["footprints", Footprints],
  ["castle", Castle],
  ["gem", Gem],
  ["cross", Cross],
  ["flag", Flag],
  ["tree-pine", TreePine],
]);

export function resolvedAppearance(
  pin: Pin,
  cat: PinCategory | undefined,
): ResolvedAppearance {
  return {
    shape: pin.shape ?? cat?.shape ?? "pin",
    color: pin.color ?? cat?.color ?? "#4a90c4",
    icon: pin.icon ?? cat?.icon ?? "star",
  };
}

function safeColor(color: string): string {
  return /^#[0-9a-fA-F]{3,8}$|^rgb/.test(color) ? color : "#4a90c4";
}

function outline(tag: string, attrs: string, color: string): string {
  const shared = `${tag} ${attrs}`;
  return [
    `<${shared} fill="none"     stroke="rgba(0,0,0,0.7)"       stroke-width="4"   stroke-linejoin="round"/>`,
    `<${shared} fill="${color}" stroke="rgba(255,255,255,0.9)"  stroke-width="1.5" stroke-linejoin="round"/>`,
  ].join("");
}

// All shapes share a 28×28 viewBox rendered at 40×40 (scale ≈ 1.43).
// anchor     = geographic point on the 40px rendered icon [x, y]
// iconOffset = top-left of the 20×20 icon div within the 28px container div
type ShapeDef = {
  svgTag: string;
  svgAttrs: string;
  anchor: [number, number];
  iconOffset: { top: number; left: number };
};

const SHAPE_DEFS: Record<PinShape, ShapeDef> = {
  circle: {
    svgTag: "circle",
    svgAttrs: 'cx="14" cy="14" r="12"',
    anchor: [20, 20],
    iconOffset: { top: 10, left: 10 },
  },
  pin: {
    svgTag: "path",
    svgAttrs:
      'd="M14 27 C8 22 4 18 4 12 A10 10 0 0 1 24 12 C24 18 20 22 14 27Z"',
    anchor: [20, 39],
    iconOffset: { top: 7, left: 10 },
  },
  diamond: {
    svgTag: "polygon",
    svgAttrs: 'points="14,1 27,14 14,27 1,14"',
    anchor: [20, 20],
    iconOffset: { top: 10, left: 10 },
  },
  headstone: {
    svgTag: "path",
    svgAttrs: 'd="M3 27 V12 Q3 1 14 1 Q25 1 25 12 V27 Z"',
    anchor: [20, 39],
    iconOffset: { top: 10, left: 10 },
  },
  shield: {
    svgTag: "path",
    svgAttrs: 'd="M14 2 L26 6 V17 Q26 25 14 28 Q2 25 2 17 V6 Z"',
    anchor: [20, 40],
    iconOffset: { top: 10, left: 10 },
  },
  banner: {
    svgTag: "path",
    svgAttrs: 'd="M5 2 H23 V26 L14 22 L5 26 Z"',
    anchor: [20, 3],
    iconOffset: { top: 7, left: 10 },
  },
};

export function tooltipOffset(shape: PinShape): [number, number] {
  const { anchor } = SHAPE_DEFS[shape] ?? SHAPE_DEFS.circle;
  return [0, 40 - anchor[1] + 8];
}

export function buildDivIcon(
  shape: PinShape,
  color: string,
  iconHtml: string,
  L: typeof import("leaflet"),
  selected = false,
): import("leaflet").DivIcon {
  const def = SHAPE_DEFS[shape] ?? SHAPE_DEFS.circle;
  const safeCol = safeColor(color);
  const { top, left } = def.iconOffset;
  const { svgTag, svgAttrs } = def;

  const selectionRing = selected
    ? `<${svgTag} ${svgAttrs} fill="none" stroke="${safeCol}" stroke-width="9" stroke-linejoin="round" opacity="0.9"/>`
    : "";

  const html = `
		<div style="position:relative;width:28px;height:28px">
			<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 28 28" fill="none"
			     style="position:absolute;top:0;left:0;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.45));overflow:visible">
				${selectionRing}
				${outline(svgTag, svgAttrs, safeCol)}
			</svg>
			<div style="position:absolute;top:${top}px;left:${left}px;width:20px;height:20px;
			            display:flex;align-items:center;justify-content:center;pointer-events:none">
				${iconHtml}
			</div>
		</div>`;

  return L.divIcon({
    className: "",
    html,
    iconSize: [40, 40],
    iconAnchor: def.anchor,
  });
}
