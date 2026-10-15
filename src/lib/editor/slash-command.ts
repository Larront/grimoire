import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { NodeSelection, PluginKey } from "prosemirror-state";
import type { BlockIconName } from "$lib/components/editor/block-icons";
import { nameAndIcon } from "./block-vocabulary";
import { CALLOUT_TYPES, type CalloutTypeSpec } from "./callout-block";
import { insertImageFromFile } from "./image-block";
import { IMAGE_EXTENSIONS } from "./ledger-image.svelte";
import { blankInfobox } from "./infobox-block";
import { blankSceneRef } from "./scene-block.svelte";
import {
  findPreset,
  sameName,
  statblockFromPreset,
  type StatblockPreset,
} from "./statblock-presets";
import { statblockPresets } from "$lib/stores/statblock-presets.svelte";
import { createBlankEvent } from "./timeline-block";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SlashCommandItem {
  group: "Note blocks" | "Text" | "List" | "Callout";
  label: string;
  keywords: string[]; // extra search terms beyond label
  /**
   * Lucide icon name — resolved to a Component in SlashCommandMenu. A name that exists:
   * a typo is a build error rather than an item drawn with no glyph (#220).
   */
  icon: BlockIconName;
  /**
   * A few words at the row's right saying what Enter will make where the label alone
   * cannot: which shape a statblock is stamped from, or that "Warning" is a callout once
   * the group headers are gone. Not a description — the menu is labels only.
   */
  hint?: string;
  /**
   * Offered only once the GM types something it answers to. The ten callout types fold
   * into one "Callout" row on a bare `/`, where they were 42% of the list; `/warn` or
   * `/callout` still reaches them.
   */
  untilTyped?: boolean;
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
  /** Empty while the GM's word matches nothing: the menu says so rather than vanishing. */
  items: SlashCommandItem[];
  /** The bare `/`, drawn under group headings; anything typed is one ranked list. */
  grouped: boolean;
  /** What was typed after the `/`, for the empty state to repeat back. */
  query: string;
  selectedIndex: number; // flat index over all items; group headers not counted
  x: number;
  y: number;
  /** The caret's top edge, which is what the menu sits above when it flips. */
  anchorTop: number;
  command: (item: SlashCommandItem) => void; // calls suggestion plugin's command prop
  /** The pointer moved onto a row: it becomes the one Enter runs, so only one is lit. */
  select: (index: number) => void;
  /** Read the caret's position again — the note scrolled under an open menu. */
  reposition: () => void;
}

interface SlashCommandOptions {
  // Editor.svelte passes a setter here; called on every state change and null on close.
  onSlashCommand: (state: SlashCommandSuggestionState | null) => void;
}

/**
 * The menu's id and its rows', so the editor can point at the selected one
 * (`aria-activedescendant`) while focus stays in the text. One menu is open at a time —
 * it lives in the editor the GM is typing in — so the ids need not be per editor.
 */
export const SLASH_MENU_ID = "slash-command-menu";
export const slashOptionId = (index: number) => `${SLASH_MENU_ID}-option-${index}`;

// ─── Inserting ────────────────────────────────────────────────────────────────

/**
 * Leaves the caret in the line after a block just inserted, adding one if the block is
 * the note's last. An inserted block is left *selected*, and a selected block is what
 * the next keystroke replaces: a statblock stamped from a preset, which opens on no
 * field of its own, was lost to the first letter the GM typed after it.
 */
function caretAfterInsertedBlock(editor: Editor) {
  const { selection } = editor.state;
  if (!(selection instanceof NodeSelection)) return;
  const after = selection.to;
  const next = editor.state.doc.resolve(after).nodeAfter;
  if (next?.isTextblock) {
    editor.chain().setTextSelection(after + 1).scrollIntoView().run();
  } else {
    editor
      .chain()
      .insertContentAt(after, { type: "paragraph" })
      .setTextSelection(after + 1)
      .scrollIntoView()
      .run();
  }
}

/**
 * Stamps a statblock: the shape, then a name over it if one was typed.
 *
 * Synchronous, reading the presets the store already holds (it loads when the editor
 * does). It used to await the store and *then* delete the `/statblock …` it had been
 * handed, by a range taken before the wait — text typed in between moved the range.
 */
