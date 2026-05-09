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
  };
}

export const maps = createMapsStore();
