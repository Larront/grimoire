import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { PluginKey } from "prosemirror-state";
import type { BlockIconName } from "$lib/components/editor/block-icons";
import { nameAndIcon } from "./block-vocabulary";
import { CALLOUT_TYPES } from "./callout-block";
import { insertImageFromFile } from "./image-block";
import { blankInfobox } from "./infobox-block";
import { blankSceneRef } from "./scene-block.svelte";
import { statblockFromPreset } from "./statblock-presets";
import { statblockPresets } from "$lib/stores/statblock-presets.svelte";
import { createBlankEvent } from "./timeline-block";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SlashCommandItem {
  group: "Text" | "List" | "Insert" | "Callout";
  label: string;
  keywords: string[]; // extra search terms beyond label
  /**
   * Lucide icon name — resolved to a Component in SlashCommandMenu. A name that exists:
   * a typo is a build error rather than an item drawn with no glyph (#220).
   */
  icon: BlockIconName;
  /**
   * Whether the command reads the words typed after its name. A space used to end
   * the suggestion session outright; it now survives, so this flag is what keeps
   * `/quote ` closing mid-sentence while `/statblock goblin` reaches its preset.
   */
  acceptsArgument?: boolean;
  command: (
    editor: Editor,
    range: { from: number; to: number },
    /** Everything typed after the command's name, trimmed. "" for most commands. */
    argument: string,
  ) => void | boolean | Promise<void>;
}

// State pushed to Editor.svelte on every suggestion update.
// x/y are resolved from clientRect inside the render closure — NOT passed as a function.
export interface SlashCommandSuggestionState {
  items: SlashCommandItem[];
  selectedIndex: number; // flat index over all items; group headers not counted
  x: number;
  y: number;
  /** The caret's top edge, which is what the menu sits above when it flips. */
  anchorTop: number;
  command: (item: SlashCommandItem) => void; // calls suggestion plugin's command prop
}

interface SlashCommandOptions {
  // Editor.svelte passes a setter here; called on every state change and null on close.
  onSlashCommand: (state: SlashCommandSuggestionState | null) => void;
}

// ─── Command Registry ─────────────────────────────────────────────────────────
// Add future custom node commands here — no other file needs to change.

// Each entry's word and icon come from `nameAndIcon`, spread in rather than written out,
// because the gutter handle's "Turn into" section names the same seven of these and the
// handle's accessible label says the same words again — and a GM meeting one block under
// two names has learned it twice (#220). What stays here is what is this menu's alone: the
// group, the search keywords, and the command itself. A callout's entries are named by
// `CALLOUT_TYPES`, which is that vocabulary's own single source.

