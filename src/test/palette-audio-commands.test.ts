// The command palette's audio commands: the keyboard's way to pause, stop or mute
// without reaching for the sidebar. They used to be 21 Tab presses away.
import { render, fireEvent, cleanup, act } from "@testing-library/svelte";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import type { SceneWithCount } from "../lib/types/ledger";

let mockActive: number | null = null;
let mockPaused = false;

vi.mock("../lib/stores/audio-engine.svelte", () => ({
  audioEngine: {
    get activeSceneId() {
      return mockActive;
    },
    get loadingSceneId() {
      return null;
    },
    get isMasterMuted() {
      return false;
    },
    sceneState: (id: number | null) =>
      id !== null && id === mockActive ? (mockPaused ? "paused" : "playing") : "idle",
    togglePauseScene: vi.fn(),
    stopAll: vi.fn(),
    toggleMasterMute: vi.fn(),
  },
}));

const townMarket: SceneWithCount = {
  id: 2,
  name: "Town Market",
  favorited: 0,
  created_at: "2026-10-14",
  slot_count: 2,
  thumbnail_path: null,
  thumbnail_color: null,
  thumbnail_icon: null,
};

vi.mock("../lib/stores/scenes.svelte", () => ({
  scenes: {
    get scenes() {
      return [townMarket];
    },
    load: vi.fn(),
  },
}));

const { audioEngine } = await import("../lib/stores/audio-engine.svelte");
const SearchPalette = (await import("../lib/components/SearchPalette.svelte")).default;

async function openPalette() {
  await fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  await act(async () => {
    await Promise.resolve();
  });
}

const commandIds = () =>
  [...document.body.querySelectorAll('[data-testid^="cmd-"]')].map((e) =>
    e.getAttribute("data-testid"),
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockActive = null;
  mockPaused = false;
});
afterEach(() => cleanup());

describe("command palette — audio", () => {
  it("offers nothing for audio when nothing plays", async () => {
    render(SearchPalette);
    await openPalette();
    expect(commandIds()).not.toContain("cmd-stop-audio");
  });

  it("while a scene plays, puts Pause, Stop and Mute first", async () => {
    mockActive = 2;
    render(SearchPalette);
    await openPalette();
    expect(commandIds().slice(0, 3)).toEqual(["cmd-pause-scene", "cmd-stop-audio", "cmd-mute-all"]);
    const pause = document.body.querySelector('[data-testid="cmd-pause-scene"]') as HTMLElement;
    expect(pause.textContent).toContain("Pause Town Market");

    await fireEvent.click(pause);
    expect(audioEngine.togglePauseScene).toHaveBeenCalled();
  });

  it("a paused scene's command resumes it", async () => {
    mockActive = 2;
    mockPaused = true;
    render(SearchPalette);
    await openPalette();
    const item = document.body.querySelector('[data-testid="cmd-pause-scene"]') as HTMLElement;
    expect(item.textContent).toContain("Resume Town Market");
  });
});
