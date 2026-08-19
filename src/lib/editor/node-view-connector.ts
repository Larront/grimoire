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

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A block's **record** — the attributes it holds, as one object with a type of its
 * own: `Infobox`, `Statblock`, `SceneRef`.
 *
 * One object rather than a positional list, because `setAttrs(align, width, src, alt)`
 * re-breaks every consumer the moment a fifth attribute is added (ADR-0016 §4). Typed
 * rather than `Record<string, unknown>`, because the object alone only saved the
 * *connector* from that break: every block was still re-enumerating its own field
 * names on both sides of an untyped seam, and a field forgotten in one of them
 * disappeared from the GM's file with nothing to say so (#209).
 *
 * The constraint is `object` rather than an index signature on purpose: a block's
 * record is an `interface`, and an interface has no implicit index signature.
 */
export type BlockRecord = object;

/**
 * What a block's Svelte view exposes for the connector to drive, typed against the
 * block's record so that the view and the node cannot disagree about what a block holds.
 */
export interface BlockView<R extends BlockRecord> {
  /** Receives the node's whole record, notably after an undo. */
  setAttrs: (attrs: R) => void;
  /** Only for a view that draws its own selected state — see `drawsOwnSelection`. */
  setSelected?: (selected: boolean) => void;
}

/** The handles a block's own code gets, one set per mounted node view. */
export interface BlockNodeViewContext<R extends BlockRecord> {
  /** The wrapper element the block's view is mounted into. */
  dom: HTMLElement;
  /**
   * Merges `partial` into the node's current attributes and writes it back.
   *
   * `Partial<R>` is what lets a block's write-back be the record itself —
   * `onCommit: updateAttributes` — rather than a hand-listed projection of it, and it
   * is what makes a typo'd or stale field name a build error.
   */
  updateAttributes: (partial: Partial<R>) => void;
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
   * Selects the whole block as one thing.
   *
   * A sealed block holds no text position, so nothing about it is reachable by dragging a
   * caret across it — there is no caret to drag. Copying one, cutting one, or dragging one
   * somewhere else all need the node itself to be the selection, and `stopEvent` holding
   * every click is exactly what stops ProseMirror ever making that selection on its own
   * (the same reason `deleteNode` above has to exist at all).
   *
   * The gutter handle (#190) is what reaches for this from outside the node views, so no
   * block draws a control of its own for it any more.
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

export interface BlockNodeViewSpec<R extends BlockRecord, V extends BlockView<R>> {
  /**
   * The block's Svelte view.
   *
   * Its *props* stay loose, because the props it is mounted with are the node's record
   * plus whatever `props` adds, and no type spells that pair: an intersection with an
   * open index is not a substitute — Svelte's props are checked by name, so the
   * callbacks read as missing rather than as covered.
   *
   * Its *exports* are not loose, and that is where this ticket's guarantee lives: `V`
   * extends `BlockView<R>`, so the view's own `setAttrs(attrs: Infobox)` is finally
   * checked against the record the node carries instead of merely declared beside it.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: Component<any, V>;

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

  /**
   * Stands in for any attribute the node leaves null or unset — the whole record, so
   * every field has one.
   *
   * A block deriving its attributes from a `blockDom` table hands over that table's
   * `defaults` and declares nothing twice.
   */
  defaults?: R;

  /** Props beyond the node's attributes — a block's write-back callbacks. */
  props?: (ctx: BlockNodeViewContext<R>) => Record<string, unknown>;

  /**
   * The one named hole for event handling, and it is a deliberate hole: Image
   * must let `mousedown` through so ProseMirror can select the node, and Scene
   * must hold a slider drag that leaves the node view. Closing it "for
   * consistency" re-breaks both (ADR-0016 §4).
   */
  stopEvent?: (ctx: BlockNodeViewContext<R>) => StopEventHole;

  /**
   * Set when the view renders its own selected state, which suppresses
   * ProseMirror's default selected-node styling in favour of `setSelected`.
   */
  drawsOwnSelection?: boolean;

  /**
   * Runs as soon as the block's view is mounted, before ProseMirror is handed
   * the node view — a fresh insert opening itself for editing.
   */
  mounted?: (view: V, attrs: R) => void;
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
function withDefaults<R extends BlockRecord>(
  attrs: Record<string, unknown>,
  defaults?: R,
): R {
  const out: Record<string, unknown> = { ...attrs };
  for (const [key, value] of Object.entries(defaults ?? {})) {
    if (out[key] === undefined || out[key] === null) out[key] = value;
  }
  // The node's attributes *are* the block's record — the schema was built from it, and
  // the defaults above have stood in for whatever the document left out. ProseMirror
  // types them as `any`, so this is the one place the claim is made rather than checked.
  return out as R;
}

// ─── Stale positions ──────────────────────────────────────────────────────────

/**
 * The node at a position a view is holding, or null — and never a throw.
 *
 * Every write below re-reads the document before touching it, because a position taken
 * when a view was drawn may not hold that view's node by the time the GM acts on it. The
 * bounds check is part of that and not decoration: `nodeAt` throws a `RangeError` past the
 * end of the document, which is exactly the shape a note that live-reloaded to something
 * shorter leaves behind — and a throw here surfaces as the gesture that raised it dying,
 * rather than as the no-op the guard is written to produce.
 *
 * `doc` is optional because a real transaction always carries one and a test stub need
 * not.
 */
function nodeAtOrNull(
  doc: ProseMirrorNode | undefined,
  pos: number,
): ProseMirrorNode | null {
  if (!doc || pos < 0 || pos > doc.content.size) return null;
  return doc.nodeAt(pos);
}

// ─── Connector ────────────────────────────────────────────────────────────────

/**
 * Builds a block's node view from its spec. The return value is what
 * `addNodeView()` hands TipTap.
 */
export function createBlockNodeView<
  R extends BlockRecord,
  V extends BlockView<R> = BlockView<R>,
>(spec: BlockNodeViewSpec<R, V>) {
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

    const ctx: BlockNodeViewContext<R> = {
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
          const atPos = nodeAtOrNull(tr.doc, pos);
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
          const atPos = nodeAtOrNull(tr.doc, pos);
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
          // has taken this position would act on the wrong block.
          const atPos = nodeAtOrNull(tr.doc, pos);
          // `!atPos` too, unlike its two neighbours above — and the difference is not an
          // oversight in either direction. They fall back to `current` and write against
          // a position that is still theirs; this one hands the position to
          // `NodeSelection.create`, which reads the node *starting* there and throws
          // outright when nothing does. A stale position would take the gesture that
          // reached for it down with it.
          if (!atPos || atPos.type !== current.type) return false;
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
