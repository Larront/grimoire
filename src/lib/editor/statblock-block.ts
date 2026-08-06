// The Statblock — a creature, NPC, vehicle or hazard, written where the GM will be
// reading it (#177).
//
// On disk, a fence of line-oriented plain text (#150):
//
//     ```statblock
//     # Goblin Scout
//     HP: 12
//     Armor Class: 15
//
//     ## Actions
//     Shortbow: +4 to hit, 1d6+2 piercing.
//
//     Nimble Escape: Disengages or hides as a bonus action.
//     ```
//
// Three regions, and the rule that joins them:
//
//   * An optional `# Name`, read the way an [[Infobox]]'s title is.
//   * A **header** of `Label: value` rows before the first `##`, parsed by the *same*
//     Labelled Row implementation an Infobox's rows are — byte-identical, which is
//     what makes a header-only fence exactly an Infobox with pools.
//   * `## Section`s of **entries** below: blank-line-separated paragraphs whose first
//     colon splits a name from a body. A paragraph with no colon on its first line is
//     unnamed prose — not a spare part, but where a system's in-block description and
//     a section's preamble live.
//
// **Position, not syntax, distinguishes a row from an entry.** The identical line is a
// row above the first `##` and an entry below it, which is what lets one syntax serve
// both regions.
//
// The blank line between entries is the record boundary, and it is load bearing: two
// entry-shaped lines with nothing between them are *one* entry whose body wrapped.
// (#177's own illustration writes two short entries adjacently and so reads as one
// under this grammar. #150 fixed the rule and is the authority; a first-colon reading
// that also split on adjacency would break the wrapped body it explicitly shows, where
// a continuation line carries `Hit: 12 (2d6 + 5)`.)
//
// **Grimoire models three structural things only: rows, sections, entries.** Never an
// entry's *kind*. `## Actions` and `Relentless (3) - Passive:` are alike just
// characters the GM typed, and that is the general rule when a new modelling question
// arrives: when a system-specific concept is expressible as characters the GM typed,
// the model declines to know about it (#150).
//
// Nothing here is played. `120/135` is a string and `[x][ ]` is a string: the pool, the
// mark track and the mode that guards their definitions live in `statblock-play.ts` and
// the view (#178), and the format neither knows nor writes anything about them. What
// this file owns is the structure, and the guarantee that every byte of it survives an
// autosave — which is what makes play-state *be* the serialized value, since a hit is
// nothing but a row's value taking this same path back to the file.
//
// **Two normalisations, decided rather than discovered** (ADR-0007's tradition of
// stating an asymmetry rather than meeting it later):
//
//   1. A hand-authored blank line between header rows is dropped, because the
//      serializer writes rows contiguously.
//   2. A trailing blank line inside the fence is dropped, along with every other blank
//      line that is not separating two entries.
//
// Both are the *same* rule seen twice — a blank line is decoration everywhere except
// between entries, where it is the record boundary.
//
// No identity outside its note (#149): no database entity, no bestiary registry, no
// embed, always inline. A bestiary note plus an ordinary wikilink is a filing
// convention Grimoire has no opinion about.
import { Node, mergeAttributes } from "@tiptap/core";
import StatblockBlockView from "$lib/components/editor/StatblockBlockView.svelte";
import {
  createBlockNodeView,
  type BlockView,
} from "$lib/editor/node-view-connector";
import { fenceInfoFor, fenceParams } from "$lib/editor/fence-claim";
import { jsonListAttr } from "$lib/editor/block-attrs";
import {
  blankLabelledRow,
  isBlankLabelledRow,
  labelText,
  parseLabelledRow,
  serializeLabelledRow,
  type LabelledRow,
} from "$lib/editor/labelled-row";

// ─── Types ────────────────────────────────────────────────────────────────────

/** One named entry inside a section — or, with an empty name, unnamed prose. */
export interface StatblockEntry {
  /** Everything before the first colon of the entry's first line, "" for prose. */
  name: string;
  /**
   * The rest of the entry. May wrap across lines; may not hold a blank line, which
   * is what separates one entry from the next.
   */
  body: string;
}

/** A `## Section` and the entries under it, in the GM's order. */
export interface StatblockSection {
  /** The heading the GM typed, verbatim. "" for a bare `##`. */
  heading: string;
  entries: StatblockEntry[];
}

