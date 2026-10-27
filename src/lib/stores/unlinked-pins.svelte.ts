// Pins a repair left pointing at nothing (#224), and the GM's way through them.
//
// A repair — on open, or mid-session when the Ledger Watcher rebuilt after a bulk
// change — can re-create note rows, which costs them their id and unlinks every pin
// that held it. This is the list of those pins until each is linked again or deleted.
//
// Revised in the 2026-10 design review: the list used to be lost after one step. The
// toast's "Show pins" dismissed the toast, choosing a pin closed the dialog, and
// nothing could open it again, so a GM with five pins to fix could fix one. Now the
// list is the state, not the dialog's: it shrinks as pins are fixed, and the palette
// reopens it while any remain. It is said in the world's "needs attention" place (the
// world menu and the World Home, `needs-attention.svelte.ts`), not a toast that could
// outlive its world.
import type { UnlinkedPin } from "$lib/bindings.gen";

let pins = $state<UnlinkedPin[]>([]);
let open = $state(false);

/** A pin the GM chose in the list: its map pane selects it on arrival. */
let goTo = $state<{ mapId: number; pinId: number } | null>(null);
/** The pin whose note search should take the caret when its panel appears. */
let focusFor = $state<number | null>(null);

export const unlinkedPins = {
  get pins() {
    return pins;
  },
  get count() {
    return pins.length;
  },
  get open() {
    return open;
  },
  set open(v: boolean) {
    open = v;
  },

  /** A world opened: its repair's list, in place of any other world's. */
  replace(next: UnlinkedPin[]) {
    pins = next;
    open = false;
    goTo = null;
    focusFor = null;
  },

  /**
   * A mid-session repair found more. Added to the pins not yet fixed, not in place of
   * them — a second batch used to drop the first.
   */
  add(more: UnlinkedPin[]) {
    const known = new Set(pins.map((p) => p.pin_id));
    pins = [...pins, ...more.filter((p) => !known.has(p.pin_id))];
  },

  /** A pin was linked again, or deleted: it leaves the list. */
  resolve(pinId: number) {
    if (!pins.some((p) => p.pin_id === pinId)) return;
    pins = pins.filter((p) => p.pin_id !== pinId);
    if (pins.length === 0) open = false;
  },

  show() {
    open = true;
  },

  /** The note a listed pin used to open — what its note search starts with. */
  wasNoteFor(pinId: number): string | null {
    return pins.find((p) => p.pin_id === pinId)?.was_note_title || null;
  },

  /** Go to a pin: the dialog closes and the pin's map selects it when it is there. */
  goToPin(pin: UnlinkedPin) {
    open = false;
    goTo = { mapId: pin.map_id, pinId: pin.pin_id };
  },

  /** The map pane `mapId` takes the request, if it is for it. */
  takeGoTo(mapId: number): number | null {
    if (goTo?.mapId !== mapId) return null;
    const { pinId } = goTo;
    goTo = null;
    focusFor = pinId;
    return pinId;
  },
  get goTo() {
    return goTo;
  },

  /** The pin panel for `pinId` takes the caret, once. */
  takeFocus(pinId: number): boolean {
    if (focusFor !== pinId) return false;
    focusFor = null;
    return true;
  },
};
