export const DOCK_THRESHOLD = 820;

export type DockMode = 'docked' | 'floating';

export function getDockMode(paneWidth: number): DockMode {
  return paneWidth >= DOCK_THRESHOLD ? 'docked' : 'floating';
}

export function floatTransition(reducedMotion: boolean): { x: number; duration: number } {
  return { x: 200, duration: reducedMotion ? 0 : 150 };
}
