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
// A **list is never** the target, at any depth — see `outOfList`. Its markers and the leading
// between its items are all the surface it has, so a pointer walking down a list crossed
// list, item, list, item, and the grip flicked between the two. Nor is any container the
// target for a pointer level with the *gap between two of its children*, for the same reason
// and by the same measure — see `blockChildAtHeight`. A box keeps its header and the padding
// at its ends, which is where a GM aims for the box itself.
//
// Wherever the target is, its grip is drawn out in the **gutter**, in the same column as
// every other grip in the note rather than indented to the block's own edge — see
// `leadingEdgeOf`, which is where the reason is: a nested block's edge has a bullet or a
// callout's accent rule beside it, and a grip placed from it covers them.
//
// The **gutter beside** a block hovers it too, at any height — see the section on the hover
// zone. Reaching for the grip means leaving the words, and a hover that ended at the prose's
// edge was a grip that vanished as the hand arrived.
//
// ─── Why the seam is here and not in the plugin ───────────────────────────────
//
// `blockTargetAt` takes a document and a position, not a mouse event. Everything about
// *which* block is chosen is therefore testable, and it is the half that holds the design
// decision above. Turning a pointer into a position needs boxes — `posAtCoords`, the prose's
// own rect, the column's — and boxes are untestable without layout, so every function that
// takes a measurement here is a thin one wrapped around a decision made somewhere it can be
// asserted: `hoverProbeAt` from numbers, `blockTargetAt` from a document. What is left in
// the plugin is two listeners.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, NodeSelection, TextSelection } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import type { Editor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode, ResolvedPos } from "@tiptap/pm/model";
import { BLOCK_WORDS } from "$lib/editor/block-vocabulary";

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

// ─── The gutter is part of the hover ──────────────────────────────────────────
//
// The grip sits beside a block's **first line**, and a GM reaching for it moves left out of
// the prose and then up. The first half of that move leaves the document entirely — the
// gutter is the column's own padding, not the editor's — so the prose raised a leave, the
// hide was scheduled, and the grip was gone before the second half of the move arrived. It
// only survived a pointer that went straight onto it, which for anything taller than one
// line is a diagonal into a 16px square.
//
// So the gutter beside a block hovers that block, exactly as the block's own text does. The
// pointer's height is what names the block and its distance out into the margin is ignored,
// which is the rule a GM is already assuming when they move left towards the grip.

/** Where a pointer may be and still be hovering a block. */
export interface HoverZone {
  /** The prose's box — where the words are, and what the pointer's x is clamped into. */
  prose: Box;
  /** The gutter's outer edge: the padded column's own left. */
  columnLeft: number;
}

/**
 * A pixel, so a clamped coordinate lands *in* the first character rather than on the
 * boundary before it — `posAtCoords` on an edge can answer with the position outside.
 */
const PROBE_INSET = 1;

export interface HoverProbe {
  left: number;
  top: number;
  /**
   * True when the pointer was out in the gutter and its x had to be pulled into the prose
   * to ask the question at all. The answer then needs `innermostAtHeight` behind it — see
   * the note there for what a clamped x alone gets wrong.
   */
  fromGutter: boolean;
}

/**
 * The coordinates to ask the document about for a pointer at `coords`, or null when the
 * pointer is nowhere the handle answers for.
 *
 * Inside the prose the pointer is its own answer. Out in the gutter the x is pulled back to
 * the prose's leading edge and the y left alone, which is what makes the whole strip beside
 * a block hover that block.
 *
 * Null outside the prose's own vertical run, which is the part that keeps this honest: the
 * column also holds the note's title and the space under the last block, and a clamp with
 * no vertical bound would answer "the first paragraph" for a pointer up in the title field
 * and raise a grip beside prose the GM is not pointing at.
 */
export function hoverProbeAt(
  coords: { left: number; top: number },
  zone: HoverZone,
): HoverProbe | null {
  const { prose, columnLeft } = zone;
  if (coords.top < prose.top || coords.top > prose.top + prose.height) return null;
  if (coords.left < columnLeft || coords.left > prose.left + prose.width) return null;
  const inside = prose.left + PROBE_INSET;
  return coords.left < inside
    ? { left: inside, top: coords.top, fromGutter: true }
    : { left: coords.left, top: coords.top, fromGutter: false };
}

