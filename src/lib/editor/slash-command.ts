import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { PluginKey } from "prosemirror-state";
import { insertImageFromFile } from "./image-block";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SlashCommandItem {
  group: "Text" | "List" | "Insert";
  label: string;
  keywords: string[]; // extra search terms beyond label
  icon: string; // lucide icon name — resolved to Component in SlashCommandMenu
  command: (
    editor: Editor,
    range: { from: number; to: number },
  ) => void | boolean | Promise<void>;
}

// State pushed to Editor.svelte on every suggestion update.
// x/y are resolved from clientRect inside the render closure — NOT passed as a function.
export interface SlashCommandSuggestionState {
  items: SlashCommandItem[];
  selectedIndex: number; // flat index over all items; group headers not counted
  x: number;
  y: number;
  command: (item: SlashCommandItem) => void; // calls suggestion plugin's command prop
}

interface SlashCommandOptions {
  // Editor.svelte passes a setter here; called on every state change and null on close.
  onSlashCommand: (state: SlashCommandSuggestionState | null) => void;
}

// ─── Command Registry ─────────────────────────────────────────────────────────
// Add future custom node commands here — no other file needs to change.

export const SLASH_COMMANDS: SlashCommandItem[] = [
  // ── Text ──────────────────────────────────────────────────────────────────
  {
    group: "Text",
    label: "Paragraph",
    keywords: ["p", "text", "plain"],
    icon: "Pilcrow",
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    group: "Text",
    label: "Heading 1",
    keywords: ["h1", "title"],
    icon: "Heading1",
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run(),
  },
  {
    group: "Text",
    label: "Heading 2",
    keywords: ["h2", "subtitle"],
    icon: "Heading2",
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run(),
  },
  {
    group: "Text",
    label: "Heading 3",
    keywords: ["h3"],
    icon: "Heading3",
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run(),
  },
  {
    group: "Text",
    label: "Quote",
    keywords: ["blockquote", "cite"],
    icon: "Quote",
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setBlockquote().run(),
  },
  {
    group: "Text",
    label: "Code Block",
    keywords: ["pre", "code", "codeblock"],
    icon: "Code",
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setCodeBlock().run(),
  },
  // ── List ──────────────────────────────────────────────────────────────────
  {
    group: "List",
    label: "Bullet List",
    keywords: ["ul", "unordered"],
    icon: "List",
    // toggleBulletList is intentional: typing /bullet inside a bullet list removes it.
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    group: "List",
    label: "Numbered List",
    keywords: ["ol", "ordered"],
    icon: "ListOrdered",
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  // ── Insert ────────────────────────────────────────────────────────────────
  {
    group: "Insert",
    label: "Divider",
    keywords: ["hr", "rule", "separator"],
    icon: "Minus",
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    group: "Insert",
    label: "Ambient Scene",
    keywords: ["scene", "audio", "ambient", "music"],
    icon: "Music2",
    command: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "sceneBlock",
          attrs: { sceneId: null, expanded: false },
        })
        .run(),
  },
  {
    group: "Insert",
    label: "Image",
    keywords: ["img", "photo", "picture", "embed"],
    icon: "Image",
    command: async (editor, range) => {
      const { open } = await import("@tauri-apps/plugin-dialog");
      editor.chain().focus().deleteRange(range).run();
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "Images",
            extensions: ["jpg", "jpeg", "png", "gif", "webp", "svg"],
          },
        ],
      });
      if (typeof selected === "string") {
        await insertImageFromFile(selected, editor);
      }
    },
  },
];

// ─── Filter ───────────────────────────────────────────────────────────────────

/**
 * Case-insensitive substring match against label and keywords.
 * Empty query returns all commands.
 */
export function filterCommands(query: string): SlashCommandItem[] {
  const q = query.toLowerCase().trim();
  if (!q) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter(
    (item) =>
      item.label.toLowerCase().includes(q) ||
      item.keywords.some((kw) => kw.includes(q)),
  );
}

