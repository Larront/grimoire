// Where a caret-anchored dropdown actually goes.
//
// Three menus are anchored to a caret — the slash command menu, the wikilink
// suggestion the editor's own plugin raises, and the copy of it a [[Linked Text
// Field]] raises inside a Note Block. All three were placed at the caret's bottom
// left and drawn `fixed`, with nothing asking whether that put them inside the
// window: a `/` typed on the last line of a long note opened a menu below the
// viewport, so the GM was choosing from a list they could not see.
//
// The geometry is a pure function of numbers so it can be tested without a layout
// engine, and because the flip has to be decided from the *measured* height of the
// menu — an item list is as tall as its contents until it hits its own max-height,
// and guessing that would flip either too eagerly or not at all.
//
// It is not a general popper: no arrows, no collision boundaries beyond the window,
// no auto-updating on scroll. These menus live for one query and close.

/** The caret the menu hangs off, in viewport coordinates. */
export interface MenuAnchor {
  /** The caret's left edge — the menu's preferred left. */
  x: number;
  /** Where the menu prefers to start: just below the caret. */
  y: number;
  /**
   * The caret's *top*, which is what a flipped menu sits above. Optional so the
   * callers that have not been taught to pass it still place sensibly: without it
   * the flip lands the menu's bottom at `y`, overlapping the line by the caret's
   * height rather than clearing it.
   */
  anchorTop?: number;
}

export interface MenuBox {
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** How close a menu may come to the window's edge. */
const MARGIN = 8;

export interface MenuPlacement {
  left: number;
  top: number;
  /** Whether the menu ended up above the caret. Callers may style on it. */
  flipped: boolean;
}

/**
 * The menu's final position: below the caret when it fits, above when it does not,
 * clamped horizontally either way.
 *
 * Flipping is a *preference*, not an ordering — a menu that fits in neither
 * direction stays below and is pinned to the margin, because a menu clipped at the
 * bottom of the window still shows its first item, which is the one the GM is most
 * likely to want. Flipping such a menu would clip its first item instead.
 */
export function menuPlacement(anchor: MenuAnchor, box: MenuBox, viewport: Viewport): MenuPlacement {
  const above = anchor.anchorTop ?? anchor.y;

  const fitsBelow = anchor.y + box.height + MARGIN <= viewport.height;
  const fitsAbove = above - box.height - MARGIN >= 0;
  const flipped = !fitsBelow && fitsAbove;

  const top = flipped
    ? above - box.height - MARGIN
    : // Pinned rather than left to overflow: the menu is already as tall as the
      // window allows, so this keeps its top row on screen.
      Math.max(MARGIN, Math.min(anchor.y, viewport.height - box.height - MARGIN));

  const maxLeft = viewport.width - box.width - MARGIN;
  // `Math.max` last so a menu wider than the window starts at the margin rather
  // than at a negative left.
  const left = Math.max(MARGIN, Math.min(anchor.x, maxLeft));

  return { left, top, flipped };
}

/**
 * Measure an element and place it. Called from an effect that reads whatever makes
 * the menu's content change, so the height is the one on screen right now.
 */
export function placeMenu(el: HTMLElement, anchor: MenuAnchor): void {
  const { left, top } = menuPlacement(
    anchor,
    { width: el.offsetWidth, height: el.offsetHeight },
    { width: window.innerWidth, height: window.innerHeight },
  );
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}
