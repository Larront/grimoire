// Tests for the shared node-view connector (ADR-0016 §4, #172) — the one
// implementation of the ProseMirror ⇄ Svelte plumbing every Note Block needs.
//
// The seam under test is the connector's own interface: the spec a block hands
// it, and the ProseMirror NodeView it hands back. Both fixture views stand in
// for real blocks, so the connector's two modes are exercised by a consumer
// rather than described — the container mode in particular, whose first real
// consumer (Callout) does not exist yet.
import { fireEvent } from "@testing-library/svelte";
import { describe, it, expect, afterEach } from "vitest";
import { flushSync } from "svelte";
import { createBlockNodeView } from "$lib/editor/node-view-connector";
import SealedBlockFixture from "./fixtures/SealedBlockFixture.svelte";
import ContainerBlockFixture from "./fixtures/ContainerBlockFixture.svelte";

// ─── Harness ──────────────────────────────────────────────────────────────────

/** One `tr.setNodeMarkup` the node view asked for. */
interface RecordedAttrWrite {
  pos: number;
  attrs: Record<string, unknown>;
}

/** One `tr.setMeta` the node view asked for, and whether it preceded the write. */
interface RecordedMeta {
  value: unknown;
  beforeWrite: boolean;
}

/** The document position the harness reports the node sits at. */
const NODE_POS = 3;

/** One `tr.delete` the node view asked for. */
interface RecordedDelete {
  from: number;
  to: number;
  /** Whether a meta (the history close) preceded it, as it must. */
  afterMeta: boolean;
}

interface MountedNodeView {
  view: {
    dom: HTMLElement;
    contentDOM?: HTMLElement;
    stopEvent?: (event: Event) => boolean;
    ignoreMutation?: (mutation: unknown) => boolean;
    update?: (node: unknown) => boolean;
    selectNode?: () => void;
    deselectNode?: () => void;
    destroy?: () => void;
  };
  writes: RecordedAttrWrite[];
  metas: RecordedMeta[];
  deletes: RecordedDelete[];
  /** How many times the node view asked the editor for focus. */
  focuses: () => number;
  nodeType: { name: string };
}

let mounted: MountedNodeView | null = null;
let outsideEl: HTMLElement | null = null;

afterEach(() => {
  mounted?.view.destroy?.();
  mounted?.view.dom.remove();
  mounted = null;
  outsideEl?.remove();
  outsideEl = null;
});

/** A connector's renderer, as called with the fakes below rather than an editor. */
type TestRenderer = (props: {
  node: unknown;
  getPos: () => number | undefined;
  editor: unknown;
}) => MountedNodeView["view"];

/** A node the fake transaction's document reports at a position. */
type NodeAtPos = { type: { name: string }; attrs: Record<string, unknown> };

/**
 * Renders a connector spec against a fake editor, recording every attribute
 * write instead of applying it. `getPos` reports NODE_POS unless overridden, so
 * a test can put the node view in the "my position is gone" state. The fake
 * transaction carries a document only when `nodeAtPos` is given, so the write
 * path is exercised both with a document to consult and without one.
 */
function mountNodeView(
  render: unknown,
  attrs: Record<string, unknown> = {},
  getPos: () => number | undefined = () => NODE_POS,
  nodeAtPos?: (ownType: NodeAtPos["type"]) => NodeAtPos | null,
  /** The node's size, which only the delete path reads. */
  nodeSize = 4,
): MountedNodeView {
  const writes: RecordedAttrWrite[] = [];
  const metas: RecordedMeta[] = [];
  const deletes: RecordedDelete[] = [];
  let focusCount = 0;
  const nodeType = { name: "fixtureBlock" };
  const node = { type: nodeType, attrs, nodeSize };
  const editor = {
    commands: {
      focus() {
        focusCount++;
      },
      command(fn: (props: { tr: unknown }) => boolean) {
        const tr = {
          doc: nodeAtPos ? { nodeAt: () => nodeAtPos(nodeType) } : undefined,
          // `closeHistory(tr)` is a `setMeta` under a private key, so what the stub
          // records is *that* a meta was set before the markup change — enough to
          // pin the ordering ADR-0016 §6 needs, without reaching into
          // prosemirror-history's key.
          setMeta(_key: unknown, value: unknown) {
            metas.push({ value, beforeWrite: writes.length === 0 });
            return tr;
          },
          setNodeMarkup(
            pos: number,
            _type: unknown,
            newAttrs: Record<string, unknown>,
          ) {
            writes.push({ pos, attrs: newAttrs });
            return tr;
          },
          delete(from: number, to: number) {
            deletes.push({ from, to, afterMeta: metas.length > 0 });
            return tr;
          },
        };
        return fn({ tr });
      },
    },
  };

  const view = (render as TestRenderer)({ node, getPos, editor });
  document.body.appendChild(view.dom);
  mounted = {
    view,
    writes,
    metas,
    deletes,
    focuses: () => focusCount,
    nodeType,
  };
  return mounted;
}

