// The app's motion, for what moves from script: Svelte transitions, the graph, the map,
// a smooth scroll. CSS reads the same setting through `[data-reduce-motion]` (app.css),
// but a Svelte transition runs on the Web Animations API, which that rule can't reach —
// so the sidebar's slides ran at full length with Reduce Motion on, and a few
// components asked the computer's setting directly while the rest asked the app's
// (2026-10 design review). Everything that moves from script asks here.
//
// The durations are the CSS tokens' (`--motion-*` in app.css); DESIGN.md §5 Motion says
// which kind of motion takes which.
import { cubicOut } from "svelte/easing";
import { appPrefs } from "$lib/stores/app-prefs.svelte";

export const QUICK = 100;
export const BASE = 150;
export const ARRIVE = 300;
export const ATTENTION = 600;

/** Svelte's nearest curve to the CSS `ease-out` token. */
export const easeOut = cubicOut;

/** Whether motion is reduced now — the GM's choice, or their computer's. */
export function reduced(): boolean {
  return appPrefs.reduceMotion;
}

/** `duration`, or nothing while motion is reduced. Read as a transition starts. */
export function ms(duration: number): number {
  return reduced() ? 0 : duration;
}

/** For `scrollIntoView` and `scrollTo`. */
export function scrollBehavior(): ScrollBehavior {
  return reduced() ? "auto" : "smooth";
}
