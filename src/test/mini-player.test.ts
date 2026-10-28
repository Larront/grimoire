// The sidebar's mini player: the playing scene, for a GM whose eyes are on a note.
//
// What it says has to agree with every other surface — it names the scene starting
// during a crossfade, its crimson means sounding, a pause reads as a pause — and its Stop
// has to work whenever it is on screen: it used to grey Stop and Pause out for the whole
// of every scene change, the moment a GM most wants to cut the music.
import { render, fireEvent, cleanup, waitFor } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SceneSlot, SceneWithCount } from "../lib/types/ledger";

let mockActive: number | null = null;
let mockLoading: number | null = null;
let mockPaused = false;
let mockMasterMuted = false;

vi.mock("../lib/stores/audio-engine.svelte", () => ({
  isPlaylistSlot: (slot: { source_id: string }) => slot.source_id.startsWith("spotify:playlist:"),
  audioEngine: {
    get activeSceneId() {
      return mockActive;
    },
    get loadingSceneId() {
      return mockLoading;
    },
    get isMasterMuted() {
      return mockMasterMuted;
    },
    get isSounding() {
      return mockActive !== null && !mockPaused;
    },
    get masterVolume() {
      return 0.7;
    },
    sceneState: (id: number | null) =>
      id === null
        ? "idle"
        : id === mockLoading
          ? "loading"
          : mockLoading === null && id === mockActive
            ? mockPaused
              ? "paused"
              : "playing"
            : "idle",
    isSceneActive: (id: number) => id === mockActive,
    isSlotPlaying: () => mockActive !== null && !mockPaused,
    isSlotMuted: () => false,
    slotVolume: () => undefined,
    pauseScene: vi.fn().mockResolvedValue(undefined),
    resumeScene: vi.fn().mockResolvedValue(undefined),
    togglePauseScene: vi.fn().mockResolvedValue(undefined),
    stopAll: vi.fn(),
    toggleMasterMute: vi.fn(),
    setMasterVolume: vi.fn(),
    toggleSlotMute: vi.fn(),
    setSlotVolume: vi.fn(),
    pauseSlot: vi.fn(),
    resumeSlot: vi.fn(),
    previewSlot: vi.fn(),
    skipNext: vi.fn(),
    skipPrev: vi.fn(),
  },
}));

const scene = (id: number, name: string): SceneWithCount => ({
  id,
  name,
  favorited: 0,
  created_at: "2026-10-14",
  slot_count: 2,
  thumbnail_path: null,
  thumbnail_color: null,
  thumbnail_icon: null,
});
const track = (id: number, sceneId: number, label: string): SceneSlot => ({
  id,
  scene_id: sceneId,
  source: "local",
  source_id: `${label}.ogg`,
  label,
  volume: 0.5,
  loop: true,
  slot_order: id,
  shuffle: false,
});

vi.mock("../lib/stores/scenes.svelte", () => ({
  scenes: {
    get scenes() {
      return [scene(1, "Boss Battle"), scene(2, "Town Market")];
    },
    get slotsRevision() {
      return 0;
    },
    getSlots: vi.fn((id: number) =>
      Promise.resolve(id === 2 ? [track(21, 2, "Folk Round"), track(22, 2, "Crowd Noise")] : []),
    ),
    patchSlot: vi.fn(),
  },
}));

vi.mock("../lib/stores/tabs.svelte", () => ({
  tabs: { navigateOpen: vi.fn() },
}));

const { audioEngine } = await import("../lib/stores/audio-engine.svelte");
const { tabs } = await import("../lib/stores/tabs.svelte");
const MiniPlayer = (await import("../lib/components/sidebar/MiniPlayer.svelte")).default;

beforeEach(() => {
  vi.clearAllMocks();
  mockActive = null;
  mockLoading = null;
  mockPaused = false;
  mockMasterMuted = false;
});
afterEach(() => cleanup());

const player = (c: HTMLElement) => c.querySelector("[data-mini-player]") as HTMLElement | null;
const bars = (c: HTMLElement) => c.querySelector(".now-playing-bar");

describe("MiniPlayer", () => {
  it("is not there when nothing plays", () => {
    const { container } = render(MiniPlayer);
    expect(player(container)).toBeNull();
  });

  it("playing: the scene's name, the playing bars, Pause and Stop", () => {
    mockActive = 2;
    const { container, getByLabelText } = render(MiniPlayer);
    expect(player(container)?.textContent).toContain("Town Market");
    expect(bars(container)).toBeTruthy();
    expect(getByLabelText("Pause Town Market")).toBeTruthy();
    expect(getByLabelText("Stop Town Market")).toBeTruthy();
  });

  it("paused: says so, draws no playing bars, and offers Resume", async () => {
    mockActive = 2;
    mockPaused = true;
    const { container, getByLabelText } = render(MiniPlayer);
    expect(player(container)?.textContent).toContain("Paused");
    expect(bars(container)).toBeNull();
    await fireEvent.click(getByLabelText("Resume Town Market"));
    expect(audioEngine.togglePauseScene).toHaveBeenCalled();
  });

  it("during a scene change names the scene starting, and Stop still stops", async () => {
    mockActive = 1;
    mockLoading = 2;
    const { container, getByLabelText } = render(MiniPlayer);
    expect(player(container)?.textContent).toContain("Town Market");
    expect(player(container)?.textContent).not.toContain("Boss Battle");

    const stop = getByLabelText("Stop Town Market") as HTMLButtonElement;
    expect(stop.disabled).toBe(false);
    await fireEvent.click(stop);
    expect(audioEngine.stopAll).toHaveBeenCalled();

    // Pause waits for the scene to start (the engine leaves a starting scene alone):
    // marked unavailable, not disabled, so a keyboard GM's focus stays put.
    const pause = getByLabelText("Pause Town Market") as HTMLButtonElement;
    expect(pause.disabled).toBe(false);
    expect(pause.getAttribute("aria-disabled")).toBe("true");
  });

  it("the scene's name opens the scene", async () => {
    mockActive = 2;
    const { getByTitle } = render(MiniPlayer);
    await fireEvent.click(getByTitle("Open Town Market"));
    expect(tabs.navigateOpen).toHaveBeenCalledWith({ type: "scene", id: 2, title: "Town Market" });
  });

  it("Mute all says whether it is pressed", () => {
    mockActive = 2;
    mockMasterMuted = true;
    const { getByLabelText } = render(MiniPlayer);
    expect(getByLabelText("Mute all").getAttribute("aria-pressed")).toBe("true");
    expect(getByLabelText("Master volume")).toBeTruthy();
  });

  it("its tracks open in a floating panel, one shared row each", async () => {
    mockActive = 2;
    const { getByLabelText } = render(MiniPlayer);
    await fireEvent.click(getByLabelText("Tracks in Town Market"));
    await waitFor(() => {
      expect(document.body.querySelector('[aria-label="Folk Round volume"]')).toBeTruthy();
      expect(document.body.querySelector('[aria-label="Mute Crowd Noise"]')).toBeTruthy();
    });
  });
});
