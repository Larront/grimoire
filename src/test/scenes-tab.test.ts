import { render, fireEvent, waitFor, cleanup } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import ScenesDashboard from "../lib/components/panes/ScenesDashboard.svelte";
import type { SceneWithCount } from "../lib/types/ledger";
import { tabs } from "../lib/stores/tabs.svelte";
import { audioEngine } from "../lib/stores/audio-engine.svelte";
import { scenes } from "../lib/stores/scenes.svelte";
import { toastUndo } from "../lib/toast";

vi.mock("../lib/toast", async (original) => ({
  ...(await original<typeof import("../lib/toast")>()),
  toastUndo: vi.fn(),
}));

// Mutable mock data — reassigned per test
let mockScenes: SceneWithCount[] = [];
let mockActiveSceneId: number | null = null;
let mockLoadingSceneId: number | null = null;

// Mock mirrors the real scenes store mutation surface: each method dispatches
// the same invoke() call the real store does, then calls load(). Tests assert
// against invoke + scenes.load — keep this in sync with scenes.svelte.ts.
vi.mock("../lib/stores/scenes.svelte", async () => {
  const { invoke } = await import("@tauri-apps/api/core");
  const load = vi.fn();
  return {
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
      load,
      async deleteScene(id: number) {
        await invoke("delete_scene", { id });
        await load();
      },
      async updateScene(id: number, name: string) {
        await invoke("update_scene", { id, name });
        await load();
      },
      async toggleFavorite(id: number) {
        await invoke("toggle_scene_favorite", { id });
        await load();
      },
      async applyThumbnailColor(id: number, color: string | null) {
        const scene = mockScenes.find((s) => s.id === id);
        await invoke("update_scene_thumbnail", {
          id,
          thumbnailColor: color,
          thumbnailIcon: scene?.thumbnail_icon ?? null,
          thumbnailPath: scene?.thumbnail_path ?? null,
        });
        await load();
      },
      async applyThumbnailIcon(id: number, icon: string | null) {
        const scene = mockScenes.find((s) => s.id === id);
        await invoke("update_scene_thumbnail", {
          id,
          thumbnailColor: scene?.thumbnail_color ?? null,
          thumbnailIcon: icon,
          thumbnailPath: scene?.thumbnail_path ?? null,
        });
        await load();
      },
      async setThumbnailImage(id: number, path: string | null) {
        const scene = mockScenes.find((s) => s.id === id);
        await invoke("update_scene_thumbnail", {
          id,
          thumbnailColor: scene?.thumbnail_color ?? null,
          thumbnailIcon: scene?.thumbnail_icon ?? null,
          thumbnailPath: path,
        });
        await load();
      },
    },
  };
});

vi.mock("../lib/stores/tabs.svelte", () => ({
  tabs: {
    openTab: vi.fn(),
  },
}));

