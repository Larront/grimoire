import { invoke } from "@tauri-apps/api/core";
import { vault } from "./vault.svelte";
import type { Scene, SceneSlot } from "$lib/types/vault";

function createScenesStore() {
  let scenes = $state<Scene[]>([]);
  let isLoading = $state(false);
  let error = $state<string | null>(null);

  // Slot cache: keyed by scene_id. Populated on first getSlots() call per scene.
  // Cleared entirely on vault close. Invalidated per-scene on mutations.
  const slotCache = new Map<number, SceneSlot[]>();

  async function load() {
    isLoading = true;
    error = null;
    try {
      scenes = await invoke<Scene[]>("get_scenes");
    } catch (e) {
      error = String(e);
    } finally {
      isLoading = false;
    }
  }

  async function getSlots(sceneId: number): Promise<SceneSlot[]> {
    if (slotCache.has(sceneId)) {
      return slotCache.get(sceneId)!;
    }
    const raw = await invoke<SceneSlot[]>("get_scene_slots", { sceneId });
    // Cast is_loop integer (0/1) to boolean
    const slots = raw.map((s) => ({ ...s, loop: !!s.loop }));
    slotCache.set(sceneId, slots);
    return slots;
  }

  function invalidateSlots(sceneId: number) {
    slotCache.delete(sceneId);
  }

  $effect.root(() => {
    $effect(() => {
      if (vault.isOpen) {
        load();
      } else {
        scenes = [];
        error = null;
        slotCache.clear();
      }
    });
  });

  return {
    get scenes() { return scenes; },
    get isLoading() { return isLoading; },
    get error() { return error; },
    load,
    getSlots,
    invalidateSlots,
  };
}

export const scenes = createScenesStore();
