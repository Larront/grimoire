// The note editor's extension list, in the one order that works.
//
// It lives here rather than inline in Editor.svelte because the order is load
// bearing and testable: @tiptap/markdown registers each extension's markdown
// handlers in the order this array gives them, and tries the handlers for a
// token in registration order. StarterKit's code block claims *every* fence, so
// a block whose fence claim (ADR-0016 §3) is registered after StarterKit never
// sees its own token and renders as a grey code box.
//
// Hence: blocks first, StarterKit second. Paragraph's own priority (1000) keeps
// it the schema's default block regardless, so this only moves markdown
// registration, not what an empty document contains.
import { StarterKit } from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import type { Extensions } from "@tiptap/core";

import { CalloutBlock } from "$lib/editor/callout-block";
import { ImageBlock } from "$lib/editor/image-block";
import { InfoboxBlock } from "$lib/editor/infobox-block";
import { SceneBlock } from "$lib/editor/scene-block.svelte";
import { StatblockBlock } from "$lib/editor/statblock-block";
import { TimelineBlock } from "$lib/editor/timeline-block";
import { WikiLink } from "$lib/editor/wiki-link";
import { SlashCommand } from "$lib/editor/slash-command";
import { BlockHandle, type BlockTarget } from "$lib/editor/block-handle";
import type { SlashCommandSuggestionState } from "$lib/editor/slash-command";
import type { WikiLinkSuggestionState } from "$lib/editor/wiki-link";

export interface NoteExtensionOptions {
  /** Pushes the slash-command menu's state to the surface drawing it. */
  onSlashCommand?: (state: SlashCommandSuggestionState | null) => void;
  /** Pushes the wikilink autocomplete's state to the surface drawing it. */
  onWikiSuggestion?: (state: WikiLinkSuggestionState | null) => void;
  /**
   * Pushes the block under the pointer to the surface drawing the handle. Null as the
   * pointer leaves the prose. The extension holds no markup — where the handle sits and
   * what it looks like belong to the surface, like the two menus above.
   */
  onBlockTarget?: (target: BlockTarget | null) => void;
}

/**
 * Every extension the note editor runs. The overlay callbacks default to no-ops
 * so a surface that only needs the markdown layer — reading a note's text into a
 * document, or writing it back out — can ask for the list without wiring UI.
 */
export function noteExtensions(options: NoteExtensionOptions = {}): Extensions {
  return [
    // Blocks first: each one claims its own markdown token before StarterKit's
    // code block claims every fence.
    CalloutBlock,
    ImageBlock,
    InfoboxBlock,
    SceneBlock,
    StatblockBlock,
    TimelineBlock,
    WikiLink.configure({
      onSuggestion: options.onWikiSuggestion ?? (() => {}),
    }),
    // Callout *is* the blockquote — the ordinary quote carrying two optional
    // attributes (#180) — so StarterKit must not register a second one under the
    // same name. Nothing else about StarterKit changes.
    StarterKit.configure({ blockquote: false }),
    Markdown,
    SlashCommand.configure({
      onSlashCommand: options.onSlashCommand ?? (() => {}),
    }),
    BlockHandle.configure({
      onTarget: options.onBlockTarget ?? (() => {}),
    }),
  ];
}
