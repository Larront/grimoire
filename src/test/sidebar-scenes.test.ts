import { render, cleanup } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import AppShell from "../lib/components/AppShell.svelte";
import type { SceneWithCount } from "../lib/types/vault";

let mockSidebarScenes: SceneWithCount[] = [];
let mockSidebarActiveSceneId: number | null = null;
let mockSidebarLoadingSceneId: number | null = null;

vi.mock("../lib/stores/vault.svelte", () => ({
  vault: {
    get isOpen() { return false; },
    get path() { return null; },
    closeVault: vi.fn(),
    checkExistingVault: vi.fn(),
  },
}));

vi.mock("../lib/stores/notes.svelte", () => ({
  notes: { get notes() { return []; } },
}));

vi.mock("../lib/stores/maps.svelte", () => ({
  maps: { get maps() { return []; } },
}));

vi.mock("../lib/stores/scenes.svelte", () => ({
  scenes: {
    get scenes() { return mockSidebarScenes; },
    getSlots: vi.fn(() => Promise.resolve([])),
    load: vi.fn(),
  },
}));

vi.mock("../lib/stores/tabs.svelte", () => ({
  tabs: {
    get left() { return { tabs: [], activeIndex: 0 }; },
    get right() { return null; },
    get focusedPane() { return "left"; },
    get dragging() { return null; },
    openTab: vi.fn(),
    closeActiveTab: vi.fn(),
    closeTab: vi.fn(),
    setActiveIndex: vi.fn(),
    splitPane: vi.fn(),
    closeSplit: vi.fn(),
    moveTab: vi.fn(),
    focusPane: vi.fn(),
    updateTabTitle: vi.fn(),
  },
}));

vi.mock("../lib/stores/audio-engine.svelte", () => ({
  audioEngine: {
    get activeSceneId() { return mockSidebarActiveSceneId; },
    get loadingSceneId() { return mockSidebarLoadingSceneId; },
    get isPlaying() { return false; },
    get isCrossfading() { return false; },
    get masterVolume() { return 1; },
    get slotStates() { return new Map(); },
    get analyserNode() { return null; },
    playScene: vi.fn(),
    stopAll: vi.fn(),
    setMasterVolume: vi.fn(),
    pauseSlot: vi.fn().mockResolvedValue(undefined),
    resumeSlot: vi.fn().mockResolvedValue(undefined),
    skipNext: vi.fn(),
    skipPrev: vi.fn(),
  },
}));

vi.mock("../lib/stores/right-rail.svelte", () => ({
  RightRailState: class {
    open = false;
    toggle() {}
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
  });

  it("no scene row has data-scene-playing when both IDs are null", () => {
    mockSidebarScenes = [makeScene(1, "Forest Ambience", true)];
    const { container } = render(AppShell);
    expect(container.querySelector("[data-scene-playing]")).toBeNull();
  });

  it("favorite scene row gets data-scene-playing when activeSceneId matches", () => {
    mockSidebarScenes = [
      makeScene(1, "Forest Ambience", true),
      makeScene(2, "Tavern Noise", true),
    ];
    mockSidebarActiveSceneId = 2;
    const { container } = render(AppShell);
    const playingRow = container.querySelector("[data-scene-playing]");
    expect(playingRow).toBeTruthy();
    expect(playingRow?.textContent).toContain("Tavern Noise");
  });

  it("loadingSceneId takes precedence over activeSceneId in sidebar indicator", () => {
    mockSidebarScenes = [
      makeScene(1, "Forest Ambience", true),
      makeScene(2, "Tavern Noise", true),
    ];
    mockSidebarActiveSceneId = 1;
    mockSidebarLoadingSceneId = 2;
    const { container } = render(AppShell);
    const playingRows = container.querySelectorAll("[data-scene-playing]");
    expect(playingRows.length).toBe(1);
    expect(playingRows[0].textContent).toContain("Tavern Noise");
  });

  it("non-favorite scenes do not show indicator even if active", () => {
    mockSidebarScenes = [makeScene(1, "Forest Ambience", false)];
    mockSidebarActiveSceneId = 1;
    const { container } = render(AppShell);
    expect(container.querySelector("[data-scene-playing]")).toBeNull();
  });
});
