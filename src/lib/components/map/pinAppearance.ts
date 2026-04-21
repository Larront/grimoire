import type { Pin, PinCategory, PinShape, PinIcon } from '$lib/types/vault';
import type { Component } from 'svelte';
import {
	Star, Sword, Shield, Crown, Skull, House,
	Anchor, Flame, Eye, Scroll, Footprints, Castle,
	Gem, Cross, Flag, TreePine
} from '@lucide/svelte';

export type ResolvedAppearance = {
	shape: PinShape;
	color: string;
	icon: PinIcon;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const CURATED_ICON_COMPONENTS = new Map<PinIcon, Component<any>>([
	['star', Star],
	['sword', Sword],
	['shield', Shield],
	['crown', Crown],
	['skull', Skull],
	['house', House],
	['anchor', Anchor],
	['flame', Flame],
	['eye', Eye],
	['scroll', Scroll],
	['footprints', Footprints],
	['castle', Castle],
	['gem', Gem],
	['cross', Cross],
	['flag', Flag],
	['tree-pine', TreePine],
]);

export function resolvedAppearance(pin: Pin, cat: PinCategory | undefined): ResolvedAppearance {
	return {
		shape: pin.shape ?? cat?.shape ?? 'pin',
		color: pin.color ?? cat?.color ?? '#4a90c4',
		icon: pin.icon ?? cat?.icon ?? 'star',
	};
}

function shapeHtml(shape: PinShape, color: string, iconHtml: string): string {
	const border = `stroke="rgba(255,255,255,0.22)" stroke-width="1.5"`;

	switch (shape) {
		case 'circle':
			return `<div style="position:relative;width:32px;height:32px;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.5))">
				<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style="position:absolute;top:0;left:0">
					<circle cx="16" cy="16" r="15" fill="${color}" ${border}/>
				</svg>
				<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">${iconHtml}</div>
			</div>`;

		case 'pin':
			return `<div style="position:relative;width:28px;height:42px;filter:drop-shadow(0 3px 6px rgba(0,0,0,0.5))">
				<svg width="28" height="42" viewBox="0 0 28 42" fill="none" xmlns="http://www.w3.org/2000/svg" style="position:absolute;top:0;left:0">
					<path d="M14 40 C6 29 2 23 2 14 A12 12 0 0 1 26 14 C26 23 22 29 14 40 Z" fill="${color}" ${border}/>
				</svg>
				<div style="position:absolute;top:3px;left:4px;width:20px;height:20px;display:flex;align-items:center;justify-content:center">${iconHtml}</div>
			</div>`;

		case 'diamond':
			return `<div style="position:relative;width:34px;height:34px;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.5))">
				<svg width="34" height="34" viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg" style="position:absolute;top:0;left:0">
					<path d="M17 2 L32 17 L17 32 L2 17 Z" fill="${color}" ${border}/>
				</svg>
				<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">${iconHtml}</div>
			</div>`;

		case 'headstone':
			return `<div style="position:relative;width:30px;height:40px;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.5))">
				<svg width="30" height="40" viewBox="0 0 30 40" fill="none" xmlns="http://www.w3.org/2000/svg" style="position:absolute;top:0;left:0">
					<path d="M3 15 A12 12 0 0 1 27 15 L27 37 A2 2 0 0 1 25 39 L5 39 A2 2 0 0 1 3 37 Z" fill="${color}" ${border}/>
				</svg>
				<div style="position:absolute;top:4px;left:5px;width:20px;height:20px;display:flex;align-items:center;justify-content:center">${iconHtml}</div>
			</div>`;

		case 'shield':
			return `<div style="position:relative;width:28px;height:36px;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.5))">
				<svg width="28" height="36" viewBox="0 0 28 36" fill="none" xmlns="http://www.w3.org/2000/svg" style="position:absolute;top:0;left:0">
					<path d="M14 2 L2 7 L2 19 C2 26 7.5 32 14 34 C20.5 32 26 26 26 19 L26 7 Z" fill="${color}" ${border}/>
				</svg>
				<div style="position:absolute;top:5px;left:4px;width:20px;height:20px;display:flex;align-items:center;justify-content:center">${iconHtml}</div>
			</div>`;

		case 'banner':
			return `<div style="position:relative;width:34px;height:30px;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.5))">
				<svg width="34" height="30" viewBox="0 0 34 30" fill="none" xmlns="http://www.w3.org/2000/svg" style="position:absolute;top:0;left:0">
					<path d="M2 2 L32 2 L32 21 L17 28 L2 21 Z" fill="${color}" ${border}/>
				</svg>
				<div style="position:absolute;top:3px;left:7px;width:20px;height:16px;display:flex;align-items:center;justify-content:center">${iconHtml}</div>
			</div>`;

		default:
			return shapeHtml('circle', color, iconHtml);
	}
}

type SizeAndAnchor = { size: [number, number]; anchor: [number, number] };

const SHAPE_GEOMETRY: Record<PinShape, SizeAndAnchor> = {
	circle:    { size: [32, 32], anchor: [16, 16] },
	pin:       { size: [28, 42], anchor: [14, 42] },
	diamond:   { size: [34, 34], anchor: [17, 17] },
	headstone: { size: [30, 40], anchor: [15, 40] },
	shield:    { size: [28, 36], anchor: [14, 36] },
	banner:    { size: [34, 30], anchor: [17, 15] },
};

export function buildDivIcon(
	shape: PinShape,
	color: string,
	iconHtml: string,
	L: typeof import('leaflet')
): import('leaflet').DivIcon {
	const { size, anchor } = SHAPE_GEOMETRY[shape] ?? SHAPE_GEOMETRY.circle;
	return L.divIcon({
		html: shapeHtml(shape, color, iconHtml),
		className: 'grimoire-pin',
		iconSize: size,
		iconAnchor: anchor,
	});
}