function stampStatblock(
  editor: Editor,
  range: { from: number; to: number },
  preset: StatblockPreset | null,
  title: string,
) {
  editor
    .chain()
    .focus()
    .deleteRange(range)
    .insertContent({ type: "statblockBlock", attrs: statblockFromPreset(preset, title) })
    .run();
  // A blank shape opens for editing on its first field; a preset's opens to play, on no
  // field, so the caret has to be put somewhere that is not the block.
  if (preset) caretAfterInsertedBlock(editor);
}

/**
 * A list command, which inside its own kind of list lifts the line out. `toggleBulletList`
 * chained after the `/bullet` was deleted left the GM an empty item in the list they had
 * asked to leave.
 */
function toggleList(
  editor: Editor,
  range: { from: number; to: number },
  list: "bulletList" | "orderedList",
) {
  const chain = editor.chain().focus().deleteRange(range);
  if (!editor.isActive(list)) {
    return list === "bulletList" ? chain.toggleBulletList().run() : chain.toggleOrderedList().run();
  }
  // Two steps: chained after the delete, the lift reads the selection from before it and
  // refuses. Undo takes both back together — the history groups them.
  chain.run();
  return editor.commands.liftListItem("listItem");
}

function calloutCommand(spec: CalloutTypeSpec): SlashCommandItem["command"] {
  // A callout wraps the paragraph the cursor is already in rather than being inserted
  // beside it, so the GM lands inside the new aside typing.
  return (editor, range) =>
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
      .run();
}

// ─── Command Registry ─────────────────────────────────────────────────────────
// Add future custom node commands here — no other file needs to change.

// Each entry's word and icon come from `nameAndIcon`, spread in rather than written out,
// because the gutter handle's "Turn into" section names the same seven of these and the
// handle's accessible label says the same words again — and a GM meeting one block under
// two names has learned it twice (#220). What stays here is what is this menu's alone: the
// group, the search keywords, and the command itself. A callout's entries are named by
// `CALLOUT_TYPES`, which is that vocabulary's own single source.
//
// Grimoire's own blocks come first. They were rows 10 to 13, below a first screen of
// paragraph, headings, quote, code and lists — which any Markdown editor has, and which
// Markdown's own shortcuts (`# `, `- `, `> `) already make without the menu.

export const SLASH_COMMANDS: SlashCommandItem[] = [
  // ── Note blocks ───────────────────────────────────────────────────────────
  {
    group: "Note blocks",
    ...nameAndIcon("statblock"),
    keywords: ["statblock", "creature", "monster", "npc", "stats", "hp"],
    // The one command that reads its argument (#179). Its rows — the vault's default,
    // each preset, a name typed after it — are drawn by `statblockRows`, which says on
    // each what Enter will stamp. This entry is the bare one, for when no preset rows
    // are offered: the vault's default shape.
    acceptsArgument: true,
    command: (editor, range) =>
      stampStatblock(editor, range, defaultPreset(presetContext()), ""),
  },
  {
    group: "Note blocks",
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
    group: "Note blocks",
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
    group: "Note blocks",
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
    group: "Note blocks",
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
            // The one list the ledger accepts: SVG was offered here and then refused.
            extensions: IMAGE_EXTENSIONS,
          },
        ],
      });
      if (typeof selected === "string") {
        await insertImageFromFile(selected, editor);
      }
    },
  },
  // The ten callout types, folded to one row on a bare `/`. It makes the first of them —
  // a plain note — and typing a type's name reaches the rest.
  {
    group: "Note blocks",
    label: "Callout",
    icon: CALLOUT_TYPES[0].icon,
    keywords: ["callout", "aside", "admonition"],
    command: calloutCommand(CALLOUT_TYPES[0]),
  },
  // ── Text ──────────────────────────────────────────────────────────────────
  {
    group: "Text",
    ...nameAndIcon("paragraph"),
    keywords: ["p", "text", "plain"],
    command: (editor, range) => editor.chain().focus().deleteRange(range).setParagraph().run(),
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
    command: (editor, range) => editor.chain().focus().deleteRange(range).setBlockquote().run(),
  },
  {
    group: "Text",
    ...nameAndIcon("codeBlock"),
    keywords: ["pre", "code", "codeblock"],
    command: (editor, range) => editor.chain().focus().deleteRange(range).setCodeBlock().run(),
  },
  {
    group: "Text",
    ...nameAndIcon("divider"),
    keywords: ["hr", "rule", "separator"],
    command: (editor, range) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  // ── List ──────────────────────────────────────────────────────────────────
  {
    group: "List",
    ...nameAndIcon("bulletList"),
    keywords: ["ul", "unordered"],
    // Typing /bullet inside a bullet list takes the line out of it, as a toggle should.
    command: (editor, range) => toggleList(editor, range, "bulletList"),
  },
  {
    group: "List",
    ...nameAndIcon("orderedList"),
    keywords: ["ol", "ordered"],
    command: (editor, range) => toggleList(editor, range, "orderedList"),
  },
  // ── Callout ───────────────────────────────────────────────────────────────
  // One entry per shipped type (#180). These ten are an *offer*, not the set:
  // the vocabulary is open, so a GM may write any word as a callout's type and
  // get a neutrally styled callout. Nothing here validates or autocompletes.
  ...CALLOUT_TYPES.map(
    (spec): SlashCommandItem => ({
      group: "Callout",
      label: spec.label,
      keywords: [spec.type, ...spec.keywords],
      icon: spec.icon,
      hint: "Callout",
      untilTyped: true,
      command: calloutCommand(spec),
    }),
  ),
];

