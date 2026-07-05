// Unit tests for the audioEngine crossfade state machine (issue #97).
//
// createAudioEngine exposes an injectable slot-player factory. By passing a
// FakeSlotPlayer factory we drive crossfadeTo / pauseScene / resumeScene with no
// AudioContext and no Spotify SDK, and assert against the same observable state
// the components read (activeSceneId, isPlaying, isCrossfading, slotStates).
//
// The fake's fadeTo returns a promise that only resolves when the shared `clock`
// is flushed — this is the "controllable tick" that lets a test park a crossfade
// mid-fade and assert what happens when stopAll() fires before the fade settles.
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SceneSlot } from "../lib/types/ledger";
import { createAudioEngine, type SlotPlayer } from "../lib/stores/audio-engine.svelte";

// Fade durations mirror the constants in audio-engine.svelte.ts.
const FADE_SEC = 2.5; // warm swap
const FADE_SEC_COLD = 0.3; // cold start

// ---- Scene fixtures -----------------------------------------------------------------
// getSlots is mocked to return these slot lists keyed by scene id.
const sceneSlots = new Map<number, SceneSlot[]>();

function slot(id: number, sceneId: number, extra: Partial<SceneSlot> = {}): SceneSlot {
  return {
    id,
    scene_id: sceneId,
    source: "local",
    source_id: `local:${id}.wav`,
    label: `slot ${id}`,
    volume: 0.8,
    loop: true,
    slot_order: 0,
    shuffle: false,
    ...extra,
  };
}

vi.mock("../lib/stores/scenes.svelte", () => ({
  scenes: {
    getSlots: vi.fn((sceneId: number) => Promise.resolve(sceneSlots.get(sceneId) ?? [])),
  },
}));

// The $effect.root cleanup in the engine reads ledger.isOpen; keep it open so the
// cleanup effect stays inert during tests.
vi.mock("../lib/stores/ledger.svelte", () => ({
  ledger: {
    get isOpen() {
      return true;
    },
  },
}));

// ---- Controllable fade clock --------------------------------------------------------

const clock = {
  pending: [] as Array<() => void>,
  flush() {
    const resolvers = this.pending;
    this.pending = [];
    for (const r of resolvers) r();
  },
};

// ---- Fake adapter -------------------------------------------------------------------

interface FadeCall {
  target: number;
  dur: number;
}

class FakeSlotPlayer implements SlotPlayer {
  starts: number[] = []; // initialVolume per start()
  stops = 0;
  resumes = 0;
  fades: FadeCall[] = [];
  masterVolumes: number[] = [];

  constructor(public readonly slot: SceneSlot) {}

  async start(_slot: SceneSlot, initialVolume: number): Promise<void> {
    this.starts.push(initialVolume);
  }
  async stop(): Promise<void> {
    this.stops++;
  }
  async resume(): Promise<void> {
    this.resumes++;
  }
  fadeTo(targetVolume: number, durationSec: number): Promise<void> {
    this.fades.push({ target: targetVolume, dur: durationSec });
    return new Promise<void>((resolve) => clock.pending.push(resolve));
  }
  setVolume(_volume: number): void {}
  setMasterVolume(volume: number): void {
    this.masterVolumes.push(volume);
  }
}

let created: FakeSlotPlayer[] = [];

function makeEngine() {
  created = [];
  return createAudioEngine({
    makeSlotPlayer: (s) => {
      const player = new FakeSlotPlayer(s);
      created.push(player);
      return player;
    },
  });
}

const playersForScene = (sceneId: number) => created.filter((p) => p.slot.scene_id === sceneId);

// A macrotask yields to the event loop after the microtask queue (incl. chained
// promise resolutions) drains — parking any in-flight crossfade at its next await.
const macrotask = () => new Promise<void>((r) => setTimeout(r, 0));

// Drive any in-flight (and chained) crossfades to completion: drain microtasks,
// then resolve all outstanding fades, repeatedly.
async function settle(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await macrotask();
    clock.flush();
  }
}

beforeEach(() => {
  sceneSlots.clear();
  clock.pending = [];
  // Scene 1 / 2: two normal local slots each. Scene 3: one slot. Scene 9: empty.
  sceneSlots.set(1, [slot(11, 1), slot(12, 1)]);
  sceneSlots.set(2, [slot(21, 2), slot(22, 2)]);
  sceneSlots.set(3, [slot(31, 3)]);
  sceneSlots.set(9, []);
});

