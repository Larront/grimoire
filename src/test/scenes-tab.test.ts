import { render, fireEvent, waitFor, cleanup } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import ScenesDashboard from "../lib/components/panes/ScenesDashboard.svelte";
import type { SceneWithCount } from "../lib/types/vault";
import { tabs } from "../lib/stores/tabs.svelte";
import { audioEngine } from "../lib/stores/audio-engine.svelte";
import { scenes } from "../lib/stores/scenes.svelte";

// Mutable mock data — reassigned per test
let mockScenes: SceneWithCount[] = [];

vi.mock("../lib/stores/scenes.svelte", () => ({
  scenes: {
    get scenes() {
      return mockScenes;
    },
    get isLoading() {
      return false;
    },
    get error() {
      return null;
    },
    load: vi.fn(),
  },
}));

vi.mock("../lib/stores/tabs.svelte", () => ({
  tabs: {
    openTab: vi.fn(),
  },
}));

vi.mock("../lib/stores/audio-engine.svelte", () => ({
  audioEngine: {
    playScene: vi.fn(),
    get activeSceneId() {
      return null;
    },
    get isPlaying() {
      return false;
    },
  },
}));

function makeScene(
  id: number,
  name: string,
  favorited: boolean,
  created_at: string,
  slot_count = 0,
): SceneWithCount {
  return {
    id,
    name,
    favorited: favorited ? 1 : 0,
    created_at,
    slot_count,
    thumbnail_path: null,
    thumbnail_color: null,
    thumbnail_icon: null,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ScenesDashboard", () => {
  beforeEach(() => {
    mockScenes = [];
    vi.clearAllMocks();
  });

  it("renders the scenes dashboard shell", () => {
    const { container } = render(ScenesDashboard);
    expect(container.querySelector("[data-scenes-dashboard]")).toBeTruthy();
  });

  it("shows a heading for All Scenes", () => {
    const { getByText } = render(ScenesDashboard);
    expect(getByText("All Scenes")).toBeTruthy();
  });

  it("shows + New Scene button in the header", () => {
    const { getAllByRole } = render(ScenesDashboard);
    const buttons = getAllByRole("button");
    const newSceneBtn = buttons.find((b) => b.textContent?.includes("New Scene"));
    expect(newSceneBtn).toBeTruthy();
  });

  it("shows empty state with CTA when no scenes exist", () => {
    const { container, getAllByRole } = render(ScenesDashboard);
    expect(container.querySelector("[data-empty-state]")).toBeTruthy();
    const buttons = getAllByRole("button");
    const ctaBtn = buttons.find((b) => b.textContent?.includes("New Scene"));
    expect(ctaBtn).toBeTruthy();
  });

  it("does not show the grid when no scenes exist", () => {
    const { container } = render(ScenesDashboard);
    expect(container.querySelector("[data-scenes-grid]")).toBeNull();
  });

  it("renders a card for each scene", () => {
    mockScenes = [
      makeScene(1, "Forest Ambience", false, "2024-01-01"),
      makeScene(2, "Tavern Noise", false, "2024-01-02"),
    ];
    const { getByText, container } = render(ScenesDashboard);
    expect(getByText("Forest Ambience")).toBeTruthy();
    expect(getByText("Tavern Noise")).toBeTruthy();
    expect(container.querySelectorAll("[data-scene-card]").length).toBe(2);
  });

  it("hides the empty state when scenes exist", () => {
    mockScenes = [makeScene(1, "Battle Music", false, "2024-01-01")];
    const { container } = render(ScenesDashboard);
    expect(container.querySelector("[data-empty-state]")).toBeNull();
  });

  it("orders favorites before non-favorites", () => {
    mockScenes = [
      makeScene(1, "Regular Scene", false, "2024-01-01"),
      makeScene(2, "Favorite Scene", true, "2024-01-02"),
    ];
    const { container } = render(ScenesDashboard);
    const cards = container.querySelectorAll("[data-scene-card]");
    expect(cards[0].textContent).toContain("Favorite Scene");
    expect(cards[1].textContent).toContain("Regular Scene");
  });

  it("orders non-favorites by created_at ascending", () => {
    mockScenes = [
      makeScene(3, "Later Scene", false, "2024-03-01"),
      makeScene(1, "Early Scene", false, "2024-01-01"),
      makeScene(2, "Middle Scene", false, "2024-02-01"),
    ];
    const { container } = render(ScenesDashboard);
    const cards = container.querySelectorAll("[data-scene-card]");
    expect(cards[0].textContent).toContain("Early Scene");
    expect(cards[1].textContent).toContain("Middle Scene");
    expect(cards[2].textContent).toContain("Later Scene");
  });

  it("shows slot count metadata on each card", () => {
    mockScenes = [makeScene(1, "My Scene", false, "2024-01-01", 3)];
    const { getByText } = render(ScenesDashboard);
    expect(getByText(/3\s+tracks/)).toBeTruthy();
  });

  it("shows a play button on each scene card", () => {
    mockScenes = [makeScene(1, "Battle Music", false, "2024-01-01")];
    const { container } = render(ScenesDashboard);
    const card = container.querySelector("[data-scene-card]");
    expect(card?.querySelector("[data-play-btn]")).toBeTruthy();
  });
});

// ── Context menu helpers ──────────────────────────────────────────────────────

async function openCardContextMenu(container: HTMLElement) {
  const trigger =
    container.querySelector('[data-slot="context-menu-trigger"]') ??
    container.querySelector("[data-scene-card]")!;
  await fireEvent.contextMenu(trigger);
}

