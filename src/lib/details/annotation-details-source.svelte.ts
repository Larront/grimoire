// Details Source for annotation selection on map panes (see CONTEXT.md —
// "Details Source"). The third adapter onto the shared save-status machine, and
// the thinnest: an annotation has no auxiliary data to fan out for, so this
// source is nothing but its save path.
//
// It exists anyway because that save path was the worst of the three. Every
// annotation edit went through MapPane handlers whose whole failure story was
// `console.error`, under a DetailPanel rendered with no `saveStatus` and no
// `onRetrySave` at all — the indicator sitting right there, wired to nothing
// (#203). Routing the panel's edits through the same machine as notes and pins
// is what turns "the label silently didn't save" into `Save failed · Retry`.
//
// MapPane keeps the annotation list — the canvas draws from it — and hands this
// source the two commits it needs to make against it.
//
// Must be instantiated during component init (it registers an $effect) — or
// inside $effect.root in tests.
import { api } from "$lib/api";
import { createSaveStatus } from "./save-status.svelte";
import type { MapAnnotation } from "$lib/types/ledger";

export type { SaveStatus } from "./save-status.svelte";

export function createAnnotationDetailsSource(
  getAnnotation: () => MapAnnotation | null,
  /** Commit a saved annotation back to the pane that owns the list for the canvas. */
  applyAnnotation: (saved: MapAnnotation) => void,
  /** Drop a deleted annotation from that list. */
  removeAnnotation: (id: number) => void,
) {
  const saves = createSaveStatus();

  // Non-reactive: which annotation the current status belongs to.
  let statusForId: number | null = null;

  // A failed save belongs to the shape it was made on — selecting another one
  // must not inherit its error, exactly as switching pins clears the pin's.
  $effect(() => {
    const a = getAnnotation();
    const id = a?.id ?? null;
    if (id === statusForId) return;
    statusForId = id;
    saves.reset();
  });

  /**
   * Save a patched annotation.
   *
   * Quiet surface, and the rule is the indicator rather than the pane: this save
   * has a `Save failed · Retry` of its own to fail into, so a toast would report
   * the same failure twice. MapPane's canvas-side writes (pin/annotation drag)
   * keep the loud surface precisely because they have no such indicator.
   * Never rejects — see the save-status machine.
   */
  async function saveAnnotation(updated: MapAnnotation) {
    await saves.run(async () => {
      const saved = (await api.silent.updateAnnotation(updated)) as MapAnnotation;
      applyAnnotation(saved);
    });
  }

  /** Delete the annotation. Reported through the same machine — a delete that
   *  fails leaves the shape on the map, which the GM needs told about.
   *
   *  A pin delete deliberately does *not* come through here: it is deferred
   *  behind an undo window (`handlePinDelete` in MapPane), so by the time the
   *  backend is called the panel has already closed and there is no indicator
   *  left to report into. */
  async function deleteAnnotation(id: number) {
    await saves.run(async () => {
      await api.silent.deleteAnnotation(id);
      removeAnnotation(id);
    });
  }

  return {
    get saveStatus() {
      return saves.status;
    },
    saveAnnotation,
    deleteAnnotation,
    retrySave: saves.retry,
  };
}

export type AnnotationDetailsSource = ReturnType<typeof createAnnotationDetailsSource>;