// ─── Statblock presets ────────────────────────────────────────────────────────

/** What the statblock rows read: every stampable preset, and the vault's default. */
export interface PresetContext {
  presets: StatblockPreset[];
  defaultName: string | null;
}

const NO_PRESETS: PresetContext = { presets: [], defaultName: null };

function presetContext(): PresetContext {
  return { presets: statblockPresets.available, defaultName: statblockPresets.defaultName };
}

function defaultPreset(ctx: PresetContext): StatblockPreset | null {
  return findPreset(ctx.presets, ctx.defaultName);
}

/** What a statblock stamped from the default looks like, said in a word or two. */
function defaultHint(ctx: PresetContext): string {
  return defaultPreset(ctx)?.name.trim() ?? "Blank";
}

const STATBLOCK = SLASH_COMMANDS.find((item) => item.acceptsArgument)!;

/** A preset as a row of its own. Picking it stamps its shape under its own name. */
function presetRow(preset: StatblockPreset): SlashCommandItem {
  return {
    group: "Note blocks",
    label: preset.name.trim(),
    keywords: [],
    icon: STATBLOCK.icon,
    hint: "Preset",
    command: (editor, range) => stampStatblock(editor, range, preset, ""),
  };
}

/**
 * Whether the GM has said "statblock" plainly enough to be shown the presets: four
 * letters of the word, or one of its whole synonyms. `/st` is also the start of
 * "Structure" and a dozen keywords, and listing every preset for it would bury the rest.
 */
function asksForStatblock(word: string): boolean {
  if (word.length >= 4 && "statblock".startsWith(word)) return true;
  return ["statblock", "creature", "monster", "npc"].includes(word);
}

/**
 * The statblock's rows, each saying what Enter will stamp — the menu used to show one
 * "Statblock" whatever followed it, so `/statblock Goblin` gave a blank creature with no
 * hint that Goblin was not a preset.
 *
 *   * **No name typed** — the vault's default first, its shape as the hint, then every
 *     preset. Plain `/statblock` Enter still stamps the default in one step.
 *   * **A name typed** — first what Enter has always made: a name that is a preset's,
 *     whole, is that preset under that name; any other is a statblock *titled* with it,
 *     over the default shape. Below, the presets it starts (`/statblock lar` offers
 *     Large Orc), one arrow away and never first — a GM typing a new creature called
 *     "Orc" must not have Enter hand them the Orc Warlord preset.
 */
export function statblockRows(argument: string | null, ctx: PresetContext): SlashCommandItem[] {
  const base: SlashCommandItem = { ...STATBLOCK, hint: defaultHint(ctx) };
  if (argument === null) return [base, ...ctx.presets.map(presetRow)];

  const name = argument.trim();
  if (!name) return [base, ...ctx.presets.map(presetRow)];

  const exact = ctx.presets.find((preset) => sameName(preset.name, name));
  const started = ctx.presets.filter(
    (preset) => preset !== exact && preset.name.trim().toLowerCase().startsWith(name.toLowerCase()),
  );
  const named: SlashCommandItem = exact
    ? {
        ...presetRow(exact),
        command: (editor, range) => stampStatblock(editor, range, exact, name),
      }
    : {
        ...STATBLOCK,
        label: `Statblock “${name}”`,
        hint: defaultHint(ctx),
        command: (editor, range) => stampStatblock(editor, range, defaultPreset(ctx), name),
      };
  return [named, ...started.map(presetRow)];
}

