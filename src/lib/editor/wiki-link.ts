import { Node, mergeAttributes, nodeInputRule } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { parseWikiTarget, wikiStem } from "./wiki-target";
import {
  describeWikiMenu,
  looksLikeProse,
  parseWikiQuery,
  readWikiSuggestKey,
  searchWikiTargets,
  wikiLinkTarget,
  wikiMenuAnchor,
  type WikiMenuAnchor,
  type WikiSuggestion,
} from "./wiki-suggest";

interface WikiBrokenState {
  broken: Set<string>;
  deco: DecorationSet;
}

// Editor.svelte resolves which wikilink targets don't exist and pushes the set of
// broken paths through this key; the plugin below turns that into node decorations
// (data-broken) so stubs render faded. Resolution lives in the component because it
// needs the reactive notes store and async alias lookups, which a plugin can't reach.
export const wikiBrokenLinkKey = new PluginKey<WikiBrokenState>("wikiBrokenLink");

// The target text rules live in wiki-target.ts (TipTap-free, so the Link Resolver
// can share them) and the dropdown's grammar in wiki-suggest.ts (TipTap-free, so a
// Linked Text Field can share it); both re-exported here because this is where callers
// look for them.
export { stripWikiFragment, wikiStem, parseWikiTarget } from "./wiki-target";
export type { WikiSuggestion } from "./wiki-suggest";

export interface WikiLinkSuggestionState extends WikiMenuAnchor {
  items: WikiSuggestion[];
  command: (item: WikiSuggestion) => void;
  selectedIndex: number; // managed by the suggestion plugin's onKeyDown, not the component
  /** The pointer moved onto a row: it becomes the one Enter takes. */
  select: (index: number) => void;
  /** Read the caret's position again — the note scrolled under the open menu. */
  reposition: () => void;
}

// `[[target]]`, anchored: a tokenizer is offered the rest of the line, and a
// target holds no brackets of its own.
const WIKI_LINK_RE = /^\[\[([^[\]]+)\]\]/;

/**
 * True when the `[[` about to be read is the second character of `![[…]]` — an
 * Obsidian transclusion, which Grimoire renders as the text the GM typed rather
 * than as a link.
 *
 * The `!` is not part of what the tokenizer is offered: the reader hands over the
 * source from `[[` onwards, having already taken the `!` as text. So the evidence
 * is the tail of the token in front of us.
 */
function followsTransclusionBang(tokens: { raw?: string }[]): boolean {
  return tokens.at(-1)?.raw?.endsWith("!") ?? false;
}

interface WikiLinkOptions {
  // Called by the suggestion system to push state updates to the editor component.
  // Editor.svelte passes a setter here so it can render the dropdown in its template.
  onSuggestion: (state: WikiLinkSuggestionState | null) => void;
  /**
   * The note being written in, which a bare `[[` leaves out of its recent notes: a note
   * linking to itself is never what the GM was reaching for.
   */
  notePath: () => string | null;
}