vi.mock("../lib/stores/audio-engine.svelte", () => ({
  audioEngine: {
    playScene: vi.fn(),
    stopAll: vi.fn(),
    pauseScene: vi.fn(),
    resumeScene: vi.fn(),
    isScenePaused: false,
    get activeSceneId() {
      return mockActiveSceneId;
    },
    get loadingSceneId() {
      return mockLoadingSceneId;
    },
    get isPlaying() {
      return false;
    },
    sceneState: (id: number) =>
      id === mockLoadingSceneId
        ? "loading"
        : mockLoadingSceneId === null && id === mockActiveSceneId
          ? "playing"
          : "idle",
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
    mockActiveSceneId = null;
    mockLoadingSceneId = null;
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

  it("pressing the card's picture plays the scene rather than opening it", async () => {
    mockScenes = [makeScene(1, "Battle Music", false, "2024-01-01")];
    const { container } = render(ScenesDashboard);
    await fireEvent.click(container.querySelector("[data-play-btn]")!);
    expect(audioEngine.playScene).toHaveBeenCalledWith(1);
    expect(tabs.openTab).not.toHaveBeenCalled();
  });

  it("the card's edit button opens the scene editor", async () => {
    mockScenes = [makeScene(1, "Battle Music", false, "2024-01-01")];
    const { container } = render(ScenesDashboard);
    await fireEvent.click(container.querySelector("[data-edit-btn]")!);
    expect(tabs.openTab).toHaveBeenCalledWith({ type: "scene", id: 1, title: "Battle Music" });
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
    const items = Array.from(document.body.querySelectorAll('[data-slot="context-menu-item"]'));
    const item = items.find((el) => {
      const text = el.textContent ?? "";
      return label instanceof RegExp ? label.test(text) : text.includes(label);
    }) as HTMLElement | undefined;
    if (!item) throw new Error(`Menu item "${String(label)}" not found`);
    return item;
  });
}

// ── Context menu: structure ───────────────────────────────────────────────────
//
// Playing first, then editing, then Delete (2026-10 design review). Picture, colour
// and icon are one Appearance popover where a "Customise" submenu opened three windows.

function menuLabels(): string[] {
  return Array.from(document.body.querySelectorAll('[data-slot="context-menu-item"]')).map((el) =>
    (el.textContent ?? "").replace(/\s+/g, " ").trim(),
  );
}

describe("ScenesDashboard — context menu structure", () => {
  it("leads with Play, then editing, then Delete by name", async () => {
    mockScenes = [makeScene(1, "Forest Ambience", false, "2024-01-01")];
    const { container } = render(ScenesDashboard);
    await openCardContextMenu(container);
    await clickMenuItem("Play");
    expect(menuLabels()).toEqual([
      "Play",
      "Open",
      "Rename F2",
      "Appearance…",
      "Favourite",
      "Delete “Forest Ambience” Del",
    ]);
  });

  it("offers Unfavourite on a favourite", async () => {
    mockScenes = [makeScene(1, "Forest Ambience", true, "2024-01-01")];
    const { container } = render(ScenesDashboard);
    await openCardContextMenu(container);
    expect(await clickMenuItem("Unfavourite")).toBeTruthy();
  });

  // Play on a sounding scene did nothing a GM could see.
  it("offers Stop on the scene that is playing, and it stops", async () => {
    mockScenes = [makeScene(1, "Forest Ambience", false, "2024-01-01")];
    mockActiveSceneId = 1;
    const { container } = render(ScenesDashboard);
    await openCardContextMenu(container);
    await fireEvent.click(await clickMenuItem("Stop"));
    expect(audioEngine.stopAll).toHaveBeenCalled();
    expect(menuLabels()).not.toContain("Play");
    mockActiveSceneId = null;
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
    expect(tabs.openTab).toHaveBeenCalledWith({
      type: "scene",
      id: 1,
      title: "Forest Ambience",
    });
  });

  it("Play calls audioEngine.playScene", async () => {
    mockScenes = [makeScene(1, "Forest Ambience", false, "2024-01-01")];
    const { container } = render(ScenesDashboard);
    await openCardContextMenu(container);
    const item = await clickMenuItem(/^\s*Play\s*$/);
    await fireEvent.click(item);
    expect(audioEngine.playScene).toHaveBeenCalledWith(1);
  });

  it("Favourite toggles via toggle_scene_favorite and reloads", async () => {
    mockScenes = [makeScene(1, "Forest Ambience", false, "2024-01-01")];
    const { container } = render(ScenesDashboard);
    await openCardContextMenu(container);
    const item = await clickMenuItem("Favourite");
    await fireEvent.click(item);
    await waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("toggle_scene_favorite", {
        id: 1,
      });
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

  it("F2 on the card starts the same rename", async () => {
    mockScenes = [makeScene(1, "Forest Ambience", false, "2024-01-01")];
    const { container } = render(ScenesDashboard);
    await fireEvent.keyDown(container.querySelector("[data-play-btn]")!, { key: "F2" });
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
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_scene", {
        id: 1,
        name: "New Name",
      });
    });
  });
});

// ── Context menu: delete ──────────────────────────────────────────────────────
//
// An undo toast, as removing a track has; the modal said "cannot be undone".

describe("ScenesDashboard — delete", () => {
  it("takes the card away at once, with Undo, and no dialog", async () => {
    mockScenes = [makeScene(1, "Forest Ambience", false, "2024-01-01")];
    const { container } = render(ScenesDashboard);
    await openCardContextMenu(container);
    await fireEvent.click(await clickMenuItem("Delete"));
    await waitFor(() => expect(container.querySelector("[data-scene-card]")).toBeNull());
    expect(vi.mocked(toastUndo).mock.calls[0][0]).toBe("Deleted “Forest Ambience”");
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("delete_scene", { id: 1 });
  });

  it("deletes when the toast closes", async () => {
    mockScenes = [makeScene(1, "Forest Ambience", false, "2024-01-01")];
    const { container } = render(ScenesDashboard);
    await fireEvent.keyDown(container.querySelector("[data-play-btn]")!, { key: "Delete" });
    const [, commit] = vi.mocked(toastUndo).mock.calls[0];
    await commit();
    await waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("delete_scene", { id: 1 });
      expect(scenes.load).toHaveBeenCalled();
    });
  });

  it("puts the card back on Undo", async () => {
    mockScenes = [makeScene(1, "Forest Ambience", false, "2024-01-01")];
    const { container } = render(ScenesDashboard);
    await fireEvent.keyDown(container.querySelector("[data-play-btn]")!, { key: "Delete" });
    await waitFor(() => expect(container.querySelector("[data-scene-card]")).toBeNull());
    vi.mocked(toastUndo).mock.calls[0][2]!();
    await waitFor(() => expect(container.querySelector("[data-scene-card]")).toBeTruthy());
  });
});