/** The padded column a note is drawn in, which is the element the gutter belongs to. */
export function noteColumn(view: EditorView): HTMLElement {
  const dom = view.dom as HTMLElement;
  return dom.closest<HTMLElement>("[data-note-column]") ?? dom;
}

/** Every block child of `parent`, with the box each one is drawn as. */
function blockChildren(
  view: EditorView,
  parent: BlockTarget,
): { target: BlockTarget; box: DOMRect }[] {
  const children: { target: BlockTarget; box: DOMRect }[] = [];
  parent.node.forEach((child, offset) => {
    if (!child.isBlock) return;
    // A non-leaf node's content starts one position after the node itself.
    const pos = parent.pos + 1 + offset;
    const dom = blockElementAt(view, pos);
    if (dom) children.push({ target: { pos, node: child }, box: dom.getBoundingClientRect() });
  });
  return children;
}

/**
 * The block child of `parent` the height `top` belongs to: the one whose box covers it, or —
 * where the height falls in the leading *between* two children — the nearer of those two.
 *
 * The second half is the same flicker the list rule closes, in the one other place a note has
 * it. A callout's children are a paragraph's margin apart, and a pointer coming down the
 * gutter past one crossed paragraph, gap, paragraph — with the gap answering "the callout",
 * which threw the grip up to the encounter's header and back for every block in the box.
 *
 * Null above the first child and below the last, and that asymmetry is the whole reason this
 * is written as "between two" rather than "within a few pixels of one": a callout's header
 * band and the padding under its last block have no child on one side, and they are exactly
 * where the box itself is meant to be grabbed.
 */
function blockChildAtHeight(
  view: EditorView,
  parent: BlockTarget,
  top: number,
): BlockTarget | null {
  const children = blockChildren(view, parent);
  const covering = children.find(({ box }) => top >= box.top && top <= box.bottom);
  if (covering) return covering.target;

  const above = children.filter(({ box }) => box.bottom < top).at(-1);
  const below = children.find(({ box }) => box.top > top);
  if (!above || !below) return null;
  return top - above.box.bottom <= below.box.top - top ? above.target : below.target;
}

/** The block child of `parent` nearest the height `top`, whether or not it covers it. */
function nearestBlockChild(
  view: EditorView,
  parent: BlockTarget,
  top: number,
): BlockTarget | null {
  let best: { target: BlockTarget; distance: number } | null = null;
  for (const { target, box } of blockChildren(view, parent)) {
    const distance = Math.max(box.top - top, top - box.bottom, 0);
    if (!best || distance < best.distance) best = { target, distance };
  }
  return best?.target ?? null;
}

/**
 * The innermost block at a height, descending from a block that contains it.
 *
 * This is what a clamped x cannot do on its own, and the case is a creature inside an
 * encounter callout. The gutter is outside the callout, so a pointer level with the creature
 * but out in the margin is level with the *box* as well — and the position at the prose's
 * leading edge is inside the callout, not inside the card. Asked with coordinates alone the
 * answer is "the callout", so a GM reaching left for a creature's grip would watch it slide
 * up to the encounter's own first line, mid-reach, having asked for nothing.
 *
 * Height alone is the right test out here, and only out here: distance out into the margin
 * is exactly what the gutter hover disregards. Inside the prose the x still decides, because
 * statblocks tile two to a row and two cards at the same height are not the same block.
 */
export function innermostAtHeight(
  view: EditorView,
  target: BlockTarget,
  top: number,
): BlockTarget {
  // Terminates on its own: every step descends a level, and an atom has no block children.
  let current = target;
  for (let child = blockChildAtHeight(view, current, top); child; ) {
    current = child;
    child = blockChildAtHeight(view, current, top);
  }
  return current;
}

/** Whether a node is a list, which is the one container the handle never holds. */
function isListLike(node: ProseMirrorNode): boolean {
  const name = node.type.name;
  return name === "bulletList" || name === "orderedList" || name === "listItem";
}

