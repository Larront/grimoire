import { render, cleanup } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import AppShell from "../lib/components/AppShell.svelte";
import type { SceneWithCount } from "../lib/types/ledger";

let mockSidebarScenes: SceneWithCount[] = [];
let mockSidebarActiveSceneId: number | null = null;
let mockSidebarLoadingSceneId: number | null = null;
let mockSidebarPaused = false;

vi.mock("../lib/stores/ledger.svelte", () => ({
  ledger: {
    get isOpen() {
      return false;
    },
    get path() {
      return null;
    },
    closeLedger: vi.fn(),
    checkExistingLedger: vi.fn(),
  },
  failedImportsModal: { open: false, failures: [] },
  unlinkedPinsModal: { open: false, pins: [] },
}));

vi.mock("../lib/stores/notes.svelte", () => ({
  notes: {
    get notes() {
      return [];
    },
  },
}));

vi.mock("../lib/stores/maps.svelte", () => ({
  maps: {
    get maps() {
      return [];
    },
  },
}));

vi.mock("../lib/stores/scenes.svelte", () => ({
  scenes: {
    get scenes() {
      return mockSidebarScenes;
    },
    getSlots: vi.fn(() => Promise.resolve([])),
    load: vi.fn(),
  },
}));

vi.mock("../lib/stores/tabs.svelte", () => ({
  tabs: {
    get left() {
      return { tabs: [], activeIndex: 0 };
    },
    get right() {
      return null;
    },
    get focusedPane() {
      return "left";
    },
    get dragging() {
      return null;
    },
    get activeTab() {
      return null;
    },
    openTab: vi.fn(),
    navigateOpen: vi.fn(),
    closeActiveTab: vi.fn(),
    closeTab: vi.fn(),
    setActiveIndex: vi.fn(),
    splitPane: vi.fn(),
    closeSplit: vi.fn(),
    moveTab: vi.fn(),
    focusPane: vi.fn(),
    updateTabTitle: vi.fn(),
    canGoBack: vi.fn(() => false),
    canGoForward: vi.fn(() => false),
    navigateBack: vi.fn(),
    navigateForward: vi.fn(),
  },
}));

vi.mock("../lib/stores/audio-engine.svelte", () => ({
  audioEngine: {
    get activeSceneId() {
      return mockSidebarActiveSceneId;
    },
    get loadingSceneId() {
      return mockSidebarLoadingSceneId;
    },
    get isPlaying() {
      return false;
    },
    get isCrossfading() {
      return false;
    },
    get masterVolume() {
      return 1;
    },
    get isScenePaused() {
      return false;
    },
    get isMasterMuted() {
      return false;
    },
    playScene: vi.fn(),
    stopAll: vi.fn(),
    setMasterVolume: vi.fn(),
    toggleMasterMute: vi.fn(),
    pauseScene: vi.fn().mockResolvedValue(undefined),
    resumeScene: vi.fn().mockResolvedValue(undefined),
    pauseSlot: vi.fn().mockResolvedValue(undefined),
    resumeSlot: vi.fn().mockResolvedValue(undefined),
    isSceneActive: vi.fn(() => false),
    // As the engine answers: the scene starting is "loading", and the one it is leaving
    // reads as idle.
    sceneState: vi.fn((id: number | null) =>
      id === null
        ? "idle"
        : id === mockSidebarLoadingSceneId
          ? "loading"
          : mockSidebarLoadingSceneId === null && id === mockSidebarActiveSceneId
            ? mockSidebarPaused
              ? "paused"
              : "playing"
            : "idle",
    ),
    isSlotPlaying: vi.fn(() => false),
    slotVolume: vi.fn(() => undefined),
    skipNext: vi.fn(),
    skipPrev: vi.fn(),
  },
}));

function makeScene(id: number, name: string, favorited: boolean): SceneWithCount {
  return {
    id,
    name,
    favorited: favorited ? 1 : 0,
    created_at: "2024-01-01",
    slot_count: 0,
    thumbnail_path: null,
    thumbnail_color: null,
    thumbnail_icon: null,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AppSidebar — scene playing indicator", () => {
  beforeEach(() => {
    mockSidebarScenes = [];
    mockSidebarActiveSceneId = null;
    mockSidebarLoadingSceneId = null;
    mockSidebarPaused = false;
  });

  it("no scene row has data-scene-playing when both IDs are null", () => {
    mockSidebarScenes = [makeScene(1, "Forest Ambience", true)];
    const { container } = render(AppShell);
    expect(container.querySelector("[data-scene-playing]")).toBeNull();
  });

  it("favorite scene row gets data-scene-playing when activeSceneId matches", () => {
    mockSidebarScenes = [makeScene(1, "Forest Ambience", true), makeScene(2, "Tavern Noise", true)];
    mockSidebarActiveSceneId = 2;
    const { container } = render(AppShell);
    const playingRow = container.querySelector("[data-scene-playing]");
    expect(playingRow).toBeTruthy();
    expect(playingRow?.textContent).toContain("Tavern Noise");
  });

  it("loadingSceneId takes precedence over activeSceneId in sidebar indicator", () => {
    mockSidebarScenes = [makeScene(1, "Forest Ambience", true), makeScene(2, "Tavern Noise", true)];
    mockSidebarActiveSceneId = 1;
    mockSidebarLoadingSceneId = 2;
    const { container } = render(AppShell);
    const playingRows = container.querySelectorAll("[data-scene-playing]");
    expect(playingRows.length).toBe(1);
    expect(playingRows[0].textContent).toContain("Tavern Noise");
  });

  it("a paused scene's row is not marked playing, and offers Play to resume it", () => {
    // Crimson means sounding. The row used to stay crimson through a pause.
    mockSidebarScenes = [makeScene(1, "Forest Ambience", true)];
    mockSidebarActiveSceneId = 1;
    mockSidebarPaused = true;
    const { container } = render(AppShell);
    expect(container.querySelector("[data-scene-playing]")).toBeNull();
    const play = container.querySelector('[data-testid="sidebar-scene-play"]');
    expect(play?.getAttribute("aria-label")).toBe("Play Forest Ambience");
  });

  it("with favourites, a non-favourite scene is not listed even if active", () => {
    mockSidebarScenes = [makeScene(1, "Forest Ambience", false), makeScene(2, "Tavern Noise", true)];
    mockSidebarActiveSceneId = 1;
    const { container } = render(AppShell);
    expect(container.querySelector("[data-scene-playing]")).toBeNull();
  });

  it("with no favourites, lists the newest scenes so there is something to press", () => {
    mockSidebarScenes = [
      { ...makeScene(1, "Oldest", false), created_at: "2024-01-01" },
      { ...makeScene(2, "Second", false), created_at: "2024-02-01" },
      { ...makeScene(3, "Third", false), created_at: "2024-03-01" },
      { ...makeScene(4, "Newest", false), created_at: "2024-04-01" },
    ];
    const { container } = render(AppShell);
    const plays = [...container.querySelectorAll('[data-testid="sidebar-scene-play"]')];
    expect(plays.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Play Newest",
      "Play Third",
      "Play Second",
    ]);
  });
});