// ── Playing indicator ─────────────────────────────────────────────────────────

describe("ScenesDashboard — playing indicator", () => {
  beforeEach(() => {
    mockActiveSceneId = null;
    mockLoadingSceneId = null;
  });

  it("no card has data-playing when both activeSceneId and loadingSceneId are null", () => {
    mockScenes = [makeScene(1, "Forest Ambience", false, "2024-01-01")];
    const { container } = render(ScenesDashboard);
    expect(container.querySelector("[data-playing]")).toBeNull();
  });

  it("card with matching activeSceneId gets data-playing", () => {
    mockScenes = [
      makeScene(1, "Forest Ambience", false, "2024-01-01"),
      makeScene(2, "Tavern Noise", false, "2024-01-02"),
    ];
    mockActiveSceneId = 2;
    const { container } = render(ScenesDashboard);
    const playingCards = container.querySelectorAll("[data-playing]");
    expect(playingCards.length).toBe(1);
    expect(playingCards[0].textContent).toContain("Tavern Noise");
  });

  it("loadingSceneId takes precedence over activeSceneId for the indicator", () => {
    mockScenes = [
      makeScene(1, "Forest Ambience", false, "2024-01-01"),
      makeScene(2, "Tavern Noise", false, "2024-01-02"),
    ];
    mockActiveSceneId = 1;
    mockLoadingSceneId = 2;
    const { container } = render(ScenesDashboard);
    const playingCards = container.querySelectorAll("[data-playing]");
    expect(playingCards.length).toBe(1);
    expect(playingCards[0].textContent).toContain("Tavern Noise");
  });

  it("no card has data-playing when activeSceneId doesn't match any scene", () => {
    mockScenes = [makeScene(1, "Forest Ambience", false, "2024-01-01")];
    mockActiveSceneId = 99;
    const { container } = render(ScenesDashboard);
    expect(container.querySelector("[data-playing]")).toBeNull();
  });
});

// ── Appearance ────────────────────────────────────────────────────────────────

async function openAppearance(container: HTMLElement) {
  await openCardContextMenu(container);
  await fireEvent.click(await clickMenuItem("Appearance…"));
  await waitFor(() => {
    if (!document.body.querySelector("[data-icon-picker]")) throw new Error("not open");
  });
}

describe("ScenesDashboard — appearance colour", () => {
  it("Appearance… opens the picture, colour and icon together", async () => {
    mockScenes = [makeScene(1, "Forest", false, "2024-01-01")];
    const { container } = render(ScenesDashboard);
    await openAppearance(container);
    expect(document.body.querySelector("[data-color-picker]")).toBeTruthy();
    expect(document.body.querySelector("[data-edit-thumbnail-btn]")).toBeTruthy();
  });

  it("a colour entered in the picker is saved as hex and reloads", async () => {
    mockScenes = [makeScene(1, "Forest", false, "2024-01-01")];
    const { container } = render(ScenesDashboard);
    await openAppearance(container);
    const hex = await waitFor(() => {
      const el = document.body.querySelector('[aria-label="Hex colour"]') as HTMLInputElement;
      if (!el) throw new Error("hex field not found");
      return el;
    });
    await fireEvent.input(hex, { target: { value: "3a7fa8" } });
    await fireEvent.keyDown(hex, { key: "Enter" });
    await waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith(
        "update_scene_thumbnail",
        expect.objectContaining({ id: 1, thumbnailColor: "#3a7fa8" }),
      );
      expect(scenes.load).toHaveBeenCalled();
    });
  });

  it("Default clears thumbnail_color", async () => {
    mockScenes = [{ ...makeScene(1, "Forest", false, "2024-01-01"), thumbnail_color: "#3a7fa8" }];
    const { container } = render(ScenesDashboard);
    await openAppearance(container);
    const defaultBtn = await waitFor(() => {
      const btn = document.body.querySelector("[data-color-default]") as HTMLElement | null;
      if (!btn) throw new Error("Default button not found");
      return btn;
    });
    await fireEvent.click(defaultBtn);
    await waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith(
        "update_scene_thumbnail",
        expect.objectContaining({ id: 1, thumbnailColor: null }),
      );
    });
  });
});