/**
 * Out of a list and onto the item the pointer is level with — the block a GM means.
 *
 * A list is the one container that is **never** a target, and the reason is what the pointer
 * is over when it lands on one. A list's own surface is the strip its markers are drawn in
 * and the few pixels of margin between items: nothing else in a `<ul>` is not an item. So a
 * pointer walking down its bullets crosses list, item, list, item — and the grip flicked
 * between the whole list and one bullet several times a second, which is what #190's
 * follow-on was reported for a second time.
 *
 * The nearest item is right rather than merely convenient: a gap between two bullets is two
 * pixels of leading, not a place a GM was pointing at, and no GM reaches for a bullet's grip
 * by aiming at the space above it.
 *
 * The whole list stops being grabbable, which is the accepted cost and a small one. A list
 * has no chrome of its own — no header, no box — so there was never anywhere to grab it that
 * did not belong to an item, and Notion has no handle for one either. Its items each have a
 * grip, and Turn into on one reaches the list.
 */
function outOfList(view: EditorView, target: BlockTarget, top: number): BlockTarget {
  let current = target;
  while (isListLike(current.node)) {
    const child = nearestBlockChild(view, current, top);
    if (!child) break;
    current = child;
  }
  return current;
}

/**
 * The block a pointer anywhere in the column is hovering — the gutter included.
 *
 * The measuring half of `hoverProbeAt`, kept beside `placeHandle` and for the same reason:
 * boxes cannot be asserted without layout, so they are gathered where there are no
 * decisions to hide behind them.
 */
export function targetFromPointer(
  view: EditorView,
  coords: { left: number; top: number },
): BlockTarget | null {
  const prose = (view.dom as HTMLElement).getBoundingClientRect();
  const probe = hoverProbeAt(coords, {
    prose: {
      left: prose.left,
      top: prose.top,
      width: prose.width,
      height: prose.height,
    },
    columnLeft: noteColumn(view).getBoundingClientRect().left,
  });
  if (!probe) return null;

  const target = targetFromCoords(view, probe);
  if (!target) return null;
  // The gutter answer needs the descent; both answers need to be out of a list.
  const inside = probe.fromGutter ? innermostAtHeight(view, target, probe.top) : target;
  return outOfList(view, inside, probe.top);
}

// ─── Acting on one ────────────────────────────────────────────────────────────
//
// Every write below takes the **whole target** — the position and the node that stood
// there — and refuses if the two no longer agree.
//
// A gesture is open across time. The GM hovers a block, reaches out to the grip, opens a
// menu, reads it, and clicks; an undo, an external live-reload or their own last
// keystroke can land anywhere in that. A position on its own goes stale *silently*,
// because a position that no longer holds its block still resolves — to whatever has
// since slid into it — so the write lands on a bystander and the GM's own note is the
// only place that records it happened.
//
// One guard, at one strength, and it is `blockStillThere`. It is applied here, where a
// gesture reaches the document, rather than at whichever caller happened to remember it:
// that is what makes the grip's drag, its select and its arrow-move exactly as safe as
// the menu's Delete.
//
// Every one closes the history group first, so ADR-0016 §6 holds here too — a duplicate
// or a delete is one Ctrl+Z, never folded into the sentence the GM typed a moment
// earlier.

/**
 * Whether the target is still the block it was taken from.
 *
 * **Identity**, not "is a block there", and the difference between the two is the whole
 * of this function. ProseMirror's nodes are immutable and an edit rebuilds only the
 * ancestors of what changed, so an untouched block is the *same object* across a
 * transaction however far its position moved — and a different block at that position
 * is, necessarily, a different object. "Is a block there" answers true for the bystander;
 * identity is what tells the two apart.
 *
 * Not *proof* of the same block, and the limit is worth naming: ProseMirror shares nodes
 * freely, and `duplicateBlock` in particular inserts the very object it copied — so two
 * identical siblings can be one object, and a target for one of them survives the other
 * sliding into its place. Identity narrows the bystander to a block indistinguishable from
 * the one the GM was looking at, which is as far as an address of this kind reaches.
 *
 * `isBlock` because every write behind this takes a node's whole range: it was the
 * deleted `nodeAt` helper's check, and a `BlockTarget` is a bare pair anyone can build.
 */
