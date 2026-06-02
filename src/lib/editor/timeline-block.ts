import { Node, mergeAttributes } from "@tiptap/core";
import { mount, unmount } from "svelte";
import TimelineBlockView from "$lib/components/editor/TimelineBlockView.svelte";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TimelineEvent {
  date: string;
  title: string;
  description: string;
}

interface TimelineBlockViewExports {
  setAttrs: (events: TimelineEvent[]) => void;
  openEdit: (index: number) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function createBlankEvent(): TimelineEvent {
  return { date: "", title: "", description: "" };
}

function isBlankEvent(e: TimelineEvent): boolean {
  return !e.date && !e.title && !e.description;
}

export function insertEventAt(
  events: TimelineEvent[],
  index: number,
  event: TimelineEvent,
): TimelineEvent[] {
  const result = [...events];
  result.splice(index, 0, event);
  return result;
}

export function moveEventUp(events: TimelineEvent[], index: number): TimelineEvent[] {
  if (index <= 0 || index >= events.length) return events;
  const result = [...events];
  [result[index - 1], result[index]] = [result[index], result[index - 1]];
  return result;
}

export function moveEventDown(events: TimelineEvent[], index: number): TimelineEvent[] {
  if (index < 0 || index >= events.length - 1) return events;
  const result = [...events];
  [result[index], result[index + 1]] = [result[index + 1], result[index]];
  return result;
}

// ─── Display rendering ───────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Converts `[[...]]` wikilinks in a plain text string to `data-wiki-link` spans
 * suitable for rendering with {@html} in display mode. Plain-text segments are
 * HTML-escaped; the generated spans match the shape that Editor.svelte's delegated
 * handleClick / handleMouseover handlers expect.
 */
export function renderTimelineText(text: string): string {
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
    parts.push(
      `<span data-wiki-link data-path="${escapedPath}" data-title="${escapedTitle}">${escapeHtml(title)}</span>`,
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

// ─── Preprocessor ────────────────────────────────────────────────────────────

const TIMELINE_FENCE_RE = /```timeline\n([\s\S]*?)\n```/g;

/**
 * Converts fenced ```timeline blocks in a markdown string to
 * <timeline-block data-events="..."> HTML elements so TipTap's HTML parser
 * can pick them up via parseHTML(). Called before passing content to the editor.
 */
export function preprocessTimelineBlocks(markdown: string): string {
  return markdown.replace(TIMELINE_FENCE_RE, (_, body: string) => {
    const events = parseTimelineBody(body);
    const encoded = encodeURIComponent(JSON.stringify(events));
    return `<timeline-block data-events="${encoded}"></timeline-block>`;
  });
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

  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write: (s: string) => void; closeBlock: (n: unknown) => void },
          node: { attrs: { events: TimelineEvent[] } },
        ) {
          state.write(serializeTimelineEvents(node.attrs.events));
          state.closeBlock(node);
        },
      },
    };
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("div");
      dom.setAttribute("contenteditable", "false");

      const events = node.attrs.events as TimelineEvent[];

      function onCommit(newEvents: TimelineEvent[]) {
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (pos == null) return;
        editor
          .chain()
          .command(({ tr }) => {
            tr.setNodeMarkup(pos, null, { events: newEvents });
            return true;
          })
          .run();
      }

      const raw = mount(TimelineBlockView, {
        target: dom,
        props: { events, onCommit },
      });
      const component = raw as unknown as TimelineBlockViewExports;

      // Fresh /timeline insert: one blank event → open it in edit mode immediately
      if (events.length === 1 && isBlankEvent(events[0])) {
        component.openEdit(0);
      }

      return {
        dom,
        stopEvent(event: Event) {
          return dom.contains(event.target as globalThis.Node);
        },
        update(updatedNode) {
          if (updatedNode.type !== node.type) return false;
          component.setAttrs(updatedNode.attrs.events as TimelineEvent[]);
          return true;
        },
        destroy() {
          unmount(raw);
        },
      };
    };
  },
});
