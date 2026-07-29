// Characterisation tests for the Scene note block (#170).
//
// Scene is about to be moved onto the shared node-view connector, have its
// markdown handling replaced, and have its on-disk format changed (#169). These
// tests pin the behaviour that must survive those three rewrites. Nothing here
// asserts a *new* expectation — where current behaviour is wrong it is recorded
// as such (see "write-back merges attributes" below) rather than corrected.
//
// Deliberately NOT covered, per #155: the `<scene-block>` HTML serialization and
// the persisted expanded/collapsed flag. Both are being deleted, so freezing
// them would cost twice — once to write, once to delete.
import { render, waitFor, fireEvent, cleanup } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import SceneBlockView from "../lib/components/editor/SceneBlockView.svelte";
import { SceneBlock } from "../lib/editor/scene-block.svelte";
import type { Scene, SceneSlot } from "../lib/types/ledger";

let mockScenes: Scene[] = [];
let mockSlots: SceneSlot[] = [];

// Mirrors the real scenes store's read surface. Slot reads resolve from
// mockSlots so a test can put a scene's tracks on screen without a ledger.
vi.mock("../lib/stores/scenes.svelte", () => ({
  scenes: {
    get scenes() {
      return mockScenes;
    },
    getSlots: vi.fn(() => Promise.resolve(mockSlots)),
    invalidateSlots: vi.fn(),
    createScene: vi.fn(),
  },
}));

vi.mock("../lib/stores/tabs.svelte", () => ({
  tabs: { openTab: vi.fn() },
}));

// The engine reports nothing playing throughout: playback state is not what
// these tests pin, and a scene block renders the same details either way.
vi.mock("../lib/stores/audio-engine.svelte", () => ({
  // Keep in sync with the named export in audio-engine.svelte.ts
  isPlaylistSlot: (slot: { source_id: string }) =>
    slot.source_id.startsWith("spotify:playlist:"),
  audioEngine: {
    playScene: vi.fn(),
    pauseScene: vi.fn(),
    resumeScene: vi.fn(),
    stopAll: vi.fn(),
    pauseSlot: vi.fn().mockResolvedValue(undefined),
    resumeSlot: vi.fn().mockResolvedValue(undefined),
    setMasterVolume: vi.fn(),
    setSlotVolume: vi.fn(),
    toggleMasterMute: vi.fn(),
    skipNext: vi.fn(),
    skipPrev: vi.fn(),
    isSceneActive: vi.fn(() => false),
    isScenePlaying: vi.fn(() => false),
    isSlotPlaying: vi.fn(() => false),
    slotVolume: vi.fn(() => undefined),
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
    get isScenePaused() {
      return false;
    },
    get isMasterMuted() {
      return false;
    },
  },
}));

function makeScene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 1,
    name: "Dark Forest",
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
    id: 11,
    scene_id: 1,
    source: "local",
    source_id: "audio/wind.mp3",
    label: "Wind",
    volume: 0.8,
    loop: true,
    slot_order: 0,
    shuffle: false,
    ...overrides,
  };
}

// `expanded` is a transitional prop — #155 deletes it. It is set in exactly one
// place so that deletion is a one-line change, and no test asserts on it.
function renderView(props: { sceneId: number | null }) {
  return render(SceneBlockView, {
    props: { ...props, expanded: true, onUpdate: vi.fn() },
  });
}

// A node view mounted by mountNodeView(), torn down after each test. Node views
// are mounted imperatively rather than by @testing-library, so cleanup() does
// not know about them.
let mounted: ReturnType<typeof mountNodeView> | null = null;
let outsideEl: HTMLElement | null = null;

beforeEach(() => {
  mockScenes = [];
  mockSlots = [];
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  mounted?.view.destroy();
  mounted?.view.dom.remove();
  mounted = null;
  outsideEl?.remove();
  outsideEl = null;
});

// ─── Reference resolution ─────────────────────────────────────────────────────
//
// A Scene block holds a reference to a scene, not the scene itself. The two
// states that matter are "the reference resolves" and "it does not" — a scene
// deleted out from under a note must still render something sane.