export const SLASH_COMMANDS: SlashCommandItem[] = [
  // ── Text ──────────────────────────────────────────────────────────────────
  {
    group: "Text",
    ...nameAndIcon("paragraph"),
    keywords: ["p", "text", "plain"],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    group: "Text",
    ...nameAndIcon("heading1"),
    keywords: ["h1", "title"],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run(),
  },
  {
    group: "Text",
    ...nameAndIcon("heading2"),
    keywords: ["h2", "subtitle"],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run(),
  },
  {
    group: "Text",
    ...nameAndIcon("heading3"),
    keywords: ["h3"],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run(),
  },
  {
    group: "Text",
    ...nameAndIcon("quote"),
    keywords: ["blockquote", "cite"],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setBlockquote().run(),
  },
  {
    group: "Text",
    ...nameAndIcon("codeBlock"),
    keywords: ["pre", "code", "codeblock"],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setCodeBlock().run(),
  },
  // ── List ──────────────────────────────────────────────────────────────────
  {
    group: "List",
    ...nameAndIcon("bulletList"),
    keywords: ["ul", "unordered"],
    // toggleBulletList is intentional: typing /bullet inside a bullet list removes it.
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    group: "List",
    ...nameAndIcon("orderedList"),
    keywords: ["ol", "ordered"],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  // ── Insert ────────────────────────────────────────────────────────────────
  {
    group: "Insert",
    ...nameAndIcon("divider"),
    keywords: ["hr", "rule", "separator"],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    group: "Insert",
    ...nameAndIcon("scene"),
    keywords: ["scene", "audio", "ambient", "music"],
    command: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "sceneBlock",
          attrs: blankSceneRef(),
        })
        .run(),
  },
  {
    group: "Insert",
    ...nameAndIcon("infobox"),
    keywords: ["infobox", "panel", "facts", "summary", "sidebar", "stats"],
    command: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: "infoboxBlock", attrs: blankInfobox() })
        .run(),
  },
  {
    group: "Insert",
    ...nameAndIcon("statblock"),
    keywords: ["statblock", "creature", "monster", "npc", "stats", "hp"],
    // The one command that reads its argument (#179). `/statblock goblin` stamps the
    // `Goblin` preset if one exists and titles the block `# Goblin`; a name that
    // matches nothing still becomes the title, over the vault's default shape.
    // `/statblock` alone stamps that default. Every path is silent — no preset and no
    // default gives a blank statblock and no toast, because a toast fires mid-fight
    // where the GM cannot act on it. The diagnosis is in Settings.
    acceptsArgument: true,
    command: async (editor, range, argument) => {
      const preset = await statblockPresets.resolve(argument);
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "statblockBlock",
          attrs: statblockFromPreset(preset, argument),
        })
        .run();
    },
  },
  {
    group: "Insert",
    ...nameAndIcon("timeline"),
    keywords: ["timeline", "events", "chronology", "history"],
    command: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "timelineBlock",
          attrs: { events: [createBlankEvent()] },
        })
        .run(),
  },
  {
    group: "Insert",
    ...nameAndIcon("image"),
    keywords: ["img", "photo", "picture", "embed"],
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
  // ── Callout ───────────────────────────────────────────────────────────────
  // One entry per shipped type (#180). These ten are an *offer*, not the set:
  // the vocabulary is open, so a GM may write any word as a callout's type and
  // get a neutrally styled callout. Nothing here validates or autocompletes.
  //
  // A callout wraps the paragraph the cursor is already in rather than being
  // inserted beside it, so the GM lands inside the new aside typing.
  ...CALLOUT_TYPES.map(
    (spec): SlashCommandItem => ({
      group: "Callout",
      label: spec.label,
      keywords: [spec.type, ...spec.keywords],
      icon: spec.icon,
      command: (editor, range) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .wrapIn("blockquote")
          .updateAttributes("blockquote", {
            calloutType: spec.type,
            calloutTitle: null,
            foldMarker: null,
          })
          .run(),
    }),
  ),
];

// ─── Filter ───────────────────────────────────────────────────────────────────

/** Whether a command answers to a word exactly, by label or by keyword. */
function isNamed(item: SlashCommandItem, word: string): boolean {
  return (
    item.label.toLowerCase() === word || item.keywords.some((kw) => kw === word)
  );
}

/**
 * The commands a query offers.
 *
 * Two readings, split by whether a space has been typed:
 *
 *   * **No space** — case-insensitive substring match against label and keywords,
 *     and an empty query offers everything. This is the whole menu as it was.
 *   * **A space** — the words before it must *name* an argument-taking command
 *     exactly. Everything else offers nothing, which is what closes the menu.
 *
 * The second reading exists because the suggestion session no longer ends at a
 * space (it cannot, or `/statblock Large Orc` could never be typed), so this
 * function is now what stops a stray `/` mid-sentence from reopening the menu on
 * the next word. Requiring the *whole* head to match is the load-bearing part:
 * `and / ordered chaos` has an empty head and offers nothing.
 */
export function filterCommands(query: string): SlashCommandItem[] {
  const space = query.search(/\s/);
  if (space < 0) {
    const q = query.toLowerCase().trim();
    if (!q) return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.keywords.some((kw) => kw.includes(q)),
    );
  }

  const head = query.slice(0, space).toLowerCase();
  if (!head) return [];
  return SLASH_COMMANDS.filter(
    (item) => item.acceptsArgument && isNamed(item, head),
  );
}

/**
 * The argument inside a matched `/…` — everything after the command's name.
 *
 * Read back off the document text the suggestion matched rather than tracked in a
 * closure, so there is one source for it and no state to fall out of step.
 */
export function slashArgument(text: string): string {
  const space = text.search(/\s/);
  return space < 0 ? "" : text.slice(space + 1).trim();
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
        // The session survives a space so a command can take an argument with one
        // in it (`/statblock Large Orc`). What used to be the plugin's job — closing
        // the menu at the first space — is now `filterCommands`', which closes it for
        // every command that does not read an argument.
        allowSpaces: true,

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
          props.command(
            ed,
            range,
            slashArgument(ed.state.doc.textBetween(range.from, range.to)),
          );
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
              anchorTop: rect?.top ?? 0,
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
