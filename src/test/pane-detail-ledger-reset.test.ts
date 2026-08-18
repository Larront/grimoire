import { describe, it, expect, afterEach, vi } from "vitest";
import { render, fireEvent, cleanup, act } from "@testing-library/svelte";
import { invoke } from "@tauri-apps/api/core";
import { ledger } from "../lib/stores/ledger.svelte";
import { maps } from "../lib/stores/maps.svelte";
import { paneDetailState } from "../lib/stores/pane-detail-state.svelte";
import type { Map as LedgerMap, Pin } from "../lib/types/ledger";

// Leaflet can't run in jsdom; the stub fires the same selection callbacks and
// reflects the restored selection back as a data attribute.
vi.mock("$lib/components/map/MapCanvas.svelte", async () => {
  const mod = await import("./fixtures/MapCanvasStub.svelte");
  return { default: mod.default };
});

import MapPane from "../lib/components/panes/MapPane.svelte";

/** Map id 3 exists in both ledgers — the collision the issue is about. */
const MAP_ID = 3;

const testMap: LedgerMap = {
  id: MAP_ID,
  title: "World",
  image_path: "maps/world.png",
  image_width: 1000,
  image_height: 800,
  created_at: "2026-01-01T00:00:00Z",
  modified_at: "2026-01-01T00:00:00Z",
};

const PIN: Pin = {
  id: 11,
  map_id: MAP_ID,
  x: 10,
  y: 10,
  title: "Harbor",
  description: null,
  category_id: null,
  note_id: null,
  created_at: "2026-01-01T00:00:00Z",
  shape: null,
  icon: null,
  color: null,
};

function mockOpenLedger(path: string) {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "open_ledger")
      return {
        path,
        note_count: 0,
        scene_count: 0,
        map_count: 0,
        failed_imports: [],
        unlinked_pins: [],
      };
    if (cmd === "get_notes") return [];
    if (cmd === "get_recent_ledgers") return [];
    if (cmd === "get_maps") return [testMap];
    if (cmd === "get_pins") return [PIN];
    if (cmd === "get_annotations") return [];
    if (cmd === "get_map_image_data_url") return "data:image/png;base64,AAAA";
    if (
      cmd === "get_pin_categories" ||
      cmd === "get_pin_categories_for_map" ||
      cmd === "get_pin_tags" ||
      cmd === "list_all_tags"
    )
      return [];
    return null;
  });
}

/** Flush the map load promise chain plus the persist/restore effects. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function openLedgerAt(path: string) {
  mockOpenLedger(path);
  await act(async () => {
    await ledger.openLedger(path);
  });
}

afterEach(async () => {
  cleanup();
  await act(async () => {
    await ledger.closeLedger();
  });
  paneDetailState.reset();
  vi.mocked(invoke).mockResolvedValue(null);
});

// Selections are keyed `pane:mapId`, and map ids restart per ledger database, so
// a selection left behind from ledger A restores a pin id from a different
// ledger's map 3 (#204).
describe("paneDetailState — ledger lifecycle", () => {
  it("clears selections when a different ledger is opened", async () => {
    await openLedgerAt("/test/ledger-a");
    paneDetailState.setMapSelection("left", 3, {
      pinId: 11,
      annotationId: null,
    });
    expect(paneDetailState.getMapSelection("left", 3).pinId).toBe(11);

    await openLedgerAt("/test/ledger-b");

    expect(paneDetailState.getMapSelection("left", 3).pinId).toBeNull();
    expect(paneDetailState.getMapSelection("left", 3).annotationId).toBeNull();
  });

  it("clears selections in both panes when the ledger closes", async () => {
    await openLedgerAt("/test/ledger-a");
    paneDetailState.setMapSelection("left", 3, {
      pinId: 11,
      annotationId: null,
    });
    paneDetailState.setMapSelection("right", 4, {
      pinId: null,
      annotationId: 22,
    });

    await act(async () => {
      await ledger.closeLedger();
    });

    expect(paneDetailState.getMapSelection("left", 3).pinId).toBeNull();
    expect(paneDetailState.getMapSelection("right", 4).annotationId).toBeNull();
  });

  // The behaviour the store-level cases above only imply: the restore path at
  // `MapPane` must not pull ledger A's pin back onto ledger B's map of the same id.
  it("restores no selection on a same-id map after the ledger changes", async () => {
    await openLedgerAt("/test/ledger-a");
    await act(async () => {
      await maps.load();
    });

    const first = render(MapPane, { props: { mapId: MAP_ID, pane: "left" } });
    await flush();
    await fireEvent.click(first.getByTestId("stub-pin-11"));
    await flush();
    expect(
      first.getByTestId("map-canvas-stub").getAttribute("data-selected-pin"),
    ).toBe("11");
    cleanup();

    await openLedgerAt("/test/ledger-b");
    await act(async () => {
      await maps.load();
    });

    const second = render(MapPane, { props: { mapId: MAP_ID, pane: "left" } });
    await flush();

    expect(
      second.getByTestId("map-canvas-stub").getAttribute("data-selected-pin"),
    ).toBe("");
  });

  it("keeps selections while the same ledger stays open", async () => {
    await openLedgerAt("/test/ledger-a");
    paneDetailState.setMapSelection("left", 3, {
      pinId: 11,
      annotationId: null,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(paneDetailState.getMapSelection("left", 3).pinId).toBe(11);
  });
});
