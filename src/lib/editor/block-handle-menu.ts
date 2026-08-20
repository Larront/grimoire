// What the grip's menu offers, and how each item reaches the block it belongs to (#191).
//
// The grip could be dragged before this and did nothing when clicked, so the three things
// that apply to *every* block — duplicate, copy, delete — had no gesture anywhere in a
// note. They are the same three because they are the ones that need no knowledge of what
// the block is: "turn into" is a text block's alone (see `turnInto`), and a statblock's
// own controls belong to the statblock.
//
// The writes themselves already exist in `block-handle.ts`, tested there. This module is
// deliberately only the seam between a menu item and one of them, and it exists as its own
// file for two reasons:
//
//   - A menu is open **across time**. The block it was opened on describes the document
//     as it was then, and an undo, a live-reload or the GM's own last keystroke can happen
//     while it is up. What it carries forward is therefore the whole `BlockTarget`, never
//     a bare position — `blockStillThere` is what turns a stale one into a no-op, and it
//     is applied by the writes themselves rather than by this seam.
//   - Copy needs a clipboard, and a clipboard is the one part of this that is neither the
//     document nor the component. Passing it in keeps the action assertable without a
//     browser and without a global stub.
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { BlockIconName } from "$lib/components/editor/block-icons";
import { nameAndIcon } from "./block-vocabulary";
import {
  blockLabel,
  blockMarkdown,
  canTurnInto,
  deleteBlock,
  duplicateBlock,
  turnInto,
  turnIntoKindOf,
  type BlockTarget,
  type TurnIntoKind,
} from "./block-handle";

export type BlockHandleAction = "duplicate" | "copy" | "delete";

/**
 * What choosing one item does: one of the three that apply to every block, or the kind
 * this item would turn a text block into.
 *
 * A bare string for the first three and an object for the second, rather than a tagged
 * union throughout, because the two are genuinely different in kind — the three name
 * *the block*, whatever it is, and a transformation names a destination the block may
 * already be at.
 */
export type BlockHandleCommand = BlockHandleAction | { turnInto: TurnIntoKind };

export interface BlockHandleMenuItem {
  command: BlockHandleCommand;
  /**
   * What the GM reads, and what a screen reader announces. The three verbs name the
   * *block* as well — the grip floats in the margin with no container to be read in, so
   * "Delete" on its own says nothing about which of forty blocks is about to go. A
   * transformation does not repeat it: its section heading has already said "Turn into",
   * and "Turn paragraph into Heading 2" read seven times is noise.
   */
  label: string;
  /**
   * A Lucide icon *name*, resolved through `BLOCK_ICONS` the way the slash menu's are.
   * Typed as a name that exists, so a typo is a build error rather than a menu item
   * silently drawn with no glyph (#220).
   */
  icon: BlockIconName;
  /** For a transformation: whether the block is already this. Never true of the three. */
  current?: boolean;
}

export interface BlockHandleMenuSection {
  /** The heading above the group, or undefined for the unlabelled one at the foot. */
  title?: string;
  items: BlockHandleMenuItem[];
}

/**
 * What a text block can become, in the order the GM reads it.
 *
 * Order only. The words and icons are the slash menu's — literally, through the same
 * `nameAndIcon` that menu spreads into its own entries — because they are the same seven
 * things and a GM who learned them there should not have to learn them twice (#220). This
 * used to restate them, with a comment claiming the agreement and nothing keeping it.
 *
 * Quote is the *ordinary* quote and not a typed callout. A GM turning a paragraph into a
 * quote is asking for a quote; picking "encounter" or "warning" for them would be
 * inventing an intent they did not express.
 */
const TURN_INTO: TurnIntoKind[] = [
  "paragraph",
  "heading1",
  "heading2",
  "heading3",
  "bulletList",
  "orderedList",
  "quote",
];

