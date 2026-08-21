// Tests for the annotation Details Source (#203) — the third adapter onto the
// shared save-status machine, and the one that closes the worst gap: annotation
// edits used to run through MapPane handlers whose entire failure story was
// `console.error`, under a DetailPanel rendered with no saveStatus and no
// onRetrySave at all.
import { describe, it, expect, afterEach, vi } from "vitest";
import { flushSync } from "svelte";
import { invoke } from "@tauri-apps/api/core";
import { createAnnotationDetailsSource } from "$lib/details/annotation-details-source.svelte";
import type { AnnotationDetailsSource } from "$lib/details/annotation-details-source.svelte";
import type { MapAnnotation } from "$lib/types/ledger";

const mocked = vi.mocked(invoke);

const baseAnnotation: MapAnnotation = {
  id: 1,
  map_id: 5,
  kind: "text",
  x: 10,
  y: 20,
  x2: null,
  y2: null,
  radius: null,
  label: "Old Quarter",
  color: "#f0ece8",
  stroke_color: "#a39e99",
  stroke_width: 2,
  font_size: 14,
  opacity: 1,
} as unknown as MapAnnotation;

type Responses = Record<string, unknown>;

function mockCommands(responses: Responses, failures: string[] = []) {
  mocked.mockImplementation((cmd: string) => {
    if (failures.includes(cmd)) return Promise.reject(new Error(`${cmd} failed`));
    if (cmd in responses) return Promise.resolve(responses[cmd]);
    return Promise.resolve(null);
  });
}

function callsFor(cmd: string) {
  return mocked.mock.calls.filter(([c]) => c === cmd);
}

let cleanup: (() => void) | null = null;
// What the "pane" holds — MapPane keeps the annotation list for the canvas.
let applied: MapAnnotation[] = [];
let removed: number[] = [];

function mount(getAnnotation: () => MapAnnotation | null): AnnotationDetailsSource {
  let source!: AnnotationDetailsSource;
  cleanup = $effect.root(() => {
    source = createAnnotationDetailsSource(
      getAnnotation,
      (saved) => {
        applied.push(saved);
      },
      (id) => {
        removed.push(id);
      },
    );
  });
  flushSync();
  return source;
}

afterEach(() => {
  cleanup?.();
  cleanup = null;
  applied = [];
  removed = [];
  vi.useRealTimers();
  mocked.mockReset();
  mocked.mockResolvedValue(null);
});

describe("annotation Details Source — saves", () => {
  it("commits the saved annotation back to the pane and flashes 'saved'", async () => {
    vi.useFakeTimers();
    const saved = { ...baseAnnotation, label: "New Quarter" } as MapAnnotation;
    mockCommands({ update_annotation: saved });
    const source = mount(() => baseAnnotation);

    await source.saveAnnotation({
      ...baseAnnotation,
      label: "New Quarter",
    } as MapAnnotation);
    expect(callsFor("update_annotation")).toHaveLength(1);
    expect(applied).toEqual([saved]);
    expect(source.saveStatus).toBe("saved");

    vi.advanceTimersByTime(1500);
    expect(source.saveStatus).toBe("idle");
  });

  it("a failed save reports 'error' to the panel rather than only the console", async () => {
    mockCommands({}, ["update_annotation"]);
    const source = mount(() => baseAnnotation);

    // Awaited from a bare `onblur` in AnnotationDetails — must never reject.
    await expect(
      source.saveAnnotation({
        ...baseAnnotation,
        label: "New Quarter",
      } as MapAnnotation),
    ).resolves.toBeUndefined();
    expect(source.saveStatus).toBe("error");
    expect(applied).toEqual([]);
  });

  it("retrySave re-attempts a failed save", async () => {
    mockCommands({}, ["update_annotation"]);
    const source = mount(() => baseAnnotation);
    await source.saveAnnotation({
      ...baseAnnotation,
      label: "New Quarter",
    } as MapAnnotation);
    expect(source.saveStatus).toBe("error");

    const saved = { ...baseAnnotation, label: "New Quarter" } as MapAnnotation;
    mockCommands({ update_annotation: saved }); // backend recovers
    await source.retrySave();
    expect(source.saveStatus).toBe("saved");
    expect(callsFor("update_annotation")).toHaveLength(2);
    expect(applied).toEqual([saved]);
  });
});

describe("annotation Details Source — deletes", () => {
  it("drops the annotation from the pane's list on success", async () => {
    mockCommands({ delete_annotation: 1 });
    const source = mount(() => baseAnnotation);

    await source.deleteAnnotation(1);
    expect(removed).toEqual([1]);
    expect(source.saveStatus).toBe("saved");
  });

  it("a failed delete reports 'error' — the shape is still on the map", async () => {
    mockCommands({}, ["delete_annotation"]);
    const source = mount(() => baseAnnotation);

    await expect(source.deleteAnnotation(1)).resolves.toBeUndefined();
    expect(removed).toEqual([]);
    expect(source.saveStatus).toBe("error");
  });
});

describe("annotation Details Source — status ownership", () => {
  it("a failed save does not follow the selection to another shape", async () => {
    mockCommands({}, ["update_annotation"]);
    let annotation = $state<MapAnnotation | null>(baseAnnotation);
    const source = mount(() => annotation);
    await source.saveAnnotation({
      ...baseAnnotation,
      label: "x",
    } as MapAnnotation);
    expect(source.saveStatus).toBe("error");

    annotation = { ...baseAnnotation, id: 2 } as MapAnnotation;
    flushSync();
    expect(source.saveStatus).toBe("idle");
  });

  it("leaves no flash timer behind when torn down mid-flash", async () => {
    vi.useFakeTimers();
    mockCommands({ update_annotation: baseAnnotation });
    const source = mount(() => baseAnnotation);

    await source.saveAnnotation(baseAnnotation);
    expect(source.saveStatus).toBe("saved");
    expect(vi.getTimerCount()).toBe(1);

    cleanup!();
    cleanup = null;
    expect(vi.getTimerCount()).toBe(0);
  });
});
