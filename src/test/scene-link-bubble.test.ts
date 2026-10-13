import { render, fireEvent, cleanup } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import SceneLinkBubble from "../lib/components/panes/SceneLinkBubble.svelte";
import { audioEngine } from "../lib/stores/audio-engine.svelte";
import { tabs } from "../lib/stores/tabs.svelte";
import type { SceneWithCount } from "../lib/types/ledger";

// Active scene drives the Play↔Stop toggle; masterVolume/setMasterVolume back the
// toolbar's global volume control. Mock mirrors the audio-engine surface the
// component touches.
let mockPlayingSceneId: number | null = null;

vi.mock("../lib/stores/audio-engine.svelte", () => ({
  audioEngine: {
    playScene: vi.fn(),
    stopAll: vi.fn(),
    setMasterVolume: vi.fn(),
    masterVolume: 1,
    resumeScene: vi.fn(),
    sceneState: (id: number) => (mockPlayingSceneId === id ? "playing" : "idle"),
  },
}));

vi.mock("../lib/stores/tabs.svelte", () => ({
  tabs: { openTab: vi.fn(), openTabOpposite: vi.fn() },
}));

// The change-Scene dropdown embeds the ScenePicker, which reads the scenes store.
const otherScene: SceneWithCount = {
  id: 7,
  name: "Forest Path",
  favorited: 0,
  created_at: "2026-06-23",
  slot_count: 0,
  thumbnail_path: null,
  thumbnail_color: null,
  thumbnail_icon: null,
};
vi.mock("../lib/stores/scenes.svelte", () => ({
  scenes: {
    get scenes() {
      return [scene, otherScene];
    },
  },
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

function renderBubble(overrides: Partial<Record<string, unknown>> = {}) {
  return render(SceneLinkBubble, {
    scene,
    onChangeScene: vi.fn(),
    onNewScene: vi.fn(),
    onRemove: vi.fn(),
    ...overrides,
  });
}

beforeEach(() => {
  mockPlayingSceneId = null;
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("SceneLinkBubble — Play wiring", () => {
  it("plays the linked Scene by its scene_id when Play is clicked", async () => {
    const { getByLabelText } = renderBubble();
    await fireEvent.click(getByLabelText("Play Tavern Brawl"));
    expect(audioEngine.playScene).toHaveBeenCalledWith(42);
    expect(audioEngine.stopAll).not.toHaveBeenCalled();
  });

  it("stops instead of playing when the linked Scene is already playing", async () => {
    mockPlayingSceneId = 42;
    const { getByLabelText } = renderBubble();
    await fireEvent.click(getByLabelText("Stop Tavern Brawl"));
    expect(audioEngine.stopAll).toHaveBeenCalledOnce();
    expect(audioEngine.playScene).not.toHaveBeenCalled();
  });
});

describe("SceneLinkBubble — master volume", () => {
  it("sets global master volume when the slider moves", async () => {
    const { getByLabelText } = renderBubble();
    await fireEvent.input(getByLabelText("Master volume"), {
      target: { value: "0.4" },
    });
    expect(audioEngine.setMasterVolume).toHaveBeenCalledWith(0.4);
  });
});

describe("SceneLinkBubble — change Scene", () => {
  it("re-links to a different Scene picked from the change dropdown", async () => {
    const onChangeScene = vi.fn();
    const { getByLabelText, getByText } = renderBubble({ onChangeScene });
    await fireEvent.click(getByLabelText("Change Scene"));
    // Pick the other Scene from the now-open picker.
    await fireEvent.click(getByText("Forest Path"));
    expect(onChangeScene).toHaveBeenCalledWith(7);
  });

  it("creates and links a new Scene from the change dropdown's footer", async () => {
    const onNewScene = vi.fn();
    const { getByLabelText, getByText } = renderBubble({ onNewScene });
    await fireEvent.click(getByLabelText("Change Scene"));
    await fireEvent.click(getByText("New scene"));
    expect(onNewScene).toHaveBeenCalledOnce();
  });
});

describe("SceneLinkBubble — remove", () => {
  it("invokes onRemove when the remove button is clicked", async () => {
    const onRemove = vi.fn();
    const { getByLabelText } = renderBubble({ onRemove });
    await fireEvent.click(getByLabelText("Remove Scene-link"));
    expect(onRemove).toHaveBeenCalledOnce();
  });
});

describe("SceneLinkBubble — at the table", () => {
  beforeEach(() => {
    mockPlayingSceneId = null;
    vi.clearAllMocks();
  });
  afterEach(() => cleanup());

  it("opens the scene beside the PDF rather than replacing it", async () => {
    const { getByText } = renderBubble();
    await fireEvent.click(getByText("Tavern Brawl"));
    expect(tabs.openTabOpposite).toHaveBeenCalledWith(
      expect.objectContaining({ type: "scene", id: 42 }),
    );
    expect(tabs.openTab).not.toHaveBeenCalled();
  });

  it("won't play a scene with no tracks, and says why", async () => {
    const { getByLabelText, getByText } = renderBubble({ scene: { ...scene, slot_count: 0 } });
    const play = getByLabelText("Play Tavern Brawl");
    expect(play.hasAttribute("disabled")).toBe(true);
    await fireEvent.click(play);
    expect(audioEngine.playScene).not.toHaveBeenCalled();
    expect(getByText("No tracks yet. Open the scene to add some.")).toBeTruthy();
  });

  it("marks the current scene in the change dropdown, and Enter picks the highlighted match", async () => {
    const onChangeScene = vi.fn();
    const { getByLabelText } = renderBubble({ onChangeScene });
    await fireEvent.click(getByLabelText("Change Scene"));
    const search = getByLabelText("Search scenes") as HTMLInputElement;
    const current = document.body.querySelector('[role="option"][aria-selected="true"]');
    expect(current?.textContent).toContain("Tavern Brawl");
    await fireEvent.input(search, { target: { value: "forest" } });
    await fireEvent.keyDown(search, { key: "Enter" });
    expect(onChangeScene).toHaveBeenCalledWith(7);
  });
});