/**
 * The menu, for one block, in sections.
 *
 * Ordered least to most destructive *across the whole menu*, so the item a mis-aimed
 * click lands on is one that can be undone without the GM noticing what they lost, and
 * Delete stays at the far end from where the pointer arrives.
 *
 * "Turn into" is **absent** rather than disabled on everything else (#192). A statblock,
 * an infobox, a timeline, a scene or an image has no answer to "become a heading" —
 * there is no deciding which of a creature's rows survives, because a creature is not a
 * sentence with extra steps. A greyed-out section would still be a claim that some
 * arrangement of the note makes it work; there is none.
 *
 * It takes the document as well as the target because the handle holds the *innermost*
 * block, so which kind a list item already is lives in the ancestry above it.
 */
export function blockHandleMenuSections(
  doc: ProseMirrorNode,
  target: BlockTarget,
): BlockHandleMenuSection[] {
  const what = blockLabel(target.node);
  const sections: BlockHandleMenuSection[] = [];

  if (canTurnInto(target.node)) {
    const current = turnIntoKindOf(doc, target);
    sections.push({
      title: "Turn into",
      items: TURN_INTO.map((into) => ({
        command: { turnInto: into },
        ...nameAndIcon(into),
        current: into === current,
      })),
    });
  }

  sections.push({
    items: [
      { command: "duplicate", label: `Duplicate ${what}`, icon: "CopyPlus" },
      // "as Markdown" because the alternative a GM might expect is the rendered card,
      // and this is emphatically the fence on disk (ADR-0016 §1).
      { command: "copy", label: `Copy ${what} as Markdown`, icon: "Copy" },
      { command: "delete", label: `Delete ${what}`, icon: "Trash2" },
    ],
  });

  return sections;
}

/**
 * What the GM is told when an item they chose threw, in the words of the item they chose.
 *
 * Copy is the one that fails as a matter of course rather than as a bug — it awaits a
 * clipboard, and a clipboard rejects on a denied permission or a webview that will not hand
 * one over — so it is the only one that names a cause, because for it the cause is known
 * and actionable. The other three reach here only when a write throws, and the honest thing
 * to say about those is that the block is unchanged: naming the clipboard for a Delete
 * sends the GM to check a permission that had nothing to do with it.
 */
export function actionFailureMessage(command: BlockHandleCommand, what: string): string {
  if (typeof command !== "string") return `Couldn't turn that ${what} into anything.`;
  switch (command) {
    case "copy":
      return `Couldn't copy that ${what} — this window has no clipboard access.`;
    case "duplicate":
      return `Couldn't duplicate that ${what}. It is unchanged.`;
    case "delete":
      return `Couldn't delete that ${what}. It is still there.`;
  }
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
 * Runs one menu item against the block the menu was opened on, and answers whether
 * anything happened.
 *
 * It takes the whole target rather than a position because a menu is open **across
 * time** — the GM opens it, reads it, and clicks, and an undo, an external live-reload or
 * a note swapped under it can all land in between. `false` for a target that has gone is
 * not an error; it is the ordinary end of a menu left open, and it must be a no-op rather
 * than a write to whatever is there now. Every write below applies `blockStillThere`
 * itself, so this seam carries the target through and adds no guard of its own.
 *
 * Async only because the clipboard is. Duplicate and delete land synchronously inside it,
 * each closing its own history group, so each remains a single Ctrl+Z (ADR-0016 §6).
 */
export async function runBlockHandleAction(
  editor: Editor,
  target: BlockTarget,
  command: BlockHandleCommand,
  clipboard: ClipboardWriter | undefined = systemClipboard(),
): Promise<boolean> {
  if (typeof command !== "string") {
    // Already this kind: nothing to do, and emphatically not the toggle the underlying
    // command would perform — `toggleBulletList` on a bullet list lifts it back out, so
    // choosing the item that names what the block already is would un-list it.
    if (turnIntoKindOf(editor.state.doc, target) === command.turnInto) return false;
    return turnInto(editor, target, command.turnInto);
  }

  switch (command) {
    case "duplicate":
      return duplicateBlock(editor, target);
    case "delete":
      return deleteBlock(editor, target);
    case "copy": {
      const markdown = blockMarkdown(editor, target);
      if (markdown === null || !clipboard) return false;
      await clipboard.writeText(markdown);
      return true;
    }
  }
}
