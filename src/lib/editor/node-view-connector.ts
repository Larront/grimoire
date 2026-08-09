// The shared node-view connector: one implementation of the plumbing between a
// ProseMirror node and the Svelte component that draws it (ADR-0016 §4). Every
// Note Block's node view is a spec handed to createBlockNodeView() — the three
// hand-written copies this replaces had already drifted into three spellings of
// the same write-back, one of which silently dropped attributes.
//
// It is the pattern's only executable content that removes work: the fourth
// block gets its plumbing for free. Deliberately *not* a shared shell — it owns
// no markup a GM sees beyond the wrapper element, and holds no opinion about how
// a block looks (ADR-0016 §8).
//
// It also implements §6's "every mutation is one undo": a write-back through this
// connector closes the history group first, so a block's edit is never folded into an
// adjacent prose edit by `prosemirror-history`'s 500 ms grouping. Written here rather
// than per block because §6 states it universally — the play-state block (#153) needs
// it most sharply, and Callout's title field (#181) needs it already.
import { mount, unmount } from "svelte";
import { closeHistory } from "@tiptap/pm/history";
import { NodeSelection } from "@tiptap/pm/state";
import type { Component } from "svelte";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/**
 * Marks the element a block offers as ProseMirror's handle on it — its grip.
 *
 * The attribute is the seam, and it is deliberately only that. §8 keeps *how a block
 * looks* out of this file, so the connector never draws a grip: a block renders its own,
 * in its own chrome, with its own design-system idiom, and marks it with this. What the
 * connector then owns is the routing, which is plumbing every block would otherwise
 * re-derive: events on a grip are not held back, so ProseMirror can select the node and
 * start a drag.
 */
export const BLOCK_GRIP_ATTR = "data-block-grip";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A node's attributes as one object. The connector never takes or hands out
 * attributes positionally: `setAttrs(align, width, src, alt)` re-breaks every
 * consumer the moment a fifth attribute is added.
 */
export type BlockAttrs = Record<string, unknown>;

/** What a block's Svelte view exposes for the connector to drive. */
export interface BlockView {
  /** Receives the node's attributes, notably after an undo. */
  setAttrs: (attrs: BlockAttrs) => void;
  /** Only for a view that draws its own selected state — see `drawsOwnSelection`. */
  setSelected?: (selected: boolean) => void;
}

/** The handles a block's own code gets, one set per mounted node view. */
export interface BlockNodeViewContext {
  /** The wrapper element the block's view is mounted into. */
  dom: HTMLElement;
  /** Merges `partial` into the node's current attributes and writes it back. */
  updateAttributes: (partial: BlockAttrs) => void;
  /**
   * Removes the node from the document — the one gesture a sealed block cannot get
   * from ProseMirror.
   *
   * A sealed block's `stopEvent` holds every click, which is what lets its fields
   * work at all and also means the node is never *selected*: there is nothing for
   * Backspace to delete, so a block with no control of its own could be emptied but
   * never removed (#175 review). Undo takes it back in one step, like every other
   * mutation through this connector, so no block needs to confirm.
   */
  deleteNode: () => void;
  /**
   * Where this node currently sits, or undefined once it is gone — ProseMirror's own
   * `getPos`, handed on unchanged.
   *
   * A block needs it to reason about its *surroundings* rather than its content: the
   * Callout moves the caret out of a body it is about to hide (#181), and answering
   * "is the caret in me, and what is before me?" from the DOM instead would be
   * archaeology. Reading it is safe; writing through it is what `updateAttributes` is
   * for.
   */
  getPos: () => number | undefined;
  /**
   * Selects the whole block as one thing, which is what a grip's `mousedown` does.
   *
   * A sealed block holds no text position, so nothing about it is reachable by dragging a
   * caret across it — there is no caret to drag. Copying one, cutting one, or dragging one
   * somewhere else all need the node itself to be the selection, and `stopEvent` holding
   * every click is exactly what stops ProseMirror ever making that selection on its own
   * (the same reason `deleteNode` above has to exist at all).
   *
   * The editor is focused afterwards, because an unfocused editor's selection is not the
   * one the operating system copies: Ctrl+C would reach whatever else holds focus.
   */
  selectNode: () => void;
}

