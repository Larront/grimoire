import { api } from "$lib/api";
import { createLedgerCollection } from "./ledger-collection.svelte";
import type { Map } from "$lib/types/ledger";

function createMapsStore() {
  const base = createLedgerCollection<Map>({
    fetch: () => api.getMaps(),
  });

  // Delete a map that was created but never given an image (abandoned creation).
  // No-op if the map has an image or is already gone. Imageless maps have no
  // pins/annotations (those require the canvas), so a plain delete is safe.
  async function pruneIfImageless(mapId: number) {
    const m = base.items.find((x) => x.id === mapId);
    if (!m || m.image_path) return;
    try {
      await api.deleteMap(mapId);
      await base.load();
    } catch (e) {
      console.error("prune imageless map failed:", e);
    }
  }

  return {
    get maps() {
      return base.items;
    },
    // Called after any create/delete mutation to keep the count reactive.
    get mapCount() {
      return base.count;
    },
    get isLoading() {
      return base.isLoading;
    },
    get error() {
      return base.error;
    },
    load: base.load,
    pruneIfImageless,
  };
}

export const maps = createMapsStore();
