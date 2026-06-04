import { ledger } from "./ledger.svelte";
import { api } from "$lib/api";
import type { Scene, SceneSlot, SceneWithCount } from "$lib/types/ledger";

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
  // Cleared entirely on ledger close. Invalidated per-scene on mutations.
  const slotCache = new Map<number, SceneSlot[]>();

  async function load() {
    isLoading = true;
    error = null;
    try {
      scenes = await api.getScenesWithSlotCounts();
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
    const raw = await api.getSceneSlots(sceneId);
    // Cast is_loop integer (0/1) to boolean. `as SceneSlot[]` narrows the
    // generated `volume: number | null` (specta's NaN-guard on floats) to the
    // ledger type's `number` — volumes are never null.
    const slots = raw.map((s) => ({ ...s, loop: !!s.loop })) as SceneSlot[];
    slotCache.set(sceneId, slots);
    return slots;
  }

  function invalidateSlots(sceneId: number) {
    slotCache.delete(sceneId);
  }

  // --- Scene mutations ---

  async function createScene(name: string): Promise<Scene> {
    const scene = await api.createScene(name);
    await load();
    return scene;
  }

  async function deleteScene(id: number): Promise<void> {
    await api.deleteScene(id);
    await load();
  }

  async function updateScene(id: number, name: string): Promise<void> {
    await api.updateScene(id, name);
    await load();
  }

  async function toggleFavorite(id: number): Promise<void> {
    await api.toggleSceneFavorite(id);
    await load();
  }

  async function applyThumbnailColor(id: number, color: string | null): Promise<void> {
    const scene = scenes.find((s) => s.id === id);
    await api.updateSceneThumbnail(
      id,
      scene?.thumbnail_path ?? null,
      color,
      scene?.thumbnail_icon ?? null,
    );
    await load();
  }

  async function applyThumbnailIcon(id: number, icon: string | null): Promise<void> {
    const scene = scenes.find((s) => s.id === id);
    await api.updateSceneThumbnail(
      id,
      scene?.thumbnail_path ?? null,
      scene?.thumbnail_color ?? null,
      icon,
    );
    await load();
  }

  async function setThumbnailImage(id: number, path: string | null): Promise<void> {
    const scene = scenes.find((s) => s.id === id);
    await api.updateSceneThumbnail(
      id,
      path,
      scene?.thumbnail_color ?? null,
      scene?.thumbnail_icon ?? null,
    );
    await load();
  }

  // --- Slot mutations ---
  // Each slot mutation invalidates the cache and returns the refreshed slot list,
  // so callers can update local state in one await rather than three steps.

  async function addSlot(sceneId: number, params: CreateSlotParams): Promise<SceneSlot[]> {
    await api.createSceneSlot(
      sceneId,
      params.source,
      params.sourceId,
      params.label,
      params.volume,
      params.loop,
      params.slotOrder,
      params.shuffle,
    );
    invalidateSlots(sceneId);
    const slots = await getSlots(sceneId);
    await load(); // refresh slot_count on parent scene
    return slots;
  }

  async function deleteSlot(sceneId: number, slotId: number): Promise<SceneSlot[]> {
    await api.deleteSceneSlot(slotId);
    invalidateSlots(sceneId);
    const slots = await getSlots(sceneId);
    await load(); // refresh slot_count on parent scene
    return slots;
  }

  async function updateSlot(sceneId: number, slotId: number, params: UpdateSlotParams): Promise<SceneSlot[]> {
    await api.updateSceneSlot(
      slotId,
      params.label,
      params.volume,
      params.loop,
      params.slotOrder,
      params.shuffle,
    );
    invalidateSlots(sceneId);
    return getSlots(sceneId);
  }

  $effect.root(() => {
    $effect(() => {
      if (ledger.isOpen) {
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
