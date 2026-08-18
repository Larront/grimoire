import { render, fireEvent, cleanup, act } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { maps } from "$lib/stores/maps.svelte";
import { tabs } from "$lib/stores/tabs.svelte";
import { paneDetailState } from "$lib/stores/pane-detail-state.svelte";
import type { Map as LedgerMap, Pin, MapAnnotation } from "$lib/types/ledger";

// Leaflet can't run in jsdom; the stub fires the same selection callbacks.
vi.mock("$lib/components/map/MapCanvas.svelte", async () => {
  const mod = await import("./fixtures/MapCanvasStub.svelte");
  return { default: mod.default };
});

import PaneContent from "$lib/components/PaneContent.svelte";

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

const PIN: Pin = {
  id: 1,
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

const TEXT_ANNOTATION: MapAnnotation = {
  id: 7,
  map_id: MAP_ID,
  kind: "text",
  x: 0,
  y: 0,
  x2: null,
  y2: null,
  radius: null,
  label: "Old Road",
  color: "#e2e8f0",
  stroke_color: "#94a3b8",
  stroke_width: 2,
  font_size: 16,
  opacity: 0.2,
  created_at: "2026-01-01T00:00:00Z",
};

const ANNOTATIONS: MapAnnotation[] = [TEXT_ANNOTATION];

/** Every `update_annotation` the panel sent, in order. */
let updatedAnnotations: MapAnnotation[] = [];

/** Every `update_pin` the panel sent, in order. */
let updatedPins: Pin[] = [];

function setupInvoke() {
  vi.mocked(invoke).mockImplementation((cmd: string, args?: unknown) => {
    switch (cmd) {
      case "get_maps":
        return Promise.resolve([testMap]);
      case "get_pins":
        return Promise.resolve([PIN]);
      case "get_annotations":
        return Promise.resolve(ANNOTATIONS);
      case "get_map_image_data_url":
        return Promise.resolve("data:image/png;base64,AAAA");
      case "update_annotation": {
        const ann = (args as { annotation: MapAnnotation }).annotation;
        updatedAnnotations.push(ann);
        return Promise.resolve(ann);
      }
      case "update_pin": {
        const pin = (args as { pin: Pin }).pin;
        updatedPins.push(pin);
        return Promise.resolve(pin);
      }
      case "get_notes":
        return Promise.resolve([]);
      case "read_note_content":
        return Promise.resolve("");
      case "get_pin_categories":
      case "get_pin_categories_for_map":
      case "get_pin_tags":
      case "list_all_tags":
        return Promise.resolve([]);
      default:
        return Promise.resolve(null);
    }
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(async () => {
  updatedPins = [];
  updatedAnnotations = [];
  paneDetailState.reset();
  setupInvoke();
  await act(async () => {
    await maps.load();
  });
});

afterEach(() => {
  cleanup();
  tabs.closeAll("right");
  tabs.closeAll("left");
  paneDetailState.reset();
  vi.mocked(invoke).mockResolvedValue(null);
});

/** Select the pin and open its panel, returning the panel's title input. */
async function openPinPanel() {
  await act(() => {
    tabs.openTab({ type: "map", id: MAP_ID, title: "World" });
  });
  const view = render(PaneContent, { props: { pane: "left" } });
  await flush();

  await fireEvent.click(view.getByTestId("stub-pin-1"));
  await flush();

  const title = view.container.querySelector(
    'input[placeholder="Name this pin"]',
  ) as HTMLInputElement;
  const description = view.container.querySelector(
    "#pin-description",
  ) as HTMLTextAreaElement;
  return { ...view, title, description };
}

/** Select the text annotation and open its panel, returning the label input. */
async function openAnnotationPanel() {
  await act(() => {
    tabs.openTab({ type: "map", id: MAP_ID, title: "World" });
  });
  const view = render(PaneContent, { props: { pane: "left" } });
  await flush();

  await fireEvent.click(view.getByTestId("stub-ann-7"));
  await flush();

  const label = view.container.querySelector("#ann-label") as HTMLInputElement;
  return { ...view, label };
}

/** Switch the pane's active tab, which destroys MapPane and the panel with it. */
async function switchTabAway() {
  await act(() => {
    tabs.openTab({ type: "scenes", id: 0, title: "All Scenes" });
  });
  await flush();
}

// Teardown fires no `blur`, so a title or description typed and not blurred was
// silently discarded when the pane's tab changed — the commit ADR-0006's
// Consequences require (#201).
describe("PinDetails — in-flight edits on teardown", () => {
  it("commits a title typed but not blurred when the pane's tab changes", async () => {
    const { title } = await openPinPanel();
    expect(title).toBeTruthy();

    await fireEvent.input(title, { target: { value: "Harbor of Storms" } });
    await switchTabAway();

    expect(updatedPins.map((p) => p.title)).toContain("Harbor of Storms");
  });

  it("commits a description typed but not blurred when the pane's tab changes", async () => {
    const { description } = await openPinPanel();
    expect(description).toBeTruthy();

    await fireEvent.input(description, {
      target: { value: "Deep water berth" },
    });
    await switchTabAway();

    expect(updatedPins.map((p) => p.description)).toContain("Deep water berth");
  });

  // Both fields dirty is ONE write, not two: `savePin` round-trips the whole
  // row, so a second write built off the same pre-edit row would carry the first
  // field at its old value and revert it.
  it("commits both fields in a single write when both are dirty", async () => {
    const { title, description } = await openPinPanel();

    await fireEvent.input(title, { target: { value: "Harbor of Storms" } });
    await fireEvent.input(description, {
      target: { value: "Deep water berth" },
    });
    await switchTabAway();

    expect(updatedPins).toHaveLength(1);
    expect(updatedPins[0].title).toBe("Harbor of Storms");
    expect(updatedPins[0].description).toBe("Deep water berth");
  });

  it("writes nothing when the panel is torn down with no pending edit", async () => {
    await openPinPanel();
    await switchTabAway();

    expect(updatedPins).toEqual([]);
  });

  it("does not re-commit an edit already saved on blur", async () => {
    const { title } = await openPinPanel();

    await fireEvent.input(title, { target: { value: "Harbor of Storms" } });
    await fireEvent.blur(title);
    await flush();
    expect(updatedPins).toHaveLength(1);

    await switchTabAway();

    expect(updatedPins).toHaveLength(1);
  });

  // Deselecting nulls the `pin` prop while the panel is still mounted — it flies
  // out first — so the commit has to work off the row the drafts were loaded
  // from rather than the prop, or it reads `null.title` and throws out of a
  // teardown. jsdom never finishes the outro (no Web Animations API), so the
  // teardown this test needs is the unmount, with the prop already null.
  it("commits a deselected pin's edit off the row the drafts came from", async () => {
    const { title, getByTestId } = await openPinPanel();

    await fireEvent.input(title, { target: { value: "Harbor of Storms" } });
    await fireEvent.click(getByTestId("stub-mapclick"));
    await flush();

    cleanup();
    await flush();

    expect(updatedPins.map((p) => p.title)).toContain("Harbor of Storms");
  });

  it("commits an annotation label typed but not blurred, for the same reason", async () => {
    const { label } = await openAnnotationPanel();
    expect(label).toBeTruthy();

    await fireEvent.input(label, { target: { value: "The Old Road" } });
    await switchTabAway();

    expect(updatedAnnotations.map((a) => a.label)).toContain("The Old Road");
  });
});
