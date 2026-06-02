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

// ─── Parse ────────────────────────────────────────────────────────────────────

/**
 * Parses the body of a fenced ```timeline block into TimelineEvent records.
 * Records are blank-line-separated; within a record, lines starting with
 * "Date: " and "Title: " set those fields and all other lines are description.
 */
export function parseTimelineBody(body: string): TimelineEvent[] {
  const rawRecords = body.split(/\n\n+/).filter((r) => r.trim());
  return rawRecords.map((record) => {
    let date = "";
    let title = "";
    const descLines: string[] = [];

    for (const line of record.split("\n")) {
      if (line.startsWith("Date: ")) {
        date = line.slice(6);
      } else if (line.startsWith("Title: ")) {
        title = line.slice(7);
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
