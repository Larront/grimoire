import { render, fireEvent, cleanup, act, within } from "@testing-library/svelte";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { maps } from "$lib/stores/maps.svelte";
import { paneDetailState } from "$lib/stores/pane-detail-state.svelte";
import type { Map as LedgerMap, Pin, MapAnnotation } from "$lib/types/ledger";

// Replace the Leaflet-backed canvas with a stub that fires the same selection
// callbacks MapPane wires up. Lets us drive selection without a real map canvas.
vi.mock("$lib/components/map/MapCanvas.svelte", async () => {
  const mod = await import("./fixtures/MapCanvasStub.svelte");
  return { default: mod.default };
});

import MapPane from "$lib/components/panes/MapPane.svelte";

const MAP_ID = 5;

const testMap: LedgerMap = {
  id: MAP_ID,
  title: "World",
  image_path: "maps/world.png",
  image_width: 1000,
  image_height: 800,
  created_at: "2026-01-01T00:00:00Z",
  modified_at: "2026-01-01T00:00:00Z",
};

function pin(id: number, title: string): Pin {
  return {
    id,
    map_id: MAP_ID,
    x: id * 10,
    y: id * 10,
    title,
    description: null,
    category_id: null,
    note_id: null,
    created_at: "2026-01-01T00:00:00Z",
    shape: null,
    icon: null,
    color: null,
  };
}

function annotation(id: number): MapAnnotation {
  return {
    id,
    map_id: MAP_ID,
    kind: "rect",
    x: 0,
    y: 0,
    x2: 10,
    y2: 10,
    radius: null,
    label: null,
    color: "#e2e8f0",
    stroke_color: "#94a3b8",
    stroke_width: 2,
    font_size: 16,
    opacity: 0.2,
    created_at: "2026-01-01T00:00:00Z",
  };
}

const PINS = [pin(1, "Harbor"), pin(2, "Keep")];
const ANNOTATIONS = [annotation(7)];

function setupInvoke() {
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    switch (cmd) {
      case "get_maps":
        return Promise.resolve([testMap]);
      case "get_pins":
        return Promise.resolve(PINS);
      case "get_pin_categories":
      case "get_pin_categories_for_map":
      case "get_pin_tags":
      case "list_all_tags":
        return Promise.resolve([]);
      case "get_annotations":
        return Promise.resolve(ANNOTATIONS);
      case "get_map_image_data_url":
        return Promise.resolve("data:image/png;base64,AAAA");
      case "read_note_content":
        return Promise.resolve("");
      default:
        return Promise.resolve(null);
    }
  });
}

// Flush the load promise chain + the persist/restore effects.
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderPane(pane: "left" | "right") {
  const result = render(MapPane, { props: { mapId: MAP_ID, pane } });
  await flush();
  return result;
}

beforeEach(async () => {
  paneDetailState.reset();
  setupInvoke();
  await act(async () => {
    await maps.load();
  });
});

afterEach(() => {
  cleanup();
  paneDetailState.reset();
  vi.mocked(invoke).mockResolvedValue(null);
});

describe("MapPane — selection persists to the per-pane store", () => {
  it("writes the selected pin to paneDetailState for its own pane", async () => {
    const { getByTestId } = await renderPane("left");

    await fireEvent.click(getByTestId("stub-pin-1"));
    await flush();

    expect(paneDetailState.getMapSelection("left", MAP_ID).pinId).toBe(1);
  });

  it("opens a floating detail panel titled after the selected pin", async () => {
    const { getByTestId, container } = await renderPane("left");

    await fireEvent.click(getByTestId("stub-pin-2"));
    await flush();

    const panel = container.querySelector('[data-slot="detail-panel"]');
    expect(panel).toBeTruthy();
    expect(panel!.textContent).toContain("Keep");
  });

  it("selecting an annotation persists annotationId and clears any pin", async () => {
    const { getByTestId } = await renderPane("left");

    await fireEvent.click(getByTestId("stub-pin-1"));
    await flush();
    await fireEvent.click(getByTestId("stub-ann-7"));
    await flush();

    const sel = paneDetailState.getMapSelection("left", MAP_ID);
    expect(sel.annotationId).toBe(7);
    expect(sel.pinId).toBeNull();
  });
});

describe("MapPane — restore on mount", () => {
  it("restores a saved pin selection and shows its panel", async () => {
    paneDetailState.setMapSelection("left", MAP_ID, { pinId: 2, annotationId: null });

    const { getByTestId, container } = await renderPane("left");

    expect(getByTestId("map-canvas-stub").getAttribute("data-selected-pin")).toBe("2");
    const panel = container.querySelector('[data-slot="detail-panel"]');
    expect(panel!.textContent).toContain("Keep");
  });

  it("retains the selection across an unmount/remount (tab switch away and back)", async () => {
    const first = await renderPane("left");
    await fireEvent.click(first.getByTestId("stub-pin-1"));
    await flush();
    expect(paneDetailState.getMapSelection("left", MAP_ID).pinId).toBe(1);

    // Leaving the tab unmounts the pane (PaneContent keys on the active tab).
    cleanup();

    const second = await renderPane("left");
    expect(second.getByTestId("map-canvas-stub").getAttribute("data-selected-pin")).toBe("1");
    expect(
      second.container.querySelector('[data-slot="detail-panel"]')!.textContent,
    ).toContain("Harbor");
  });
});

describe("MapPane — same map in both panes holds independent selections", () => {
  it("selecting in one pane does not affect the other; two panels coexist", async () => {
    const left = await renderPane("left");
    const right = await renderPane("right");

    // Both panes mount into document.body, so scope queries to each container.
    await fireEvent.click(within(left.container).getByTestId("stub-pin-1"));
    await fireEvent.click(within(right.container).getByTestId("stub-pin-2"));
    await flush();

    expect(paneDetailState.getMapSelection("left", MAP_ID).pinId).toBe(1);
    expect(paneDetailState.getMapSelection("right", MAP_ID).pinId).toBe(2);

    // Each pane shows its own floating panel — two open at once.
    expect(left.container.querySelector('[data-slot="detail-panel"]')!.textContent).toContain("Harbor");
    expect(right.container.querySelector('[data-slot="detail-panel"]')!.textContent).toContain("Keep");
  });
});
