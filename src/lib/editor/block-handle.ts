// The block handle — how a GM picks up anything in a note.
//
// One handle in the gutter, tracking whatever block the pointer is over, rather than a
// control inside each block. That is not a style preference; it is the only shape that can
// cover a **paragraph**. A per-block grip needs chrome to live in, and prose has none — so
// the version of this that put a grip in each block's own controls could move a statblock
// and never a sentence, which is most of a note.
//
// It also keeps ADR-0016 §8 intact by going around it rather than through it. §8 refuses a
// shared visual shell for blocks, and this is not one: the handle is *editor* chrome, a
// sibling of the prose like the slash menu, and it draws nothing inside any block.
//
// ─── What it targets ──────────────────────────────────────────────────────────
//
// The **innermost** block under the pointer. Hover a statblock inside an encounter callout
// and the target is the creature, not the box, because reordering creatures as initiative
// moves around the table is the whole reason a fight is grouped in the first place (#151,
// #182). The cost, accepted: a callout is grabbable over its own header and padding, not
// over its children. Notion behaves the same way and for the same reason.
//
// ─── Why the seam is here and not in the plugin ───────────────────────────────
//
// `blockTargetAt` takes a document and a position, not a mouse event. Everything about
// *which* block is chosen is therefore testable, and it is the half that holds the design
// decision above. Turning a pointer into a position is `posAtCoords`, one call, in the
// plugin — and untestable anywhere without layout, which is exactly why it is kept down to
// one line and holds no decisions of its own.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, NodeSelection } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import type { Editor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/** A block the handle can act on, and where it starts. */
export interface BlockTarget {
  /** The position immediately before the node — what `NodeSelection` wants. */
  pos: number;
  node: ProseMirrorNode;
}

/**
 * The innermost block containing `pos`, or null if there is none.
 *
 * Two cases, and the order between them is the whole function:
 *
 * A node starting exactly at `pos` wins first. A sealed block is an atom, so a coordinate
 * over it resolves to the position *before* it, and its own depth is its parent's — asking
 * the resolved path first would answer "the callout" for every creature inside one, which
 * is the wrong end of the decision above.
 *
 * Otherwise the resolved path is walked from the deepest node outwards, which finds the
 * paragraph a caret is in rather than the callout wrapping it. Depth 0 is the document and
 * is never a target: the whole note is not a block a GM drags.
 */
export function blockTargetAt(doc: ProseMirrorNode, pos: number): BlockTarget | null {
  if (pos < 0 || pos > doc.content.size) return null;

  const at = doc.nodeAt(pos);
  if (at?.isBlock) return { pos, node: at };

  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth >= 1; depth--) {
    const node = $pos.node(depth);
    if (node.isBlock) return { pos: $pos.before(depth), node };
  }
  return null;
}

/**
 * The block under a pointer. `inside` is preferred over `pos` because it is the position of
 * the node the coordinates are actually *in* — for an atom that is the atom, where `pos`
 * would be a spot beside it.
 */
export function targetFromCoords(
  view: EditorView,
  coords: { left: number; top: number },
): BlockTarget | null {
  const found = view.posAtCoords(coords);
  if (!found) return null;
  return blockTargetAt(view.state.doc, found.inside >= 0 ? found.inside : found.pos);
}

// ─── Acting on one ────────────────────────────────────────────────────────────
//
// Each of these re-reads the node at the position before writing, for the reason the
// node-view connector states about its own writes: a position held across a render may no
// longer hold the node it was taken from, and acting anyway would hit a bystander.
//
// Every one closes the history group first, so ADR-0016 §6 holds here too — a duplicate or
// a delete is one Ctrl+Z, never folded into the sentence the GM typed a moment earlier.

/** The node still at `pos`, or null if something else is there now. */
function nodeAt(editor: Editor, pos: number): ProseMirrorNode | null {
  if (pos < 0 || pos > editor.state.doc.content.size) return null;
  const node = editor.state.doc.nodeAt(pos);
  return node?.isBlock ? node : null;
}

/** Selects the block, which is what a drag carries and what Ctrl+C copies. */
export function selectBlockAt(editor: Editor, pos: number): boolean {
  if (!nodeAt(editor, pos)) return false;
  return editor
    .chain()
    .command(({ tr, dispatch }) => {
      if (dispatch) tr.setSelection(NodeSelection.create(tr.doc, pos));
      return true;
    })
    .run();
}