async function clickMenuItem(label: RegExp | string): Promise<HTMLElement> {
  return waitFor(() => {
    const items = Array.from(
      document.body.querySelectorAll('[data-slot="context-menu-item"]'),
    );
    const item = items.find((el) => {
      const text = el.textContent ?? "";
      return label instanceof RegExp ? label.test(text) : text.includes(label);
    }) as HTMLElement | undefined;
    if (!item) throw new Error(`Menu item "${String(label)}" not found`);
    return item;
  });
}

// ── Context menu: structure ───────────────────────────────────────────────────

describe("ScenesDashboard — context menu structure", () => {
  it("shows context menu items on right-click", async () => {
    mockScenes = [makeScene(1, "Forest Ambience", false, "2024-01-01")];
    const { container } = render(ScenesDashboard);
    await openCardContextMenu(container);
    await waitFor(() => {
      const items = document.body.querySelectorAll('[data-slot="context-menu-item"]');
      expect(items.length).toBeGreaterThan(0);
    });
  });

  it("shows Favorite label for unfavorited scene", async () => {
    mockScenes = [makeScene(1, "Forest Ambience", false, "2024-01-01")];
    const { container } = render(ScenesDashboard);
    await openCardContextMenu(container);
    const item = await clickMenuItem("Favorite");
    expect(item).toBeTruthy();
  });

  it("shows Unfavorite label for favorited scene", async () => {
    mockScenes = [makeScene(1, "Forest Ambience", true, "2024-01-01")];
    const { container } = render(ScenesDashboard);
    await openCardContextMenu(container);
    const item = await clickMenuItem("Unfavorite");
    expect(item).toBeTruthy();
  });
});

// ── Context menu: actions ─────────────────────────────────────────────────────

describe("ScenesDashboard — context menu actions", () => {
  it("Open calls tabs.openTab", async () => {
    mockScenes = [makeScene(1, "Forest Ambience", false, "2024-01-01")];
    const { container } = render(ScenesDashboard);
    await openCardContextMenu(container);
    const item = await clickMenuItem("Open");
    await fireEvent.click(item);
    expect(tabs.openTab).toHaveBeenCalledWith({ type: "scene", id: 1, title: "Forest Ambience" });
  });

  it("Play calls audioEngine.playScene", async () => {
    mockScenes = [makeScene(1, "Forest Ambience", false, "2024-01-01")];
    const { container } = render(ScenesDashboard);
    await openCardContextMenu(container);
    const item = await clickMenuItem("Play");
    await fireEvent.click(item);
    expect(audioEngine.playScene).toHaveBeenCalledWith(1);
  });

  it("Favorite toggles via toggle_scene_favorite and reloads", async () => {
    mockScenes = [makeScene(1, "Forest Ambience", false, "2024-01-01")];
    const { container } = render(ScenesDashboard);
    await openCardContextMenu(container);
    const item = await clickMenuItem("Favorite");
    await fireEvent.click(item);
    await waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("toggle_scene_favorite", { id: 1 });
      expect(scenes.load).toHaveBeenCalled();
    });
  });
});

// ── Context menu: rename ──────────────────────────────────────────────────────

describe("ScenesDashboard — inline rename", () => {
  it("Rename shows an input field on the scene card", async () => {
    mockScenes = [makeScene(1, "Forest Ambience", false, "2024-01-01")];
    const { container } = render(ScenesDashboard);
    await openCardContextMenu(container);
    const item = await clickMenuItem("Rename");
    await fireEvent.click(item);
    await waitFor(() => {
      expect(container.querySelector('[data-mode="edit"]')).toBeTruthy();
    });
  });

  it("committing rename calls update_scene", async () => {
    mockScenes = [makeScene(1, "Forest Ambience", false, "2024-01-01")];
    const { container } = render(ScenesDashboard);
    await openCardContextMenu(container);
    const item = await clickMenuItem("Rename");
    await fireEvent.click(item);
    const input = await waitFor(() => {
      const el = container.querySelector('[data-mode="edit"]') as HTMLInputElement;
      if (!el) throw new Error("rename input not found");
      return el;
    });
    await fireEvent.input(input, { target: { value: "New Name" } });
    await fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_scene", { id: 1, name: "New Name" });
    });
  });
});

// ── Context menu: delete ──────────────────────────────────────────────────────

describe("ScenesDashboard — delete", () => {
  it("Delete shows confirmation dialog", async () => {
    mockScenes = [makeScene(1, "Forest Ambience", false, "2024-01-01")];
    const { container } = render(ScenesDashboard);
    await openCardContextMenu(container);
    const item = await clickMenuItem("Delete");
    await fireEvent.click(item);
    await waitFor(() => {
      expect(document.body.querySelector('[role="alertdialog"]')).toBeTruthy();
    });
  });

  it("confirming delete calls delete_scene and reloads", async () => {
    mockScenes = [makeScene(1, "Forest Ambience", false, "2024-01-01")];
    const { container } = render(ScenesDashboard);
    await openCardContextMenu(container);
    const item = await clickMenuItem("Delete");
    await fireEvent.click(item);
    const confirmBtn = await waitFor(() => {
      const btn = document.body.querySelector('[role="alertdialog"] button[data-slot="alert-dialog-action"]') as HTMLElement;
      if (!btn) throw new Error("confirm button not found");
      return btn;
    });
    await fireEvent.click(confirmBtn);
    await waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("delete_scene", { id: 1 });
      expect(scenes.load).toHaveBeenCalled();
    });
  });
});
