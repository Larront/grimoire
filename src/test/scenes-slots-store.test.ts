// The scenes store's track lists: the one copy every surface reads.
//
// The scene editor, the in-note player, the mini player and the audio engine each show
// or use a scene's tracks. Each used to load its own copy and none heard when another
// surface changed one, so a loop turned off in the mini player still showed on there and
// the next press saved "off" again. The store now says when a scene's tracks change
// (`slotsRevision`) and saves a change to one setting without guessing at the rest.
import { describe, it, expect, vi, beforeEach } from "vitest";

const getSceneSlots = vi.fn();
const updateSceneSlot = vi.fn();

vi.mock("../lib/api", () => ({
  api: {
    getSceneSlots: (...a: unknown[]) => getSceneSlots(...a),
    updateSceneSlot: (...a: unknown[]) => updateSceneSlot(...a),
    getScenesWithSlotCounts: vi.fn(() => Promise.resolve([])),
  },
}));

vi.mock("../lib/stores/ledger.svelte", () => ({
  ledger: {
    get isOpen() {
      return false;
    },
    get path() {
      return null;
    },
  },
}));

const { scenes } = await import("../lib/stores/scenes.svelte");

function row(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    scene_id: 1,
    source: "local",
    source_id: `${id}.ogg`,
    label: `Track ${id}`,
    volume: 0.5,
    loop: 1,
    slot_order: id,
    shuffle: false,
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  scenes.invalidateSlots(1);
  updateSceneSlot.mockResolvedValue(undefined);
});

describe("scenes store — track lists", () => {
  it("surfaces asking for the same scene at once share one request", async () => {
    getSceneSlots.mockResolvedValue([row(1)]);

    const [a, b] = await Promise.all([scenes.getSlots(1), scenes.getSlots(1)]);

    expect(getSceneSlots).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(a[0].loop).toBe(true);
  });

  it("patchSlot saves the one setting, keeps the rest, and says the tracks changed", async () => {
    getSceneSlots.mockResolvedValue([row(1)]);
    const [slot] = await scenes.getSlots(1);
    const before = scenes.slotsRevision;
    getSceneSlots.mockResolvedValue([row(1, { loop: 0 })]);

    const fresh = await scenes.patchSlot(slot, { loop: false });

    expect(updateSceneSlot).toHaveBeenCalledWith(1, "Track 1", 0.5, false, 1, false);
    expect(scenes.slotsRevision).toBeGreaterThan(before);
    expect(fresh[0].loop).toBe(false);
    // And it is what every later reader gets.
    expect((await scenes.getSlots(1))[0].loop).toBe(false);
  });

  it("a load overtaken by a change does not put its older list back", async () => {
    let resolveOld!: (rows: unknown[]) => void;
    getSceneSlots.mockReturnValueOnce(new Promise((r) => (resolveOld = r)));
    const old = scenes.getSlots(1);

    // The tracks change while that load is in flight.
    scenes.invalidateSlots(1);
    getSceneSlots.mockResolvedValue([row(1, { volume: 0.9 })]);
    const fresh = await scenes.getSlots(1);
    resolveOld([row(1, { volume: 0.2 })]);
    await old;

    expect(fresh[0].volume).toBe(0.9);
    expect((await scenes.getSlots(1))[0].volume).toBe(0.9);
  });
});
