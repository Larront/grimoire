import { Node, mergeAttributes, nodeInputRule } from "@tiptap/core";
import { api } from "$lib/api";
import Suggestion from "@tiptap/suggestion";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

interface WikiBrokenState {
  broken: Set<string>;
  deco: DecorationSet;
}

// Editor.svelte resolves which wikilink targets don't exist and pushes the set of
// broken paths through this key; the plugin below turns that into node decorations
// (data-broken) so stubs render faded. Resolution lives in the component because it
// needs the reactive notes store and async alias lookups, which a plugin can't reach.
export const wikiBrokenLinkKey = new PluginKey<WikiBrokenState>("wikiBrokenLink");

// The display title a path falls back to when no explicit alias is given:
// the last path segment with any .md extension stripped.
export function wikiStem(path: string): string {
  return path.split("/").pop()?.replace(/\.md$/, "") ?? path;
}

// Splits the inside of a [[...]] link into its target path and display title.
// `path|display` uses the explicit alias; otherwise the title is the path stem.
export function parseWikiTarget(raw: string): { path: string; title: string } {
  const inner = raw.trim();
  const pipe = inner.indexOf("|");
  const path = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
  const title = pipe >= 0 ? inner.slice(pipe + 1).trim() : wikiStem(path);
  return { path, title };
}

export interface WikiLinkSuggestionState {
  items: NoteSearchResult[];
  command: (item: NoteSearchResult) => void;
  selectedIndex: number; // managed by the suggestion plugin's onKeyDown, not the component
  x: number;
  y: number;
}

export interface NoteSearchResult {
  id: number;
  title: string;
  path: string;
}

