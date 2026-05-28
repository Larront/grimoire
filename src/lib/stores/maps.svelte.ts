import { invoke } from "@tauri-apps/api/core";
import { vault } from "./vault.svelte";
import type { Map } from "$lib/types/vault";

function createMapsStore() {
  let maps = $state<Map[]>([]);
  let isLoading = $state(false);
  let error = $state<string | null>(null);

  async function load() {
    isLoading = true;
    error = null;
    try {
      maps = await invoke<Map[]>("get_maps");
    } catch (e) {
      error = String(e);
    } finally {
      isLoading = false;
    }
  }

  // Delete a map that was created but never given an image (abandoned creation).
  // No-op if the map has an image or is already gone. Imageless maps have no
  // pins/annotations (those require the canvas), so a plain delete is safe.
  async function pruneIfImageless(mapId: number) {
    const m = maps.find((x) => x.id === mapId);
    if (!m || m.image_path) return;
    try {
      await invoke("delete_map", { mapId });
      await load();
    } catch (e) {
      console.error("prune imageless map failed:", e);
    }
  }

  $effect.root(() => {
    $effect(() => {
      if (vault.isOpen) {
        load();
      } else {
        maps = [];
        error = null;
      }
    });
  });

  return {
    get maps() {
      return maps;
    },
    // Called after any create/delete mutation to keep the count reactive.
    get mapCount() {
      return maps.length;
    },
    get isLoading() {
      return isLoading;
    },
    get error() {
      return error;
    },
    load,
    pruneIfImageless,
  };
}

export const maps = createMapsStore();
