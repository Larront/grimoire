// The local slot player's memory across a pause.
//
// The engine pauses a slot by stopping its player and resumes it by starting the same
// file again at the volume the player remembers. Every slot is started at 0 and faded
// up, so a player that remembered only what start() was given came back from a pause
// at 0: silent, while the transport, the mini player and the in-note player all said
// it was playing. The engine's own tests use a fake player and cannot see this, so this
// file drives the real one over a fake AudioContext.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SceneSlot } from "../lib/types/ledger";

vi.mock("../lib/api", () => ({
  api: { getAudioAbsolutePath: vi.fn((p: string) => Promise.resolve(`/abs/${p}`)) },
}));
vi.mock("../lib/stores/scenes.svelte", () => ({ scenes: { getSlots: vi.fn() } }));
vi.mock("../lib/stores/ledger.svelte", () => ({
  ledger: { isOpen: true, path: "/ledgers/one" },
}));

const { LocalSlotPlayer } = await import("../lib/stores/audio-engine.svelte");

/** The gain each started source plays through, in order of start(). */
let gains: Array<{ gain: { value: number; ramps: number[] } }>;

function fakeLocalCtx() {
  const ctx = {
    currentTime: 0,
    decodeAudioData: vi.fn(() => Promise.resolve({})),
    createBufferSource: () => ({
      buffer: null,
      loop: false,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }),
    createGain: () => {
      const node = {
        gain: {
          value: 1,
          ramps: [] as number[],
          linearRampToValueAtTime(v: number) {
            node.gain.ramps.push(v);
          },
          cancelScheduledValues: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      gains.push(node);
      return node;
    },
  };
  return { ctx, destination: {}, setMasterVolume: vi.fn() };
}

const slot: SceneSlot = {
  id: 1,
  scene_id: 1,
  source: "local",
  source_id: "rain.ogg",
  label: "Heavy Rain",
  volume: 0.6,
  loop: true,
  slot_order: 0,
  shuffle: false,
};

beforeEach(() => {
  gains = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) })),
  );
  vi.useFakeTimers();
});

describe("LocalSlotPlayer resume", () => {
  it("resumes at the volume it faded to, not the 0 it started at", async () => {
    const player = new LocalSlotPlayer(fakeLocalCtx() as never);
    await player.start(slot, 0);
    void player.fadeTo(0.6, 0.3);

    await player.stop();
    await player.resume();

    expect(gains).toHaveLength(2);
    expect(gains[1].gain.value).toBe(0.6);
  });

  it("resumes at a volume set while it played", async () => {
    const player = new LocalSlotPlayer(fakeLocalCtx() as never);
    await player.start(slot, 0);
    void player.fadeTo(0.6, 0.3);
    player.setVolume(0.25);

    await player.stop();
    await player.resume();

    expect(gains[1].gain.value).toBe(0.25);
  });
});
