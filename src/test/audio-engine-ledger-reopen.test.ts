import { describe, it, expect, beforeEach, vi } from "vitest";
import { flushSync } from "svelte";
import { invoke } from "@tauri-apps/api/core";
import type { SceneSlot } from "$lib/types/ledger";
import { ledger } from "$lib/stores/ledger.svelte";
import { createAudioEngine, type SlotPlayer } from "$lib/stores/audio-engine.svelte";

// Re-exploring the Example World from inside itself reopens the *same* path over a
// sandbox the backend has just wiped and copied fresh. A scene playing from the old
// copy has an id that may name nothing in the new one, or another scene — so the
// engine stops it, as it does on a switch to another ledger. The real ledger store
// runs against a mocked backend; the slot players are fakes.

const SAMPLE_PATH = "/app-data/sample-world";

const slots: SceneSlot[] = [
  {
    id: 11,
    scene_id: 1,
    source: "local",
    source_id: "local:11.wav",
    label: "rain",
    volume: 0.8,
    loop: true,
    slot_order: 0,
    shuffle: false,
  },
];

vi.mock("$lib/stores/scenes.svelte", () => ({
  scenes: {
    getSlots: vi.fn(() => Promise.resolve(slots)),
  },
}));

class FakeSlotPlayer implements SlotPlayer {
  stops = 0;
  async start(): Promise<void> {}
  async stop(): Promise<void> {
    this.stops++;
  }
  async resume(): Promise<void> {}
  async fadeTo(): Promise<void> {}
  setVolume(): void {}
  setMasterVolume(): void {}
}

function mockBackend() {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "explore_sample_ledger") return SAMPLE_PATH;
    if (cmd === "open_ledger")
      return {
        path: SAMPLE_PATH,
        note_count: 3,
        scene_count: 1,
        map_count: 0,
        failed_imports: [],
        unlinked_pins: [],
        recovered_from_backup: null,
      };
    return null;
  });
}

async function settle() {
  flushSync();
  for (let i = 0; i < 3; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

beforeEach(async () => {
  await ledger.closeLedger();
  vi.mocked(invoke).mockReset();
  mockBackend();
  await settle();
});

describe("re-exploring the Example World from inside itself", () => {
  it("stops the scene playing from the copy it replaced", async () => {
    const players: FakeSlotPlayer[] = [];
    const engine = createAudioEngine({
      makeSlotPlayer: () => {
        const player = new FakeSlotPlayer();
        players.push(player);
        return player;
      },
    });

    await ledger.exploreSample();
    await settle();
    engine.crossfadeTo(1);
    await settle();
    expect(engine.activeSceneId).toBe(1);

    await ledger.exploreSample();
    await settle();

    expect(ledger.path).toBe(SAMPLE_PATH);
    expect(engine.activeSceneId).toBeNull();
    expect(engine.isPlaying).toBe(false);
    expect(players.every((p) => p.stops > 0)).toBe(true);
  });
});
