// Details Source for pin selection on map panes (see CONTEXT.md — "Details
// Source"). Owns everything between the PinDetails body and the backend: the
// auxiliary-data fan-out (pin tags, the ledger-global tag list, per-map Pin
// Categories, the linked-note preview) and the save-status machine covering
// *every* edit the panel offers — tags and the pin row alike.
//
// The pin row itself still lives on MapPane, which the canvas needs for
// rendering and drag; what moved here is the pin's save *path*. Those are two
// different needs, and separating them is what lets a title, colour or category
// change light up the DetailPanel's indicator instead of failing silently into
// an unhandled rejection from a blur handler (#203). MapPane keeps the list by
// handing this source an `applyPin` to commit each saved row through.
//
// Must be instantiated during component init (it registers $effects) — or
// inside $effect.root in tests.
import { api } from "$lib/api";
import { untrack } from "svelte";
import { createSaveStatus } from "./save-status.svelte";
import { staleGuard } from "./stale-guard";
import type { Note, Pin, PinCategory } from "$lib/types/ledger";

export type { SaveStatus } from "./save-status.svelte";

export function createPinDetailsSource(
  getPin: () => Pin | null,
  getLinkedNote: () => Note | null,
  /** Commit a saved pin row back to the pane that owns the list for the canvas. */
  applyPin: (saved: Pin) => void,
) {
  let pinTags = $state<string[]>([]);
  let allTags = $state<string[]>([]);
  let categories = $state<PinCategory[]>([]);
  let notePreview = $state<string | null>(null);

  const saves = createSaveStatus();

  // Non-reactive: guard stale async responses when selection switches quickly.
  let loadedForPinId: number | null = null;
  let loadedForMapId: number | null = null;

  async function refreshAllTags() {
    try { allTags = (await api.silent.listAllTags()) ?? []; }
    catch { allTags = []; }
  }

  // Pin tags — keyed by pin id so pin patches (title, color…) don't refetch.
  // Both settle paths are guarded: an unguarded reject let pin A's failure
  // clear pin B's tags after a quick selection change (#202).
  $effect(() => {
    const p = getPin();
    if (!p) {
      pinTags = [];
      loadedForPinId = null;
      saves.reset();
      return;
    }
    if (p.id === loadedForPinId) return;
    const targetId = p.id;
    loadedForPinId = targetId;
    saves.reset();
    const whenCurrent = staleGuard(targetId, () => loadedForPinId);
    api.silent.getPinTags(targetId)
      .then((t) => whenCurrent(() => { pinTags = t; }))
      .catch(() => whenCurrent(() => { pinTags = []; }));
    refreshAllTags();
  });

  // Pin Categories — per-map, so keyed by map id.
  $effect(() => {
    const p = getPin();
    if (!p) return;
    if (p.map_id === loadedForMapId) return;
    const targetMapId = p.map_id;
    loadedForMapId = targetMapId;
    const whenCurrent = staleGuard(targetMapId, () => loadedForMapId);
    api.silent.getPinCategoriesForMap(targetMapId)
      // Generated `icon` is `string`; the frontend refines it to the `PinIcon`
      // union. The runtime value is always a valid PinIcon, so narrow here.
      .then((cats) => whenCurrent(() => { categories = cats as PinCategory[]; }))
      .catch(() => whenCurrent(() => { categories = []; }));
  });

  // Linked-note preview — first ~150 chars of the note body, markdown-stripped.
  $effect(() => {
    const linked = getLinkedNote();
    if (!linked) { notePreview = null; return; }
    const targetPath = linked.path;
    // Keyed on the linked note's path, which lives on the caller's side rather
    // than in a `loadedFor*` of this source's own.
    const whenCurrent = staleGuard<string | null>(targetPath, () =>
      untrack(() => getLinkedNote())?.path ?? null,
    );
    api.silent.readNoteContent(targetPath)
      .then((content) => whenCurrent(() => {
        const stripped = content.replace(/[#*_`\[\]]/g, "").trim();
        notePreview = stripped.slice(0, 150) + (stripped.length > 150 ? "…" : "");
      }))
      .catch(() => whenCurrent(() => { notePreview = null; }));
  });

  async function savePinTags(next: string[]) {
    const p = untrack(() => getPin());
    if (!p) return;
    await saves.run(async () => {
      await api.silent.setPinTags(p.id, next);
      refreshAllTags();
    });
  }

  /**
   * Save a patched pin row.
   *
   * Quiet surface, and the rule is the indicator rather than the pane: this save
   * has a `Save failed · Retry` of its own to fail into, so a toast would report
   * the same failure twice. MapPane's canvas-side writes (pin/annotation drag)
   * keep the loud surface precisely because they have no such indicator.
   * Never rejects — see the save-status machine.
   */
  async function savePin(updated: Pin) {
    await saves.run(async () => {
      const saved = (await api.silent.updatePin(updated)) as Pin;
      applyPin(saved);
    });
  }

  return {
    get pinTags() { return pinTags; },
    set pinTags(v: string[]) { pinTags = v; },
    get allTags() { return allTags; },
    get categories() { return categories; },
    get notePreview() { return notePreview; },
    get saveStatus() { return saves.status; },
    savePinTags,
    savePin,
    retrySave: saves.retry,
  };
}

export type PinDetailsSource = ReturnType<typeof createPinDetailsSource>;