// ─── Filter ───────────────────────────────────────────────────────────────────

/** Whether a command answers to a word exactly, by label or by keyword. */
function isNamed(item: SlashCommandItem, word: string): boolean {
  return item.label.toLowerCase() === word || item.keywords.some((kw) => kw === word);
}

/**
 * How well a command answers to what was typed — lower is better, `null` not at all.
 *
 * The menu used to keep registry order for any match, so the row Enter took was
 * whichever matched first: `/st` was Bullet List (keyword "unordered" holds "st"), `/no`
 * Bullet List too, `/im` Timeline. A label the GM is typing comes first now.
 */
function rank(item: SlashCommandItem, q: string): number | null {
  const label = item.label.toLowerCase();
  if (label.startsWith(q)) return 0;
  if (label.split(/\s+/).some((word) => word.startsWith(q))) return 1;
  if (item.keywords.includes(q)) return 2;
  if (item.keywords.some((kw) => kw.startsWith(q))) return 3;
  if (label.includes(q)) return 4;
  if (item.keywords.some((kw) => kw.includes(q))) return 5;
  return null;
}

/**
 * The commands a query offers.
 *
 * Two readings, split by whether a space has been typed:
 *
 *   * **No space** — an empty query offers every command, folded callouts aside, in its
 *     groups. Anything typed ranks the matches: the label being typed first, then a word
 *     of it, then a keyword. Saying "statblock" adds the preset rows beneath it.
 *   * **A space** — the words before it must *name* an argument-taking command exactly,
 *     and the words after are its argument. Everything else offers nothing, which is
 *     what closes the menu.
 *
 * The second reading exists because the suggestion session no longer ends at a
 * space (it cannot, or `/statblock Large Orc` could never be typed), so this
 * function is now what stops a stray `/` mid-sentence from reopening the menu on
 * the next word. Requiring the *whole* head to match is the load-bearing part:
 * `and / ordered chaos` has an empty head and offers nothing.
 */