export const WikiLink = Node.create<WikiLinkOptions>({
  name: "wikiLink",
  group: "inline",
  inline: true,
  atom: true,

  addOptions() {
    return {
      onSuggestion: () => {},
      notePath: () => null,
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
    // Color and cursor are driven by CSS off [data-wiki-link] / [data-broken], so a
    // link in prose and a link inside a Linked Text Field share one styling source.
    // The broken marker is applied by the decoration plugin below, not by the node view.
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
          dom.textContent = updatedNode.attrs.title ?? updatedNode.attrs.path ?? "?";
          return true;
        },
      };
    };
  },

  // A wikilink's declaration to the markdown reader, which replaces the raw-text
  // pass that used to rewrite `[[…]]` into HTML before the reader ever saw the
  // note. That pass could not tell prose from a fence, so a `[[…]]` a GM typed
  // inside a code fence came back as a span; the reader knows the difference,
  // because it only offers a tokenizer the text it is already treating as inline.
  markdownTokenizer: {
    name: "wikiLink",
    level: "inline",
    start: (src: string) => src.indexOf("[["),
    tokenize: (src: string, tokens: { raw?: string }[]) => {
      const match = WIKI_LINK_RE.exec(src);
      if (!match) return undefined;
      if (followsTransclusionBang(tokens)) return undefined;
      return { type: "wikiLink", raw: match[0], text: match[1] };
    },
  },

  parseMarkdown: (token, helpers) =>
    helpers.createNode("wikiLink", parseWikiTarget(token.text ?? "")),

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
    const notePath = this.options.notePath;

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
              decos.push(
                Decoration.node(pos, pos + node.nodeSize, {
                  "data-broken": "",
                }),
              );
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
        // A name has spaces in it — "The Ember Keep" — and the first one used to end the
        // search, so most of a world's names could not be typed into it. `looksLikeProse`
        // closes the menu for a stray `[[` the GM has written a sentence after instead.
        allowSpaces: true,
        // Any character may come before the brackets, as in a field: `([[Mira` and
        // `"[[Mira` never opened the menu, because the default wants a space in front.
        allowedPrefixes: null,

        items: ({ query }: { query: string }) =>
          looksLikeProse(query) ? [] : searchWikiTargets(query, notePath()),

        // Whatever the GM typed after the name — `#heading`, `|display` — is written with
        // the note they chose. It used to be dropped: `[[keep|the Keep` wrote a bare link.
        command: ({
          editor,
          range,
          props,
        }: {
          editor: unknown;
          range: { from: number; to: number };
          props: WikiSuggestion;
        }) => {
          const ed = editor as import("@tiptap/core").Editor;
          const typed = ed.state.doc.textBetween(range.from, range.to).replace(/^\[\[/, "");
          ed.chain()
            .focus()
            .deleteRange(range)
            .insertContent({
              type: "wikiLink",
              attrs: parseWikiTarget(wikiLinkTarget(props, parseWikiQuery(typed))),
            })
            .run();
        },

        render: () => {
          // selectedIndex is tracked in this closure, not in the Svelte component.
          // This keeps keyboard navigation in one place (onKeyDown below) and avoids
          // global svelte:window listeners that would conflict with other key handlers.
          let selectedIndex = 0;
          let currentState: WikiLinkSuggestionState | null = null;
          let lastProps: RenderProps | null = null;

          type RenderProps = {
            editor: import("@tiptap/core").Editor;
            query: string;
            clientRect?: (() => DOMRect | null) | null;
            items: WikiSuggestion[];
            command: (p: WikiSuggestion) => void;
          };

          function buildState(props: RenderProps, si: number): WikiLinkSuggestionState {
            return {
              items: props.items,
              command: props.command,
              selectedIndex: si,
              select,
              reposition,
              ...wikiMenuAnchor(props.clientRect?.()),
            };
          }

          // The editor names the menu it opened and the row Enter will take, so a screen
          // reader follows the selection while focus stays in the text.
          function push(state: WikiLinkSuggestionState | null) {
            currentState = state;
            describeWikiMenu(
              lastProps?.editor.view.dom,
              state && { itemCount: state.items.length, selectedIndex: state.selectedIndex },
            );
            onSuggestion(state);
          }

          function select(index: number) {
            if (!currentState || index === selectedIndex) return;
            selectedIndex = index;
            push({ ...currentState, selectedIndex });
          }

          function reposition() {
            if (!currentState || !lastProps) return;
            push(buildState(lastProps, selectedIndex));
          }

          return {
            onStart(props: RenderProps) {
              lastProps = props;
              selectedIndex = 0;
              push(buildState(props, selectedIndex));
            },

            onUpdate(props: RenderProps) {
              lastProps = props;
              selectedIndex = 0;
              // A stray `[[` followed by a sentence: close, and leave the text alone.
              if (looksLikeProse(props.query)) {
                push(null);
                return;
              }
              push(buildState(props, selectedIndex));
            },

            // What each key means is `readWikiSuggestKey`'s, shared with the Linked
            // Text Field; what is left here is prose's own half — moving the highlight
            // is a closure variable, and accepting runs TipTap's `command`.
            onKeyDown({ event }: { event: KeyboardEvent }) {
              if (!currentState) return false;
              const verdict = readWikiSuggestKey(event.key, {
                itemCount: currentState.items.length,
                selectedIndex,
                shiftKey: event.shiftKey,
              });
              if (!verdict) return false;

              if (verdict.kind === "move") {
                selectedIndex = verdict.selectedIndex;
                push({ ...currentState, selectedIndex });
              } else if (verdict.kind === "dismiss") {
                push(null);
              } else {
                currentState.command(currentState.items[verdict.selectedIndex]);
              }
              return true;
            },

            onExit() {
              push(null);
              selectedIndex = 0;
              lastProps = null;
            },
          };
        },
      }),
    ];
  },
});
