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
/** Where in the file each started source began playing, in seconds, in order. */
let startOffsets: number[];

/** A two-minute track. */
const DURATION = 120;

function fakeLocalCtx() {
  const ctx = {
    currentTime: 0,
    decodeAudioData: vi.fn(() => Promise.resolve({ duration: DURATION })),
    createBufferSource: () => ({
      buffer: null,
      loop: false,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn((_when?: number, offset?: number) => startOffsets.push(offset ?? 0)),
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
  startOffsets = [];
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

describe("LocalSlotPlayer pause", () => {
  // The engine pauses a track by stopping it and resumes it with resume(). Stopping
  // threw the playing sound away and resume() fetched, decoded and started the file again
  // from its beginning — so Pause then Play restarted every track.
  it("resumes where it was paused, without loading the file again", async () => {
    const local = fakeLocalCtx();
    const player = new LocalSlotPlayer(local as never);
    await player.start(slot, 0.6);
    local.ctx.currentTime = 5;
    await player.stop();
    local.ctx.currentTime = 30;
    await player.resume();

    expect(startOffsets).toEqual([0, 5]);
    expect(local.ctx.decodeAudioData).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps counting from where it resumed across a second pause", async () => {
    const local = fakeLocalCtx();
    const player = new LocalSlotPlayer(local as never);
    await player.start(slot, 0.6);
    local.ctx.currentTime = 5;
    await player.stop();
    local.ctx.currentTime = 30;
    await player.resume();
    local.ctx.currentTime = 40;
    await player.stop();
    await player.resume();

    expect(startOffsets).toEqual([0, 5, 15]);
  });

  it("a looping track paused past its end resumes at the matching point in the loop", async () => {
    const local = fakeLocalCtx();
    const player = new LocalSlotPlayer(local as never);
    await player.start({ ...slot, loop: true }, 0.6);
    local.ctx.currentTime = DURATION + 7;
    await player.stop();
    await player.resume();

    expect(startOffsets[1]).toBeCloseTo(7);
  });

  it("a track that played to its end and stopped starts again from the top", async () => {
    const local = fakeLocalCtx();
    const player = new LocalSlotPlayer(local as never);
    await player.start({ ...slot, loop: false }, 0.6);
    local.ctx.currentTime = DURATION + 7;
    await player.stop();
    await player.resume();

    expect(startOffsets[1]).toBe(0);
  });
});

describe("LocalSlotPlayer loop changed while playing", () => {
  // Loop is saved on the slot, which the player used to read only when it started: a
  // loop turned off mid-scene kept looping until the scene was played again.
  it("reaches the sound already playing", async () => {
    const local = fakeLocalCtx();
    const sources: Array<{ loop: boolean }> = [];
    const make = local.ctx.createBufferSource;
    local.ctx.createBufferSource = () => {
      const src = make();
      sources.push(src);
      return src;
    };
    const player = new LocalSlotPlayer(local as never);
    await player.start(slot, 0.6);
    expect(sources[0].loop).toBe(true);

    player.setLoop(false);

    expect(sources[0].loop).toBe(false);
  });

  it("turned off part-way through a later pass, pauses and resumes inside that pass", async () => {
    const local = fakeLocalCtx();
    const player = new LocalSlotPlayer(local as never);
    await player.start(slot, 0.6);
    // Third pass of a two-minute loop, 10s in.
    local.ctx.currentTime = 2 * DURATION + 10;
    player.setLoop(false);
    local.ctx.currentTime = 2 * DURATION + 15;
    await player.stop();
    await player.resume();

    expect(startOffsets).toEqual([0, 15]);
  });
});
