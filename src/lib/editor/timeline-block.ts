import { Node, mergeAttributes } from "@tiptap/core";
import TimelineBlockView from "$lib/components/editor/TimelineBlockView.svelte";
import {
  createBlockNodeView,
  type BlockView,
} from "$lib/editor/node-view-connector";
import { fenceInfo } from "$lib/editor/fence-claim";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TimelineEvent {
  date: string;
  title: string;
  description: string;
}

/** A freshly inserted timeline opens its one blank event, so its view must let it. */
interface TimelineBlockViewExports extends BlockView {
  openEdit: (index: number) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function createBlankEvent(): TimelineEvent {
  return { date: "", title: "", description: "" };
}

function isBlankEvent(e: TimelineEvent): boolean {
  return !e.date && !e.title && !e.description;
}

// Order — inserting, moving and deleting events — is the Row List's (#173), which
// the view reaches directly. Nothing about ordering lives here any more.

// ─── Display rendering ───────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Converts `[[...]]` wikilinks in a plain text string to `data-wiki-link` spans
 * suitable for rendering with {@html} in display mode. Plain-text segments are
 * HTML-escaped; the generated spans match the shape that Editor.svelte's delegated
 * handleClick / handleMouseover handlers expect.
 *
 * `isKnownPath` resolves whether a link points at an existing note. Links it
 * rejects get a `data-broken` marker so they can be styled as faded-accent stubs
 * (full-accent for resolved links). When omitted, no link is marked broken.
 */
export function renderTimelineText(
  text: string,
  isKnownPath?: (path: string) => boolean,
): string {
  const re = /\[\[([^\]]+)\]\]/g;
  const parts: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    parts.push(escapeHtml(text.slice(lastIndex, match.index)));

    const rawInner = match[1].trim();
    const pipeIdx = rawInner.indexOf("|");
    const path = pipeIdx >= 0 ? rawInner.slice(0, pipeIdx).trim() : rawInner;
    const title =
      pipeIdx >= 0
        ? rawInner.slice(pipeIdx + 1).trim()
        : (path.split("/").pop()?.replace(/\.md$/, "") ?? path);

    const escapedPath = path.replace(/"/g, "&quot;");
    const escapedTitle = title.replace(/"/g, "&quot;");
    const brokenAttr = isKnownPath && !isKnownPath(path) ? " data-broken" : "";
    parts.push(
      `<span data-wiki-link${brokenAttr} data-path="${escapedPath}" data-title="${escapedTitle}">${escapeHtml(title)}</span>`,
    );

    lastIndex = match.index + match[0].length;
  }

  parts.push(escapeHtml(text.slice(lastIndex)));
  return parts.join("");
}

// ─── Parse ────────────────────────────────────────────────────────────────────

/**
 * Parses the body of a fenced ```timeline block into TimelineEvent records.
 * Records are blank-line-separated. Within a record, the header is the leading
 * lines: an optional "Date: " line followed by the "Title: " line (the order the
 * serializer always emits). The "Title: " line ends the header — every line after
 * it is description, even if it starts with "Date: " or "Title: ", so description
 * content that happens to look like a label round-trips without being clobbered.
 */
export function parseTimelineBody(body: string): TimelineEvent[] {
  const rawRecords = body.split(/\n\n+/).filter((r) => r.trim());
  return rawRecords.map((record) => {
    let date = "";
    let title = "";
    let titleSeen = false;
    const descLines: string[] = [];

    for (const line of record.split("\n")) {
      if (!titleSeen && line.startsWith("Date: ")) {
        date = line.slice(6);
      } else if (!titleSeen && line.startsWith("Title: ")) {
        title = line.slice(7);
        titleSeen = true;
      } else {
        descLines.push(line);
      }
    }

    return { date, title, description: descLines.join("\n") };
  });
}

// ─── Serialize ────────────────────────────────────────────────────────────────

/**
 * Serializes an array of TimelineEvents to a fenced ```timeline block.
 * Date and description are omitted when empty; records are blank-line-separated.
 */
export function serializeTimelineEvents(events: TimelineEvent[]): string {
  const records = events.map((evt) => {
    const lines: string[] = [];
    if (evt.date) lines.push(`Date: ${evt.date}`);
    lines.push(`Title: ${evt.title}`);
    if (evt.description) lines.push(evt.description);
    return lines.join("\n");
  });
  return "```timeline\n" + records.join("\n\n") + "\n```";
}

// ─── Extension ────────────────────────────────────────────────────────────────

export const TimelineBlock = Node.create({
  name: "timelineBlock",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      events: {
        default: [],
        parseHTML: (el) => {
          try {
            return JSON.parse(
              decodeURIComponent((el as HTMLElement).dataset.events ?? "[]"),
            );
          } catch {
            return [];
          }
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "timeline-block" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "timeline-block",
      mergeAttributes(
        { "data-events": encodeURIComponent(JSON.stringify(node.attrs.events)) },
        HTMLAttributes,
      ),
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
  renderMarkdown(node: { attrs: { events: TimelineEvent[] } }) {
    return serializeTimelineEvents(node.attrs.events);
  },

  addNodeView() {
    return createBlockNodeView<TimelineBlockViewExports>({
      component: TimelineBlockView,
      defaults: { events: [] },
      props: ({ updateAttributes }) => ({
        onCommit: (events: TimelineEvent[]) => updateAttributes({ events }),
      }),
      mounted: (view, attrs) => {
        // Fresh /timeline insert: one blank event → open it in edit mode immediately
        const events = attrs.events as TimelineEvent[];
        if (events.length === 1 && isBlankEvent(events[0])) view.openEdit(0);
      },
    });
  },
});
