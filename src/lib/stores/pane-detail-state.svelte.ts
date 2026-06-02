import { untrack } from 'svelte';

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

  return {
    getMapSelection,
    setMapSelection,
    reset,
  };
}

export const paneDetailState = createPaneDetailState();
