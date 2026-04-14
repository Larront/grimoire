import { Node, mergeAttributes } from "@tiptap/core";
import { invoke } from "@tauri-apps/api/core";
import Suggestion from "@tiptap/suggestion";

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
    const path = rawPath.trim();
    const title = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
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
        HTMLAttributes
      ),
      node.attrs.title ?? node.attrs.path,
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");

      const applyClasses = (el: HTMLElement) => {
        const broken = el.dataset.broken !== undefined;
        el.className = broken
          ? "inline-flex items-center text-foreground-muted line-through cursor-default select-none whitespace-nowrap"
          : "inline-flex items-center text-accent cursor-pointer select-none whitespace-nowrap";
      };

      dom.dataset.wikiLink = "";
      dom.dataset.path = node.attrs.path ?? "";
      dom.dataset.title = node.attrs.title ?? "";
      dom.textContent = node.attrs.title ?? node.attrs.path ?? "?";
      applyClasses(dom);

      return {
        dom,
        update(updatedNode) {
          if (updatedNode.type !== node.type) return false;
          dom.dataset.path = updatedNode.attrs.path ?? "";
          dom.dataset.title = updatedNode.attrs.title ?? "";
          dom.textContent = updatedNode.attrs.title ?? updatedNode.attrs.path ?? "?";
          applyClasses(dom);
          return true;
        },
      };
    };
  },

  // @ts-expect-error — renderMarkdown is read by @tiptap/markdown via getExtensionField
  renderMarkdown(node: { attrs: { path: string } }) {
    return `[[${node.attrs.path}]]`;
  },

  addProseMirrorPlugins() {
    const onSuggestion = this.options.onSuggestion;

    return [
      Suggestion({
        editor: this.editor,
        char: "[[",
        startOfLine: false,

        items: async ({ query }: { query: string }) => {
          try {
            return await invoke<NoteSearchResult[]>("search_notes", { query });
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
            .insertContent({ type: "wikiLink", attrs: { path: props.path, title: props.title } })
            .run();
        },

        render: () => {
          // selectedIndex is tracked in this closure, not in the Svelte component.
          // This keeps keyboard navigation in one place (onKeyDown below) and avoids
          // global svelte:window listeners that would conflict with other key handlers.
          let selectedIndex = 0;
          let currentState: WikiLinkSuggestionState | null = null;

          function buildState(
            props: { clientRect?: (() => DOMRect | null) | null; items: NoteSearchResult[]; command: (p: NoteSearchResult) => void },
            si: number
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
            onStart(props: { clientRect?: (() => DOMRect | null) | null; items: NoteSearchResult[]; command: (p: NoteSearchResult) => void }) {
              selectedIndex = 0;
              currentState = buildState(props, selectedIndex);
              onSuggestion(currentState);
            },

            onUpdate(props: { clientRect?: (() => DOMRect | null) | null; items: NoteSearchResult[]; command: (p: NoteSearchResult) => void }) {
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
