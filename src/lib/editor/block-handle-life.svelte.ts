// The block handle's life: whether it is up, which block it is on, and for which reasons
// (#190, #191, #211).
//
// One module rather than two halves, and it starts from the third thing #190 had to get
// right: **the grip must not disappear when the pointer moves onto it.**
//
// The editor reports the block under the pointer on `mousemove`, and reports nothing at
// all once the pointer leaves the prose — which is exactly what moving onto the grip is.
// The grip is editor chrome, a sibling of the document, so the browser raises a leave on
// the prose and, a moment later, an enter on the grip. A hide that fired on the first of
// those would take the grip away in the gap between them, every time, at the precise
// moment a GM reached for it.
//
// So a hide is *scheduled*, and anything that holds the grip cancels it. There are four
// such reasons — the pointer, the focus, a keyboard grab waiting to be answered, and an
// open menu — and they overlap in every order a GM can produce: the pointer crosses a gap
// to reach the menu, so the grip's own `mouseleave` fires *while the menu is open*;
// Escape closes the menu with the pointer still on the grip; `Mod-Shift-h` raises the grip
// under a resting pointer, so the first nudge of the mouse leaves a grip that still holds
// the keyboard.
//
// Splitting those four across a component and a machine is what this module stopped doing.
// The sequences between them — a menu that must close *before* the write it runs, a drag
// that must both end the drag and take the handle down, an edit that must walk a held
// target through the change before invalidating anything else — were prose in a
// component's `<script>` and asserted nowhere, and the gap between the two halves is
// exactly where the "frozen grip" class of bug lived: a latch set by one half and released
// by the other, with the whole component free to unmount in between.
//
// What the grip reports here are *gestures* — a pointer arrived, the menu was asked for, an
// item was chosen — and what it reads back is what to draw. The orderings are this
// module's, and they are asserted through it.
import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import {
  blockLabel,
  blockStillThere,
  blockTargetAt,
  endBlockDrag,
  moveBlock,
  releaseBlock,
  type BlockTarget,
} from "$lib/editor/block-handle";
import {
  actionFailureMessage,
  blockHandleMenuSections,
  runBlockHandleAction,
  type BlockHandleCommand,
  type BlockHandleMenuSection,
} from "$lib/editor/block-handle-menu";
import { toastError } from "$lib/toast";

/**
 * Long enough for a `mouseleave` on the prose to be followed by a `mouseenter` on the
 * grip — those are consecutive events in one pointer move, so this is generous — and
 * short enough that a grip abandoned by a pointer heading elsewhere is gone before the GM
 * looks back at it.
 */
export const HANDLE_HIDE_MS = 120;

/** Where the menu is drawn: off the grip's own box, below it or above it. */
export interface BlockHandleMenuAnchor {
  x: number;
  y: number;
  anchorTop: number;
}

/**
 * An open menu, and everything about it that is fixed the moment it opens.
 *
 * The block is captured whole — position *and* node — so that an edit landing while the
 * menu is up is caught by `blockStillThere` rather than silently redirected to whichever
 * block has moved into that position. The sections are captured with it for the same
 * reason rather than for symmetry: they are read off the document, and which kind is
 * ticked as current is a fact about the block as it stood when the GM opened the menu.
 * Deriving them live would have the list under the pointer change shape mid-reach.
 */
export interface BlockHandleMenuState {
  target: BlockTarget;
  sections: BlockHandleMenuSection[];
  anchor: BlockHandleMenuAnchor;
}

export interface BlockHandleLife {
  /** The block the handle is drawn beside, or null when there is no handle. */
  readonly target: BlockTarget | null;
  /**
   * True when the handle was raised from the keyboard and has not been drawn yet — the
   * grip reads it once, to take focus. A hover must not steal focus out of the prose,
   * which is why this is not simply "the handle is up".
   */
  readonly grabbed: boolean;
  /** The grip's menu, as it is to be drawn, or null when there is none. */
  readonly menu: BlockHandleMenuState | null;

