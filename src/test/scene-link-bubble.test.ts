import { render, fireEvent, cleanup } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import SceneLinkBubble from "../lib/components/panes/SceneLinkBubble.svelte";
import { audioEngine } from "../lib/stores/audio-engine.svelte";
import type { SceneWithCount } from "../lib/types/ledger";

// Active scene drives the Play↔Stop toggle. Mock mirrors the real audio-engine
// surface this component touches.
let mockPlayingSceneId: number | null = null;

vi.mock("../lib/stores/audio-engine.svelte", () => ({
  audioEngine: {
    playScene: vi.fn(),
    stopAll: vi.fn(),
    isScenePlaying: (id: number) => mockPlayingSceneId === id,
  },
}));

vi.mock("../lib/stores/tabs.svelte", () => ({
  tabs: { openTab: vi.fn() },
}));

const scene: SceneWithCount = {
  id: 42,
  name: "Tavern Brawl",
  favorited: 0,
  created_at: "2026-06-23",
  slot_count: 2,
  thumbnail_path: null,
  thumbnail_color: null,
  thumbnail_icon: null,
};

beforeEach(() => {
  mockPlayingSceneId = null;
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("SceneLinkBubble — Play wiring", () => {
  it("plays the linked Scene by its scene_id when Play is clicked", async () => {
    const { getByLabelText } = render(SceneLinkBubble, { scene, onRemove: vi.fn() });
    await fireEvent.click(getByLabelText("Play Tavern Brawl"));
    expect(audioEngine.playScene).toHaveBeenCalledWith(42);
    expect(audioEngine.stopAll).not.toHaveBeenCalled();
  });

  it("stops instead of playing when the linked Scene is already playing", async () => {
    mockPlayingSceneId = 42;
    const { getByLabelText } = render(SceneLinkBubble, { scene, onRemove: vi.fn() });
    await fireEvent.click(getByLabelText("Stop Tavern Brawl"));
    expect(audioEngine.stopAll).toHaveBeenCalledOnce();
    expect(audioEngine.playScene).not.toHaveBeenCalled();
  });

  it("invokes onRemove when the remove button is clicked", async () => {
    const onRemove = vi.fn();
    const { getByLabelText } = render(SceneLinkBubble, { scene, onRemove });
    await fireEvent.click(getByLabelText("Remove Scene-link"));
    expect(onRemove).toHaveBeenCalledOnce();
  });
});
