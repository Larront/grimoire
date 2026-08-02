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
//     ![The harbour at dusk](images/harbor.png)
//     Population: 4,200
//     Ruler: [[Captain Ash]]
//     Founded: 812 AR
//     ```
//
// Two lines carry meta, both markdown-flavoured: a leading `# ` title and an
// `![alt](path)` thumbnail (#176). Because the meta lines look like markdown rather
// than like labels, **there are no reserved labels** — a row a GM genuinely labelled
// `Image:` is never silently eaten.
//
// The thumbnail is the Infobox's *own* ledger-relative path, not a composed Image
// node: composing would make the Infobox a container for a single fixed child and pay
// the ProseMirror-children cost for nothing. The reusable part is the path-resolution
// helper, which is a function (`$lib/editor/ledger-image`). Its `alt` doubles as the
// visible caption, so the GM labels it once — accepting that the portrait is legible
// but not *visible* in Obsidian.
//
// Nothing about the panel's presentation is in here, and that is the point: the float
// that makes this read like a wiki page's summary box is CSS measured on the block's
// own column (`app.css`), so the same fence renders both ways depending only on the
// space available (#148, #167).
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
//     One exception, found by asserting it rather than assuming it and then left
//     alone: that index strips image syntax *including its alt text*, so a thumbnail's
//     caption is the one part of a panel that is not findable
//     (`search.rs`, `body_search_skips_an_infobox_caption_but_keeps_its_rows`).
import { Node, mergeAttributes } from "@tiptap/core";
import InfoboxBlockView from "$lib/components/editor/InfoboxBlockView.svelte";
import { createBlockNodeView, type BlockView } from "$lib/editor/node-view-connector";
import { fenceInfo } from "$lib/editor/fence-claim";
import { jsonListAttr } from "$lib/editor/block-attrs";
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
  /** The thumbnail's ledger-relative path, "" when the panel has none. */
  image: string;
  /**
   * The thumbnail's alt text, which is also its visible caption.
   *
   * Only meaningful while `image` is set, because the `![alt](path)` line is what
   * carries it: a caption with no path has nowhere in the fence to be written, so
   * parsing never produces one and the view clears both together. Two flat strings
   * rather than one optional pair to match the title, which says "absent" the same way.
   */
  imageAlt: string;
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
  return { title: "", image: "", imageAlt: "", rows: [blankLabelledRow()] };
}

/** Whether a panel holds nothing a GM typed — a fresh insert, still untouched. */
export function isBlankInfobox(infobox: Infobox): boolean {
  return !infobox.title && !infobox.image && infobox.rows.every(isBlankLabelledRow);
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

// ─── The image line ───────────────────────────────────────────────────────────

/**
 * `![The harbour at dusk](images/harbor.png)`, the whole line and nothing else.
 *
 * Both captures are greedy, so the *last* `](` in the line is the separator. That is
 * what lets a caption hold `]` — a `[[wikilink]]` in one is a real link, like every
 * other free text in a block — and a path hold `)`, which a copied image's filename
 * may (`map (1).png`). The only line it misreads is one whose *path* holds `](`: the
 * pair stays inverse over every record parsing can produce, which is the property the
 * round trip needs.
 */
const IMAGE_LINE = /^!\[(.*)\]\((.*)\)$/;

/**
 * A line's thumbnail, or `null` if the line is not an image line at all.
 *
 * A pathless `![]()` is an image line holding no image: it is the shield
 * `serializeInfobox` writes over a first row that would otherwise be read as the
 * thumbnail, and reading it consumes the line while leaving the panel with none.
 */
function imageOf(line: string): { image: string; imageAlt: string } | null {
  const match = IMAGE_LINE.exec(line);
  if (!match) return null;
  const [, alt, src] = match;
  return src ? { image: src, imageAlt: alt } : { image: "", imageAlt: "" };
}

// ─── Parse ────────────────────────────────────────────────────────────────────

/**
 * The body of a fenced ```infobox as a title, a thumbnail and its rows.
 *
 * The title is the first line that has anything on it, and only if it opens with
 * `# ` — a later `# …` line is a row, because a panel has one title. The thumbnail is
 * read at one position only, the next line with anything on it, for the same reason:
 * a second `![…](…)` line is an unlabelled row. Blank lines are decoration and are
 * dropped rather than kept, which is safe in both directions: nothing re-emits them,
 * so a load-and-save cannot grow one either.
 */
export function parseInfoboxBody(body: string): Infobox {
  const lines = body.split("\n");
  let i = 0;
  const skipBlanks = () => {
    while (i < lines.length && lines[i].trim() === "") i++;
  };

  skipBlanks();
  const title = i < lines.length ? titleOf(lines[i]) : null;
  if (title !== null) i++;

  skipBlanks();
  const image = i < lines.length ? imageOf(lines[i]) : null;
  if (image !== null) i++;

  const rows = lines
    .slice(i)
    .filter((line) => line.trim() !== "")
    .map(parseLabelledRow);

  return {
    title: title ?? "",
    image: image?.image ?? "",
    imageAlt: image?.imageAlt ?? "",
    rows,
  };
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
 * Each meta reading collides with the first row in exactly one way, and each is
 * shielded by writing the meta line as its own empty form: a bare `#` over a row that
 * opens with `# `, and a pathless `![]()` over a row that is an image line. Either
 * way the meta stays empty and the row below stays a row.
 */
export function serializeInfobox(infobox: Infobox): string {
  const rowLines = infobox.rows
    .map(serializeLabelledRow)
    .filter((line) => line.trim() !== "");
  const first = rowLines.length ? rowLines[0] : null;

  const lines: string[] = [];
  if (infobox.title) lines.push(`# ${infobox.title}`);
  else if (first !== null && titleOf(first) !== null) lines.push("#");

  if (infobox.image) lines.push(`![${infobox.imageAlt}](${infobox.image})`);
  else if (first !== null && imageOf(first) !== null) lines.push("![]()");

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
      image: {
        default: "",
        parseHTML: (el) => (el as HTMLElement).dataset.image ?? "",
      },
      imageAlt: {
        default: "",
        parseHTML: (el) => (el as HTMLElement).dataset.imageAlt ?? "",
      },
      rows: {
        default: [],
        parseHTML: (el) => jsonListAttr((el as HTMLElement).dataset.rows),
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
          "data-image": node.attrs.image,
          "data-image-alt": node.attrs.imageAlt,
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
      // The float's hook. It sits on the wrapper because the wrapper is the block in
      // the document's flow — the element paragraphs wrap around — and it is an
      // attribute rather than a class so nothing in the note or the view can look
      // like it decides the layout (#148).
      domAttrs: { "data-infobox-block": "" },
      defaults: { title: "", image: "", imageAlt: "", rows: [] },
      props: ({ updateAttributes }) => ({
        onCommit: (infobox: Infobox) =>
          updateAttributes({
            title: infobox.title,
            image: infobox.image,
            imageAlt: infobox.imageAlt,
            rows: infobox.rows,
          }),
      }),
      mounted: (view, attrs) => {
        // A fresh `/infobox`: one empty row, opened for typing straight away.
        const panel: Infobox = {
          title: attrs.title as string,
          image: attrs.image as string,
          imageAlt: attrs.imageAlt as string,
          rows: attrs.rows as LabelledRow[],
        };
        if (panel.rows.length === 1 && isBlankInfobox(panel)) view.focusRow(0);
      },
    });
  },
});
