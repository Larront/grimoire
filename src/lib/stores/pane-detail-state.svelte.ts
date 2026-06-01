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
    selections = { ...selections, [selKey(pane, mapId)]: sel };
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