describe("scene reference resolution", () => {
  it("a reference that resolves renders its scene's details", async () => {
    mockScenes = [
      makeScene({
        id: 4,
        name: "Dark Forest",
        thumbnail_color: "rgba(100,200,100,0.4)",
      }),
    ];
    mockSlots = [makeSlot({ scene_id: 4, label: "Wind" })];
    const { container, getByLabelText } = renderView({ sceneId: 4 });

    // The scene's name, and a control that opens that scene by name.
    expect(container.textContent).toContain("Dark Forest");
    expect(getByLabelText("Open Dark Forest in Scenes")).toBeTruthy();

    // And the scene's tracks, fetched for the id the block references.
    await waitFor(() => expect(container.textContent).toContain("Wind"));

    // Its identity chip takes the scene's own saved colour.
    const chip = container.querySelector(
      '[style*="background-color"]',
    ) as HTMLElement;
    expect(chip?.getAttribute("style")).toMatch(/100.*200.*100/);
  });

  it("a reference that does not resolve renders its not-found state", () => {
    mockScenes = [makeScene({ id: 4 })];
    const { container, getByLabelText } = renderView({ sceneId: 99 });

    expect(container.textContent).toContain("Unknown scene");
    expect(getByLabelText("Open scene in Scenes")).toBeTruthy();

    // Unresolved chip falls back to the accent theme rather than the scene's
    // own colour, so a dangling reference tracks the current accent.
    const chip = container.querySelector(
      '[style*="background-color"]',
    ) as HTMLElement;
    expect(chip?.getAttribute("style")).toContain("--primary-subtle");
  });

  it("no scene bound at all renders the picker, not the not-found state", () => {
    mockScenes = [makeScene({ id: 4, name: "Dark Forest" })];
    const { container, getByPlaceholderText } = renderView({ sceneId: null });

    expect(getByPlaceholderText("Search scenes…")).toBeTruthy();
    expect(container.textContent).not.toContain("Unknown scene");
  });
});

// ─── Slot volume persistence ──────────────────────────────────────────────────

describe("slot volume", () => {
  it("adjusting a slot's volume persists to the database", async () => {
    mockScenes = [makeScene({ id: 1 })];
    mockSlots = [
      makeSlot({
        id: 11,
        label: "Wind",
        volume: 0.8,
        loop: true,
        slot_order: 2,
      }),
    ];
    const { getByLabelText } = renderView({ sceneId: 1 });

    const slider = await waitFor(() => getByLabelText("Wind volume"));
    await fireEvent.change(slider, { target: { value: "0.35" } });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "update_scene_slot",
        expect.objectContaining({
          id: 11,
          label: "Wind",
          volume: 0.35,
          loop: true,
          slotOrder: 2,
          shuffle: false,
        }),
      );
    });
  });

  it("dragging tracks live on screen without writing every intermediate value", async () => {
    // The fill bar follows the drag (`input`), but only the settled value
    // (`change`) reaches the ledger — otherwise one drag is fifty writes.
    mockScenes = [makeScene({ id: 1 })];
    mockSlots = [makeSlot({ id: 11, label: "Wind", volume: 0.8 })];
    const { getByLabelText, container } = renderView({ sceneId: 1 });

    const slider = await waitFor(() => getByLabelText("Wind volume"));
    await fireEvent.input(slider, { target: { value: "0.5" } });
    await fireEvent.input(slider, { target: { value: "0.6" } });

    // The fill bar sits alongside the slider and is sized from the live value.
    const fill = container.querySelector('[style*="width: 60%"]');
    expect(fill).toBeTruthy();

    expect(invoke).not.toHaveBeenCalledWith(
      "update_scene_slot",
      expect.anything(),
    );
  });
});

// ─── Node view: ProseMirror event handling ────────────────────────────────────
//
// The riskiest thing the connector swap drags along. Everything below is view
// behaviour with no obvious reason on its face — exactly what a later reader
// tidies away.

/** One `tr.setNodeMarkup` the node view asked for. */
interface RecordedAttrWrite {
  pos: number;
  attrs: Record<string, unknown>;
}

interface TestNodeView {
  dom: HTMLElement;
  stopEvent: (event: Event) => boolean;
  destroy: () => void;
}

/** The document position mountNodeView() reports the node sits at. */
const NODE_POS = 7;