// ─── Extension ────────────────────────────────────────────────────────────────

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: "slashCommand",

  addOptions() {
    return {
      onSlashCommand: () => {},
    };
  },

  addProseMirrorPlugins() {
    const onSlashCommand = this.options.onSlashCommand;

    return [
      Suggestion({
        pluginKey: new PluginKey("slashCommand"),
        editor: this.editor,
        char: "/",
        startOfLine: false, // '/' opens the menu anywhere in a line
        allowSpaces: false, // session ends on a space keypress

        // Synchronous filter — unlike WikiLink which uses async invoke.
        items: ({ query }: { query: string }) => filterCommands(query),

        // Called when the user selects a command (via Enter, click, or state.command()).
        // props is the selected SlashCommandItem. We delegate to its own command method.
        command: ({
          editor,
          range,
          props,
        }: {
          editor: unknown;
          range: { from: number; to: number };
          props: SlashCommandItem;
        }) => {
          const ed = editor as Editor;
          props.command(ed, range);
        },

        render: () => {
          // selectedIndex and currentState live in this closure.
          // onKeyDown mutates them and calls onSlashCommand to push updates.
          let selectedIndex = 0;
          let currentState: SlashCommandSuggestionState | null = null;

          // Resolves the cursor DOMRect to x/y numbers before pushing to Editor.svelte.
          // Re-called on every onStart/onUpdate so the position is always fresh.
          function buildState(
            props: {
              clientRect?: (() => DOMRect | null) | null;
              items: SlashCommandItem[];
              command: (item: SlashCommandItem) => void;
            },
            si: number,
          ): SlashCommandSuggestionState {
            const rect = props.clientRect?.();
            return {
              items: props.items,
              // props.command is the suggestion plugin's executor — calling it with an
              // item triggers the `command` option above, which calls item.command(editor, range).
              command: props.command,
              selectedIndex: si,
              x: rect?.left ?? 0,
              y: (rect?.bottom ?? 0) + 4,
            };
          }

          type RenderProps = {
            clientRect?: (() => DOMRect | null) | null;
            items: SlashCommandItem[];
            command: (item: SlashCommandItem) => void;
          };

          return {
            onStart(props: RenderProps) {
              selectedIndex = 0;
              currentState = buildState(props, selectedIndex);
              onSlashCommand(currentState);
            },

            onUpdate(props: RenderProps) {
              selectedIndex = 0;
              // Dismiss condition 4: zero results — close the menu but leave text in doc.
              // currentState is nulled here so onKeyDown sees no active menu until onExit.
              if (props.items.length === 0) {
                currentState = null;
                onSlashCommand(null);
                return;
              }
              currentState = buildState(props, selectedIndex);
              onSlashCommand(currentState);
            },

            onKeyDown({ event }: { event: KeyboardEvent }) {
              if (!currentState) return false;
              const count = currentState.items.length;

              // Move down — Tab or ArrowDown
              if (
                event.key === "ArrowDown" ||
                (event.key === "Tab" && !event.shiftKey)
              ) {
                selectedIndex = (selectedIndex + 1) % count;
                currentState = { ...currentState, selectedIndex };
                onSlashCommand(currentState);
                return true; // consumed — prevents Tab from moving browser focus
              }

              // Move up — Shift+Tab or ArrowUp
              if (
                event.key === "ArrowUp" ||
                (event.key === "Tab" && event.shiftKey)
              ) {
                selectedIndex = (selectedIndex - 1 + count) % count;
                currentState = { ...currentState, selectedIndex };
                onSlashCommand(currentState);
                return true;
              }

              // Execute selected command
              if (event.key === "Enter") {
                // Invariant: currentState !== null implies items.length > 0 (enforced above).
                if (currentState.items[selectedIndex]) {
                  currentState.command(currentState.items[selectedIndex]);
                }
                return true;
              }

              // Dismiss — Escape
              // Must null currentState here (same as zero-results) so subsequent
              // onKeyDown calls before onExit fires don't execute against the hidden menu.
              if (event.key === "Escape") {
                currentState = null;
                onSlashCommand(null);
                return true;
              }

              return false;
            },

            // onExit fires when the plugin session ends (e.g., backspace past '/').
            // Always resets regardless of whether currentState is already null (idempotent).
            onExit() {
              currentState = null;
              selectedIndex = 0;
              onSlashCommand(null);
            },
          };
        },
      }),
    ];
  },
});
