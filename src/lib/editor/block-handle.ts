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
import type { Node as ProseMirrorNode, ResolvedPos } from "@tiptap/pm/model";

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

/**
 * The kind the block at `pos` **already is**, or null where nothing on offer names it.
 *
 * Two things need this and neither can get it from the node alone. The menu marks the
 * GM's current type, and the handle targets the *innermost* block — which for a list item
 * is the paragraph its text lives in, so "this is a bullet list" is a fact about the
 * ancestry above the target and not about the target.
 *
 * The other is the guard in front of the transformation itself, and it is the half with
 * teeth. Every one of these commands is a *toggle* or a rewrap underneath:
 * `toggleBulletList` on a bullet list lifts it back out, and Tiptap's `setNode` falls
 * back to `clearNodes` when the block is already that node — which lifts it out of every
 * wrapper it is in. So the item naming what the block already is, chosen, is the one
 * thing it cannot be asking for, and this is what recognises it.
 *
 * A callout's own paragraph therefore answers **"paragraph"**, not null. The callout is a
 * container and not one of the seven, so what the block inside it is, is a paragraph —
 * and saying so is what stops "Turn into → Paragraph" tearing the prose out of an
 * encounter box and leaving the box empty behind it. A *plain* quote is different: it is
 * on offer, so its paragraph reads as the quote it is part of.
 *
 * Null is still the answer where nothing on offer names the block at all — a code block,
 * or a heading below level 3.
 */
export function turnIntoKindAt(
  doc: ProseMirrorNode,
  pos: number,
): TurnIntoKind | null {
  if (pos < 0 || pos > doc.content.size) return null;
  const node = doc.nodeAt(pos);
  if (!node || !canTurnInto(node)) return null;

  if (node.type.name === "heading") {
    const level = node.attrs.level as number;
    return level >= 1 && level <= 3 ? (`heading${level}` as TurnIntoKind) : null;
  }
  // A code block is a textblock and so may be turned into these, but none of them is what
  // it is — which is exactly what "no entry" says.
  if (node.type.name !== "paragraph") return null;

  // Deepest first, so a bullet list inside a callout reads as the list it is.
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth >= 1; depth--) {
    const ancestor = $pos.node(depth);
    switch (ancestor.type.name) {
      case "bulletList":
        return "bulletList";
      case "orderedList":
        return "orderedList";
      // A typed callout stops the walk without claiming it: the box is not one of the
      // seven, so the paragraph inside it is just a paragraph. Walking past it would
      // read a callout nested in a plain quote as "quote", which is the outer box.
      case "blockquote":
        return ancestor.attrs.calloutType ? "paragraph" : "quote";
    }
  }
  return "paragraph";
}

/** Whether a resolved position is inside a list item — the one case `wrapIn` refuses. */
function isInListItem($pos: ResolvedPos): boolean {
  for (let depth = $pos.depth; depth >= 1; depth--) {
    if ($pos.node(depth).type.name === "listItem") return true;
  }
  return false;
}

/**
 * Turns the block at `pos` into `kind`, and answers whether the **document changed**.
 *
 * Not whether the chain reported success, which is a different question and the wrong
 * one: `editor.chain()` dispatches what it accumulated whichever way each command
 * answered, and Tiptap's `setNode` returns false down its `clearNodes` fallback — the
 * path that unwraps a quote — so `run()` says "nothing happened" about a write that
 * plainly did. ProseMirror rebuilds the doc node only when a transaction changes it, so
 * comparing identity across the call answers what the caller actually asked.
 */