/** The fixture's remove control, which calls the connector's `deleteNode`. */
function removeButton(view: MountedNodeView["view"]): HTMLElement {
  return view.dom.querySelector("[data-fixture-remove]") as HTMLElement;
}

function addOutsideElement(): HTMLElement {
  outsideEl = document.body.appendChild(document.createElement("div"));
  return outsideEl;
}

function eventOn(target: globalThis.Node, type = "mousemove"): Event {
  return { type, target } as unknown as Event;
}

// ─── Sealed mode ──────────────────────────────────────────────────────────────

describe("node-view connector — sealed mode", () => {
  it("mounts the block's view inside a wrapper the caret cannot enter", () => {
    const { view } = mountNodeView(
      createBlockNodeView({
        component: SealedBlockFixture,
        class: "fixture-wrapper",
        domAttrs: { "data-fixture-block": "" },
      }),
      { label: "Ambush", count: 2 },
    );

    expect(view.dom.getAttribute("contenteditable")).toBe("false");
    expect(view.dom.className).toBe("fixture-wrapper");
    expect(view.dom.hasAttribute("data-fixture-block")).toBe(true);
    expect(view.dom.querySelector("[data-fixture-label]")?.textContent).toBe(
      "Ambush/2",
    );
    // Nothing for ProseMirror to own: a sealed block has no children.
    expect(view.contentDOM).toBeUndefined();
  });

  it("fills in a block's declared defaults for attributes the node has not set", () => {
    const { view } = mountNodeView(
      createBlockNodeView({
        component: SealedBlockFixture,
        defaults: { label: "Untitled", count: 0 },
      }),
      { label: null },
    );

    expect(view.dom.querySelector("[data-fixture-label]")?.textContent).toBe(
      "Untitled/0",
    );
  });
});

// ─── Attribute write-back ─────────────────────────────────────────────────────

