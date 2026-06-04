// Tests for the pin Details Source — the auxiliary-data fan-out behind the
// PinDetails body: pin tags (keyed by pin id, so pin patches don't refetch),
// per-map Pin Categories, the linked-note preview, and the tag save-status
// machine (pin tag saves previously had no error handling at all).
import { describe, it, expect, afterEach, vi } from "vitest";
import { flushSync } from "svelte";
import { invoke } from "@tauri-apps/api/core";
import { createPinDetailsSource } from "$lib/details/pin-details-source.svelte";
import type { PinDetailsSource } from "$lib/details/pin-details-source.svelte";
import type { Note, Pin } from "$lib/types/ledger";

const mocked = vi.mocked(invoke);

const basePin: Pin = {
  id: 1,
  map_id: 5,
  x: 0,
  y: 0,
  title: "Test Pin",
  description: null,
  category_id: null,
  note_id: null,
  created_at: "2026-01-01T00:00:00Z",
  shape: null,
  icon: null,
  color: null,
} as unknown as Pin;

const linkedNote: Note = {
  id: 42,
  path: "notes/aldric.md",
  title: "Aldric",
  icon: null,
  cover_image: null,
  parent_path: "notes",
  archived: false,
  modified_at: "2026-01-01T00:00:00Z",
} as unknown as Note;

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

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

let cleanup: (() => void) | null = null;

function mount(
  getPin: () => Pin | null,
  getLinkedNote: () => Note | null = () => null,
): PinDetailsSource {
  let source!: PinDetailsSource;
  cleanup = $effect.root(() => {
    source = createPinDetailsSource(getPin, getLinkedNote);
  });
  flushSync();
  return source;
}

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.useRealTimers();
  mocked.mockReset();
  mocked.mockResolvedValue(null);
});

describe("pin Details Source — fetch fan-out", () => {
  it("loads pin tags, allTags and per-map categories on selection", async () => {
    mockCommands({
      get_pin_tags: ["harbor"],
      list_all_tags: ["harbor", "npc"],
      get_pin_categories_for_map: [{ id: 1, map_id: 5, name: "Town", icon: "house", color: "#fff" }],
    });
    const source = mount(() => basePin);
    await flush();

    expect(source.pinTags).toEqual(["harbor"]);
    expect(source.allTags).toEqual(["harbor", "npc"]);
    expect(source.categories).toHaveLength(1);
    expect(callsFor("get_pin_tags")[0][1]).toEqual({ pinId: 1 });
    expect(callsFor("get_pin_categories_for_map")[0][1]).toEqual({ mapId: 5 });
  });

  it("does not refetch tags or categories when the pin is patched (same id)", async () => {
    mockCommands({ get_pin_tags: ["harbor"], get_pin_categories_for_map: [] });
    let pin = $state<Pin | null>(basePin);
    const source = mount(() => pin);
    await flush();
    const tagCalls = callsFor("get_pin_tags").length;
    const catCalls = callsFor("get_pin_categories_for_map").length;

    // A pin patch (rename, recolor) produces a new object with the same id.
    pin = { ...basePin, title: "Renamed" } as Pin;
    flushSync();
    await flush();
    expect(callsFor("get_pin_tags").length).toBe(tagCalls);
    expect(callsFor("get_pin_categories_for_map").length).toBe(catCalls);
    expect(source.pinTags).toEqual(["harbor"]);
  });

  it("refetches tags when selection moves to a different pin", async () => {
    mockCommands({ get_pin_tags: [] });
    let pin = $state<Pin | null>(basePin);
    mount(() => pin);
    await flush();
    const before = callsFor("get_pin_tags").length;

    pin = { ...basePin, id: 2 } as Pin;
    flushSync();
    await flush();
    expect(callsFor("get_pin_tags").length).toBe(before + 1);
  });

  it("clears pin tags when selection is cleared", async () => {
    mockCommands({ get_pin_tags: ["harbor"] });
    let pin = $state<Pin | null>(basePin);
    const source = mount(() => pin);
    await flush();
    expect(source.pinTags).toEqual(["harbor"]);

    pin = null;
    flushSync();
    expect(source.pinTags).toEqual([]);
  });

  it("loads a markdown-stripped, truncated preview of the linked note", async () => {
    const longBody = "# Heading\n" + "x".repeat(200);
    mockCommands({ read_note_content: longBody });
    let linked = $state<Note | null>(linkedNote);
    const source = mount(() => basePin, () => linked);
    await flush();

    expect(source.notePreview).not.toContain("#");
    expect(source.notePreview!.endsWith("…")).toBe(true);
    expect(source.notePreview!.length).toBeLessThanOrEqual(151);

    linked = null;
    flushSync();
    expect(source.notePreview).toBeNull();
  });
});

describe("pin Details Source — save-status machine", () => {
  it("savePinTags writes, refreshes allTags, and flashes 'saved'", async () => {
    vi.useFakeTimers();
    mockCommands({ list_all_tags: ["harbor"] });
    const source = mount(() => basePin);
    await flush();
    const allTagsBefore = callsFor("list_all_tags").length;

    await source.savePinTags(["harbor"]);
    expect(callsFor("set_pin_tags")[0][1]).toEqual({ pinId: 1, tags: ["harbor"] });
    expect(callsFor("list_all_tags").length).toBe(allTagsBefore + 1);
    expect(source.saveStatus).toBe("saved");

    vi.advanceTimersByTime(1500);
    expect(source.saveStatus).toBe("idle");
  });

  it("savePinTags failure reports 'error' (previously unhandled) and retrySave re-attempts", async () => {
    mockCommands({}, ["set_pin_tags"]);
    const source = mount(() => basePin);
    await flush();

    await source.savePinTags(["harbor"]);
    expect(source.saveStatus).toBe("error");

    mockCommands({}); // backend recovers
    await source.retrySave();
    expect(source.saveStatus).toBe("saved");
    expect(callsFor("set_pin_tags").length).toBe(2); // failed attempt + retry
  });
});
