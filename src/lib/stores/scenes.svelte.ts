import { api } from "$lib/api";
import { createLedgerCollection } from "./ledger-collection.svelte";
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
  // Slot cache: keyed by scene_id. Populated on first getSlots() call per scene.
  // Cleared entirely on ledger close (via onClose). Invalidated per-scene on mutations.
  const slotCache = new Map<number, SceneSlot[]>();

  // Bumped whenever a scene's tracks change. The cache is what every surface reads, and
  // each one used to hold its own copy of it with nothing to say when another surface
  // changed it: loop turned off in the mini player still showed on there, so the next
  // press saved "off" again and loop could never be turned back on. A surface that shows
  // tracks reads this where it loads them, and loads again when it moves.
  let slotsRevision = $state(0);

  const base = createLedgerCollection<SceneWithCount>({
    fetch: () => api.getScenesWithSlotCounts(),
    onClose: () => slotCache.clear(),
  });

  // One fetch per scene at a time: after a change every surface showing that scene
  // reloads at once, and they share the one request.
  const inflight = new Map<number, Promise<SceneSlot[]>>();

  async function getSlots(sceneId: number): Promise<SceneSlot[]> {
    if (slotCache.has(sceneId)) {
      return slotCache.get(sceneId)!;
    }
    const pending = inflight.get(sceneId);
    if (pending) return pending;
    const request = api
      .getSceneSlots(sceneId)
      .then((raw) => {
        // Cast is_loop integer (0/1) to boolean. `as SceneSlot[]` narrows the
        // generated `volume: number | null` (specta's NaN-guard on floats) to the
        // ledger type's `number` — volumes are never null.
        const slots = raw.map((s) => ({ ...s, loop: !!s.loop })) as SceneSlot[];
        // Not if the scene changed again while this was in flight: that change's own
        // reload has the newer list.
        if (inflight.get(sceneId) === request) slotCache.set(sceneId, slots);
        return slots;
      })
      .finally(() => {
        if (inflight.get(sceneId) === request) inflight.delete(sceneId);
      });
    inflight.set(sceneId, request);
    return request;
  }

  function invalidateSlots(sceneId: number) {
    slotCache.delete(sceneId);
    inflight.delete(sceneId);
    slotsRevision++;
  }

  // --- Scene mutations ---

  async function createScene(name: string): Promise<Scene> {
    const scene = await api.createScene(name);
    await base.load();
    return scene;
  }

  async function deleteScene(id: number): Promise<void> {
    await api.deleteScene(id);
    await base.load();
  }

  async function updateScene(id: number, name: string): Promise<void> {
    await api.updateScene(id, name);
    await base.load();
  }

  async function toggleFavorite(id: number): Promise<void> {
    await api.toggleSceneFavorite(id);
    await base.load();
  }

  async function applyThumbnailColor(id: number, color: string | null): Promise<void> {
    const scene = base.items.find((s) => s.id === id);
    await api.updateSceneThumbnail(
      id,
      scene?.thumbnail_path ?? null,
      color,
      scene?.thumbnail_icon ?? null,
    );
    await base.load();
  }

  async function applyThumbnailIcon(id: number, icon: string | null): Promise<void> {
    const scene = base.items.find((s) => s.id === id);
    await api.updateSceneThumbnail(
      id,
      scene?.thumbnail_path ?? null,
      scene?.thumbnail_color ?? null,
      icon,
    );
    await base.load();
  }

  async function setThumbnailImage(id: number, path: string | null): Promise<void> {
    const scene = base.items.find((s) => s.id === id);
    await api.updateSceneThumbnail(
      id,
      path,
      scene?.thumbnail_color ?? null,
      scene?.thumbnail_icon ?? null,
    );
    await base.load();
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
    await base.load(); // refresh slot_count on parent scene
    return slots;
  }

  async function deleteSlot(sceneId: number, slotId: number): Promise<SceneSlot[]> {
    await api.deleteSceneSlot(slotId);
    invalidateSlots(sceneId);
    const slots = await getSlots(sceneId);
    await base.load(); // refresh slot_count on parent scene
    return slots;
  }

  async function updateSlot(
    sceneId: number,
    slotId: number,
    params: UpdateSlotParams,
  ): Promise<SceneSlot[]> {
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

  /** Save some of a track's settings, the rest as they are on `slot`. */
  function patchSlot(
    slot: SceneSlot,
    patch: Partial<Pick<SceneSlot, "label" | "volume" | "loop" | "shuffle" | "slot_order">>,
  ): Promise<SceneSlot[]> {
    const next = { ...slot, ...patch };
    return updateSlot(slot.scene_id, slot.id, {
      label: next.label,
      volume: next.volume,
      loop: next.loop,
      slotOrder: next.slot_order,
      shuffle: !!next.shuffle,
    });
  }

  return {
    get scenes() {
      return base.items;
    },
    get sceneCount() {
      return base.count;
    },
    get isLoading() {
      return base.isLoading;
    },
    get error() {
      return base.error;
    },
    get slotsRevision() {
      return slotsRevision;
    },
    load: base.load,
    getSlots,
    invalidateSlots,
    createScene,
    deleteScene,
    updateScene,
    toggleFavorite,
    addSlot,
    deleteSlot,
    updateSlot,
    patchSlot,
    applyThumbnailColor,
    applyThumbnailIcon,
    setThumbnailImage,
  };
}

export const scenes = createScenesStore();