describe("node-view connector — attribute write-back", () => {
  it("writes the changed attribute back at the node's position", async () => {
    const { view, writes } = mountNodeView(
      createBlockNodeView({
        component: SealedBlockFixture,
        props: ({ updateAttributes }) => ({ onUpdate: updateAttributes }),
      }),
      { label: "Ambush", count: 2 },
    );

    await fireEvent.click(view.dom.querySelector("button") as HTMLElement);

    expect(writes).toHaveLength(1);
    expect(writes[0].pos).toBe(NODE_POS);
    expect(writes[0].attrs.count).toBe(3);
  });

  // ADR-0016 §6: every mutation is one undo. `prosemirror-history` groups adjacent
  // steps inside 500 ms, so without closing the group first a block's write is
  // appended to whatever prose edit preceded it and one Ctrl+Z takes back both.
  it("closes the history group before writing, so the change is its own undo step", async () => {
    const { view, metas, writes } = mountNodeView(
      createBlockNodeView({
        component: SealedBlockFixture,
        props: ({ updateAttributes }) => ({ onUpdate: updateAttributes }),
      }),
      { label: "Ambush", count: 2 },
    );

    await fireEvent.click(view.dom.querySelector("button") as HTMLElement);

    expect(writes).toHaveLength(1);
    expect(metas).toHaveLength(1);
    expect(metas[0].beforeWrite).toBe(true);
  });

  // The bug the connector fixes by construction: a block that names two
  // attributes must not drop a third it has never heard of.
  it("merges the change into the node's other attributes rather than replacing them", async () => {
    const { view, writes } = mountNodeView(
      createBlockNodeView({
        component: SealedBlockFixture,
        props: ({ updateAttributes }) => ({ onUpdate: updateAttributes }),
      }),
      { label: "Ambush", count: 2, marker: "keep me" },
    );

    await fireEvent.click(view.dom.querySelector("button") as HTMLElement);

    expect(writes[0].attrs).toEqual({
      label: "Ambush",
      count: 3,
      marker: "keep me",
    });
  });

  it("merges into the freshest attributes when the node has since changed", async () => {
    const { view, writes } = mountNodeView(
      createBlockNodeView({
        component: SealedBlockFixture,
        props: ({ updateAttributes }) => ({ onUpdate: updateAttributes }),
      }),
      { label: "Ambush", count: 2, marker: "keep me" },
    );

    view.update?.({
      type: mounted!.nodeType,
      attrs: { label: "Ambush", count: 9, marker: "still here" },
    });
    await fireEvent.click(view.dom.querySelector("button") as HTMLElement);

    expect(writes[0].attrs.marker).toBe("still here");
    expect(writes[0].attrs.count).toBe(10);
  });

  it("prefers the document's attributes over its own when it can read them", async () => {
    const { view, writes } = mountNodeView(
      createBlockNodeView({
        component: SealedBlockFixture,
        props: ({ updateAttributes }) => ({ onUpdate: updateAttributes }),
      }),
      { label: "Ambush", count: 2 },
      () => NODE_POS,
      (ownType) => ({
        type: ownType,
        attrs: { label: "Ambush", count: 2, marker: "from the document" },
      }),
    );

    await fireEvent.click(view.dom.querySelector("button") as HTMLElement);

    expect(writes[0].attrs.marker).toBe("from the document");
  });

  it("writes nothing when another node now sits at its position", async () => {
    const { view, writes } = mountNodeView(
      createBlockNodeView({
        component: SealedBlockFixture,
        props: ({ updateAttributes }) => ({ onUpdate: updateAttributes }),
      }),
      { label: "Ambush", count: 2 },
      () => NODE_POS,
      () => ({ type: { name: "paragraph" }, attrs: {} }),
    );

    await fireEvent.click(view.dom.querySelector("button") as HTMLElement);

    expect(writes).toHaveLength(0);
  });

  it("writes nothing when the node no longer has a position", async () => {
    const { view, writes } = mountNodeView(
      createBlockNodeView({
        component: SealedBlockFixture,
        props: ({ updateAttributes }) => ({ onUpdate: updateAttributes }),
      }),
      { label: "Ambush", count: 2 },
      () => undefined,
    );

    await fireEvent.click(view.dom.querySelector("button") as HTMLElement);

    expect(writes).toHaveLength(0);
  });
});

// ─── deleteNode() ─────────────────────────────────────────────────────────────
//
// The one gesture a sealed block cannot get from ProseMirror. Its `stopEvent` holds
// every click, so the node is never selected and Backspace has nothing to take — a
// block could be emptied but never removed (#175 review).

describe("node-view connector — deleteNode", () => {
  it("deletes the node's whole range at its position", async () => {
    const { view, deletes } = mountNodeView(
      createBlockNodeView({
        component: SealedBlockFixture,
        props: ({ deleteNode }) => ({ onRemove: deleteNode }),
      }),
      { label: "Ambush", count: 2 },
      undefined,
      undefined,
      7,
    );

    await fireEvent.click(removeButton(view));

    expect(deletes).toEqual([{ from: NODE_POS, to: NODE_POS + 7, afterMeta: true }]);
  });

  it("closes the history group first, so the removal is its own undo step", async () => {
    // Same rule as a write (ADR-0016 §6), and the one where it matters most: a removal
    // folded into the sentence typed a moment earlier would take the sentence with it.
    const { view, deletes } = mountNodeView(
      createBlockNodeView({
        component: SealedBlockFixture,
        props: ({ deleteNode }) => ({ onRemove: deleteNode }),
      }),
      { label: "Ambush" },
    );

    await fireEvent.click(removeButton(view));

    expect(deletes[0].afterMeta).toBe(true);
  });

  it("focuses the editor, so the GM's next Ctrl+Z reaches the removal", async () => {
    const { view, focuses } = mountNodeView(
      createBlockNodeView({
        component: SealedBlockFixture,
        props: ({ deleteNode }) => ({ onRemove: deleteNode }),
      }),
      { label: "Ambush" },
    );

    await fireEvent.click(removeButton(view));

    expect(focuses()).toBe(1);
  });

  it("does nothing when the node's position is gone", async () => {
    const { view, deletes } = mountNodeView(
      createBlockNodeView({
        component: SealedBlockFixture,
        props: ({ deleteNode }) => ({ onRemove: deleteNode }),
      }),
      { label: "Ambush" },
      () => undefined,
    );

    await fireEvent.click(removeButton(view));

    expect(deletes).toHaveLength(0);
  });

  it("refuses when the position holds a different node", async () => {
    // The guard that matters more here than on a write: a stale position landing a
    // delete on whatever replaced this block would remove the wrong thing.
    const { view, deletes } = mountNodeView(
      createBlockNodeView({
        component: SealedBlockFixture,
        props: ({ deleteNode }) => ({ onRemove: deleteNode }),
      }),
      { label: "Ambush" },
      undefined,
      () => ({ type: { name: "paragraph" }, attrs: {} }),
    );

    await fireEvent.click(removeButton(view));

    expect(deletes).toHaveLength(0);
  });
});