export function blockStillThere(doc: ProseMirrorNode, target: BlockTarget): boolean {
  // Bounds first, and not merely for tidiness: `nodeAt` *throws* past the end of the
  // document, and a note that live-reloaded to something shorter is exactly the case this
  // guard exists for.
  if (target.pos < 0 || target.pos > doc.content.size) return false;
  return doc.nodeAt(target.pos) === target.node && target.node.isBlock;
}

/**
 * Selects the block, which is what a drag carries and what shows the GM which of forty
 * blocks the grip is holding.
 */
export function selectBlock(editor: Editor, target: BlockTarget): boolean {
  if (!blockStillThere(editor.state.doc, target)) return false;
  return editor
    .chain()
    .command(({ tr, dispatch }) => {
      if (dispatch) tr.setSelection(NodeSelection.create(tr.doc, target.pos));
      return true;
    })
    .run();
}

/**
 * The end of a grip gesture, whichever gesture it was: what it left behind is cleared and
 * the prose has the caret back.
 *
 * Parts of a gesture set a whole-block selection **on purpose** — a drag carries one, and
 * an arrow-move leaves the block it moved selected so the GM can see the thing they are
 * walking up an initiative order. A node selection is *replaced* by the next character
 * typed, so prose focused with one still set means the GM's next keystroke destroys the
 * block they were holding: a whole paragraph gone, one Ctrl+Z away but with nothing on
 * screen saying why.
 *
 * So handing the prose back is one function rather than a rule each write's caller has
 * to remember, and every route that returns focus to the document — a menu item, Escape —
 * is this one.
 *
 * A drag is **not** one of them, and that is not an omission. Once a drop has landed,
 * ProseMirror owns the selection and has set its own over what arrived, and the drag may
 * have ended in another pane or another application entirely — so a grip pulling focus
 * back to its own editor on `dragend` takes the caret out of the note the GM just dropped
 * into. `endBlockDrag` is the drag's own ending, and the latch it clears must be cleared
 * from there and nowhere else: folded in here, a slow Copy's `finally` resolving mid-drag
 * would unlatch a drag that had only just started.
 *
 * `TextSelection.between` and not `Selection.near`: `near` answers with another
 * `NodeSelection` for a selectable leaf, which is the case that has to be got rid of.
 * This searches for a *text* position, forwards first — so a divider's grip puts the
 * caret at the start of the paragraph after it, and a paragraph's puts it at that
 * paragraph's start.
 */
export function releaseBlock(editor: Editor): void {
  const { selection } = editor.state;
  if (selection instanceof NodeSelection) {
    const tr = editor.state.tr;
    const $pos = tr.doc.resolve(selection.from);
    editor.view.dispatch(tr.setSelection(TextSelection.between($pos, $pos, 1)));
  }
  editor.commands.focus();
}

