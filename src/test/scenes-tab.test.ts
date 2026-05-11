import { render } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ScenesDashboard from "../lib/components/panes/ScenesDashboard.svelte";
import type { SceneWithCount } from "../lib/types/vault";

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
    expect(getByText(/3/)).toBeTruthy();
  });

  it("shows a play button on each scene card", () => {
    mockScenes = [makeScene(1, "Battle Music", false, "2024-01-01")];
    const { container } = render(ScenesDashboard);
    const card = container.querySelector("[data-scene-card]");
    expect(card?.querySelector("[data-play-btn]")).toBeTruthy();
  });
});
