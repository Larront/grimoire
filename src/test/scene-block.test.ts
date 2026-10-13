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
// them would cost twice — once to write, once to delete. Both have since gone
// (#185), and the fence that replaced the tag is pinned at the bottom of this file.
import { render, waitFor, fireEvent, cleanup } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { audioEngine } from "../lib/stores/audio-engine.svelte";
import { scenes } from "../lib/stores/scenes.svelte";
import SceneBlockView from "../lib/components/editor/SceneBlockView.svelte";
import { SceneBlock, parseSceneBody, serializeSceneRef } from "../lib/editor/scene-block.svelte";
import type { Scene, SceneSlot } from "../lib/types/ledger";

let mockScenes: Scene[] = [];
let mockSlots: SceneSlot[] = [];
// Playback, for the cases that pin it: which scene the engine holds, and whether it is
// paused. Nothing plays by default.
let mockActiveId: number | null = null;
let mockPaused = false;

// Mirrors the real scenes store's read surface. Slot reads resolve from
// mockSlots so a test can put a scene's tracks on screen without a ledger.
vi.mock("../lib/stores/scenes.svelte", () => ({
  scenes: {
    get scenes() {
      return mockScenes;
    },
    getSlots: vi.fn(() => Promise.resolve(mockSlots)),
    invalidateSlots: vi.fn(),
    patchSlot: vi.fn(() => Promise.resolve(mockSlots)),
    createScene: vi.fn(),
  },
}));

vi.mock("../lib/stores/tabs.svelte", () => ({
  tabs: { openTab: vi.fn(), openTabOpposite: vi.fn() },
}));