/**
 * How wide the card is drawn. The one piece of a statblock that is presentation rather
 * than content, and it serializes anyway: a GM who narrows the three creatures in an
 * encounter so they sit side by side has arranged their prep, and prep that resets when
 * the note is reopened was not arranged. Collapse and the structure mode stay view-only
 * for the opposite reason — they are how this pane happens to be showing the block right
 * now, not a decision about it.
 */
export type StatblockWidth = "narrow" | "comfortable";

export const DEFAULT_STATBLOCK_WIDTH: StatblockWidth = "comfortable";

const STATBLOCK_WIDTHS: readonly string[] = ["narrow", "comfortable"];

/** A width off the fence or off the DOM, or the default for anything unrecognised. */
export function asStatblockWidth(raw: unknown): StatblockWidth {
  return STATBLOCK_WIDTHS.includes(raw as string)
    ? (raw as StatblockWidth)
    : DEFAULT_STATBLOCK_WIDTH;
}

export interface Statblock {
  /** The creature's name, "" when the GM wrote none. */
  name: string;
  /** The header rows, in the GM's order. Identical in form to an Infobox's. */
  rows: LabelledRow[];
  /** The sections below the header, in the GM's order. */
  sections: StatblockSection[];
  /** How wide the card is drawn. Carried on the fence, not in the body. */
  width: StatblockWidth;
}

/** A freshly inserted statblock opens its one blank row, so its view must let it. */
interface StatblockBlockViewExports extends BlockView {
  focusRow: (index: number) => void;
}

/**
 * What `/statblock` inserts: no name, no sections, and one empty header row so there
 * is somewhere to type. The empty row is not content — it serializes to nothing.
 */
export function blankStatblock(): Statblock {
  return {
    name: "",
    rows: [blankLabelledRow()],
    sections: [],
    width: DEFAULT_STATBLOCK_WIDTH,
  };
}

/** An entry an insert-between control adds to a section. */
export function blankStatblockEntry(): StatblockEntry {
  return { name: "", body: "" };
}

/** A section an insert-between control adds, opening with one empty entry. */
export function blankStatblockSection(): StatblockSection {
  return { heading: "", entries: [blankStatblockEntry()] };
}

/**
 * Whether a statblock has nothing to play on and everything to author — one empty
 * header row and nothing under it.
 *
 * A name does not count against it. `/statblock Bugbear` stamps a title and no shape
 * (#179), and the GM who typed that name is waiting to type the rows under it, so the
 * block opens for typing exactly as a bare `/statblock` does. A preset that brought
 * rows with it does not open, because there is already something to play on.
 */
function isUnwrittenStatblock(block: Statblock): boolean {
  return (
    block.rows.length === 1 &&
    block.rows.every(isBlankLabelledRow) &&
    block.sections.length === 0
  );
}

// ─── The two structural lines ─────────────────────────────────────────────────

/**
 * `# Goblin Scout`. A lone `#` says *the name is empty*, which is only ever written as
 * a shield (see `serializeStatblock`) but is read either way. `## …` is not a name:
 * the pattern needs a space or the end of the line after its one hash.
 */
const NAME_LINE = /^#(?: (.*))?$/;

/** `## Actions`, or a bare `##` for a section the GM left unheaded. `###` is prose. */
const SECTION_LINE = /^##(?: (.*))?$/;

function nameOf(line: string): string | null {
  const match = NAME_LINE.exec(line);
  return match ? (match[1] ?? "") : null;
}

function headingOf(line: string): string | null {
  const match = SECTION_LINE.exec(line);
  return match ? (match[1] ?? "") : null;
}

const isBlank = (line: string) => line.trim() === "";

// ─── The format's restrictions on a field ─────────────────────────────────────
//
// Applied by the fields that edit a label, a name and a body, exactly as `labelText`
// is: parsing can never produce these shapes, so keeping the fields honest is what
// makes the round trip *total* rather than nearly total. Each is the narrowest
// restriction that closes its hole, and each is visible to the GM as they type rather
// than arriving as a rewrite of their file on the next autosave.

/**
 * A header row's label or an entry's name as the format can hold it: a Labelled Row's
 * label, minus a leading `## ` that would make the whole line a section heading once
 * the value is joined to it.
 *
 * A leading single `#` needs no such treatment — `# Trait: value` is a header row that
 * the name shield already keeps out of the name's position.
 */