  // ── What the editor reports ────────────────────────────────────────────────
  /** The editor's answer for the pointer: a block, or null as it leaves the prose. */
  point: (target: BlockTarget | null) => void;
  /**
   * The keyboard's way in: hold the handle up on this block, whatever the pointer is
   * doing, until it is dismissed. Held from the start, because there is no pointer on it
   * to do the holding.
   */
  grab: (target: BlockTarget) => void;
  /**
   * The document changed. A grip the GM is **holding** is walked through the change; every
   * other handle is taken down, because the positions it holds are the old document's and
   * the pointer has not moved to re-answer them.
   */
  documentChanged: (transaction: Transaction) => void;
  /**
   * The handle's target is no longer good: the note scrolled under a still pointer. A held
   * grip is exempt — it is mid-gesture. An open menu is not; see the implementation.
   */
  invalidate: () => void;

  // ── What the grip reports ──────────────────────────────────────────────────
  /** The pointer arriving on, or leaving, the grip itself. */
  hover: (on: boolean) => void;
  /** The focus arriving on, or leaving, the grip. Tracked apart from the pointer. */
  focus: (on: boolean) => void;
  /** The grip reports it has taken the focus `grab` asked for. */
  grabHandled: () => void;
  /** The GM asked for the menu, anchored off the grip's measured box. */
  openMenu: (anchor: BlockHandleMenuAnchor) => void;
  /** Dismissed without choosing. The grip stays up, still holding its block. */
  closeMenu: () => void;
  /** One menu item, on the block the menu was opened on. */
  choose: (command: BlockHandleCommand) => Promise<void>;
  /** One place per press, the moved block staying the handle's target. */
  move: (direction: -1 | 1) => boolean;
  /** The gesture is over and the prose takes the caret back. */
  release: () => void;
  /** A drag ended, however it ended. Focus is deliberately untouched. */
  endDrag: () => void;

  destroy: () => void;
}

/**
 * @param editorOf the editor this handle belongs to, read late — the component that owns
 * both builds this before it builds the editor, and a note can close under a grip that is
 * still fading out. Every gesture that reaches the document declines without one, which
 * is the honest answer for both.
 */
