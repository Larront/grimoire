import { Node, mergeAttributes } from "@tiptap/core";
import TimelineBlockView from "$lib/components/editor/TimelineBlockView.svelte";
import { createBlockNodeView, type BlockView } from "$lib/editor/node-view-connector";
import { fenceInfo } from "$lib/editor/fence-claim";
import { blockDom, listAttr } from "$lib/editor/block-attrs";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TimelineEvent {
  date: string;
  title: string;
  description: string;
}

/**
 * The block's record — one field, and named all the same (#209). A record is what the
 * connector, the schema and the view are typed against, so a timeline that later carries
 * anything beside its events adds a field here and nowhere else.
 */
export interface Timeline {
  events: TimelineEvent[];
}

/** A freshly inserted timeline opens its one blank event, so its view must let it. */
interface TimelineBlockViewExports extends BlockView<Timeline> {
  focusRow: (index: number) => void;
}

/**
 * How the timeline's record crosses the DOM, declared once: the schema's attributes, the
 * `data-*` a copied timeline travels as, and the node view's stand-ins are all read off
 * this table.
 */
const TIMELINE_DOM = blockDom<Timeline>({
  events: listAttr<TimelineEvent>(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function createBlankEvent(): TimelineEvent {
  return { date: "", title: "", description: "" };
}

function isBlankEvent(e: TimelineEvent): boolean {
  return !e.date && !e.title && !e.description;
}

// Order — inserting, moving and deleting events — is the Row List's (#173), which
// the view reaches directly. Nothing about ordering lives here any more.

// Display rendering used to be here: an HTML-escaper and a function building
// `data-wiki-link` spans as a string for `{@html}`. Both are gone (#214) — the view's
// values are Linked Text Fields, which split a value into segments Svelte draws, so the
// escaping problem is deleted rather than kept in a second escaper. Nothing about how a
// timeline *looks* lives in this file any more.

// ─── Grammar ──────────────────────────────────────────────────────────────────
//
// An event begins at a column-zero `#` heading carrying its title, then an
// optional `Date:` line, then free description prose in which blank lines are
// legal. The heading is the record boundary.
//
// This replaced a grammar in which `Title:` was a labelled line and *any* blank
// line ended the record, which meant a hand-authored two-paragraph description
// was silently split into a second, untitled event on the next autosave (#184).
// The `#` form also matches Infobox and Statblock, where `#` names the thing.
// A parser-only fix was available and free; it lost because it leaves the
// boundary as a special case a GM has to know about.
//
// Existing vaults are brought across by the Timeline [[Format Migration]]
// (`src-tauri/src/format_migration/timeline_v1.rs`), which is this file's old
// parser followed by this file's new serializer — including the heading escape
// below, which is why the migration warns about it.

/** A column-zero heading line: `# Title`, or a bare `#` for an untitled event. */
const HEADING_LINE = /^#(?: (.*))?$/;

/** Drop leading and trailing empty lines, leaving interior blank lines alone. */
function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === "") start++;
  while (end > start && lines[end - 1] === "") end--;
  return lines.slice(start, end);
}

// ─── Parse ────────────────────────────────────────────────────────────────────

/**
 * Parses the body of a fenced ```timeline block into TimelineEvent records.
 *
 * A `Date:` line counts as the date only immediately under the heading — which
 * is what the blank line the serializer writes between header and description
 * buys: a description whose first line reads `Date: yesterday` stays prose.
 * Everything after the header is description, with the blank lines that separate
 * one record from the next trimmed off the ends.
 *
 * Read forgivingly on two points, so a file hand-edited in Obsidian survives:
 * the blank line under the header is optional, and lines before the first
 * heading belong to no event and are dropped rather than guessed at.
 */
export function parseTimelineBody(body: string): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  let current: TimelineEvent | null = null;
  let descLines: string[] = [];
  // Whether anything has followed the current event's heading yet — a `Date:`
  // line is only the date when nothing has.
  let underHeading = false;

  const flush = () => {
    if (current) {
      current.description = trimBlankLines(descLines).join("\n");
      events.push(current);
    }
  };

  for (const line of body.split("\n")) {
    const heading = HEADING_LINE.exec(line);
    if (heading) {
      flush();
      current = { date: "", title: heading[1] ?? "", description: "" };
      descLines = [];
      underHeading = true;
      continue;
    }
    if (!current) continue;
    if (underHeading && line.startsWith("Date: ")) {
      current.date = line.slice(6);
      underHeading = false;
      continue;
    }
    underHeading = false;
    descLines.push(line);
  }
  flush();

  return events;
}

// ─── Serialize ────────────────────────────────────────────────────────────────

/**
 * A description line that is itself a column-zero heading would read back as the
 * start of a new event, so it gets one leading space. This is the only place the
 * Timeline format edits what the GM typed rather than Grimoire's own syntax —
 * hence the [[Format Migration]] raising a warning wherever it has to do it.
 */
function escapeHeadingLines(description: string): string {
  return description
    .split("\n")
    .map((line) => (HEADING_LINE.test(line) ? ` ${line}` : line))
    .join("\n");
}

/**
 * Serializes an array of TimelineEvents to a fenced ```timeline block.
 * Date and description are omitted when empty; a description is separated from
 * the header by a blank line, and records by a blank line from each other.
 */
export function serializeTimelineEvents(events: TimelineEvent[]): string {
  const records = events.map((evt) => {
    const lines: string[] = [`# ${evt.title}`];
    if (evt.date) lines.push(`Date: ${evt.date}`);
    if (evt.description) lines.push("", escapeHeadingLines(evt.description));
    return lines.join("\n");
  });
  return "```timeline\n" + records.join("\n\n") + "\n```";
}

// ─── Extension ────────────────────────────────────────────────────────────────

export const TimelineBlock = Node.create({
  name: "timelineBlock",
  group: "block",
  atom: true,
  // Draggable so a grip can carry it. ProseMirror will not drag a node whose spec does
  // not allow it, however the selection was made.
  draggable: true,

  addAttributes() {
    return TIMELINE_DOM.attributes;
  },

  parseHTML() {
    return [{ tag: "timeline-block" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "timeline-block",
      mergeAttributes(TIMELINE_DOM.dataset(node.attrs as Timeline), HTMLAttributes),
    ];
  },

  // Timeline's declaration to the markdown reader: a fenced code token whose
  // language is `timeline` is one of these, at any nesting depth. Anything else
  // is declined with `[]` and stays whatever the reader makes of it.
  markdownTokenName: "code",

  parseMarkdown: (token) =>
    fenceInfo(token) === "timeline"
      ? {
          type: "timelineBlock",
          attrs: { events: parseTimelineBody(token.text ?? "") },
        }
      : [],

  // @ts-expect-error — renderMarkdown is read by @tiptap/markdown via getExtensionField
  renderMarkdown(node: { attrs: Timeline }) {
    return serializeTimelineEvents(node.attrs.events);
  },

  addNodeView() {
    return createBlockNodeView<Timeline, TimelineBlockViewExports>({
      component: TimelineBlockView,
      domAttrs: { "data-note-block": "timeline" },
      defaults: TIMELINE_DOM.defaults,
      // The record is the write-back's argument: the connector merges a `Partial<Timeline>`
      // into the node, so nothing here re-lists what a timeline holds.
      props: ({ updateAttributes }) => ({ onCommit: updateAttributes }),
      mounted: (view, { events }) => {
        // Fresh /timeline insert: one blank event → its title opens for typing, the way
        // a fresh infobox's first row does.
        if (events.length === 1 && isBlankEvent(events[0])) view.focusRow(0);
      },
    });
  },
});