export function statblockLabelText(raw: string): string {
  return labelText(raw).replace(/^(?:## )+/, "");
}

/**
 * An entry's body as the format can hold it. Two things a body may not contain, both
 * because the grammar reads them as boundaries rather than as prose:
 *
 *   * a blank line, which separates one entry from the next;
 *   * a line opening a section, which ends the entry and everything under it.
 *
 * The first line's own hazards — a colon, or a section-shaped opening — are *shielded*
 * on the way out instead, because a shield costs the GM no characters. A continuation
 * line has nowhere to carry a shield, which is why these two are removed here.
 */
export function entryBodyText(raw: string): string {
  return raw
    .split(/\r?\n/)
    .filter((line) => !isBlank(line))
    .map((line, index) =>
      index > 0 && SECTION_LINE.test(line) ? line.replace(/^## ?/, "") : line,
    )
    .join("\n");
}

// ─── Parse ────────────────────────────────────────────────────────────────────

/**
 * The body of a fenced ```statblock as a name, header rows and sections.
 *
 * Read forgivingly, because a GM hand-edits this file in Obsidian: blank lines are
 * decoration everywhere except between two entries, the name is optional, a section
 * may hold no entries, and a line before the first `##` is a header row whatever it
 * looks like.
 */
export function parseStatblockBody(body: string): Statblock {
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length && isBlank(lines[i])) i++;

  // The name is read at one position only — the first line with anything on it — for
  // the reason a panel has one title: a later `# …` line is a row, or prose.
  const name = i < lines.length ? nameOf(lines[i]) : null;
  if (name !== null) i++;

  const rows: LabelledRow[] = [];
  while (i < lines.length && headingOf(lines[i]) === null) {
    if (!isBlank(lines[i])) rows.push(parseLabelledRow(lines[i]));
    i++;
  }

  const sections: StatblockSection[] = [];
  while (i < lines.length) {
    sections.push({ heading: headingOf(lines[i]) ?? "", entries: [] });
    i++;

    let paragraph: string[] = [];
    const flush = () => {
      if (paragraph.length)
        sections[sections.length - 1].entries.push(entryOf(paragraph));
      paragraph = [];
    };
    while (i < lines.length && headingOf(lines[i]) === null) {
      if (isBlank(lines[i])) flush();
      else paragraph.push(lines[i]);
      i++;
    }
    flush();
  }

  return {
    name: name ?? "",
    rows,
    sections,
    width: DEFAULT_STATBLOCK_WIDTH,
  };
}

/**
 * One paragraph as an entry. Its first line is split exactly as a header row is —
 * the same `Label: value` reading one region down — and the rest of the paragraph is
 * body, so `Hit: 12 (2d6 + 5)` on a wrapped second line is prose rather than a name.
 */
function entryOf(paragraph: string[]): StatblockEntry {
  const { label, value } = parseLabelledRow(paragraph[0]);
  return { name: label, body: [value, ...paragraph.slice(1)].join("\n") };
}

// ─── Serialize ────────────────────────────────────────────────────────────────

/**
 * A line that would read back as a section heading, marked as content instead.
 *
 * The Labelled Row's own leading-`: ` marker, reused: `: ## Deeper` reads back as an
 * unlabelled value of `## Deeper`, so the pair stays inverse. Only correct for a line
 * with no label in front of it, which is why a *labelled* one is kept out of this
 * shape by `statblockLabelText` instead.
 */
function shieldSection(line: string): string {
  return SECTION_LINE.test(line) ? `: ${line}` : line;
}

/** An entry as its lines, or no lines at all when the GM typed nothing into it. */
function serializeEntry(entry: StatblockEntry): string[] {
  const bodyLines = entry.body === "" ? [] : entry.body.split("\n");
  const first = serializeLabelledRow({
    label: entry.name,
    value: bodyLines[0] ?? "",
  });
  if (isBlank(first)) return [];
  return [shieldSection(first), ...bodyLines.slice(1)];
}

/**
 * A statblock as its fence.
 *
 * A row or an entry whose line holds nothing but whitespace is dropped: a record the
 * GM typed nothing into is not content, and a blank line written for it would come
 * back as decoration — or, between entries, as a record boundary that split one entry
 * into two. Testing the *line* rather than the record is what keeps the round trip
 * total, because every record parsing can produce writes a line with something on it.
 *
 * One shield is the Infobox's, for the same collision: an empty name above a first row
 * that opens with `# ` is written as a bare `#`, so the name stays empty and the row
 * below stays a row.
 */
export function serializeStatblock(block: Statblock): string {
  const lines: string[] = [];

  const rowLines = block.rows
    .map(serializeLabelledRow)
    .filter((line) => !isBlank(line))
    .map(shieldSection);

  if (block.name) lines.push(`# ${block.name}`);
  else if (rowLines.length && NAME_LINE.test(rowLines[0])) lines.push("#");
  lines.push(...rowLines);

  for (const section of block.sections) {
    // A blank line above a heading is readability, not grammar: the heading ends the
    // region above it either way. Written only where there is something to separate.
    if (lines.length) lines.push("");
    lines.push(section.heading ? `## ${section.heading}` : "##");

    const entries = section.entries
      .map(serializeEntry)
      .filter((entry) => entry.length > 0);
    entries.forEach((entryLines, index) => {
      if (index > 0) lines.push("");
      lines.push(...entryLines);
    });
  }

  // The width rides on the info string rather than in the body, because the body is the
  // GM's own line-oriented text and a `width:` line in it would be indistinguishable
  // from a header row a GM typed about a creature's width. Written only when it is not
  // the default, so every fence already on disk re-emits byte-identically.
  // Normalised, not read raw: a caller holding a block from before width existed passes
  // `undefined`, and comparing that against the default would write `width=undefined`
  // into the GM's file. Anything unrecognised is the default, and the default is omitted.
  const width = asStatblockWidth(block.width);
  const info = fenceInfoFor(
    "statblock",
    width === DEFAULT_STATBLOCK_WIDTH ? {} : { width },
  );

  return ["```" + info, ...lines, "```"].join("\n");
}

// ─── Extension ────────────────────────────────────────────────────────────────

export const StatblockBlock = Node.create({
  name: "statblockBlock",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      // Every attribute reads itself back off the DOM, because copying a statblock
      // inside the editor goes out through `renderHTML` and back in through here — an
      // attribute that only writes is an attribute a copy-paste drops.
      name: {
        default: "",
        parseHTML: (el) => (el as HTMLElement).dataset.name ?? "",
      },
      rows: {
        default: [],
        parseHTML: (el) => jsonListAttr((el as HTMLElement).dataset.rows),
      },
      sections: {
        default: [],
        parseHTML: (el) => jsonListAttr((el as HTMLElement).dataset.sections),
      },
      width: {
        default: DEFAULT_STATBLOCK_WIDTH,
        parseHTML: (el) => asStatblockWidth((el as HTMLElement).dataset.width),
      },
    };
  },

  parseHTML() {
    return [{ tag: "statblock-block" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "statblock-block",
      mergeAttributes(
        {
          "data-name": node.attrs.name,
          "data-rows": encodeURIComponent(JSON.stringify(node.attrs.rows)),
          "data-sections": encodeURIComponent(
            JSON.stringify(node.attrs.sections),
          ),
          "data-width": node.attrs.width,
        },
        HTMLAttributes,
      ),
    ];
  },

  // Statblock's declaration to the markdown reader (ADR-0016 §3): a fenced code token
  // whose language is `statblock` is one of these, at any nesting depth — inside the
  // `> [!encounter] The Ambush` a GM groups a fight with as readily as at column zero.
  // Anything else is declined with `[]` and stays whatever the reader makes of it,
  // including a `statblock` fence carrying a parameter this version cannot write back.
  markdownTokenName: "code",

  parseMarkdown: (token) => {
    const params = fenceParams(token, "statblock", ["width"]);
    if (!params) return [];
    return {
      type: "statblockBlock",
      attrs: {
        ...parseStatblockBody(token.text ?? ""),
        width: asStatblockWidth(params.width),
      },
    };
  },

  // @ts-expect-error — renderMarkdown is read by @tiptap/markdown via getExtensionField
  renderMarkdown(node: { attrs: Statblock }) {
    return serializeStatblock(node.attrs);
  },

  addNodeView() {
    return createBlockNodeView<StatblockBlockViewExports>({
      component: StatblockBlockView,
      domAttrs: { "data-note-block": "statblock" },
      defaults: {
        name: "",
        rows: [],
        sections: [],
        width: DEFAULT_STATBLOCK_WIDTH,
      },
      props: ({ updateAttributes, deleteNode }) => ({
        onCommit: (block: Statblock) =>
          updateAttributes({
            name: block.name,
            rows: block.rows,
            sections: block.sections,
            width: block.width,
          }),
        onRemove: deleteNode,
      }),
      mounted: (view, attrs) => {
        // A fresh `/statblock`: one empty header row, opened for typing straight away.
        const block: Statblock = {
          name: attrs.name as string,
          rows: attrs.rows as LabelledRow[],
          sections: attrs.sections as StatblockSection[],
          width: asStatblockWidth(attrs.width),
        };
        if (isUnwrittenStatblock(block)) view.focusRow(0);
      },
    });
  },
});