/**
 * Decides whether an event belongs to the block rather than ProseMirror.
 * Returning `undefined` defers to the connector's default. Created per mounted
 * node view, so it may close over per-instance state and set up its own
 * listeners on `ctx.dom`.
 */
export type StopEventHole = (event: Event) => boolean | undefined;

export interface BlockNodeViewSpec<V extends BlockView> {
  /**
   * The block's Svelte view. Typed loosely on purpose: the connector cannot know
   * one block's props, and the props it passes are the node's own attribute
   * names plus whatever `props` adds.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: Component<any, any>;

  /**
   * `sealed` (the default) holds all its content in attributes and has no
   * ProseMirror children. `container` gets a content hole whose children
   * ProseMirror owns — the block's view marks where it goes with
   * `data-node-view-content` (ADR-0016 §5).
   */
  mode?: "sealed" | "container";

  /** Wrapper element class and static attributes. */
  class?: string;
  domAttrs?: Record<string, string>;

  /** Stands in for any attribute the node leaves null or unset. */
  defaults?: BlockAttrs;

  /** Props beyond the node's attributes — a block's write-back callbacks. */
  props?: (ctx: BlockNodeViewContext) => Record<string, unknown>;

  /**
   * The one named hole for event handling, and it is a deliberate hole: Image
   * must let `mousedown` through so ProseMirror can select the node, and Scene
   * must hold a slider drag that leaves the node view. Closing it "for
   * consistency" re-breaks both (ADR-0016 §4).
   */
  stopEvent?: (ctx: BlockNodeViewContext) => StopEventHole;

  /**
   * Set when the view renders its own selected state, which suppresses
   * ProseMirror's default selected-node styling in favour of `setSelected`.
   */
  drawsOwnSelection?: boolean;

  /**
   * Runs as soon as the block's view is mounted, before ProseMirror is handed
   * the node view — a fresh insert opening itself for editing.
   */
  mounted?: (view: V, attrs: BlockAttrs) => void;
}

/** Only the parts of TipTap's node-view arguments the connector reads. */
interface NodeViewArgs {
  node: ProseMirrorNode;
  editor: Editor;
  getPos: () => number | undefined;
}

// ─── Attributes ───────────────────────────────────────────────────────────────

/**
 * The node's attributes with the block's declared defaults standing in for
 * anything null or unset. Applied on the way *out* to the view only — the
 * document keeps whatever it holds, so a default never becomes a write.
 */
function withDefaults(attrs: BlockAttrs, defaults?: BlockAttrs): BlockAttrs {
  const out: BlockAttrs = { ...attrs };
  for (const [key, value] of Object.entries(defaults ?? {})) {
    if (out[key] === undefined || out[key] === null) out[key] = value;
  }
  return out;
}

// ─── Connector ────────────────────────────────────────────────────────────────

/**
 * Builds a block's node view from its spec. The return value is what
 * `addNodeView()` hands TipTap.
 */