// Converts [[path]] occurrences in a markdown string to <span data-wiki-link>
// HTML before passing to Tiptap's setContent. Called on initial load and
// on watcher reloads.
export function preprocessWikiLinks(markdown: string): string {
  return markdown.replace(/\[\[([^\]]+)\]\]/g, (_match, rawPath: string) => {
    const { path, title } = parseWikiTarget(rawPath);
    const escapedPath = path.replace(/"/g, "&quot;");
    const escapedTitle = title.replace(/"/g, "&quot;");
    return `<span data-wiki-link data-path="${escapedPath}" data-title="${escapedTitle}">${escapedTitle}</span>`;
  });
}

interface WikiLinkOptions {
  // Called by the suggestion system to push state updates to the editor component.
  // Editor.svelte passes a setter here so it can render the dropdown in its template.
  onSuggestion: (state: WikiLinkSuggestionState | null) => void;
}

export const WikiLink = Node.create<WikiLinkOptions>({
  name: "wikiLink",
  group: "inline",
  inline: true,
  atom: true,

  addOptions() {
    return {
      onSuggestion: () => {},
    };
  },

  addAttributes() {
    return {
      path: { default: null },
      title: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-wiki-link]",
        getAttrs: (element) => {
          const el = element as HTMLElement;
          return {
            path: el.dataset.path ?? null,
            title: el.dataset.title ?? null,
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(
        {
          "data-wiki-link": "",
          "data-path": node.attrs.path,
          "data-title": node.attrs.title,
        },
        HTMLAttributes,
      ),
      node.attrs.title ?? node.attrs.path,
    ];
  },

  addNodeView() {
    // Color and cursor are driven by CSS off [data-wiki-link] / [data-broken] so the
    // editor and the timeline's {@html} links share one styling source. The broken
    // marker is applied by the decoration plugin below, not by the node view.
    return ({ node }) => {
      const dom = document.createElement("span");
      // Plain inline (not inline-flex): a flex box centers its content on the
      // cross-axis, which lifts the label off the surrounding text baseline.
      // The link is just a text label, so let it flow inline like normal text.
      dom.className = "select-none whitespace-nowrap";
      dom.dataset.wikiLink = "";
      dom.dataset.path = node.attrs.path ?? "";
      dom.dataset.title = node.attrs.title ?? "";
      dom.textContent = node.attrs.title ?? node.attrs.path ?? "?";

      return {
        dom,
        update(updatedNode) {
          if (updatedNode.type !== node.type) return false;
          dom.dataset.path = updatedNode.attrs.path ?? "";
          dom.dataset.title = updatedNode.attrs.title ?? "";
          dom.textContent =
            updatedNode.attrs.title ?? updatedNode.attrs.path ?? "?";
          return true;
        },
      };
    };
  },

  // @ts-expect-error — renderMarkdown is read by @tiptap/markdown via getExtensionField
  renderMarkdown(node: { attrs: { path: string; title: string } }) {
    // Round-trip the alias only when the title isn't what parseWikiTarget would
    // derive from the path — otherwise [[path]] alone reloads to the same title.
    if (node.attrs.title && node.attrs.title !== wikiStem(node.attrs.path)) {
      return `[[${node.attrs.path}|${node.attrs.title}]]`;
    }
    return `[[${node.attrs.path}]]`;
  },

  // Typing a complete [[target]] (closing the brackets yourself) commits a literal
  // link to exactly what you typed — a stub when the target doesn't exist yet —
  // instead of accepting whatever the suggestion popup happened to highlight. This
  // gives a deterministic escape hatch from loose autocomplete matches.
  addInputRules() {
    return [
      nodeInputRule({
        find: /\[\[[^[\]]+\]\]$/,
        type: this.type,
        getAttributes: (match) => parseWikiTarget(match[0].slice(2, -2)),
      }),
    ];
  },

  addProseMirrorPlugins() {
    const onSuggestion = this.options.onSuggestion;

    // Decorates wikiLink nodes whose path is in the broken set (fed via meta) with
    // data-broken. Rebuilds when a new set arrives or the doc changes; otherwise the
    // existing DecorationSet is mapped forward untouched.
    const brokenLinkPlugin = new Plugin<WikiBrokenState>({
      key: wikiBrokenLinkKey,
      state: {
        init: () => ({ broken: new Set<string>(), deco: DecorationSet.empty }),
        apply(tr, value, _oldState, newState) {
          const meta = tr.getMeta(wikiBrokenLinkKey) as Set<string> | undefined;
          if (!meta && !tr.docChanged) return value;
          const broken = meta ?? value.broken;
          const decos: Decoration[] = [];
          newState.doc.descendants((node, pos) => {
            if (node.type.name !== "wikiLink") return;
            const path = node.attrs.path as string | null;
            if (path && broken.has(path)) {
              decos.push(Decoration.node(pos, pos + node.nodeSize, { "data-broken": "" }));
            }
          });
          return { broken, deco: DecorationSet.create(newState.doc, decos) };
        },
      },
      props: {
        decorations(state) {
          return wikiBrokenLinkKey.getState(state)?.deco;
        },
      },
    });

    return [
      brokenLinkPlugin,
      Suggestion({
        editor: this.editor,
        char: "[[",
        startOfLine: false,

        items: async ({ query }: { query: string }) => {
          try {
            return await api.searchNotes(query);
          } catch {
            return [];
          }
        },

        command: ({
          editor,
          range,
          props,
        }: {
          editor: unknown;
          range: { from: number; to: number };
          props: NoteSearchResult;
        }) => {
          const ed = editor as import("@tiptap/core").Editor;
          ed.chain()
            .focus()
            .deleteRange(range)
            .insertContent({
              type: "wikiLink",
              attrs: { path: props.path, title: props.title },
            })
            .run();
        },

        render: () => {
          // selectedIndex is tracked in this closure, not in the Svelte component.
          // This keeps keyboard navigation in one place (onKeyDown below) and avoids
          // global svelte:window listeners that would conflict with other key handlers.
          let selectedIndex = 0;
          let currentState: WikiLinkSuggestionState | null = null;

          function buildState(
            props: {
              clientRect?: (() => DOMRect | null) | null;
              items: NoteSearchResult[];
              command: (p: NoteSearchResult) => void;
            },
            si: number,
          ): WikiLinkSuggestionState {
            const rect = props.clientRect?.();
            return {
              items: props.items,
              command: props.command,
              selectedIndex: si,
              x: rect?.left ?? 0,
              y: (rect?.bottom ?? 0) + 4,
            };
          }

          return {
            onStart(props: {
              clientRect?: (() => DOMRect | null) | null;
              items: NoteSearchResult[];
              command: (p: NoteSearchResult) => void;
            }) {
              selectedIndex = 0;
              currentState = buildState(props, selectedIndex);
              onSuggestion(currentState);
            },

            onUpdate(props: {
              clientRect?: (() => DOMRect | null) | null;
              items: NoteSearchResult[];
              command: (p: NoteSearchResult) => void;
            }) {
              selectedIndex = 0;
              currentState = buildState(props, selectedIndex);
              onSuggestion(currentState);
            },

            onKeyDown({ event }: { event: KeyboardEvent }) {
              if (!currentState) return false;
              const count = Math.max(currentState.items.length, 1);

              if (event.key === "ArrowDown") {
                selectedIndex = (selectedIndex + 1) % count;
                currentState = { ...currentState, selectedIndex };
                onSuggestion(currentState);
                return true;
              }
              if (event.key === "ArrowUp") {
                selectedIndex = (selectedIndex - 1 + count) % count;
                currentState = { ...currentState, selectedIndex };
                onSuggestion(currentState);
                return true;
              }
              if (event.key === "Enter") {
                if (currentState.items[selectedIndex]) {
                  currentState.command(currentState.items[selectedIndex]);
                }
                return true;
              }
              if (event.key === "Escape") {
                onSuggestion(null);
                return true;
              }
              return false;
            },

            onExit() {
              currentState = null;
              selectedIndex = 0;
              onSuggestion(null);
            },
          };
        },
      }),
    ];
  },
});