// ─── update() → setAttrs() ────────────────────────────────────────────────────
//
// The path an undone change travels to reach the Svelte view. Without it, undo
// changes the document and the block on screen keeps showing the old values.

describe("node-view connector — update path", () => {
  it("pushes the node's attributes into the view as one object", () => {
    const { view, nodeType } = mountNodeView(
      createBlockNodeView({ component: SealedBlockFixture }),
      { label: "Ambush", count: 2 },
    );

    let accepted: boolean | undefined;
    flushSync(() => {
      accepted = view.update?.({
        type: nodeType,
        attrs: { label: "Retreat", count: 7 },
      });
    });

    expect(accepted).toBe(true);
    expect(view.dom.querySelector("[data-fixture-label]")?.textContent).toBe(
      "Retreat/7",
    );
  });

  it("refuses a node of another type", () => {
    const { view } = mountNodeView(
      createBlockNodeView({ component: SealedBlockFixture }),
      { label: "Ambush", count: 2 },
    );

    const accepted = view.update?.({
      type: { name: "somethingElse" },
      attrs: { label: "Retreat", count: 7 },
    });

    expect(accepted).toBe(false);
    expect(view.dom.querySelector("[data-fixture-label]")?.textContent).toBe(
      "Ambush/2",
    );
  });
});

// ─── The event hole ───────────────────────────────────────────────────────────
//
// Deliberately a hole (ADR-0016 §4): Image must let mousedown through for node
// selection, and Scene must hold a slider drag that leaves the node view.
// Closing it "for consistency" re-breaks both.

describe("node-view connector — event handling", () => {
  it("keeps events raised inside the block and leaves the rest to ProseMirror", () => {
    const { view } = mountNodeView(
      createBlockNodeView({ component: SealedBlockFixture }),
    );

    const inside = view.dom.querySelector("button") as HTMLElement;
    expect(view.stopEvent?.(eventOn(inside))).toBe(true);
    expect(view.stopEvent?.(eventOn(addOutsideElement()))).toBe(false);
  });

  it("lets a block's own decision win over that default, either way", () => {
    const { view } = mountNodeView(
      createBlockNodeView({
        component: SealedBlockFixture,
        stopEvent: () => (event) =>
          event.type === "mousedown" ? false : undefined,
      }),
    );

    const inside = view.dom.querySelector("button") as HTMLElement;
    // Handed back to ProseMirror despite originating inside the block.
    expect(view.stopEvent?.(eventOn(inside, "mousedown"))).toBe(false);
    // Anything the block declines to decide falls through to the default.
    expect(view.stopEvent?.(eventOn(inside, "click"))).toBe(true);
  });

  it("gives each mounted block its own handler, so one can hold a drag", () => {
    const render = createBlockNodeView({
      component: SealedBlockFixture,
      // The Scene shape: per-instance state, set up from the block's own DOM.
      stopEvent: ({ dom }) => {
        let dragging = false;
        dom.addEventListener("mousedown", () => {
          dragging = true;
        });
        return () => (dragging ? true : undefined);
      },
    });

    const first = mountNodeView(render);
    const outside = addOutsideElement();
    expect(first.view.stopEvent?.(eventOn(outside))).toBe(false);

    // A drag underway in this block keeps events that stray outside it…
    (first.view.dom.querySelector("button") as HTMLElement).dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true }),
    );
    expect(first.view.stopEvent?.(eventOn(outside))).toBe(true);

    // …and says nothing about the next block mounted from the same spec.
    const second = mountNodeView(render);
    expect(second.view.stopEvent?.(eventOn(outside))).toBe(false);
    second.view.destroy?.();
    second.view.dom.remove();
    mounted = first;
  });
});