describe("crossfade state machine", () => {
  it("same scene id is a no-op — no new players started", async () => {
    const engine = makeEngine();
    engine.crossfadeTo(1);
    await settle();
    expect(engine.activeSceneId).toBe(1);

    const before = created.length;
    engine.crossfadeTo(1);
    await settle();

    expect(created.length).toBe(before); // factory never called again
    expect(engine.activeSceneId).toBe(1);
  });

  it("normal crossfade commits incoming and stops/fades-out outgoing", async () => {
    const engine = makeEngine();
    engine.crossfadeTo(1);
    await settle();
    engine.crossfadeTo(2);
    await settle();

    expect(engine.activeSceneId).toBe(2);
    expect(engine.isPlaying).toBe(true);
    expect(engine.isCrossfading).toBe(false);

    // Outgoing (scene 1) faded to 0 and stopped.
    for (const p of playersForScene(1)) {
      expect(p.fades.some((f) => f.target === 0)).toBe(true);
      expect(p.stops).toBeGreaterThan(0);
    }
    // Incoming (scene 2) started and is the committed state.
    for (const p of playersForScene(2)) {
      expect(p.starts.length).toBe(1);
      expect(p.starts[0]).toBe(0); // started silent, then faded up
    }
    expect([...engine.slotStates.keys()].sort()).toEqual([21, 22]);
    expect([...engine.slotStates.values()].every((s) => s.playing)).toBe(true);
  });

  it("cold start uses the short fade; warm swap uses the long fade", async () => {
    const engine = makeEngine();

    engine.crossfadeTo(1);
    await settle();
    // Cold start: incoming faded up over the short fade.
    for (const p of playersForScene(1)) {
      expect(p.fades.some((f) => f.target > 0 && f.dur === FADE_SEC_COLD)).toBe(true);
    }

    engine.crossfadeTo(2);
    await settle();
    // Warm swap: incoming faded up over the long fade...
    for (const p of playersForScene(2)) {
      expect(p.fades.some((f) => f.target > 0 && f.dur === FADE_SEC)).toBe(true);
    }
    // ...and outgoing faded to 0 over the long fade.
    for (const p of playersForScene(1)) {
      expect(p.fades.some((f) => f.target === 0 && f.dur === FADE_SEC)).toBe(true);
    }
  });

  it("play during an in-flight crossfade is queued and runs after the first", async () => {
    const engine = makeEngine();
    engine.crossfadeTo(1);
    await settle();

    // Start a warm swap to 2 and park it at the outgoing-fade await.
    engine.crossfadeTo(2);
    await macrotask();
    expect(engine.isCrossfading).toBe(true);

    // Request 3 mid-flight: it must be queued, not started immediately.
    engine.crossfadeTo(3);
    await macrotask();
    expect(engine.activeSceneId).toBe(1); // 2 not committed yet (fades unresolved)
    expect(playersForScene(3).length).toBe(0); // 3 deferred — factory not yet called

    // Resolve fades: 2 commits, then the queued 3 runs to completion.
    await settle();
    expect(engine.activeSceneId).toBe(3);
    expect(engine.isPlaying).toBe(true);
    expect(playersForScene(2).length).toBeGreaterThan(0); // 2 did run before 3
  });

  it("stopAll() mid-fade aborts the commit — new state is not applied", async () => {
    const engine = makeEngine();
    engine.crossfadeTo(1);
    await settle();

    // Park a warm swap to 2 at the outgoing-fade await, then stop everything.
    engine.crossfadeTo(2);
    await macrotask();
    expect(engine.isCrossfading).toBe(true);

    engine.stopAll();
    await settle();

    // Scene 2 must NOT have been committed; stopAll cleared all state.
    expect(engine.activeSceneId).toBe(null);
    expect(engine.isPlaying).toBe(false);
    expect(engine.slotStates.size).toBe(0);
  });

  it("a scene with zero slots resolves to no active scene", async () => {
    const engine = makeEngine();
    engine.crossfadeTo(9);
    await settle();

    expect(engine.activeSceneId).toBe(null);
    expect(engine.isPlaying).toBe(false);
    expect(engine.slotStates.size).toBe(0);
  });
});

describe("scene verbs over the fake adapter", () => {
  it("pauseScene stops every slot and reports isScenePaused", async () => {
    const engine = makeEngine();
    engine.crossfadeTo(1);
    await settle();
    expect(engine.isScenePaused).toBe(false);

    await engine.pauseScene();

    expect(engine.isScenePaused).toBe(true);
    expect([...engine.slotStates.values()].every((s) => !s.playing)).toBe(true);
    for (const p of playersForScene(1)) {
      expect(p.stops).toBeGreaterThan(0);
    }
  });

  it("resumeScene restarts paused slots and clears isScenePaused", async () => {
    const engine = makeEngine();
    engine.crossfadeTo(1);
    await settle();
    await engine.pauseScene();
    expect(engine.isScenePaused).toBe(true);

    await engine.resumeScene();

    expect(engine.isScenePaused).toBe(false);
    expect([...engine.slotStates.values()].every((s) => s.playing)).toBe(true);
    for (const p of playersForScene(1)) {
      expect(p.resumes).toBeGreaterThan(0);
    }
  });
});
