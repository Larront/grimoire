// What each block is *called*, and the icon it is drawn with — declared once (#220).
//
// Three surfaces name the same blocks: the slash menu offers them, the gutter handle's
// "Turn into" section turns a text block into one of seven of them, and the handle's own
// accessible label says which block it is holding ("Move numbered list"). All three said
// it separately, and the turn-into section carried a comment *asserting* the agreement —
// "the same words and icons the slash menu uses … a GM who learned them there should not
// have to learn them twice" — with nothing enforcing it.
//
// This is that comment as data. It is a table of display strings and nothing else, which
// is what keeps it clear of ADR-0016 §3's argument against a registry: what the ADR
// refuses to collect is node specs and markdown handlers — the things whose collection
// would hide the expensive part of a block behind a layer. Seven words and seven icons
// are not that, and a GM meeting the same block under two names is the failure being
// prevented.
//
// Two spellings of a block, because a menu and a sentence want different ones:
//
//   * `label` — title case, how a menu offers it. "Numbered List".
//   * `word`  — lower case, how a sentence says it. "Delete numbered list".
//
// They are declared rather than derived from one another. `Bullet List` is a plain "list"
// in a sentence and `Ambient Scene` is a plain "scene", so a lower-casing rule would be
// wrong for two of fourteen entries and there would be no way to tell which two.
import type { BlockIconName } from "$lib/components/editor/block-icons";

/** A block the menus offer. The seven a text block can turn into are the first seven. */
export type BlockVocabularyKey =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bulletList"
  | "orderedList"
  | "quote"
  | "codeBlock"
  | "divider"
  | "scene"
  | "infobox"
  | "statblock"
  | "timeline"
  | "image";

export interface BlockVocabularyEntry {
  /** How a menu names it, in title case. */
  label: string;
  /** How a sentence names it — the GM's own word, never the schema's. */
  word: string;
  /** A Lucide icon, by a name that has to exist. */
  icon: BlockIconName;
  /**
   * The schema name of the node this *is*, where the block is one node.
   *
   * Three headings share one node, which is why the table is keyed by what a menu
   * offers rather than by node: `heading1` and `heading3` are two offers of a `heading`,
   * and both are a "heading" once inserted.
   */
  node: string;
}

export const BLOCK_VOCABULARY: Record<BlockVocabularyKey, BlockVocabularyEntry> = {
  paragraph: { label: "Paragraph", word: "paragraph", icon: "Pilcrow", node: "paragraph" },
  heading1: { label: "Heading 1", word: "heading", icon: "Heading1", node: "heading" },
  heading2: { label: "Heading 2", word: "heading", icon: "Heading2", node: "heading" },
  heading3: { label: "Heading 3", word: "heading", icon: "Heading3", node: "heading" },
  bulletList: { label: "Bullet List", word: "list", icon: "List", node: "bulletList" },
  orderedList: {
    label: "Numbered List",
    word: "numbered list",
    icon: "ListOrdered",
    node: "orderedList",
  },
  // The *ordinary* quote, not a typed callout: both are `blockquote` underneath, and a
  // callout is named by its own type word (see `blockLabel`).
  quote: { label: "Quote", word: "quote", icon: "Quote", node: "blockquote" },
  codeBlock: { label: "Code Block", word: "code block", icon: "Code", node: "codeBlock" },
  divider: { label: "Divider", word: "divider", icon: "Minus", node: "horizontalRule" },
  scene: { label: "Ambient Scene", word: "scene", icon: "Music2", node: "sceneBlock" },
  infobox: { label: "Infobox", word: "infobox", icon: "PanelRight", node: "infoboxBlock" },
  statblock: { label: "Statblock", word: "statblock", icon: "Shield", node: "statblockBlock" },
  timeline: { label: "Timeline", word: "timeline", icon: "CalendarDays", node: "timelineBlock" },
  image: { label: "Image", word: "image", icon: "Image", node: "image" },
};

/**
 * How a menu names and draws a block — the two fields a menu item needs and no more.
 *
 * Both menus spread this into their items rather than reaching for the fields
 * themselves, so there is one projection of the table instead of one per surface.
 */
export function nameAndIcon(block: BlockVocabularyKey): {
  label: string;
  icon: BlockIconName;
} {
  const { label, icon } = BLOCK_VOCABULARY[block];
  return { label, icon };
}

/**
 * The GM's word for each node, keyed by schema name — what `blockLabel` announces.
 *
 * Derived rather than written: the words are the menus' own, so a block renamed in the
 * slash menu is renamed in the handle's label in the same edit. The three headings all
 * write "heading" into the same key, which is the same word whichever order they land in.
 *
 * A list item is the one node with a word and no offer — it sits *inside* a list rather
 * than beside one, so nothing inserts it and nothing turns anything into it. It is named
 * here rather than given a table entry with a label and an icon no menu would draw.
 */
export const BLOCK_WORDS: Record<string, string> = {
  listItem: "list item",
  ...Object.fromEntries(
    Object.values(BLOCK_VOCABULARY).map(({ node, word }) => [node, word]),
  ),
};
