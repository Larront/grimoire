// The Infobox — a compact panel of labelled facts (#175).
//
// The wiki page's top-right summary box: an optional title and an ordered list of
// rows the GM labels themselves. Built first among the new blocks deliberately —
// it is *nothing but rows*, so it is the honest test of whether the shared
// machinery (the node-view connector, the Row List, the Labelled Row and the Linked
// Text Field) actually works.
//
// On disk, a fence split on the first colon:
//
//     ```infobox
//     # Harbor's End
//     Population: 4,200
//     Ruler: [[Captain Ash]]
//     Founded: 812 AR
//     ```
//
// Two lines carry meta, both markdown-flavoured: a leading `# ` title, and (from the
// next ticket) an `![alt](path)` thumbnail. Because the meta lines look like markdown
// rather than like labels, **there are no reserved labels** — a row a GM genuinely
// labelled `Image:` is never silently eaten.
//
// Three things it is not, each a line drawn on purpose:
//
//   * **Inert.** No part of an Infobox is mutated during play. That is the line
//     against Statblock — *an Infobox is read, a Statblock is played* — so nothing
//     here recognises a pool, a mark track or any other playable value.
//   * **Independent of frontmatter.** Frontmatter holds what the tool consumes; an
//     Infobox holds what the reader sees. No promotion either direction, no syncing,
//     which is why nothing in this file imports the frontmatter helpers.
//   * **Not indexed.** Row values are full-text searchable because the Search Index
//     reads the note's raw body verbatim, and that is the whole of it (ADR-0016 §8).
import { Node, mergeAttributes } from "@tiptap/core";
import InfoboxBlockView from "$lib/components/editor/InfoboxBlockView.svelte";
import { createBlockNodeView, type BlockView } from "$lib/editor/node-view-connector";
import { fenceInfo } from "$lib/editor/fence-claim";
import {
  blankLabelledRow,
  isBlankLabelledRow,
  parseLabelledRow,
  serializeLabelledRow,
  type LabelledRow,
} from "$lib/editor/labelled-row";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Infobox {
  /** The panel's title, "" when the GM wrote none. */
  title: string;
  /** The rows, in the GM's order. */
  rows: LabelledRow[];
}

/** A freshly inserted panel opens its one blank row, so its view must let it. */
interface InfoboxBlockViewExports extends BlockView {
  focusRow: (index: number) => void;
}

/**
 * What `/infobox` inserts: no title, and one empty row so there is somewhere to
 * type. The empty row is not content — it serializes to nothing at all.
 */
export function blankInfobox(): Infobox {
  return { title: "", rows: [blankLabelledRow()] };
}

/** Whether a panel holds nothing a GM typed — a fresh insert, still untouched. */
export function isBlankInfobox(infobox: Infobox): boolean {
  return !infobox.title && infobox.rows.every(isBlankLabelledRow);
}

// ─── The title line ───────────────────────────────────────────────────────────

/**
 * `# Harbor's End`. A lone `#` says *the title is empty*, which is only ever written
 * as a shield (see `serializeInfobox`) but is read either way.
 */
function titleOf(line: string): string | null {
  if (line === "#") return "";
  return line.startsWith("# ") ? line.slice(2) : null;
}

// ─── Parse ────────────────────────────────────────────────────────────────────

/**
 * The body of a fenced ```infobox as a title and its rows.
 *
 * The title is the first line that has anything on it, and only if it opens with
 * `# ` — a later `# …` line is a row, because a panel has one title. Blank lines are
 * decoration and are dropped rather than kept, which is safe in both directions:
 * nothing re-emits them, so a load-and-save cannot grow one either.
 */
export function parseInfoboxBody(body: string): Infobox {
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;

  const title = i < lines.length ? titleOf(lines[i]) : null;
  if (title !== null) i++;

  const rows = lines
    .slice(i)
    .filter((line) => line.trim() !== "")
    .map(parseLabelledRow);

  return { title: title ?? "", rows };
}

// ─── Serialize ────────────────────────────────────────────────────────────────

/**
 * A panel as its fence.
 *
 * A row whose line holds nothing but whitespace is dropped — a row the GM typed
 * nothing into (or one space into) is not content, and a blank line written for it
 * would come back as decoration. Testing the *line* rather than the record is what
 * keeps the round trip total: every row `parseInfoboxBody` can produce writes a line
 * with something on it, so nothing this drops could have come from a GM's file.
 *
 * The one collision between the two meta readings is an empty title above an
 * unlabelled row that itself opens with `# `. A bare `#` line shields it — the title
 * is still empty, and the row below is still a row.
 */
export function serializeInfobox(infobox: Infobox): string {
  const rowLines = infobox.rows
    .map(serializeLabelledRow)
    .filter((line) => line.trim() !== "");

  const lines: string[] = [];
  if (infobox.title) lines.push(`# ${infobox.title}`);
  else if (rowLines.length && titleOf(rowLines[0]) !== null) lines.push("#");

  return ["```infobox", ...lines, ...rowLines, "```"].join("\n");
}

// ─── Extension ────────────────────────────────────────────────────────────────

export const InfoboxBlock = Node.create({
  name: "infoboxBlock",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      // Both attributes read themselves back off the DOM, because copying a panel
      // inside the editor goes out through `renderHTML` and back in through here —
      // an attribute that only writes is an attribute a copy-paste drops.
      title: {
        default: "",
        parseHTML: (el) => (el as HTMLElement).dataset.title ?? "",
      },
      rows: {
        default: [],
        parseHTML: (el) => {
          try {
            return JSON.parse(decodeURIComponent((el as HTMLElement).dataset.rows ?? "[]"));
          } catch {
            return [];
          }
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "infobox-block" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "infobox-block",
      mergeAttributes(
        {
          "data-title": node.attrs.title,
          "data-rows": encodeURIComponent(JSON.stringify(node.attrs.rows)),
        },
        HTMLAttributes,
      ),
    ];
  },

  // Infobox's declaration to the markdown reader (ADR-0016 §3): a fenced code token
  // whose language is `infobox` is one of these, at any nesting depth — inside a
  // Callout as readily as at column zero. Anything else is declined with `[]` and
  // stays whatever the reader makes of it.
  markdownTokenName: "code",

  parseMarkdown: (token) =>
    fenceInfo(token) === "infobox"
      ? { type: "infoboxBlock", attrs: parseInfoboxBody(token.text ?? "") }
      : [],

  // @ts-expect-error — renderMarkdown is read by @tiptap/markdown via getExtensionField
  renderMarkdown(node: { attrs: Infobox }) {
    return serializeInfobox(node.attrs);
  },

  addNodeView() {
    return createBlockNodeView<InfoboxBlockViewExports>({
      component: InfoboxBlockView,
      defaults: { title: "", rows: [] },
      props: ({ updateAttributes }) => ({
        onCommit: (infobox: Infobox) =>
          updateAttributes({ title: infobox.title, rows: infobox.rows }),
      }),
      mounted: (view, attrs) => {
        // A fresh `/infobox`: one empty row, opened for typing straight away.
        const panel = { title: attrs.title as string, rows: attrs.rows as LabelledRow[] };
        if (panel.rows.length === 1 && isBlankInfobox(panel)) view.focusRow(0);
      },
    });
  },
});