describe("ScenesDashboard — appearance icon", () => {
  it("marks the icon the scene has", async () => {
    mockScenes = [makeScene(1, "Forest", false, "2024-01-01")];
    const { container } = render(ScenesDashboard);
    await openAppearance(container);
    expect(document.body.querySelector('[data-icon-btn="default"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("selecting an icon calls update_scene_thumbnail and reloads", async () => {
    mockScenes = [makeScene(1, "Forest", false, "2024-01-01")];
    const { container } = render(ScenesDashboard);
    await openAppearance(container);
    const iconBtn = document.body.querySelector(
      '[data-icon-btn]:not([data-icon-btn="default"])',
    ) as HTMLElement;
    await fireEvent.click(iconBtn);
    await waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith(
        "update_scene_thumbnail",
        expect.objectContaining({ id: 1 }),
      );
      expect(scenes.load).toHaveBeenCalled();
    });
  });

  it("Default clears thumbnail_icon", async () => {
    mockScenes = [{ ...makeScene(1, "Forest", false, "2024-01-01"), thumbnail_icon: "Skull" }];
    const { container } = render(ScenesDashboard);
    await openAppearance(container);
    await fireEvent.click(document.body.querySelector('[data-icon-btn="default"]')!);
    await waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith(
        "update_scene_thumbnail",
        expect.objectContaining({ id: 1, thumbnailIcon: null }),
      );
    });
  });
});

describe("ScenesDashboard — appearance picture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Choose picture opens file picker filtered to image types", async () => {
    mockScenes = [makeScene(1, "Forest", false, "2024-01-01")];
    vi.mocked(open).mockResolvedValueOnce(null);
    const { container } = render(ScenesDashboard);
    await openAppearance(container);
    await fireEvent.click(document.body.querySelector("[data-edit-thumbnail-btn]")!);
    await waitFor(() => {
      expect(vi.mocked(open)).toHaveBeenCalledWith(
        expect.objectContaining({
          filters: expect.arrayContaining([
            expect.objectContaining({
              extensions: expect.arrayContaining(["jpg", "png", "webp"]),
            }),
          ]),
        }),
      );
    });
  });

  it("a chosen picture is copied in and saved", async () => {
    mockScenes = [makeScene(1, "Forest", false, "2024-01-01")];
    vi.mocked(open).mockResolvedValueOnce("/path/to/image.jpg");
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "copy_thumbnail_file") return ".grimoire/thumbnails/image.jpg";
      return null;
    });
    const { container } = render(ScenesDashboard);
    await openAppearance(container);
    await fireEvent.click(document.body.querySelector("[data-edit-thumbnail-btn]")!);
    await waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("copy_thumbnail_file", {
        absolutePath: "/path/to/image.jpg",
      });
      expect(vi.mocked(invoke)).toHaveBeenCalledWith(
        "update_scene_thumbnail",
        expect.objectContaining({
          id: 1,
          thumbnailPath: ".grimoire/thumbnails/image.jpg",
        }),
      );
      expect(scenes.load).toHaveBeenCalled();
    });
  });

  it("offers Remove only when there is a picture, and it clears it", async () => {
    mockScenes = [makeScene(1, "Forest", false, "2024-01-01")];
    const first = render(ScenesDashboard);
    await openAppearance(first.container);
    expect(document.body.querySelector("[data-remove-thumbnail-btn]")).toBeNull();
    cleanup();

    mockScenes = [
      { ...makeScene(1, "Forest", false, "2024-01-01"), thumbnail_path: ".grimoire/thumbnails/img.jpg" },
    ];
    const { container } = render(ScenesDashboard);
    await openAppearance(container);
    await fireEvent.click(document.body.querySelector("[data-remove-thumbnail-btn]")!);
    await waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith(
        "update_scene_thumbnail",
        expect.objectContaining({ id: 1, thumbnailPath: null }),
      );
      expect(scenes.load).toHaveBeenCalled();
    });
  });

  it("card with thumbnail_path resolves absolute path via get_audio_absolute_path", async () => {
    mockScenes = [
      {
        ...makeScene(1, "Scene", false, "2024-01-01"),
        thumbnail_path: ".grimoire/thumbnails/img.jpg",
      },
    ];
    render(ScenesDashboard);
    await waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("get_audio_absolute_path", {
        relativePath: ".grimoire/thumbnails/img.jpg",
      });
    });
  });
});

// ── Thumbnail icon rendering ──────────────────────────────────────────────────

describe("ScenesDashboard — thumbnail icon", () => {
  // The music note, as on every other surface that draws a scene (DEFAULT_SCENE_ICON).
  it("shows the default music note when thumbnail_icon is null", () => {
    mockScenes = [makeScene(1, "Scene", false, "2024-01-01")];
    const { container } = render(ScenesDashboard);
    const card = container.querySelector("[data-scene-card]");
    expect(card?.querySelector("[data-thumbnail-icon='Music2']")).toBeTruthy();
  });

  it("shows custom icon when thumbnail_icon is set", () => {
    mockScenes = [
      {
        ...makeScene(1, "Scene", false, "2024-01-01"),
        thumbnail_icon: "Skull",
      },
    ];
    const { container } = render(ScenesDashboard);
    const card = container.querySelector("[data-scene-card]");
    expect(card?.querySelector("[data-thumbnail-icon='Skull']")).toBeTruthy();
  });
});
