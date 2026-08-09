// Whether the block handle is on screen, and which block it belongs to.
//
// This exists as its own module for one reason, and it is the third thing #190 had to get
// right: **the grip must not disappear when the pointer moves onto it.**
//
// The editor reports the block under the pointer on `mousemove`, and reports nothing at
// all once the pointer leaves the prose — which is exactly what moving onto the grip is.
// The grip is editor chrome, a sibling of the document, so the browser raises a leave on
// the prose and, a moment later, an enter on the grip. A hide that fired on the first of
// those would take the grip away in the gap between them, every time, at the precise
// moment a GM reached for it.
//
// So a hide is *scheduled*, and holding the grip cancels it. Timers and an ordering
// between two events are the kind of thing that is written once and then quietly broken
// by a later edit to whatever surface owns them, which is why this is not four lines
// inside a component's `<script>`: here it is a state machine over a clock, and the tests
// drive the clock.
import type { BlockTarget } from "$lib/editor/block-handle";

/**
 * Long enough for a `mouseleave` on the prose to be followed by a `mouseenter` on the
 * grip — those are consecutive events in one pointer move, so this is generous — and
 * short enough that a grip abandoned by a pointer heading elsewhere is gone before the GM
 * looks back at it.
 */
export const HANDLE_HIDE_MS = 120;

export interface BlockHandleHover {
  /** The block the handle is drawn beside, or null when there is no handle. */
  readonly target: BlockTarget | null;
  /**
   * True when the handle was raised from the keyboard and has not been drawn yet — the
   * grip reads it once, to take focus. A hover must not steal focus out of the prose,
   * which is why this is not simply "the handle is up".
   */
  readonly grabbed: boolean;
  /** The editor's answer for the pointer: a block, or null as it leaves the prose. */
  point: (target: BlockTarget | null) => void;
  /**
   * The keyboard's way in: hold the handle up on this block, whatever the pointer is
   * doing, until it is dismissed. Held from the start, because there is no pointer on it
   * to do the holding.
   */
  grab: (target: BlockTarget) => void;
  /** The grip reports it has taken the focus `grab` asked for. */
  grabHandled: () => void;
  /** The pointer or focus arriving on, or leaving, the grip itself. */
  hold: (held: boolean) => void;
  /**
   * The gesture is over and its result has landed — a drag that dropped. Down at once
   * rather than after the hide delay: the positions the handle holds describe the
   * document as it was *before* the drop, so a grip left on screen is a grip pointing at
   * whichever block has since moved into that spot.
   */
  release: () => void;
  /** The block moved and the handle follows it — a keyboard reorder. */
  retarget: (target: BlockTarget) => void;
  /**
   * The handle's target is no longer good: the note scrolled under a still pointer, or
   * the document changed beneath positions taken from the old one. A held grip is exempt
   * — it is mid-gesture and its own move is what changed the document.
   */
  invalidate: () => void;
  destroy: () => void;
}

export function createBlockHandleHover(hideDelay = HANDLE_HIDE_MS): BlockHandleHover {
  // `raw`, emphatically: a target holds a ProseMirror node, and a deep proxy over one is
  // both a waste — the node is a tree — and a hazard, since ProseMirror compares its own
  // classes by identity. The whole value is replaced on every change anyway.
  let target = $state.raw<BlockTarget | null>(null);
  // Plain `let`: nothing is drawn from it, and the scheduled hide must read the value as
  // it is when the timer fires rather than as it was when the timer was set.
  let held = false;
  let grabbed = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function scheduleHide() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!held) target = null;
    }, hideDelay);
  }

  return {
    get target() {
      return target;
    },
    get grabbed() {
      return grabbed;
    },
    point(next) {
      if (next) {
        clearTimeout(timer);
        target = next;
      } else {
        scheduleHide();
      }
    },
    grab(next) {
      clearTimeout(timer);
      held = true;
      grabbed = true;
      target = next;
    },
    grabHandled() {
      grabbed = false;
    },
    release() {
      clearTimeout(timer);
      held = false;
      grabbed = false;
      target = null;
    },
    hold(next) {
      held = next;
      if (next) clearTimeout(timer);
      else scheduleHide();
    },
    retarget(next) {
      clearTimeout(timer);
      target = next;
    },
    invalidate() {
      if (held) return;
      clearTimeout(timer);
      target = null;
    },
    destroy() {
      clearTimeout(timer);
    },
  };
}
