import { render, waitFor } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ScenePane from "../lib/components/panes/ScenePane.svelte";
import type { Scene, SceneSlot } from "../lib/types/vault";

let mockScenes: Scene[] = [];
let mockSlots: SceneSlot[] = [];

vi.mock("../lib/stores/scenes.svelte", () => ({
  scenes: {
    get scenes() {
      return mockScenes;
    },
    get isLoading() {
      return false;
    },
    getSlots: vi.fn(() => Promise.resolve(mockSlots)),
    invalidateSlots: vi.fn(),
    load: vi.fn(),
  },
}));

vi.mock("../lib/stores/tabs.svelte", () => ({
  tabs: { updateTabTitle: vi.fn() },
}));

vi.mock("../lib/stores/audio-engine.svelte", () => ({
  audioEngine: {
    playScene: vi.fn(),
    stopAll: vi.fn(),
    setMasterVolume: vi.fn(),
    setSlotVolume: vi.fn(),
    pauseSlot: vi.fn().mockResolvedValue(undefined),
    resumeSlot: vi.fn().mockResolvedValue(undefined),
    skipNext: vi.fn(),
    skipPrev: vi.fn(),
    get activeSceneId() {
      return null;
    },
    get isPlaying() {
      return false;
    },
    get isCrossfading() {
      return false;
    },
    get loadingSceneId() {
      return null;
    },
    get masterVolume() {
      return 1;
    },
    get slotStates() {
      return new Map();
    },
  },
}));

vi.mock("../lib/utils/spotify-auth", () => ({
  getSpotifyStatus: vi.fn().mockResolvedValue({ is_connected: false, expires_at: "" }),
  connectSpotify: vi.fn(),
}));

function makeScene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 1,
    name: "Test Scene",
    favorited: 0,
    created_at: "2024-01-01",
    thumbnail_path: null,
    thumbnail_color: null,
    thumbnail_icon: null,
    ...overrides,
  };
}

function makeSlot(overrides: Partial<SceneSlot> = {}): SceneSlot {
  return {
    id: 1,
    scene_id: 1,
    source: "local",
    source_id: "audio/test.mp3",
    label: "Test Track",
    volume: 0.8,
    loop: true,
    slot_order: 0,
    shuffle: false,
    ...overrides,
  };
}

describe("ScenePane hero header", () => {
  beforeEach(() => {
    mockScenes = [];
    mockSlots = [];
    vi.clearAllMocks();
  });

  // TRACER BULLET: hero header renders
  it("renders a hero header when scene exists", () => {
    mockScenes = [makeScene()];
    const { container } = render(ScenePane, { props: { sceneId: 1, pane: "left" } });
    expect(container.querySelector("[data-hero-header]")).toBeTruthy();
  });

  it("hero header uses derived accent color when no thumbnail_path or thumbnail_color", () => {
    // id=1, 1%5=1 → arcane: rgba(155,107,191,0.18)
    mockScenes = [makeScene({ id: 1, thumbnail_color: null, thumbnail_path: null })];
    const { container } = render(ScenePane, { props: { sceneId: 1, pane: "left" } });
    const hero = container.querySelector("[data-hero-header]") as HTMLElement;
    // JSDOM normalizes rgba(r,g,b,a) → rgba(r, g, b, a) with spaces
    expect(hero?.getAttribute("style")).toMatch(/155.*107.*191/);
  });

  it("hero header uses thumbnail_color when set and no thumbnail_path", () => {
    mockScenes = [makeScene({ thumbnail_color: "rgba(100,200,100,0.4)", thumbnail_path: null })];
    const { container } = render(ScenePane, { props: { sceneId: 1, pane: "left" } });
    const hero = container.querySelector("[data-hero-header]") as HTMLElement;
    expect(hero?.getAttribute("style")).toMatch(/100.*200.*100/);
  });

  it("icon always renders inside hero header (ADR-0002)", () => {
    mockScenes = [makeScene()];
    const { container } = render(ScenePane, { props: { sceneId: 1, pane: "left" } });
    expect(container.querySelector("[data-hero-icon]")).toBeTruthy();
  });

  it("scene name input has font-heading class (Metamorphous)", () => {
    mockScenes = [makeScene({ name: "Dark Forest" })];
    const { container } = render(ScenePane, { props: { sceneId: 1, pane: "left" } });
    const nameInput = container.querySelector("[data-scene-name]");
    expect(nameInput?.classList.contains("font-heading")).toBeTruthy();
  });

  it("does not show Spotify controls when scene has only local slots", async () => {
    mockScenes = [makeScene()];
    mockSlots = [makeSlot({ source: "local" })];
    const { container } = render(ScenePane, { props: { sceneId: 1, pane: "left" } });
    await waitFor(() => {
      expect(container.querySelector("[data-spotify-controls]")).toBeNull();
    });
  });

  it("shows Spotify controls when scene has a Spotify playlist slot", async () => {
    mockScenes = [makeScene()];
    mockSlots = [makeSlot({ source: "spotify", source_id: "spotify:playlist:abc123" })];
    const { container } = render(ScenePane, { props: { sceneId: 1, pane: "left" } });
    await waitFor(() => {
      expect(container.querySelector("[data-spotify-controls]")).toBeTruthy();
    });
  });

  it("does not show Spotify controls when only Spotify track slots exist (not playlists)", async () => {
    mockScenes = [makeScene()];
    mockSlots = [makeSlot({ source: "spotify", source_id: "spotify:track:xyz789" })];
    const { container } = render(ScenePane, { props: { sceneId: 1, pane: "left" } });
    await waitFor(() => {
      expect(container.querySelector("[data-spotify-controls]")).toBeNull();
    });
  });
});