export function createBlockHandleLife(
  editorOf: () => Editor | null,
  hideDelay = HANDLE_HIDE_MS,
): BlockHandleLife {
  // `raw`, emphatically: a target holds a ProseMirror node, and a deep proxy over one is
  // both a waste — the node is a tree — and a hazard, since ProseMirror compares its own
  // classes by identity. The whole value is replaced on every change anyway.
  let target = $state.raw<BlockTarget | null>(null);
  let menu = $state.raw<BlockHandleMenuState | null>(null);
  let grabbed = $state(false);
  // Plain `let`s: nothing is drawn from either, and a scheduled hide must read them as
  // they are when the timer fires rather than as they were when the timer was set.
  let hovered = false;
  let focused = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** Whether the GM's own hand or keyboard is on the grip — a gesture in progress. */
  function inHand() {
    return hovered || focused || grabbed;
  }

  /** Whether anything at all is keeping the grip up regardless of where the pointer is. */
  function kept() {
    return inHand() || menu !== null;
  }

  /**
   * Whether the handle is exempt from a change to the document under it.
   *
   * Spelled once because it is asked twice — `documentChanged` walks a target through the
   * change on exactly the condition `invalidate` then declines to act on, and two copies
   * of that rule are two copies that can disagree: the half that carried the target would
   * survive the half that dropped it, or the reverse.
   */
  function midGesture() {
    return inHand() && !menu;
  }

  function scheduleHide() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!kept()) target = null;
    }, hideDelay);
  }

  /**
   * Cancel the pending hide, or start one, according to what is left holding the grip.
   *
   * A handle that is already down needs no hide either: the last hold on a grip is let go
   * *after* the gesture that took it down — the button's own blur arrives once the grip has
   * been unmounted — and a timer armed there would be one aimed at nothing.
   */
  function settle() {
    if (kept() || !target) clearTimeout(timer);
    else scheduleHide();
  }

  /**
   * The handle down and every latch let go, at once.
   *
   * At once rather than after the hide delay: the positions the handle holds describe the
   * document as it was *before* whatever just landed, so a grip left on screen is a grip
   * pointing at whichever block has since moved into that spot. And every latch, because
   * one left set is one nothing is coming back to release — the grip frozen off for the
   * rest of the session, with nothing on screen saying why.
   */
  function down() {
    clearTimeout(timer);
    hovered = false;
    focused = false;
    grabbed = false;
    menu = null;
    target = null;
  }

  /**
   * The block moved and the handle follows it — a keyboard reorder, whose landing position
   * is known only after the write.
   */
  function retarget(next: BlockTarget) {
    clearTimeout(timer);
    target = next;
  }

  // The three below are declarations rather than methods on the object because they are
  // reached from inside the others as well as from outside it — and a method that called
  // its neighbour through `this` would be a method that stopped working the moment the
  // component passed it to `addEventListener` by name, which is exactly what the scroll
  // listener does with `invalidate`.

  /** Dismissed without choosing. The grip stays up under it, still holding its block. */
  function closeMenu() {
    if (!menu) return;
    menu = null;
    settle();
  }

  /**
   * The end of a gesture that hands the prose back: a menu item, Escape, a menu opened on
   * a block that has gone.
   *
   * The handle comes down and `releaseBlock` puts the caret back. Both halves matter and
   * neither is optional at either route: every position the handle holds describes the
   * document as it was *before* the write — after a Delete there is no block there at all
   * — so a grip left on screen points at whatever has moved into that spot, and a
   * whole-block selection left set is a block the GM's next character replaces.
   */
  function release() {
    down();
    const editor = editorOf();
    if (editor) releaseBlock(editor);
  }

  /**
   * The target is no longer good: the note scrolled under a still pointer, or the document
   * changed beneath positions taken from the old one.
   *
   * A grip in the GM's hand is exempt — it is mid-gesture and its own move is what changed
   * the document. An open menu is emphatically NOT exempt, and the `!menu` is what says so
   * — *including* when the pointer happens to be resting on the grip, which is the one way
   * the holds overlap here. The menu is drawn `fixed` and anchored to a grip placed from a
   * measurement a scroll has just made wrong, so a menu that survived one would hang in the
   * window naming a block that has slid out from under it. Its own actions need no
   * exemption either: `choose` closes the menu *before* it writes.
   */
  function invalidate() {
    if (midGesture()) return;
    down();
  }

  return {
    get target() {
      return target;
    },
    get grabbed() {
      return grabbed;
    },
    get menu() {
      return menu;
    },

    point(next) {
      // The menu owns the target while it is open, and the pointer under it is noise: the
      // menu names one block and every item acts on that block, so a pointer wandering
      // back over the prose underneath must not quietly change which one that is.
      if (menu) return;
      if (next) {
        clearTimeout(timer);
        // Only when it is a different block. `blockTargetAt` builds a fresh object for
        // every answer and `$state.raw` compares by identity, so assigning unconditionally
        // notifies on *every* `mousemove` — sixty to a hundred and twenty a second — and
        // each notification re-runs the grip's placement, which measures the block's box,
        // the first line's rects and the column's computed style. That is a forced reflow
        // per pointer event to re-derive the position the grip is already at.
        //
        // Identity is the right test for the node half for the reason `blockStillThere`
        // gives: ProseMirror rebuilds only the ancestors of what changed, so an edit to
        // this block hands back a different object and the handle re-measures, which is
        // exactly when it should.
        if (!target || target.pos !== next.pos || target.node !== next.node) {
          target = next;
        }
      } else {
        scheduleHide();
      }
    },

    grab(next) {
      clearTimeout(timer);
      grabbed = true;
      target = next;
    },

    grabHandled() {
      // Only the request is dropped, and emphatically no hide is scheduled in its place.
      // The grab holds the grip up *because there is no pointer on it to do the holding*,
      // and what takes over is the focus event the grip's own `el.focus()` raises — which
      // a window that is not the foreground one can withhold until it comes back. A grip that started a hide
      // here would be one that vanished from under the GM's keyboard on that machine, and
      // there is no gesture left to bring it back.
      grabbed = false;
    },

    hover(on) {
      hovered = on;
      settle();
    },

    focus(on) {
      focused = on;
      settle();
    },

    openMenu(anchor) {
      const editor = editorOf();
      if (!editor || !target) return;
      // A menu built on a block the document has lost is ten confident items that are all
      // silent no-ops — every write behind them refuses, and nothing on screen says why.
      // The grip goes instead, which is what a target that has gone means everywhere else.
      if (!blockStillThere(editor.state.doc, target)) {
        release();
        return;
      }
      menu = {
        target,
        sections: blockHandleMenuSections(editor.state.doc, target),
        anchor,
      };
      clearTimeout(timer);
    },

    closeMenu,

    /**
     * The ordering here is the load-bearing part, and it is why this is one method rather
     * than a sequence a component performs.
     *
     * The menu closes **before** the write: an item's write is a document change, and a
     * menu still open across one is drawn `fixed` over a note that has moved under it.
     * Closing first also lets `documentChanged` take the handle down on its own terms
     * rather than finding it pinned.
     *
     * The `catch` is not tidiness: Copy awaits a clipboard, and a clipboard *rejects* — a
     * denied permission, a webview that will not hand one over. Closing the menu has
     * already taken focus off the item that held it, so a throw on the way past would
     * leave the GM's next keystrokes going nowhere at all. It is toasted rather than
     * swallowed because a copy that silently did not happen is discovered at the paste, in
     * another app, with the thing that was going to be pasted no longer to hand.
     *
     * The message names the command rather than always naming the clipboard, because the
     * other three can reach here too — Turn into runs a chain of writes against a position
     * taken when the menu opened — and telling a GM whose Delete failed that their
     * clipboard is broken sends them looking in the wrong place for a gesture that also
     * did nothing.
     *
     * It ends in `release` whatever happened, like every other way out of the grip.
     */
    async choose(command) {
      const editor = editorOf();
      const acting = menu?.target ?? null;
      closeMenu();
      try {
        if (editor && acting) await runBlockHandleAction(editor, acting, command);
      } catch {
        toastError(
          actionFailureMessage(command, acting ? blockLabel(acting.node) : "block"),
        );
      } finally {
        release();
      }
    },

    move(direction) {
      const editor = editorOf();
      if (!editor || !target) return false;
      // The write lands first, and its own `documentChanged` runs inside it — walking the
      // held target through a change it cannot follow, which leaves it as it was. The
      // block's landing position is known only here, after the fact.
      const moved = moveBlock(editor, target, direction);
      if (!moved) return false;
      retarget(moved);
      return true;
    },

    release,

    /**
     * Every way a drag can end, including the ways that change nothing: dropped somewhere
     * that took it, dropped on nothing, Escaped, dragged out of the window. The handle
     * comes down for all of them, and the editor is told the drag is over for all of them —
     * see `endBlockDrag` for what a drag that quietly stayed "in progress" does to the next
     * one.
     *
     * Focus is deliberately untouched, which is why this is not `release`: a drop that
     * landed has already been focused by whoever took it, and that is often not this
     * editor — the other pane's note, the sidebar, Obsidian. See `releaseBlock`.
     */
    endDrag() {
      const editor = editorOf();
      if (editor) endBlockDrag(editor);
      down();
    },

    documentChanged(transaction) {
      // A grip the GM is holding is mid-gesture and `invalidate` leaves it alone, so it is
      // walked through the change instead: the block keeps its identity across an edit only
      // if the edit did not rebuild it, and pressing the grip commits the field it just
      // blurred. Every write addresses its block by node identity, so without this the
      // grip beside that block refuses every gesture while still looking live.
      //
      // `mapResult` says where the block went. A deletion, or a position the change
      // swallowed, answers null and **keeps** what is there rather than dropping it: a
      // keyboard reorder is a document change of the gesture's own, and its landing
      // position is reported a moment later by `move`.
      if (target && midGesture()) {
        const mapped = transaction.mapping.mapResult(target.pos);
        const fresh = mapped.deleted ? null : blockTargetAt(transaction.doc, mapped.pos);
        if (fresh) target = fresh;
      }
      invalidate();
    },

    invalidate,

    destroy() {
      clearTimeout(timer);
    },
  };
}
