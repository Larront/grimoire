// What the grip's menu offers, and how each item reaches the block it belongs to (#191).
//
// The grip could be dragged before this and did nothing when clicked, so the three things
// that apply to *every* block — duplicate, copy, delete — had no gesture anywhere in a
// note. They are the same three because they are the ones that need no knowledge of what
// the block is: "turn into" is a text block's alone (see `turnIntoAt`), and a statblock's
// own controls belong to the statblock.
//
// The writes themselves already exist in `block-handle.ts`, tested there. This module is
// deliberately only the seam between a menu item and one of them, and it exists as its own
// file for two reasons:
//
//   - A menu is open **across time**. The position it was opened with describes the
//     document as it was then, and an undo, a live-reload or the GM's own last keystroke
//     can happen while it is up. Every action re-reads the node at the position before
//     writing and declines if it is not there, which is the same rule the node-view
//     connector states for its own writes — and the only thing standing between a stale
//     menu and a deleted bystander.
//   - Copy needs a clipboard, and a clipboard is the one part of this that is neither the
//     document nor the component. Passing it in keeps the action assertable without a
//     browser and without a global stub.
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  blockLabel,
  blockMarkdownAt,
  deleteBlockAt,
  duplicateBlockAt,
  type BlockTarget,
} from "./block-handle";

export type BlockHandleAction = "duplicate" | "copy" | "delete";

export interface BlockHandleMenuItem {
  action: BlockHandleAction;
  /**
   * What the GM reads, and what a screen reader announces. It names the *block* as well
   * as the verb — the grip floats in the margin with no container to be read in, so
   * "Delete" on its own says nothing about which of forty blocks is about to go.
   */
  label: string;
}

/**
 * The menu, for one block. Ordered least to most destructive, so the item a mis-aimed
 * click lands on is the one that can be undone without the GM noticing what they lost.
 */
export function blockHandleMenuItems(node: ProseMirrorNode): BlockHandleMenuItem[] {
  const what = blockLabel(node);
  return [
    { action: "duplicate", label: `Duplicate ${what}` },
    // "as Markdown" because the alternative a GM might expect is the rendered card, and
    // this is emphatically the fence on disk (ADR-0016 §1).
    { action: "copy", label: `Copy ${what} as Markdown` },
    { action: "delete", label: `Delete ${what}` },
  ];
}

/** The part of `navigator.clipboard` this needs, so a test can hand over a fake. */
export interface ClipboardWriter {
  writeText(text: string): Promise<void>;
}

/** The window's clipboard, or nothing where there is none to write to. */
export function systemClipboard(): ClipboardWriter | undefined {
  return typeof navigator !== "undefined" ? navigator.clipboard : undefined;
}

/**
 * Whether the block the menu was opened on is still the block at that position.
 *
 * **Identity**, not "is a block there" — that is the whole of this function, and the
 * difference between the two is the failure the ticket names. A position alone goes stale
 * *silently*: delete a paragraph above the one the menu is open on and the position still
 * resolves, to the block that has since slid into it, so Delete takes a bystander and the
 * GM's own note is the only place that records it happened.
 *
 * Node identity answers that. ProseMirror's nodes are immutable and an edit rebuilds only
 * the ancestors of what changed, so an untouched block is the *same object* across a
 * transaction however far its position moved — and a different block at that position is,
 * necessarily, a different object.
 */
export function blockStillThere(editor: Editor, target: BlockTarget): boolean {
  const { doc } = editor.state;
  // Bounds first, and not merely for tidiness: `nodeAt` *throws* past the end of the
  // document, and a note that live-reloaded to something shorter is exactly the case
  // this function exists for.
  if (target.pos < 0 || target.pos > doc.content.size) return false;
  return doc.nodeAt(target.pos) === target.node;
}

/**
 * Runs one menu item against the block the menu was opened on, and answers whether
 * anything happened.
 *
 * It takes the whole target rather than a position because a menu is open **across
 * time** — the GM opens it, reads it, and clicks, and an undo, an external live-reload or
 * a note swapped under it can all land in between. `false` for a target that has gone is
 * not an error; it is the ordinary end of a menu left open, and it must be a no-op rather
 * than a write to whatever is there now.
 *
 * Async only because the clipboard is. Duplicate and delete land synchronously inside it,
 * each closing its own history group, so each remains a single Ctrl+Z (ADR-0016 §6).
 */
export async function runBlockHandleAction(
  editor: Editor,
  target: BlockTarget,
  action: BlockHandleAction,
  clipboard: ClipboardWriter | undefined = systemClipboard(),
): Promise<boolean> {
  if (!blockStillThere(editor, target)) return false;
  const { pos } = target;

  switch (action) {
    case "duplicate":
      return duplicateBlockAt(editor, pos);
    case "delete":
      return deleteBlockAt(editor, pos);
    case "copy": {
      const markdown = blockMarkdownAt(editor, pos);
      if (markdown === null || !clipboard) return false;
      await clipboard.writeText(markdown);
      return true;
    }
  }
}