export function filterCommands(query: string, ctx: PresetContext = NO_PRESETS): SlashCommandItem[] {
  const space = query.search(/\s/);
  if (space < 0) {
    const q = query.toLowerCase().trim();
    if (!q) {
      return SLASH_COMMANDS.filter((item) => !item.untilTyped).map((item) =>
        item === STATBLOCK ? statblockRows(null, ctx)[0] : item,
      );
    }

    const ranked = SLASH_COMMANDS.map((item, order) => ({ item, order, score: rank(item, q) }))
      .filter((r): r is { item: SlashCommandItem; order: number; score: number } => r.score !== null)
      .sort((a, b) => a.score - b.score || a.order - b.order)
      .map((r) => r.item);
    // The folded "Callout" row stands for the types; once one is offered by name it
    // would be the same callout twice.
    const items = ranked.some((item) => item.group === "Callout")
      ? ranked.filter((item) => !(item.group === "Note blocks" && item.label === "Callout"))
      : ranked;

    const at = items.indexOf(STATBLOCK);
    if (at < 0) return items;
    const rows = asksForStatblock(q) ? statblockRows(null, ctx) : statblockRows(null, ctx).slice(0, 1);
    return [...items.slice(0, at), ...rows, ...items.slice(at + 1)];
  }

  const head = query.slice(0, space).toLowerCase();
  if (!head) return [];
  if (!(STATBLOCK.acceptsArgument && isNamed(STATBLOCK, head))) return [];
  return statblockRows(slashArgument(query), ctx);
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

/** Rows a PageUp or PageDown moves by — about two thirds of the menu's height. */
const PAGE = 6;

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: "slashCommand",

  addOptions() {
    return {
      onSlashCommand: () => {},
    };
  },

  onCreate() {
    // The preset rows are drawn from what the store holds as the GM types, so it is
    // loaded before the first `/` rather than on it. Silent, and once per launch.
    void statblockPresets.load();
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
        items: ({ query }: { query: string }) => filterCommands(query, presetContext()),

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
          props.command(ed, range, slashArgument(ed.state.doc.textBetween(range.from, range.to)));
        },

        render: () => {
          // selectedIndex and currentState live in this closure.
          // onKeyDown mutates them and calls onSlashCommand to push updates.
          let selectedIndex = 0;
          let currentState: SlashCommandSuggestionState | null = null;
          let lastProps: RenderProps | null = null;

          type RenderProps = {
            editor: Editor;
            query: string;
            clientRect?: (() => DOMRect | null) | null;
            items: SlashCommandItem[];
            command: (item: SlashCommandItem) => void;
          };

          // Resolves the cursor DOMRect to x/y numbers before pushing to Editor.svelte.
          // Re-called on every onStart/onUpdate so the position is always fresh.
          function buildState(props: RenderProps, si: number): SlashCommandSuggestionState {
            const rect = props.clientRect?.();
            return {
              items: props.items,
              grouped: !props.query.trim(),
              query: props.query,
              // props.command is the suggestion plugin's executor — calling it with an
              // item triggers the `command` option above, which calls item.command(editor, range).
              command: props.command,
              selectedIndex: si,
              x: rect?.left ?? 0,
              y: (rect?.bottom ?? 0) + 4,
              anchorTop: rect?.top ?? 0,
              select,
              reposition,
            };
          }

          /**
           * The editor names the menu it opened and the row Enter will run, so a screen
           * reader follows the selection while focus stays in the text — the menu used
           * to open and move without a word.
           */
          function describe(state: SlashCommandSuggestionState | null) {
            const dom = lastProps?.editor.view.dom;
            if (!dom) return;
            if (!state) {
              for (const attr of ["aria-expanded", "aria-controls", "aria-activedescendant"]) {
                dom.removeAttribute(attr);
              }
              return;
            }
            dom.setAttribute("aria-expanded", "true");
            dom.setAttribute("aria-controls", SLASH_MENU_ID);
            if (state.items.length) {
              dom.setAttribute("aria-activedescendant", slashOptionId(state.selectedIndex));
            } else {
              dom.removeAttribute("aria-activedescendant");
            }
          }

          function push(state: SlashCommandSuggestionState | null) {
            currentState = state;
            describe(state);
            onSlashCommand(state);
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

          function move(to: number) {
            if (!currentState) return;
            selectedIndex = to;
            push({ ...currentState, selectedIndex });
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
              // Dismiss condition 4: nothing answers *after a space* — prose following a
              // stray `/`. Close the menu but leave the text in the doc. currentState is
              // nulled here so onKeyDown sees no active menu until onExit.
              //
              // A single word that matches nothing keeps the menu open and says so, as
              // the link menu says "No notes found": it used to vanish with no answer.
              if (props.items.length === 0 && /\s/.test(props.query)) {
                push(null);
                return;
              }
              push(buildState(props, selectedIndex));
            },

            onKeyDown({ event }: { event: KeyboardEvent }) {
              if (!currentState) return false;
              const count = currentState.items.length;

              // Nothing to choose: every key is the text's, Enter included, and Enter
              // closes the menu on its way to breaking the line.
              if (count === 0) {
                if (event.key === "Escape" || event.key === "Enter") push(null);
                return event.key === "Escape";
              }

              // Move down — Tab or ArrowDown
              if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey)) {
                move((selectedIndex + 1) % count);
                return true; // consumed — prevents Tab from moving browser focus
              }

              // Move up — Shift+Tab or ArrowUp
              if (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey)) {
                move((selectedIndex - 1 + count) % count);
                return true;
              }

              // A page at a time, stopping at the ends rather than wrapping.
              if (event.key === "PageDown") {
                move(Math.min(count - 1, selectedIndex + PAGE));
                return true;
              }
              if (event.key === "PageUp") {
                move(Math.max(0, selectedIndex - PAGE));
                return true;
              }

              // Execute selected command
              if (event.key === "Enter") {
                if (currentState.items[selectedIndex]) {
                  currentState.command(currentState.items[selectedIndex]);
                }
                return true;
              }

              // Dismiss — Escape
              // Must null currentState here (same as zero-results) so subsequent
              // onKeyDown calls before onExit fires don't execute against the hidden menu.
              if (event.key === "Escape") {
                push(null);
                return true;
              }

              return false;
            },

            // onExit fires when the plugin session ends (e.g., backspace past '/').
            // Always resets regardless of whether currentState is already null (idempotent).
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