export function deleteBlock(editor: Editor, target: BlockTarget): boolean {
  if (!blockStillThere(editor.state.doc, target)) return false;
  return editor
    .chain()
    .command(({ tr }) => {
      closeHistory(tr);
      tr.delete(target.pos, target.pos + target.node.nodeSize);
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
export function duplicateBlock(editor: Editor, target: BlockTarget): boolean {
  if (!blockStillThere(editor.state.doc, target)) return false;
  return editor
    .chain()
    .command(({ tr }) => {
      closeHistory(tr);
      tr.insert(target.pos + target.node.nodeSize, target.node);
      return true;
    })
    .run();
}

/**
 * The block as the markdown it is written as in the file — not as HTML, and not as a
 * ProseMirror slice. Pasting a creature into Obsidian should land the fence a GM could
 * have typed, because that is what the block *is* on disk (ADR-0016 §1).
 */
export function blockMarkdown(editor: Editor, target: BlockTarget): string | null {
  const manager = editor.markdown;
  if (!manager || !blockStillThere(editor.state.doc, target)) return null;
  return manager.serialize({ type: "doc", content: [target.node.toJSON()] }).trimEnd();
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
 * The kind the target **already is**, or null where nothing on offer names it.
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
 * or a heading below level 3 — and where the target has gone stale, which is the same
 * "nothing to tick, and nothing to refuse" the menu wants from both.
 */
export function turnIntoKindOf(
  doc: ProseMirrorNode,
  target: BlockTarget,
): TurnIntoKind | null {
  if (!blockStillThere(doc, target)) return null;
  const { node } = target;
  if (!canTurnInto(node)) return null;

  if (node.type.name === "heading") {
    const level = node.attrs.level as number;
    return level >= 1 && level <= 3 ? (`heading${level}` as TurnIntoKind) : null;
  }
  // A code block is a textblock and so may be turned into these, but none of them is what
  // it is — which is exactly what "no entry" says.
  if (node.type.name !== "paragraph") return null;

  // Deepest first, so a bullet list inside a callout reads as the list it is.
  const $pos = doc.resolve(target.pos);
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
 * Turns the target into `kind`, and answers whether the **document changed**.
 *
 * Not whether the chain reported success, which is a different question and the wrong
 * one: `editor.chain()` dispatches what it accumulated whichever way each command
 * answered, and Tiptap's `setNode` returns false down its `clearNodes` fallback — the
 * path that unwraps a quote — so `run()` says "nothing happened" about a write that
 * plainly did. ProseMirror rebuilds the doc node only when a transaction changes it, so
 * comparing identity across the call answers what the caller actually asked.
 */
export function turnInto(
  editor: Editor,
  target: BlockTarget,
  kind: TurnIntoKind,
): boolean {
  if (!blockStillThere(editor.state.doc, target)) return false;
  if (!canTurnInto(target.node)) return false;

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
    .setTextSelection(target.pos + 1);

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
 * Moves the block one place among its siblings, and answers where it landed — as a
 * target, not as a number.
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
 * A target and not a position, because the old position now holds a neighbour: handing
 * back a bare number hands back the one thing that has just stopped meaning what the
 * caller takes it to mean. The node is the same object — it was reinserted as-is — so
 * what comes back is an address the *next* gesture can be guarded against.
 */
export function moveBlock(
  editor: Editor,
  target: BlockTarget,
  direction: -1 | 1,
): BlockTarget | null {
  if (!blockStillThere(editor.state.doc, target)) return null;
  const { pos, node } = target;

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
  // `insert` is *silent* when the schema will not take the node there — a paragraph past
  // a blockquote inside a list item, where the parent's content expression stops matching
  // — and what is left in the transaction is then a delete with nothing put back. Left
  // alone that dispatches a note missing the block the GM was moving, and
  // `NodeSelection.create` throws on the way past, out of a `void move()` where nothing
  // catches it. Checking that the block actually landed turns both into the "nothing
  // moved" this already answers for the ends of a list.
  if (tr.doc.nodeAt(landing) !== node) return null;
  tr.setSelection(NodeSelection.create(tr.doc, landing));
  editor.view.dispatch(tr);
  return { pos: landing, node };
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
  target: BlockTarget,
  dataTransfer: DataTransfer | null,
  dragImage?: Element,
): boolean {
  if (!blockStillThere(editor.state.doc, target)) return false;
  const { view } = editor;

  const selection = NodeSelection.create(view.state.doc, target.pos);
  view.dispatch(view.state.tr.setSelection(selection));

  const slice = selection.content();
  const { dom, text } = view.serializeForClipboard(slice);
  if (dataTransfer) {
    dataTransfer.clearData();
    dataTransfer.setData("text/html", dom.innerHTML);
    // Markdown rather than ProseMirror's plain text, for the reason the copy action gives
    // (ADR-0016 §1): a creature dropped into Obsidian should be the fence it is on disk.
    dataTransfer.setData("text/plain", blockMarkdown(editor, target) ?? text);
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

/**
 * What the handle announces itself as holding — "Move statblock", "Move encounter
 * callout".
 *
 * A handle that floats in the margin is a control with no text and no container, so a
 * screen reader announcing "button" has told the GM nothing: which of the forty blocks in
 * this note it would move is the only fact about it. The words are the GM's own, taken
 * from the slash menu's vocabulary rather than from the schema — nobody typed
 * `statblockBlock`. Literally the same words since #220: `BLOCK_WORDS` is derived from the
 * one table both menus name their blocks from. A node with no entry there is a "block".
 *
 * A callout is named by its type, because "encounter" and "warning" are how the GM thinks
 * of the two boxes and both are `blockquote` underneath. An untyped one falls through to
 * the word the menus use for it, which is "quote".
 */
export function blockLabel(node: ProseMirrorNode): string {
  if (node.type.name === "blockquote") {
    const type = node.attrs.calloutType as string | null;
    if (type) return `${type} callout`;
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
  /**
   * The leading edge the handle is placed to the left of — the block's own, or its outermost
   * container's where it has one. See `leadingEdgeOf` for why a nested block hands over the
   * container's.
   */
  blockLeft: number;
  /** The block's first line box — where it is and how tall, see `handlePlacement`. */
  firstLine: { top: number; height: number };
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
 * The handle's box, from the block's leading edge and its first line.
 *
 * It is placed entirely to the left of `blockLeft`, so it never covers a word — or a bullet,
 * or a callout's accent rule, which is why that edge is the one `leadingEdgeOf` hands over
 * and not the block's own box.
 *
 * Centred on the **first line box, where that line actually is** — not on a height measured
 * from the top of the block. Both halves of that matter and each was wrong once:
 *
 *   - A handle centred on the block's height sits beside the middle of a five-line
 *     paragraph, reading as belonging to whatever is next to it. Centred on the first line
 *     it points at the thing it picks up.
 *   - Measuring only the line's *height* and anchoring at the block's top is right for a
 *     paragraph, whose first line is at its top, and wrong for everything with chrome above
 *     its text — a callout's header, a statblock's card — where it drifts up out of the
 *     block by however much padding is in the way.
 *
 * `columnLeft` is the floor. The gutter is sized in CSS (`--block-gutter`) so this never
 * binds in the app, but a pane can be dragged narrower than any number a stylesheet
 * commits to, and a handle half off the pane is worse than one a little close to the
 * prose.
 */
export function handlePlacement(geometry: HandleGeometry): HandlePlacement {
  const { blockLeft, firstLine, handle, gap, columnLeft } = geometry;
  return {
    left: Math.max(columnLeft, blockLeft - gap - handle.width),
    top: firstLine.top + (firstLine.height - handle.height) / 2,
  };
}

/** The element a block is drawn as, which is the only thing that has a box. */
export function blockElementAt(view: EditorView, pos: number): HTMLElement | null {
  const dom = view.nodeDOM(pos);
  return dom instanceof HTMLElement ? dom : null;
}

/** One line's worth of height for `el`, which is the cap on what can be a line box. */
function lineHeightOf(el: HTMLElement): number {
  const style = getComputedStyle(el);
  // `line-height: normal` computes to the keyword, not a number. 1.6 is generous on
  // purpose: this is only ever used to tell a line from a whole block.
  return parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.6 || 0;
}

/** The rects a range over an element's contents fragments into — one per line box. */
function contentRects(el: HTMLElement): DOMRect[] {
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  return Array.from(range.getClientRects());
}

/**
 * How far down the DOM the search for a first line will go. Six levels is past every shape
 * in a note — a callout's wrapper, its blockquote, its header, the field inside that — and
 * the bound is here so a node view nobody has written yet cannot turn this into a walk.
 */
const FIRST_LINE_DEPTH = 6;

/**
 * The block's first line box: where the top of it is, and how tall.
 *
 * A range over an element's contents fragments into one rect per line, which is what makes
 * this answerable at all — an element has one border box however many lines it holds, and
 * the version of this that asked the element put the grip 138px down the side of a wrapping
 * paragraph. But the first of those rects is only a *line* for a text block. Two shapes in a
 * note answer with something much larger, and both put the grip in the middle of a block:
 *
 *   - A list. The first rect of a range over a `<ul>` is the whole first `<li>`, so a list
 *     whose first item wraps to six lines centred the grip on the sixth of them.
 *   - Anything with a node view. `nodeDOM` hands back the connector's wrapper `<div>`, whose
 *     only content is one element — so the one rect is the entire block, and every callout,
 *     statblock and image in a note had its grip halfway down.
 *
 * So a rect taller than one line is not a line, and the answer is inside the first child.
 * Descending is what finds a callout's header text and a card's first row of chrome, which
 * is where a GM looks for the grip on those.
 */
function firstLineBox(dom: HTMLElement, handleHeight: number): { top: number; height: number } {
  let el = dom;
  for (let depth = 0; depth < FIRST_LINE_DEPTH; depth++) {
    const first = contentRects(el)[0];
    if (first && first.height <= lineHeightOf(el) + 1) {
      return { top: first.top, height: first.height };
    }
    const child = el.firstElementChild;
    if (!(child instanceof HTMLElement)) break;
    el = child;
  }
  // Nothing in there reads as a line — an empty block, chrome built out of rows taller than
  // their own text, or a divider, which has no contents to range over at all.
  //
  // So the block's own top, with one line's worth of height at most to centre within. Both
  // halves earn their place. The cap is what keeps a block taller than a line from centring
  // the grip halfway down itself, which is the failure the descent above exists to avoid.
  // And taking the box's height where it is *smaller* than a line is what a divider needs:
  // its box is a single pixel, and a fallback that reported `handleHeight` here would zero
  // the centring term in `handlePlacement` and hang the whole grip below the rule, reading
  // as the next paragraph's.
  const box = dom.getBoundingClientRect();
  return { top: box.top, height: Math.min(box.height, lineHeightOf(dom) || handleHeight) };
}

/**
 * The edge the grip is placed to the left of: the block's own, or its outermost container's.
 *
 * A nested block's own box is the wrong edge, and both containers a note has say so:
 *
 *   - A bullet is drawn *outside* its list item — `list-style-position: outside` puts the
 *     marker in the list's padding, left of the item's box and inside no block at all — so a
 *     grip placed from the item lands squarely on the bullet.
 *   - A callout is a tinted box with an accent rule down its left edge. A grip placed from a
 *     creature inside one lands on that rule and on the tint, because the gap between the
 *     card and the callout's edge is narrower than a grip.
 *
 * So the walk goes out to the prose and takes the leftmost edge it crosses, which puts every
 * grip in a note in one column out in the gutter, whatever depth its block is at. The version
 * of this that indented with the block read better in the one case where the padding was wide
 * enough and covered content in every other.
 *
 * The vertical is what identifies the block, and it is exact: the grip is level with the
 * first line of the thing it holds, one block at a time, because only one grip exists.
 */
function leadingEdgeOf(view: EditorView, dom: HTMLElement, blockLeft: number): number {
  let edge = blockLeft;
  const prose = view.dom as HTMLElement;
  for (let el = dom.parentElement; el && el !== prose && prose.contains(el); el = el.parentElement) {
    edge = Math.min(edge, el.getBoundingClientRect().left);
  }
  return edge;
}

/**
 * Everything above, measured — and the only part of the placement that needs a browser.
 *
 * It lives here rather than in the component for the reason this module's header gives
 * about `posAtCoords`: measurement cannot be asserted without layout, so it is gathered in
 * one place, holds no decisions, and hands numbers to a function that does. The component
 * is left with two CSS properties to set.
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
  const handle = handleEl.getBoundingClientRect();
  const gap = parseFloat(getComputedStyle(handleEl).getPropertyValue("--block-handle-gap"));
  // The padded column, not the prose: its left edge is the pane's, and the gutter is
  // precisely the space between the two.
  const column = noteColumn(view);

  return handlePlacement({
    blockLeft: leadingEdgeOf(view, dom, block.left),
    firstLine: firstLineBox(dom, handle.height),
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
        // Listened for on the **column**, not through `handleDOMEvents` on the prose, which
        // is what brings the gutter into the hover: the gutter is the column's padding and
        // no event in it ever reaches the editor's own surface. The prose is inside the
        // column, so one listener still hears every move across the words as well.
        //
        // `mousemove` rather than per-node `mouseenter`: a sealed block's node view swallows
        // its own events (ADR-0016 §4), so listening inside the blocks is exactly what does
        // not work. A move over the column is seen whatever it is over.
        view(view) {
          const column = noteColumn(view);
          const move = (event: MouseEvent) => {
            onTarget(
              targetFromPointer(view, { left: event.clientX, top: event.clientY }),
              view,
            );
          };
          // The grip is `fixed` chrome and no descendant of the column, so a pointer moving
          // onto it leaves here — which is the leave the hide delay exists to survive.
          const leave = () => onTarget(null, view);

          column.addEventListener("mousemove", move);
          column.addEventListener("mouseleave", leave);
          return {
            destroy() {
              column.removeEventListener("mousemove", move);
              column.removeEventListener("mouseleave", leave);
            },
          };
        },
      }),
    ];
  },
});
