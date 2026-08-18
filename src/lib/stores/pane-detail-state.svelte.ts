import { untrack } from 'svelte';
import { ledger } from './ledger.svelte';

type PaneId = 'left' | 'right';

export interface MapSelection {
  pinId: number | null;
  annotationId: number | null;
}

function createPaneDetailState() {
  let selections = $state<Record<string, MapSelection>>({});

  function selKey(pane: PaneId, mapId: number): string {
    return `${pane}:${mapId}`;
  }

  function getMapSelection(pane: PaneId, mapId: number): MapSelection {
    return selections[selKey(pane, mapId)] ?? { pinId: null, annotationId: null };
  }

  function setMapSelection(pane: PaneId, mapId: number, sel: MapSelection): void {
    // untrack the read of the prior map: callers persist from inside a $effect,
    // so reading `selections` here would subscribe that effect to its own write
    // (effect_update_depth_exceeded). Only the write should be observable.
    selections = { ...untrack(() => selections), [selKey(pane, mapId)]: sel };
  }

  function reset(): void {
    selections = {};
  }

  // Selections are keyed `pane:mapId`, and map ids restart per ledger database:
  // a selection saved under `left:3` in one ledger would restore a pin from a
  // different ledger's map 3 (#204). So the keys are only meaningful for the
  // ledger that produced them, and a change of ledger — open, switch or close —
  // drops them all. Owned here rather than in `closeLedger` for the same reason
  // tabs owns its own reset (`tabs.svelte.ts`): the store that holds the
  // per-ledger state is the store that knows when it expires.
  $effect.root(() => {
    let lastPath: string | null = null;
    $effect(() => {
      const path = ledger.isOpen ? ledger.path : null;
      if (path === lastPath) return;
      lastPath = path;
      reset();
    });
  });

  return {
    getMapSelection,
    setMapSelection,
    reset,
  };
}

export const paneDetailState = createPaneDetailState();
