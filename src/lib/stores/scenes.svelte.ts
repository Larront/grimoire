import { invoke } from "@tauri-apps/api/core";
import { vault } from "./vault.svelte";
import type { SceneSlot, SceneWithCount } from "$lib/types/vault";

interface CreateSlotParams {
  source: string;
  sourceId: string;
  label: string;
  volume: number;
  loop: boolean;
  slotOrder: number;
  shuffle: boolean;
}

interface UpdateSlotParams {
  label: string;
  volume: number;
  loop: boolean;
  slotOrder: number;
  shuffle: boolean;
}

function createScenesStore() {
  let scenes = $state<SceneWithCount[]>([]);
  let isLoading = $state(false);
  let error = $state<string | null>(null);

  // Slot cache: keyed by scene_id. Populated on first getSlots() call per scene.
  // Cleared entirely on vault close. Invalidated per-scene on mutations.
  const slotCache = new Map<number, SceneSlot[]>();

  async function load() {
    isLoading = true;
    error = null;
    try {
      scenes = await invoke<SceneWithCount[]>("get_scenes_with_slot_counts");
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

  // --- Scene mutations ---

  async function createScene(name: string): Promise<SceneWithCount> {
    const scene = await invoke<SceneWithCount>("create_scene", { name });
    await load();
    return scene;
  }

  async function deleteScene(id: number): Promise<void> {
    await invoke("delete_scene", { id });
    await load();
  }

  async function updateScene(id: number, name: string): Promise<void> {
    await invoke("update_scene", { id, name });
    await load();
  }

  async function toggleFavorite(id: number): Promise<void> {
    await invoke("toggle_scene_favorite", { id });
    await load();
  }

  async function applyThumbnailColor(id: number, color: string | null): Promise<void> {
    const scene = scenes.find((s) => s.id === id);
    await invoke("update_scene_thumbnail", {
      id,
      thumbnailColor: color,
      thumbnailIcon: scene?.thumbnail_icon ?? null,
      thumbnailPath: scene?.thumbnail_path ?? null,
    });
    await load();
  }

  async function applyThumbnailIcon(id: number, icon: string | null): Promise<void> {
    const scene = scenes.find((s) => s.id === id);
    await invoke("update_scene_thumbnail", {
      id,
      thumbnailColor: scene?.thumbnail_color ?? null,
      thumbnailIcon: icon,
      thumbnailPath: scene?.thumbnail_path ?? null,
    });
    await load();
  }

  async function setThumbnailImage(id: number, path: string | null): Promise<void> {
    const scene = scenes.find((s) => s.id === id);
    await invoke("update_scene_thumbnail", {
      id,
      thumbnailColor: scene?.thumbnail_color ?? null,
      thumbnailIcon: scene?.thumbnail_icon ?? null,
      thumbnailPath: path,
    });
    await load();
  }

  // --- Slot mutations ---
  // Each slot mutation invalidates the cache and returns the refreshed slot list,
  // so callers can update local state in one await rather than three steps.

  async function addSlot(sceneId: number, params: CreateSlotParams): Promise<SceneSlot[]> {
    await invoke("create_scene_slot", { sceneId, ...params });
    invalidateSlots(sceneId);
    const slots = await getSlots(sceneId);
    await load(); // refresh slot_count on parent scene
    return slots;
  }

  async function deleteSlot(sceneId: number, slotId: number): Promise<SceneSlot[]> {
    await invoke("delete_scene_slot", { id: slotId });
    invalidateSlots(sceneId);
    const slots = await getSlots(sceneId);
    await load(); // refresh slot_count on parent scene
    return slots;
  }

  async function updateSlot(sceneId: number, slotId: number, params: UpdateSlotParams): Promise<SceneSlot[]> {
    await invoke("update_scene_slot", { id: slotId, ...params });
    invalidateSlots(sceneId);
    return getSlots(sceneId);
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
    get scenes() {
      return scenes;
    },
    get sceneCount() {
      return scenes.length;
    },
    get isLoading() {
      return isLoading;
    },
    get error() {
      return error;
    },
    load,
    getSlots,
    invalidateSlots,
    createScene,
    deleteScene,
    updateScene,
    toggleFavorite,
    addSlot,
    deleteSlot,
    updateSlot,
    applyThumbnailColor,
    applyThumbnailIcon,
    setThumbnailImage,
  };
}

export const scenes = createScenesStore();
