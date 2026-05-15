import { render, waitFor, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import ScenePane from "../lib/components/panes/ScenePane.svelte";
import type { Scene, SceneSlot } from "../lib/types/vault";

let mockScenes: Scene[] = [];
let mockSlots: SceneSlot[] = [];

// Mock mirrors the real scenes store mutation surface: each method dispatches
// the same invoke() call the real store does. Tests assert against invoke —
// keep this in sync with scenes.svelte.ts.
vi.mock("../lib/stores/scenes.svelte", async () => {
  const { invoke } = await import("@tauri-apps/api/core");
  return {
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
      async setThumbnailImage(id: number, path: string | null) {
        const scene = mockScenes.find((s) => s.id === id);
        await invoke("update_scene_thumbnail", {
          id,
          thumbnailColor: scene?.thumbnail_color ?? null,
          thumbnailIcon: scene?.thumbnail_icon ?? null,
          thumbnailPath: path,
        });
      },
    },
  };
});

vi.mock("../lib/stores/tabs.svelte", () => ({
  tabs: { updateTabTitle: vi.fn() },
}));

vi.mock("../lib/stores/audio-engine.svelte", () => ({
  // Keep in sync with the named export in audio-engine.svelte.ts
  isPlaylistSlot: (slot: { source_id: string }) => slot.source_id.startsWith("spotify:playlist:"),
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

  it("does not show skip controls when scene has only local slots", async () => {
    mockScenes = [makeScene()];
    mockSlots = [makeSlot({ source: "local" })];
    const { container } = render(ScenePane, { props: { sceneId: 1, pane: "left" } });
    await waitFor(() => {
      expect(container.querySelector("[data-slot-skip-controls]")).toBeNull();
    });
  });

  it("shows skip controls in the slot row for a Spotify playlist slot", async () => {
    mockScenes = [makeScene()];
    mockSlots = [makeSlot({ source: "spotify", source_id: "spotify:playlist:abc123" })];
    const { container } = render(ScenePane, { props: { sceneId: 1, pane: "left" } });
    await waitFor(() => {
      expect(container.querySelector("[data-slot-skip-controls]")).toBeTruthy();
    });
  });

  it("does not show skip controls for Spotify track slots (not playlists)", async () => {
    mockScenes = [makeScene()];
    mockSlots = [makeSlot({ source: "spotify", source_id: "spotify:track:xyz789" })];
    const { container } = render(ScenePane, { props: { sceneId: 1, pane: "left" } });
    await waitFor(() => {
      expect(container.querySelector("[data-slot-skip-controls]")).toBeNull();
    });
  });
});

describe("ScenePane hero header — thumbnail pickers", () => {
  beforeEach(() => {
    mockScenes = [];
    mockSlots = [];
    vi.clearAllMocks();
  });

  it("hero header has a color picker button", () => {
    mockScenes = [makeScene()];
    const { container } = render(ScenePane, { props: { sceneId: 1, pane: "left" } });
    expect(container.querySelector("[data-edit-color-btn]")).toBeTruthy();
  });

  it("hero header has an icon picker button", () => {
    mockScenes = [makeScene()];
    const { container } = render(ScenePane, { props: { sceneId: 1, pane: "left" } });
    expect(container.querySelector("[data-edit-icon-btn]")).toBeTruthy();
  });

  it("clicking the color button opens a color picker", async () => {
    mockScenes = [makeScene()];
    const { container } = render(ScenePane, { props: { sceneId: 1, pane: "left" } });
    const btn = container.querySelector("[data-edit-color-btn]") as HTMLElement;
    await fireEvent.click(btn);
    await waitFor(() => {
      expect(document.body.querySelector("[data-color-picker]")).toBeTruthy();
    });
  });

  it("clicking the icon button opens an icon picker", async () => {
    mockScenes = [makeScene()];
    const { container } = render(ScenePane, { props: { sceneId: 1, pane: "left" } });
    const btn = container.querySelector("[data-edit-icon-btn]") as HTMLElement;
    await fireEvent.click(btn);
    await waitFor(() => {
      expect(document.body.querySelector("[data-icon-picker]")).toBeTruthy();
    });
  });

  it("hero icon reflects thumbnail_icon when set", () => {
    mockScenes = [makeScene({ thumbnail_icon: "Skull" })];
    const { container } = render(ScenePane, { props: { sceneId: 1, pane: "left" } });
    expect(container.querySelector('[data-hero-icon][data-icon-name="Skull"]')).toBeTruthy();
  });

  it("hero icon defaults to Music2 when thumbnail_icon is null", () => {
    mockScenes = [makeScene({ thumbnail_icon: null })];
    const { container } = render(ScenePane, { props: { sceneId: 1, pane: "left" } });
    expect(container.querySelector('[data-hero-icon][data-icon-name="Music2"]')).toBeTruthy();
  });
});

describe("ScenePane hero header — thumbnail image upload", () => {
  beforeEach(() => {
    mockScenes = [];
    mockSlots = [];
    vi.clearAllMocks();
  });

  it("hero header has a change thumbnail button", () => {
    mockScenes = [makeScene()];
    const { container } = render(ScenePane, { props: { sceneId: 1, pane: "left" } });
    expect(container.querySelector("[data-edit-thumbnail-btn]")).toBeTruthy();
  });

  it("clicking change thumbnail opens file picker filtered to image types", async () => {
    mockScenes = [makeScene()];
    vi.mocked(open).mockResolvedValueOnce(null);
    const { container } = render(ScenePane, { props: { sceneId: 1, pane: "left" } });
    const btn = container.querySelector("[data-edit-thumbnail-btn]") as HTMLElement;
    await fireEvent.click(btn);
    await waitFor(() => {
      expect(vi.mocked(open)).toHaveBeenCalledWith(
        expect.objectContaining({
          filters: expect.arrayContaining([
            expect.objectContaining({ extensions: expect.arrayContaining(["jpg", "png", "webp"]) }),
          ]),
        }),
      );
    });
  });

  it("remove thumbnail button not visible when thumbnail_path is null", () => {
    mockScenes = [makeScene({ thumbnail_path: null })];
    const { container } = render(ScenePane, { props: { sceneId: 1, pane: "left" } });
    expect(container.querySelector("[data-remove-thumbnail-btn]")).toBeNull();
  });

  it("remove thumbnail button visible when thumbnail_path is set", () => {
    mockScenes = [makeScene({ thumbnail_path: ".grimoire/thumbnails/img.jpg" })];
    const { container } = render(ScenePane, { props: { sceneId: 1, pane: "left" } });
    expect(container.querySelector("[data-remove-thumbnail-btn]")).toBeTruthy();
  });

  it("clicking remove thumbnail calls update_scene_thumbnail with thumbnailPath null", async () => {
    mockScenes = [makeScene({ thumbnail_path: ".grimoire/thumbnails/img.jpg" })];
    const { container } = render(ScenePane, { props: { sceneId: 1, pane: "left" } });
    const btn = container.querySelector("[data-remove-thumbnail-btn]") as HTMLElement;
    await fireEvent.click(btn);
    await waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith(
        "update_scene_thumbnail",
        expect.objectContaining({ id: 1, thumbnailPath: null }),
      );
    });
  });
});