export function turnIntoAt(editor: Editor, pos: number, kind: TurnIntoKind): boolean {
  const node = nodeAt(editor, pos);
  if (!node || !canTurnInto(node)) return false;

  const before = editor.state.doc;
  // Inside the block, not before it: these are all selection-driven commands, and a node
  // selection would have them replace the block rather than change what it is.
  const chain = editor
    .chain()
    .focus()
    // Its own history group, like the three writes above it (ADR-0016 §6). Without this a
    // GM who types a line and turns it into a heading in the same breath loses both to
    // one Ctrl+Z, the typing being the half they did not ask to take back.
    .command(({ tr }) => {
      closeHistory(tr);
      return true;
    })
    .setTextSelection(pos + 1);

  switch (kind) {
    case "paragraph":
      chain.setNode("paragraph").run();
      break;
    case "heading1":
      chain.setNode("heading", { level: 1 }).run();
      break;
    case "heading2":
      chain.setNode("heading", { level: 2 }).run();
      break;
    case "heading3":
      chain.setNode("heading", { level: 3 }).run();
      break;
    case "bulletList":
      chain.toggleBulletList().run();
      break;
    case "orderedList":
      chain.toggleOrderedList().run();
      break;
    case "quote":
      // Out of the list first, where it is in one. A blockquote is not valid inside a
      // list item, so `wrapIn` alone refuses there and returns having done nothing —
      // which, once the menu offers this on a list item (#192), is a Quote a GM can
      // click and watch not happen. Leaving the list is what they asked for anyway: the
      // block they wanted quoted is no longer a bullet.
      chain
        .command(({ commands, state }) => {
          if (isInListItem(state.selection.$from)) commands.liftListItem("listItem");
          return true;
        })
        .wrapIn("blockquote")
        .run();
      break;
  }

  return editor.state.doc !== before;
}

/**
 * Moves the block one place among its siblings, and answers where it landed.
 *
 * This is the drag, for a GM who is not holding a mouse. A drag is a pointer gesture and
 * has no keyboard equivalent anywhere in a browser, so a grip that can be focused and not
 * used is a control that only looks reachable — and reordering is the whole point of the
 * grip, not a flourish on it.
 *
 * One place at a time, among *siblings only*: a creature moves up the initiative order
 * inside its encounter and never falls out of the box on the way past the first one. That
 * is the same containment a drag has when it is dropped inside the callout, and the
 * alternative — walking out of the parent at the ends — moves a block somewhere the GM
 * was not looking.
 *
 * The returned position is the block's new one, because the caller is drawing a handle
 * beside it and the old position now holds a neighbour.
 */
export function moveBlockAt(editor: Editor, pos: number, direction: -1 | 1): number | null {
  const node = nodeAt(editor, pos);
  if (!node) return null;

  const { state } = editor;
  const neighbour =
    direction === -1
      ? state.doc.resolve(pos).nodeBefore
      : state.doc.resolve(pos + node.nodeSize).nodeAfter;
  if (!neighbour) return null;

  // Dispatched directly rather than through `editor.chain()`, unlike its neighbours
  // above: the caller needs the landing position back, and a chain answers only whether
  // it ran.
  //
  // Delete first, then insert, so the two ends of the move cannot both be described
  // against a document only one of them has seen. After the delete the anchor is the
  // neighbour's own start (up) or its new end (down), which is what these two read as.
  const landing = direction === -1 ? pos - neighbour.nodeSize : pos + neighbour.nodeSize;
  const tr = state.tr;
  closeHistory(tr);
  tr.delete(pos, pos + node.nodeSize);
  tr.insert(landing, node);
  tr.setSelection(NodeSelection.create(tr.doc, landing));
  editor.view.dispatch(tr);
  return landing;
}

/**
 * Hands a drag to ProseMirror, which is what makes the drop land as a *move*.
 *
 * The grip is editor chrome and sits outside the prose, so the browser's own drag starts
 * on an element ProseMirror has never heard of. Left alone the drop would be treated as
 * foreign content — parsed back out of the clipboard HTML and *copied* — so the block
 * would end up in two places. Setting `view.dragging` is how the view is told this drag is
 * its own: it then moves the slice and deletes the source in one step.
 *
 * The clipboard payload is still set, and set the way the editor itself would serialize
 * it, because a drag out of the window (into Obsidian, into a mail) has nothing but that.
 */
export function startBlockDrag(
  editor: Editor,
  pos: number,
  dataTransfer: DataTransfer | null,
  dragImage?: Element,
): boolean {
  if (!nodeAt(editor, pos)) return false;
  const { view } = editor;

  const selection = NodeSelection.create(view.state.doc, pos);
  view.dispatch(view.state.tr.setSelection(selection));

  const slice = selection.content();
  const { dom, text } = view.serializeForClipboard(slice);
  if (dataTransfer) {
    dataTransfer.clearData();
    dataTransfer.setData("text/html", dom.innerHTML);
    // Markdown rather than ProseMirror's plain text, for the reason the copy action gives
    // (ADR-0016 §1): a creature dropped into Obsidian should be the fence it is on disk.
    dataTransfer.setData("text/plain", blockMarkdownAt(editor, pos) ?? text);
    dataTransfer.effectAllowed = "copyMove";
    // The block itself, not the grip. Without this the GM drags a 16px icon and has no
    // ghost of the thing they are moving — which for a statblock is most of a screen.
    if (dragImage) dataTransfer.setDragImage(dragImage, 0, 0);
  }

  view.dragging = { slice, move: true };
  return true;
}