export function deleteBlockAt(editor: Editor, pos: number): boolean {
  const node = nodeAt(editor, pos);
  if (!node) return false;
  return editor
    .chain()
    .command(({ tr }) => {
      closeHistory(tr);
      tr.delete(pos, pos + node.nodeSize);
      return true;
    })
    .focus()
    .run();
}

/**
 * A copy of the block, immediately after it. The node is inserted as-is, so a callout
 * brings its children and a statblock brings its rows — a fight becomes six kobolds by
 * doing this five times, which is the case #182 described and had no gesture for.
 */
export function duplicateBlockAt(editor: Editor, pos: number): boolean {
  const node = nodeAt(editor, pos);
  if (!node) return false;
  return editor
    .chain()
    .command(({ tr }) => {
      closeHistory(tr);
      tr.insert(pos + node.nodeSize, node);
      return true;
    })
    .run();
}

/**
 * The block as the markdown it is written as in the file — not as HTML, and not as a
 * ProseMirror slice. Pasting a creature into Obsidian should land the fence a GM could
 * have typed, because that is what the block *is* on disk (ADR-0016 §1).
 */
export function blockMarkdownAt(editor: Editor, pos: number): string | null {
  const node = nodeAt(editor, pos);
  const manager = editor.markdown;
  if (!node || !manager) return null;
  return manager.serialize({ type: "doc", content: [node.toJSON()] }).trimEnd();
}

/**
 * What a text block can become. Only text blocks offer this: turning a statblock into a
 * heading would mean deciding which of its parts survives, and the answer is that none of
 * them do — a creature is not a sentence with extra steps.
 */
export type TurnIntoKind =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bulletList"
  | "orderedList"
  | "quote";

/** Whether "Turn into" applies at all: a textblock holds inline content a GM typed. */
export function canTurnInto(node: ProseMirrorNode): boolean {
  return node.isTextblock;
}

export function turnIntoAt(editor: Editor, pos: number, kind: TurnIntoKind): boolean {
  const node = nodeAt(editor, pos);
  if (!node || !canTurnInto(node)) return false;

  // Inside the block, not before it: these are all selection-driven commands, and a node
  // selection would have them replace the block rather than change what it is.
  const chain = editor.chain().focus().setTextSelection(pos + 1);
  switch (kind) {
    case "paragraph":
      return chain.setNode("paragraph").run();
    case "heading1":
      return chain.setNode("heading", { level: 1 }).run();
    case "heading2":
      return chain.setNode("heading", { level: 2 }).run();
    case "heading3":
      return chain.setNode("heading", { level: 3 }).run();
    case "bulletList":
      return chain.toggleBulletList().run();
    case "orderedList":
      return chain.toggleOrderedList().run();
    case "quote":
      return chain.wrapIn("blockquote").run();
  }
}

// ─── The plugin ───────────────────────────────────────────────────────────────

export const blockHandleKey = new PluginKey("blockHandle");

export interface BlockHandleOptions {
  /**
   * Called as the target changes, with null when the pointer leaves the prose. The handle
   * itself is drawn by a Svelte component reading this — the extension holds no markup, so
   * how the handle *looks* stays where the design system is.
   */
  onTarget: (target: BlockTarget | null, view: EditorView) => void;
}

export const BlockHandle = Extension.create<BlockHandleOptions>({
  name: "blockHandle",

  addOptions() {
    return { onTarget: () => {} };
  },

  addProseMirrorPlugins() {
    const { onTarget } = this.options;
    return [
      new Plugin({
        key: blockHandleKey,
        props: {
          handleDOMEvents: {
            // `mousemove` rather than per-node `mouseenter`: a sealed block's node view
            // swallows its own events, so listening inside the blocks is exactly what does
            // not work. The editor's own surface sees every move regardless.
            mousemove(view, event) {
              onTarget(
                targetFromCoords(view, { left: event.clientX, top: event.clientY }),
                view,
              );
              return false;
            },
            mouseleave(view) {
              onTarget(null, view);
              return false;
            },
          },
        },
      }),
    ];
  },
});