// Mounts the real node view against a fake editor, recording every attribute
// write instead of applying it. Attrs are open-shaped on purpose: one test puts
// a third attribute on the node to characterise what happens to it.
function mountNodeView(attrs: Record<string, unknown> = { sceneId: 1 }) {
  const writes: RecordedAttrWrite[] = [];
  const node = { type: { name: "sceneBlock" }, attrs };
  const editor = {
    commands: {
      command(fn: (props: { tr: unknown }) => boolean) {
        const tr = {
          setNodeMarkup(
            pos: number,
            _type: unknown,
            newAttrs: Record<string, unknown>,
          ) {
            writes.push({ pos, attrs: newAttrs });
            return tr;
          },
        };
        return fn({ tr });
      },
    },
  };

  const addNodeView = (
    SceneBlock.config as unknown as {
      addNodeView: () => (props: {
        node: unknown;
        getPos: () => number;
        editor: unknown;
      }) => TestNodeView;
    }
  ).addNodeView;

  const view = addNodeView()({ node, getPos: () => NODE_POS, editor });
  document.body.appendChild(view.dom);
  return { view, writes };
}

/** A node view showing a resolvable scene, plus an element outside it. */
function mountWithOutsideElement(attrs?: Record<string, unknown>) {
  mockScenes = [makeScene({ id: 1 })];
  mounted = mountNodeView(attrs);
  outsideEl = document.body.appendChild(document.createElement("div"));
  return {
    ...mounted,
    outsideEvent: { target: outsideEl } as unknown as Event,
  };
}

describe("SceneBlock node view — slider drag", () => {
  it("a drag that continues after the pointer leaves the node view keeps tracking", () => {
    const { view, outsideEvent } = mountWithOutsideElement();

    const slider = view.dom.querySelector(
      'input[type="range"]',
    ) as HTMLInputElement;
    expect(slider).toBeTruthy();

    // A pointer event landing outside the node view is ProseMirror's business.
    expect(view.stopEvent(outsideEvent)).toBe(false);

    // Once a slider drag is underway it stays ours, even when the pointer
    // strays outside — dom.contains(target) alone would hand the drag back to
    // ProseMirror's document-level mousemove handler, which kills it.
    slider.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(view.stopEvent(outsideEvent)).toBe(true);

    // Releasing anywhere ends the drag and returns those events.
    window.dispatchEvent(new MouseEvent("mouseup"));
    expect(view.stopEvent(outsideEvent)).toBe(false);
  });

  it("mousedown on something that is not a slider starts no drag", () => {
    const { view, outsideEvent } = mountWithOutsideElement();

    const button = view.dom.querySelector("button") as HTMLElement;
    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(view.stopEvent(outsideEvent)).toBe(false);
  });

  it("events originating inside the node view are never ProseMirror's", () => {
    const { view } = mountWithOutsideElement();

    const inside = view.dom.querySelector("button") as HTMLElement;
    expect(view.stopEvent({ target: inside } as unknown as Event)).toBe(true);
  });
});

describe("SceneBlock node view — attribute write-back", () => {
  it("writes the changed attribute back at the node's position", async () => {
    mockScenes = [makeScene({ id: 1 })];
    mounted = mountNodeView({ sceneId: 1 });
    const { view, writes } = mounted;

    const change = view.dom.querySelector(
      '[aria-label="Change scene"]',
    ) as HTMLElement;
    await fireEvent.click(change);

    expect(writes).toHaveLength(1);
    expect(writes[0].pos).toBe(7);
    expect(writes[0].attrs.sceneId).toBe(null);
  });

  // KNOWN FAILING — recorded, not papered over (#170).
  //
  // The write-back replaces the whole attribute set with the two keys it knows
  // about, so any other attribute on the node is dropped. Scene has no third
  // attribute today, which is the only reason this is invisible. The shared
  // node-view connector fixes it by construction (it merges rather than
  // replaces); when it lands, drop the `.fails` and this test goes green.
  it.fails(
    "write-back merges attributes, leaving the others intact",
    async () => {
      mockScenes = [makeScene({ id: 1 })];
      mounted = mountNodeView({ sceneId: 1, marker: "keep me" });
      const { view, writes } = mounted;

      const change = view.dom.querySelector(
        '[aria-label="Change scene"]',
      ) as HTMLElement;
      await fireEvent.click(change);

      expect(writes[0].attrs.marker).toBe("keep me");
    },
  );
});