export function createBlockNodeView<V extends BlockView = BlockView>(
  spec: BlockNodeViewSpec<V>,
) {
  const sealed = (spec.mode ?? "sealed") === "sealed";

  return ({ node, editor, getPos }: NodeViewArgs) => {
    const dom = document.createElement("div");
    if (spec.class) dom.className = spec.class;
    for (const [name, value] of Object.entries(spec.domAttrs ?? {})) {
      dom.setAttribute(name, value);
    }
    // A sealed block has no document content, so no caret may enter it. A
    // container's children are real content and must stay editable.
    if (sealed) dom.setAttribute("contenteditable", "false");

    const contentDOM = sealed ? null : document.createElement("div");

    // The node as this view currently sees it. ProseMirror keeps it fresh
    // through update(), which is what makes it safe to merge against.
    let current = node;

    const ctx: BlockNodeViewContext = {
      dom,
      getPos,
      updateAttributes(partial) {
        const pos = getPos();
        if (pos == null) return;
        editor.commands.command(({ tr }) => {
          // Merge into the freshest attributes available: the document's where
          // the transaction carries one — a real transaction always does, a test
          // stub need not — else this view's own copy, which ProseMirror keeps in
          // step through update(). A position holding some other node means the
          // node this view drew is gone, and the write must not land on whatever
          // replaced it.
          const atPos = tr.doc?.nodeAt(pos) ?? null;
          if (atPos && atPos.type !== current.type) return false;
          const attrs = (atPos ?? current).attrs;
          // ADR-0016 §6: every mutation is one undo. Without this, a write landing
          // within 500 ms of a prose edit is appended to it, and one Ctrl+Z takes
          // both back — the block's change *and* the GM's sentence.
          closeHistory(tr);
          tr.setNodeMarkup(pos, undefined, { ...attrs, ...partial });
          return true;
        });
      },
      deleteNode() {
        const pos = getPos();
        if (pos == null) return;
        editor.commands.command(({ tr }) => {
          // The same guard `updateAttributes` uses, for the same reason and with more
          // at stake: a stale position holding some other node would delete it.
          const atPos = tr.doc?.nodeAt(pos) ?? null;
          if (atPos && atPos.type !== current.type) return false;
          closeHistory(tr);
          tr.delete(pos, pos + (atPos ?? current).nodeSize);
          return true;
        });
        // The caret has nowhere to be once the block is gone, and an unfocused editor
        // sends Ctrl+Z somewhere else — so the GM's first instinct after a mis-click
        // would do nothing.
        editor.commands.focus();
      },
      selectNode() {
        const pos = getPos();
        if (pos == null) return;
        editor.commands.command(({ tr, dispatch }) => {
          // The same stale-position guard the two writes above use: selecting whatever
          // has taken this position would put the grip's drag on the wrong block.
          const atPos = tr.doc?.nodeAt(pos) ?? null;
          if (atPos && atPos.type !== current.type) return false;
          if (dispatch) tr.setSelection(NodeSelection.create(tr.doc, pos));
          return true;
        });
        // `view.focus()` rather than the focus command: the selection was just set and
        // must survive being focused, not be replaced by wherever the caret last was.
        editor.view.focus();
      },
    };

    const initialAttrs = withDefaults(node.attrs, spec.defaults);

    const raw = mount(spec.component, {
      target: dom,
      props: { ...initialAttrs, ...(spec.props?.(ctx) ?? {}) },
    });
    const view = raw as unknown as V;

    if (contentDOM) {
      const hole = dom.querySelector("[data-node-view-content]");
      if (!hole) {
        throw new Error(
          "A container block's view must mark where ProseMirror's content goes " +
            "with data-node-view-content",
        );
      }
      hole.appendChild(contentDOM);
    }

    const stopEventHole = spec.stopEvent?.(ctx);

    const nodeView: {
      dom: HTMLElement;
      contentDOM?: HTMLElement;
      stopEvent: (event: Event) => boolean;
      update: (updated: ProseMirrorNode) => boolean;
      destroy: () => void;
      ignoreMutation?: (mutation: { target: globalThis.Node }) => boolean;
      selectNode?: () => void;
      deselectNode?: () => void;
    } = {
      dom,

      stopEvent(event: Event) {
        const decided = stopEventHole?.(event);
        if (decided !== undefined) return decided;
        const target = event.target as globalThis.Node | null;
        if (!target || !dom.contains(target)) return false;
        // A grip is the block handing ProseMirror a hold on itself, so its events are the
        // one thing here that must NOT be held: the mousedown selects the node and the
        // dragstart carries it. Checked before the hole below because a container's grip
        // sits outside its content, and a sealed block holds everything.
        const el = target instanceof Element ? target : target.parentElement;
        if (el?.closest(`[${BLOCK_GRIP_ATTR}]`)) return false;
        // Content inside the hole is ProseMirror's: typing in it is its business.
        return contentDOM ? !contentDOM.contains(target) : true;
      },

      update(updated: ProseMirrorNode) {
        if (updated.type !== current.type) return false;
        current = updated;
        view.setAttrs(withDefaults(updated.attrs, spec.defaults));
        return true;
      },

      destroy() {
        unmount(raw);
      },
    };

    if (contentDOM) {
      nodeView.contentDOM = contentDOM;
      // Everything outside the hole is the block's own rendering, which
      // ProseMirror must not try to read back as document content.
      nodeView.ignoreMutation = (mutation) =>
        !contentDOM.contains(mutation.target);
    }

    if (spec.drawsOwnSelection) {
      nodeView.selectNode = () => view.setSelected?.(true);
      nodeView.deselectNode = () => view.setSelected?.(false);
    }

    spec.mounted?.(view, initialAttrs);

    return nodeView;
  };
}
