// One word and one icon per block, read by three surfaces (#220).
//
// The slash menu offers a block, the gutter handle's "Turn into" section turns a text
// block into one of seven of them, and the handle's own accessible label says which block
// it is holding. All three used to name the blocks separately, with a comment in the
// turn-into section *claiming* the agreement and nothing keeping it.
//
// So what is asserted here is the agreement itself, surface against surface, rather than
// the table's contents against a copy of the table. A test that restated the fourteen
// words would be the fourth place they are written.
//
// The other half of the ticket needs no test because it is not a runtime property: an
// icon name is typed as one that exists, so a typo fails `bun run check`. The runtime
// backstop below is the one thing that type cannot say — that every name in the table is
// a key `BLOCK_ICONS` actually holds at run time, the table and the icon map being two
// files.
import { describe, it, expect, afterEach, vi } from "vitest";

// A scene block asks the ledger for its tracks as its node view mounts, and there is no
// ledger here — the same stub `block-handle-menu.test.ts` keeps for the same reason.
vi.mock("$lib/stores/scenes.svelte", () => ({
  scenes: {
    scenes: [],
    getSlots: () => Promise.resolve([]),
    invalidateSlots: () => {},
  },
}));

import { BLOCK_ICONS } from "$lib/components/editor/block-icons";
import {
  BLOCK_VOCABULARY,
  BLOCK_WORDS,
  type BlockVocabularyKey,
} from "$lib/editor/block-vocabulary";
import { SLASH_COMMANDS } from "$lib/editor/slash-command";
import { blockHandleMenuSections } from "$lib/editor/block-handle-menu";
import { blockLabel } from "$lib/editor/block-handle";
import { note, targetOf, closeNote } from "./fixtures/note-editor";

afterEach(closeNote);

/**
 * A note holding one of each block, keyed the way the table is.
 *
 * `Record<BlockVocabularyKey, string>` rather than a loose object on purpose: a block
 * added to the vocabulary with no sample here fails the build, so the case below cannot
 * quietly stop covering the newest block.
 */
const A_NOTE_HOLDING: Record<BlockVocabularyKey, string> = {
  paragraph: "A sentence.",
  heading1: "# The Lower Halls",
  heading2: "## The Lower Halls",
  heading3: "### The Lower Halls",
  bulletList: "- the one with the sling",
  orderedList: "1. first light",
  quote: "> Nothing grows here.",
  codeBlock: "```python\nprint('hi')\n```",
  divider: "---",
  scene: "```scene\n# The Tavern\nId: 7\n```",
  infobox: "```infobox\n# The Ember Keep\nRuler: Mira\n```",
  statblock: "```statblock\n# Kobold\nHP: 5/5\n```",
  timeline: "```timeline\n# The Shattering\nDate: 3rd of Frostfall\n```",
  image: "![The gate](images/gate.png)",
};

/** The seven a text block can become, as the turn-into section draws them. */
function turnIntoItems() {
  const editor = note("A sentence.");
  try {
    const sections = blockHandleMenuSections(editor.state.doc, targetOf(editor, "paragraph"));
    const section = sections.find((s) => s.title === "Turn into");
    return section!.items;
  } finally {
    closeNote();
  }
}

describe("a block's word and icon", () => {
  it("names a turn-into item exactly as the slash menu names the same block", () => {
    // The claim the old comment made: "a GM who learned them there should not have to
    // learn them twice". Compared item by item rather than as a set, so a menu that
    // agreed on the words and disagreed on which icon went with which still fails.
    for (const item of turnIntoItems()) {
      const kind = (item.command as { turnInto: string }).turnInto;
      const offered = SLASH_COMMANDS.find(
        (command) => command.label === BLOCK_VOCABULARY[kind as BlockVocabularyKey].label,
      );

      expect(offered, `no slash command offers ${item.label}`).toBeDefined();
      expect(item.label).toBe(offered!.label);
      expect(item.icon).toBe(offered!.icon);
    }
  });

  it.each(Object.keys(A_NOTE_HOLDING) as BlockVocabularyKey[])(
    "gives the handle holding a %s the word the menus use for it",
    (key) => {
      // The third surface, and asserted through a real note rather than against the
      // table: comparing `BLOCK_WORDS[entry.node]` to `entry.word` would prove nothing,
      // the one being derived from the other. What can actually be wrong is the *node*
      // name — a schema name the table spells for itself — and a wrong one shows up here
      // twice over: `targetOf` cannot find the node, and the handle falls back to
      // "block".
      const entry = BLOCK_VOCABULARY[key];
      const editor = note(A_NOTE_HOLDING[key]);

      expect(blockLabel(targetOf(editor, entry.node).node)).toBe(entry.word);
    },
  );

  it("still has a word for the one node no menu offers", () => {
    // A list item is inside a list rather than beside it, so it is named beside the table
    // rather than in it — and the handle can still hold one, which is why it has a word
    // at all.
    const editor = note("- the one with the sling");

    expect(blockLabel(targetOf(editor, "listItem").node)).toBe(BLOCK_WORDS.listItem);
  });

  it("names only icons that exist at run time, in every surface that names one", () => {
    const named = [
      ...Object.values(BLOCK_VOCABULARY).map((entry) => entry.icon),
      ...SLASH_COMMANDS.map((command) => command.icon),
      ...turnIntoItems().map((item) => item.icon),
    ];

    for (const icon of named) {
      expect(BLOCK_ICONS[icon], `${icon} is named but not imported`).toBeDefined();
    }
  });
});