// ─── Selection ────────────────────────────────────────────────────────────────

describe("node-view connector — selection", () => {
  it("tells a view that draws its own selection when it is selected", () => {
    const { view } = mountNodeView(
      createBlockNodeView({
        component: SealedBlockFixture,
        drawsOwnSelection: true,
      }),
    );

    const label = view.dom.querySelector("[data-fixture-label]") as HTMLElement;
    flushSync(() => view.selectNode?.());
    expect(label.getAttribute("data-selected")).toBe("true");
    flushSync(() => view.deselectNode?.());
    expect(label.getAttribute("data-selected")).toBe("false");
  });

  it("leaves selection to ProseMirror for a view that does not", () => {
    const { view } = mountNodeView(
      createBlockNodeView({ component: SealedBlockFixture }),
    );

    expect(view.selectNode).toBeUndefined();
    expect(view.deselectNode).toBeUndefined();
  });
});

// ─── Container mode ───────────────────────────────────────────────────────────

describe("node-view connector — container mode", () => {
  it("puts ProseMirror's content hole where the block asked for it", () => {
    const { view } = mountNodeView(
      createBlockNodeView({
        component: ContainerBlockFixture,
        mode: "container",
      }),
      { title: "Read aloud" },
    );

    expect(view.dom.hasAttribute("contenteditable")).toBe(false);
    expect(view.contentDOM).toBeTruthy();
    expect(
      view.contentDOM?.parentElement?.hasAttribute("data-node-view-content"),
    ).toBe(true);
    expect(view.dom.querySelector("[data-fixture-title]")?.textContent).toBe(
      "Read aloud",
    );
  });

  it("hands events inside the content hole to ProseMirror, and keeps the chrome's", () => {
    const { view } = mountNodeView(
      createBlockNodeView({
        component: ContainerBlockFixture,
        mode: "container",
      }),
      { title: "Read aloud" },
    );

    const child = view.contentDOM!.appendChild(document.createElement("p"));
    expect(view.stopEvent?.(eventOn(child, "keydown"))).toBe(false);

    const chrome = view.dom.querySelector(
      "[data-fixture-title]",
    ) as HTMLElement;
    expect(view.stopEvent?.(eventOn(chrome, "keydown"))).toBe(true);
  });

  it("ignores mutations to the block's own chrome and honours the content's", () => {
    const { view } = mountNodeView(
      createBlockNodeView({
        component: ContainerBlockFixture,
        mode: "container",
      }),
      { title: "Read aloud" },
    );

    const chrome = view.dom.querySelector(
      "[data-fixture-title]",
    ) as HTMLElement;
    expect(view.ignoreMutation?.({ target: chrome })).toBe(true);
    expect(view.ignoreMutation?.({ target: view.contentDOM })).toBe(false);
  });

  it("refuses a container view that never says where the content goes", () => {
    // Loudly, so Callout inherits a mode that fails at the first run rather than
    // quietly hanging ProseMirror's content off the wrapper.
    expect(() =>
      mountNodeView(
        createBlockNodeView({
          component: SealedBlockFixture,
          mode: "container",
        }),
      ),
    ).toThrow(/data-node-view-content/);
  });

  it("leaves mutation handling to ProseMirror in sealed mode", () => {
    const { view } = mountNodeView(
      createBlockNodeView({ component: SealedBlockFixture }),
    );

    expect(view.ignoreMutation).toBeUndefined();
  });
});

// ─── Mount hook and teardown ──────────────────────────────────────────────────

describe("node-view connector — lifecycle", () => {
  it("hands a freshly mounted block its view and attributes", () => {
    const seen: unknown[] = [];
    mountNodeView(
      createBlockNodeView<{
        setAttrs: (attrs: Record<string, unknown>) => void;
      }>({
        component: SealedBlockFixture,
        mounted: (view, attrs) => {
          seen.push([typeof view.setAttrs, attrs]);
        },
      }),
      { label: "Ambush", count: 2 },
    );

    expect(seen).toEqual([["function", { label: "Ambush", count: 2 }]]);
  });

  it("unmounts the block's view when ProseMirror destroys the node view", () => {
    const { view } = mountNodeView(
      createBlockNodeView({ component: SealedBlockFixture }),
    );

    expect(view.dom.querySelector("[data-fixture-label]")).toBeTruthy();
    view.destroy?.();
    expect(view.dom.querySelector("[data-fixture-label]")).toBeNull();
  });
});