/**
 * The other end of `startBlockDrag`: the drag is over, however it ended.
 *
 * `view.dragging` is a latch, and ProseMirror only ever unlatches it from two listeners of
 * its own on `view.dom` — its `drop`, and its `dragend`. Neither can be relied on here.
 * The grip is `fixed` chrome outside `view.dom` entirely, so the browser raises `dragend`
 * on the grip and ProseMirror never hears it; and a drop landing *inside* a sealed block is
 * held by that block's `stopEvent`, so its `drop` does not run either.
 *
 * Left set, the latch is read by the *next* drop into this editor — an image dragged in, a
 * wikilink, a paragraph from another pane — and ProseMirror uses the slice it is holding
 * instead of the payload that was actually dropped, deleting the current selection first
 * because the latch also says `move`. So the block the GM dropped on the desktop ten
 * minutes ago reappears in place of whatever they meant to drop. Clearing it on `dragend`
 * closes that, and is safe on the ordinary path: `drop` fires before `dragend`, so a drop
 * ProseMirror did handle has already consumed the slice by the time this runs.
 */
export function endBlockDrag(editor: Editor): void {
  editor.view.dragging = null;
}

// ─── What to call it ──────────────────────────────────────────────────────────

/** The GM's word for each node the handle can hold. A name with no entry is "block". */
const BLOCK_WORDS: Record<string, string> = {
  paragraph: "paragraph",
  heading: "heading",
  bulletList: "list",
  orderedList: "numbered list",
  listItem: "list item",
  codeBlock: "code block",
  horizontalRule: "divider",
  statblockBlock: "statblock",
  infoboxBlock: "infobox",
  timelineBlock: "timeline",
  sceneBlock: "scene",
  image: "image",
};

/**
 * What the handle announces itself as holding — "Move statblock", "Move encounter
 * callout".
 *
 * A handle that floats in the margin is a control with no text and no container, so a
 * screen reader announcing "button" has told the GM nothing: which of the forty blocks in
 * this note it would move is the only fact about it. The words are the GM's own, taken
 * from the slash menu's vocabulary rather than from the schema — nobody typed
 * `statblockBlock`.
 *
 * A callout is named by its type, because "encounter" and "warning" are how the GM thinks
 * of the two boxes and both are `blockquote` underneath.
 */
export function blockLabel(node: ProseMirrorNode): string {
  if (node.type.name === "blockquote") {
    const type = node.attrs.calloutType as string | null;
    return type ? `${type} callout` : "quote";
  }
  return BLOCK_WORDS[node.type.name] ?? "block";
}

// ─── Where it goes ────────────────────────────────────────────────────────────

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Everything the handle's position is a function of. */
export interface HandleGeometry {
  /** The target block's box on screen. */
  block: Box;
  /** The height of the block's first line — see the note in `handlePlacement`. */
  firstLine: number;
  /** The handle's own size, measured rather than assumed: it is sized in CSS. */
  handle: { width: number; height: number };
  /** The space between the handle and the block, from `--block-handle-gap`. */
  gap: number;
  /** The left edge the handle may not cross: the padded column's own. */
  columnLeft: number;
}

export interface HandlePlacement {
  left: number;
  top: number;
}

/**
 * The handle's box, from the target block's own box.
 *
 * From the *block's* box and not the prose column's, which is what lets one handle track
 * whatever the pointer is over: a paragraph inside a callout is indented, so the handle
 * follows it into the callout's padding rather than sitting out in the margin pointing at
 * nothing. It is placed entirely to the left of `block.left`, so it never covers a word.
 *
 * `firstLine` is the height of the block's first line box, not the block's height. A
 * handle centred on a five-line paragraph sits beside its middle, which reads as belonging
 * to whatever is next to it; centred on the first line it points at the thing it picks up.
 * For a sealed block — a statblock, an image — there is no line box and the caller passes
 * the block's height, which is the only honest answer and puts the handle beside the card.
 *
 * `columnLeft` is the floor. The gutter is sized in CSS (`--block-gutter`) so this never
 * binds in the app, but a pane can be dragged narrower than any number a stylesheet
 * commits to, and a handle half off the pane is worse than one a little close to the
 * prose.
 */