// The engine reports nothing playing unless a case sets mockActiveId / mockPaused.
vi.mock("../lib/stores/audio-engine.svelte", () => ({
  // Keep in sync with the named export in audio-engine.svelte.ts
  isPlaylistSlot: (slot: { source_id: string }) => slot.source_id.startsWith("spotify:playlist:"),
  audioEngine: {
    playScene: vi.fn(),
    previewSlot: vi.fn().mockResolvedValue(undefined),
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
    isSceneActive: vi.fn((id: number) => id === mockActiveId),
    sceneState: vi.fn((id: number | null) =>
      id !== null && id === mockActiveId ? (mockPaused ? "paused" : "playing") : "idle",
    ),
    isSlotMuted: vi.fn(() => false),
    toggleSlotMute: vi.fn(),
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
      return mockPaused;
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

function renderView(props: { sceneId: number | null }) {
  return render(SceneBlockView, {
    // The cached name is part of the reference the view is handed, and nothing on screen
    // comes from it — so every case here passes the empty one.
    props: { sceneName: "", ...props, onUpdate: vi.fn() },
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
  mockActiveId = null;
  mockPaused = false;
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

    // The scene's name, and a control that opens that scene, by name, beside the note.
    expect(container.textContent).toContain("Dark Forest");
    expect(getByLabelText("Open Dark Forest beside this note")).toBeTruthy();

    // And the scene's tracks, fetched for the id the block references.
    await waitFor(() => expect(container.textContent).toContain("Wind"));

    // Its identity chip takes the scene's own saved colour.
    const chip = container.querySelector('[style*="background-color"]') as HTMLElement;
    expect(chip?.getAttribute("style")).toMatch(/100.*200.*100/);
  });

  it("a reference that does not resolve renders its not-found state", () => {
    // Its own state, not a player: every control on it used to do nothing.
    mockScenes = [makeScene({ id: 4 })];
    const { container, getByText, queryByLabelText } = renderView({ sceneId: 99 });

    expect(container.textContent).toContain("This scene no longer exists.");
    expect(getByText("Choose a scene")).toBeTruthy();
    expect(queryByLabelText(/^Play /)).toBeNull();
    expect(queryByLabelText("Expand mixer")).toBeNull();
  });

  it("a stale cached name is not treated as authoritative", () => {
    // The name in the fence is a copy the database owns (#185), and a stale copy
    // *lies* rather than failing. So the view never draws it: a reference whose id
    // resolves to nothing renders the not-found state even when the file remembers
    // a name, and one that resolves draws the scene's live name over the cached one.
    mockScenes = [makeScene({ id: 4, name: "Renamed Since" })];

    const gone = render(SceneBlockView, {
      props: { sceneId: 99, sceneName: "Dark Forest", onUpdate: vi.fn() },
    });
    expect(gone.container.textContent).toContain("This scene no longer exists.");
    expect(gone.container.textContent).not.toContain("Dark Forest");
    cleanup();

    const live = render(SceneBlockView, {
      props: { sceneId: 4, sceneName: "Dark Forest", onUpdate: vi.fn() },
    });
    expect(live.container.textContent).toContain("Renamed Since");
    expect(live.container.textContent).not.toContain("Dark Forest");
  });

  it("no scene bound at all renders the picker, not the not-found state", () => {
    mockScenes = [makeScene({ id: 4, name: "Dark Forest" })];
    const { container, getByPlaceholderText } = renderView({ sceneId: null });

    expect(getByPlaceholderText("Search scenes…")).toBeTruthy();
    expect(container.textContent).not.toContain("no longer exists");
  });

  it("draws no removal control of its own, bound or unbound", () => {
    // Both states used to carry a trash can, because a sealed block holds every click so
    // ProseMirror never selected the node for Backspace to take (#175 review) — and the
    // picker needed it as much as the mixer did, since every other control in the picker
    // *binds* a scene and a `/scene` inserted by accident was stranded. The gutter
    // handle's menu deletes any block now (#194), so neither state draws one.
    mockScenes = [makeScene({ id: 4, name: "Dark Forest" })];

    const unbound = renderView({ sceneId: null });
    expect(unbound.queryByLabelText("Remove scene block")).toBeNull();
    cleanup();

    const bound = renderView({ sceneId: 4 });
    expect(bound.queryByLabelText("Remove scene block")).toBeNull();
  });

  it("still offers changing the scene, the one gesture the block kept", () => {
    // Changing and removing used to sit side by side. Removal lives on the gutter
    // handle's menu now (#194); changing is the block's own gesture, and it touches
    // nothing in the Scenes pane.
    mockScenes = [makeScene({ id: 4, name: "Dark Forest" })];
    const { getByLabelText } = renderView({ sceneId: 4 });

    expect(getByLabelText("Change scene")).toBeTruthy();
  });
});

// ─── Slot volume persistence ──────────────────────────────────────────────────

describe("slot volume", () => {
  it("adjusting a slot's volume saves it through the scenes store", async () => {
    // Through the store, not straight to the database, so every surface showing the
    // track hears of the new level.
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
      expect(scenes.patchSlot).toHaveBeenCalledWith(
        expect.objectContaining({ id: 11, label: "Wind" }),
        { volume: 0.35 },
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

    expect(scenes.patchSlot).not.toHaveBeenCalled();
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
          // The connector closes the history group before writing (ADR-0016 §6), which
          // is a `setMeta`. Recording nothing is enough here — the rule itself is
          // pinned in node-view-connector.test.ts; this stub only has to be a
          // transaction the connector can talk to.
          setMeta() {
            return tr;
          },
          setNodeMarkup(pos: number, _type: unknown, newAttrs: Record<string, unknown>) {
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

/** A node view showing a resolvable scene with one track, plus an element outside it. */
function mountWithOutsideElement(attrs?: Record<string, unknown>) {
  mockScenes = [makeScene({ id: 1 })];
  mockSlots = [makeSlot({ id: 11, scene_id: 1, label: "Wind" })];
  mounted = mountNodeView(attrs);
  outsideEl = document.body.appendChild(document.createElement("div"));
  return {
    ...mounted,
    outsideEvent: { target: outsideEl } as unknown as Event,
  };
}

describe("SceneBlock node view — slider drag", () => {
  it("a drag that continues after the pointer leaves the node view keeps tracking", async () => {
    const { view, outsideEvent } = mountWithOutsideElement();

    // A track's volume slider in the mixer (the strip no longer carries the master).
    const slider = await waitFor(() => {
      const el = view.dom.querySelector('input[type="range"]') as HTMLInputElement | null;
      if (!el) throw new Error("no slider yet");
      return el;
    });

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
  // Changing the scene opens the shared picker (in a popover, so in document.body) and
  // keeps the binding until another scene is chosen.
  async function changeTo(view: TestNodeView, name: string, writes?: RecordedAttrWrite[]) {
    await fireEvent.click(view.dom.querySelector('[aria-label="Change scene"]') as HTMLElement);
    // Opening the picker changes nothing; only a choice does.
    if (writes) expect(writes).toHaveLength(0);
    const option = await waitFor(() => {
      const el = [...document.body.querySelectorAll('[role="option"]')].find((o) =>
        o.textContent?.includes(name),
      ) as HTMLElement | undefined;
      if (!el) throw new Error("no option " + name);
      return el;
    });
    await fireEvent.click(option);
  }

  it("writes the changed attribute back at the node's position", async () => {
    mockScenes = [makeScene({ id: 1 }), makeScene({ id: 2, name: "Market" })];
    mounted = mountNodeView({ sceneId: 1 });
    const { view, writes } = mounted;

    await changeTo(view, "Market", writes);

    expect(writes).toHaveLength(1);
    expect(writes[0].pos).toBe(7);
    expect(writes[0].attrs.sceneId).toBe(2);
  });

  it("binding a scene writes its name beside the id, so the fence stays legible", async () => {
    // The name in the file is a copy the database owns (#185). It is written from
    // the *store's* name at the moment of binding — never composed from the file —
    // which is what keeps the copy a cache rather than a second source of truth.
    mockScenes = [makeScene({ id: 4, name: "Dark Forest" })];
    mounted = mountNodeView({ sceneId: null, sceneName: "" });
    const { view, writes } = mounted;

    const row = view.dom.querySelector('[role="option"]') as HTMLElement;
    await fireEvent.click(row);

    expect(writes[0].attrs.sceneId).toBe(4);
    expect(writes[0].attrs.sceneName).toBe("Dark Forest");
  });

  it("unbinding clears the remembered name with the id", async () => {
    // A deleted scene's "Choose a scene" is where a block unbinds now.
    mockScenes = [];
    mounted = mountNodeView({ sceneId: 1, sceneName: "Dark Forest" });
    const { view, writes } = mounted;

    const choose = [...view.dom.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Choose a scene",
    ) as HTMLElement;
    await fireEvent.click(choose);

    expect(writes[0].attrs.sceneId).toBe(null);
    expect(writes[0].attrs.sceneName).toBe("");
  });

  it("collapsing the mixer writes nothing to the document", async () => {
    // `expanded` used to be an attribute in the note, so collapsing a mixer was an
    // edit to the GM's file that synced to every other machine (#185).
    mockScenes = [makeScene({ id: 1 })];
    mounted = mountNodeView({ sceneId: 1, sceneName: "Dark Forest" });
    const { view, writes } = mounted;

    await fireEvent.click(view.dom.querySelector('[aria-label="Expand mixer"]') as HTMLElement);

    expect(view.dom.querySelector('[aria-label="Collapse mixer"]')).toBeTruthy();
    expect(writes).toHaveLength(0);
  });

  // Recorded as KNOWN FAILING by #170: the old write-back replaced the whole
  // attribute set with the two keys it knew about, dropping any other attribute
  // on the node. Green since #172 — the shared node-view connector merges rather
  // than replaces, so the bug is gone by construction rather than by patch.
  it("write-back merges attributes, leaving the others intact", async () => {
    mockScenes = [makeScene({ id: 1 }), makeScene({ id: 2, name: "Market" })];
    mounted = mountNodeView({ sceneId: 1, marker: "keep me" });
    const { view, writes } = mounted;

    await changeTo(view, "Market");

    expect(writes[0].attrs.marker).toBe("keep me");
  });
});

// ─── The fence (#185) ─────────────────────────────────────────────────────────
//
// Text in, text out: the format on its own, with no editor and no DOM. The claim
// itself — the reader handing a ```scene token to this parser at any nesting depth
// — is block-markdown.test.ts's seam.

describe("the scene fence", () => {
  const roundTrip = (md: string) =>
    serializeSceneRef(parseSceneBody(md.split("\n").slice(1, -1).join("\n")));

  it("reads the name and the id", () => {
    expect(parseSceneBody("# Boss Battle\nId: 1")).toEqual({
      sceneId: 1,
      sceneName: "Boss Battle",
    });
  });

  it("writes the name above the id", () => {
    expect(serializeSceneRef({ sceneId: 1, sceneName: "Boss Battle" })).toBe(
      "```scene\n# Boss Battle\nId: 1\n```",
    );
  });

  it("writes a reference bound to nothing as an empty fence", () => {
    // A fresh `/scene` the GM has not bound yet: `Id:` with no id after it would
    // read back as no id anyway, so it is not written.
    expect(serializeSceneRef({ sceneId: null, sceneName: "" })).toBe("```scene\n```");
  });

  it.each([
    ["a name and an id", "```scene\n# Boss Battle\nId: 1\n```"],
    ["an id alone", "```scene\nId: 1\n```"],
    ["a name alone", "```scene\n# Boss Battle\n```"],
    ["neither", "```scene\n```"],
    ["a name holding a colon", "```scene\n# Boss Battle: Act II\nId: 12\n```"],
    ["a name holding a wikilink", "```scene\n# The [[Ember Keep]] falls\nId: 3\n```"],
    ["a name holding a hash", "```scene\n# Scene #4\nId: 4\n```"],
  ])("round-trips %s byte for byte", (_what, md) => {
    expect(roundTrip(md)).toBe(md);
  });

  it("reads a `#` line with no name after it as no name", () => {
    // Not a name line at all: an empty name has nothing to remember, so writing
    // one back would make the pair stop being inverse. Unlike an Infobox there is
    // no first row here for a bare `#` to shield.
    expect(parseSceneBody("#\nId: 9")).toEqual({ sceneId: 9, sceneName: "" });
    expect(roundTrip("```scene\n#\nId: 9\n```")).toBe("```scene\nId: 9\n```");
  });

  it("reads a hand-edited fence whose lines are the other way round", () => {
    expect(parseSceneBody("Id: 1\n# Boss Battle")).toEqual({
      sceneId: 1,
      sceneName: "Boss Battle",
    });
  });

  it("takes the first of each line a hand-edit gave twice", () => {
    // A reference names one scene, so the second of either line is a line the format
    // has no reading for. First rather than last because the scene rename that keeps
    // the cached name true rewrites the first one (`src-tauri/src/scene_fence.rs`) —
    // the two must agree, or a rename updates a line the editor does not read.
    expect(parseSceneBody("# Boss Battle\n# Second\nId: 7\nId: 9")).toEqual({
      sceneId: 7,
      sceneName: "Boss Battle",
    });
  });

  it("reads a hand-edited fence with blank lines in it", () => {
    expect(parseSceneBody("\n# Boss Battle\n\nId: 1\n")).toEqual({
      sceneId: 1,
      sceneName: "Boss Battle",
    });
  });

  it.each(["Id:", "Id: ", "Id: abc", "Id: 1.5", "Id: -1", "Id: 1 2"])(
    "reads %o as no id rather than guessing at one",
    (line) => {
      expect(parseSceneBody(`# Boss Battle\n${line}`).sceneId).toBe(null);
    },
  );

  it("keeps a name the database hands it on one line", () => {
    // A scene name cannot hold a newline through Grimoire's own UI, but the copy
    // written here comes from the database — and a two-line name would write a
    // second fence line that reads back as something else.
    expect(serializeSceneRef({ sceneId: 1, sceneName: "Boss\nBattle" })).toBe(
      "```scene\n# Boss Battle\nId: 1\n```",
    );
  });
});

describe("playing from the note", () => {
  it("a paused scene's button resumes it, rather than pausing again", async () => {
    mockScenes = [makeScene({ id: 4, name: "Dark Forest" })];
    mockActiveId = 4;
    mockPaused = true;
    const { getByLabelText } = renderView({ sceneId: 4 });

    await fireEvent.click(getByLabelText("Resume Dark Forest"));
    expect(audioEngine.resumeScene).toHaveBeenCalled();
    expect(audioEngine.pauseScene).not.toHaveBeenCalled();
  });

  it("another scene's pause doesn't make this block offer Resume", () => {
    mockScenes = [makeScene({ id: 4, name: "Dark Forest" }), makeScene({ id: 5, name: "Market" })];
    mockActiveId = 5;
    mockPaused = true;
    const { getByLabelText } = renderView({ sceneId: 4 });
    expect(getByLabelText("Play Dark Forest")).toBeTruthy();
  });

  it("a track's play previews it on its own while the scene is stopped", async () => {
    mockScenes = [makeScene({ id: 4, name: "Dark Forest" })];
    mockSlots = [makeSlot({ id: 11, scene_id: 4, label: "Wind" })];
    const { findByLabelText } = renderView({ sceneId: 4 });

    await fireEvent.click(await findByLabelText("Play Wind on its own"));
    expect(audioEngine.previewSlot).toHaveBeenCalledWith(4, 11);
    expect(audioEngine.resumeSlot).not.toHaveBeenCalled();
  });

  it("a collapsed mixer is out of the Tab order", async () => {
    mockScenes = [makeScene({ id: 4, name: "Dark Forest" })];
    mockSlots = [makeSlot({ id: 11, scene_id: 4, label: "Wind" })];
    const { findByLabelText, getByLabelText } = renderView({ sceneId: 4 });

    // jsdom does not reflect `inert` to an attribute, so read the property up the tree.
    const insideInert = (el: Element | null): boolean =>
      !!el && ((el as HTMLElement & { inert?: boolean }).inert === true || insideInert(el.parentElement));
    const trackPlay = await findByLabelText("Play Wind on its own");
    expect(insideInert(trackPlay)).toBe(true);
    await fireEvent.click(getByLabelText("Expand mixer"));
    expect(insideInert(trackPlay)).toBe(false);
  });
});


describe("SceneBlock node view — a slider is not a handle", () => {
  it("pressing a volume slider stops the block being draggable until release", async () => {
    // ProseMirror marks the block draggable for its grip; in Chromium a range input inside
    // a draggable element drags the element, so pressing a slider picked up the block.
    const { view } = mountWithOutsideElement();
    view.dom.draggable = true;
    const slider = await waitFor(() => {
      const el = view.dom.querySelector('input[type="range"]') as HTMLInputElement | null;
      if (!el) throw new Error("no slider yet");
      return el;
    });

    slider.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(view.dom.draggable).toBe(false);

    window.dispatchEvent(new Event("pointerup"));
    expect(view.dom.draggable).toBe(true);
  });

  it("pressing anything else leaves the block draggable", () => {
    const { view } = mountWithOutsideElement();
    view.dom.draggable = true;
    (view.dom.querySelector("button") as HTMLElement).dispatchEvent(
      new Event("pointerdown", { bubbles: true }),
    );
    expect(view.dom.draggable).toBe(true);
  });
});
