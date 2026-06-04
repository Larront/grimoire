// Details Source for pin selection on map panes (see CONTEXT.md — "Details
// Source"). Owns the auxiliary-data fan-out behind the PinDetails body: pin
// tags, the ledger-global tag list, per-map Pin Categories, and the linked-note
// preview — plus the save-status machine for tag saves. The pin row itself
// (position, patches via update_pin) stays with MapPane, which the canvas
// needs for rendering.
//
// Must be instantiated during component init (it registers $effects) — or
// inside $effect.root in tests.
import { invoke } from "@tauri-apps/api/core";
import { untrack } from "svelte";
import type { Note, Pin, PinCategory } from "$lib/types/ledger";
import type { SaveStatus } from "./note-details-source.svelte";

export function createPinDetailsSource(
  getPin: () => Pin | null,
  getLinkedNote: () => Note | null,
) {
  let pinTags = $state<string[]>([]);
  let allTags = $state<string[]>([]);
  let categories = $state<PinCategory[]>([]);
  let notePreview = $state<string | null>(null);
  let saveStatus = $state<SaveStatus>("idle");

  // Non-reactive: guard stale async responses when selection switches quickly.
  let loadedForPinId: number | null = null;
  let loadedForMapId: number | null = null;
  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  let lastFailedSave: (() => Promise<void>) | null = null;

  async function refreshAllTags() {
    try { allTags = (await invoke<string[]>("list_all_tags")) ?? []; }
    catch { allTags = []; }
  }

  // Pin tags — keyed by pin id so pin patches (title, color…) don't refetch.
  $effect(() => {
    const p = getPin();
    if (!p) {
      pinTags = [];
      loadedForPinId = null;
      return;
    }
    if (p.id === loadedForPinId) return;
    const targetId = p.id;
    loadedForPinId = targetId;
    saveStatus = "idle";
    invoke<string[]>("get_pin_tags", { pinId: targetId })
      .then((t) => { if (loadedForPinId !== targetId) return; pinTags = t; })
      .catch(() => { pinTags = []; });
    refreshAllTags();
  });

  // Pin Categories — per-map, so keyed by map id.
  $effect(() => {
    const p = getPin();
    if (!p) return;
    if (p.map_id === loadedForMapId) return;
    const targetMapId = p.map_id;
    loadedForMapId = targetMapId;
    invoke<PinCategory[]>("get_pin_categories_for_map", { mapId: targetMapId })
      .then((cats) => { if (loadedForMapId !== targetMapId) return; categories = cats; })
      .catch(() => { categories = []; });
  });

  // Linked-note preview — first ~150 chars of the note body, markdown-stripped.
  $effect(() => {
    const linked = getLinkedNote();
    if (!linked) { notePreview = null; return; }
    const targetPath = linked.path;
    invoke<string>("read_note_content", { notePath: targetPath })
      .then((content) => {
        if (untrack(() => getLinkedNote())?.path !== targetPath) return;
        const stripped = content.replace(/[#*_`\[\]]/g, "").trim();
        notePreview = stripped.slice(0, 150) + (stripped.length > 150 ? "…" : "");
      })
      .catch(() => { notePreview = null; });
  });

  function beginSave() {
    if (statusTimer) clearTimeout(statusTimer);
    saveStatus = "idle";
  }

  async function savePinTags(next: string[]) {
    const p = untrack(() => getPin());
    if (!p) return;
    beginSave();
    try {
      await invoke("set_pin_tags", { pinId: p.id, tags: next });
      refreshAllTags();
      lastFailedSave = null;
      saveStatus = "saved";
      statusTimer = setTimeout(() => { saveStatus = "idle"; }, 1500);
    } catch {
      saveStatus = "error";
      lastFailedSave = () => savePinTags(untrack(() => pinTags));
    }
  }

  async function retrySave() {
    await lastFailedSave?.();
  }

  return {
    get pinTags() { return pinTags; },
    set pinTags(v: string[]) { pinTags = v; },
    get allTags() { return allTags; },
    get categories() { return categories; },
    get notePreview() { return notePreview; },
    get saveStatus() { return saveStatus; },
    savePinTags,
    retrySave,
  };
}

export type PinDetailsSource = ReturnType<typeof createPinDetailsSource>;