export function handlePlacement(geometry: HandleGeometry): HandlePlacement {
  const { block, firstLine, handle, gap, columnLeft } = geometry;
  const left = Math.max(columnLeft, block.left - gap - handle.width);
  const line = Math.min(firstLine, block.height);
  return { left, top: block.top + (line - handle.height) / 2 };
}

/** The element a block is drawn as, which is the only thing that has a box. */
export function blockElementAt(view: EditorView, pos: number): HTMLElement | null {
  const dom = view.nodeDOM(pos);
  return dom instanceof HTMLElement ? dom : null;
}

/**
 * Everything above, measured — and the only part of the placement that needs a browser.
 *
 * It lives here rather than in the component for the reason this module's header gives
 * about `posAtCoords`: measurement cannot be asserted without layout, so it is gathered in
 * one place, holds no decisions, and hands numbers to a function that does. The component
 * is left with two CSS properties to set.
 *
 * The first line comes from a **range over the element's contents**, not from the element.
 * An element has one border box however many lines it holds — `getClientRects()` on a
 * `<p>` answers with the paragraph, not its lines — and the version of this that asked the
 * element put the grip 138px down the side of a wrapping paragraph. A range fragments into
 * one rect per line, which is the number wanted. For a sealed block the first rect is its
 * first row of chrome, which keeps the grip beside the top of the card rather than halfway
 * down it; an element that yields no rects at all answers with its own height.
 *
 * The gap is read off the handle's own computed style so the number lives once, in the
 * stylesheet that also sizes the gutter it has to fit inside. It must be written there in
 * **pixels**: `getComputedStyle` returns a custom property as authored, not resolved, so a
 * `rem` arrives here as its own numeral and silently becomes a sub-pixel gap.
 */
export function placeHandle(
  view: EditorView,
  target: BlockTarget,
  handleEl: HTMLElement,
): HandlePlacement | null {
  const dom = blockElementAt(view, target.pos);
  if (!dom) return null;

  const block = dom.getBoundingClientRect();
  const range = dom.ownerDocument.createRange();
  range.selectNodeContents(dom);
  const firstLine = range.getClientRects()[0]?.height || block.height;

  const handle = handleEl.getBoundingClientRect();
  const gap = parseFloat(getComputedStyle(handleEl).getPropertyValue("--block-handle-gap"));
  // The padded column, not the prose: its left edge is the pane's, and the gutter is
  // precisely the space between the two.
  const column = (view.dom as HTMLElement).closest("[data-note-column]") ?? view.dom;

  return handlePlacement({
    block: {
      left: block.left,
      top: block.top,
      width: block.width,
      height: block.height,
    },
    firstLine,
    handle: { width: handle.width, height: handle.height },
    gap: Number.isFinite(gap) ? gap : 0,
    columnLeft: column.getBoundingClientRect().left,
  });
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
  /**
   * The GM asked for the handle from the keyboard: raise it on the block the caret is in,
   * and put focus on it. Separate from `onTarget` because it is not a hover — the handle
   * must stay up until it is dismissed, and it is the grip, not the prose, that has focus
   * afterwards.
   */
  onGrab: (target: BlockTarget, view: EditorView) => void;
}

/**
 * How the handle is reached without a mouse. Hover is the only other way in, so without
 * this the grip — and the reorder, the selection and the delete behind it — simply do not
 * exist for a GM who does not point at things.
 *
 * `Mod-Shift-h` for *handle*, and free: the app's own chords are Ctrl+W (close tab) and
 * Ctrl+\ (sidebar), and no editor extension binds a Mod chord at all.
 */
export const GRAB_SHORTCUT = "Mod-Shift-h";

export const BlockHandle = Extension.create<BlockHandleOptions>({
  name: "blockHandle",

  addOptions() {
    return { onTarget: () => {}, onGrab: () => {} };
  },

  addKeyboardShortcuts() {
    const { onGrab } = this.options;
    return {
      [GRAB_SHORTCUT]: ({ editor }) => {
        const { view } = editor;
        const target = blockTargetAt(view.state.doc, view.state.selection.from);
        if (!target) return false;
        onGrab(target, view);
        return true;
      },
    };
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
