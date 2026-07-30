// What a block needs to know about a fenced code token in order to claim it
// (ADR-0016 §3). Deliberately a fact about a token and not a third piece of
// shared machinery: the pattern shares exactly two of those, and a block's claim
// belongs in the block, where its checklist entry says it lives.
//
// The claim replaces the raw-text scan Grimoire used to find its blocks with,
// which only ever worked at column zero — a `timeline` fence indented inside
// `> [!encounter] The Ambush` round-tripped through the file intact and rendered
// as a dead grey code box (#158). Reading the token the markdown reader already
// produced is structural, and the reader produces that token at any nesting
// depth, so depth costs nothing.
//
// The shape of a claim, in full:
//
//     markdownTokenName: "code",
//     parseMarkdown: (token) =>
//       fenceInfo(token) === "timeline"
//         ? { type: "timelineBlock", attrs: { … } }
//         : [],   // ← not ours
//
// An empty array is how a handler declines: the reader tries the next handler
// for the token, which is StarterKit's code block, so a GM's ```python stays an
// ordinary code block.
import type { MarkdownToken } from "@tiptap/core";

/**
 * A fenced code token's info string, trimmed — or "" for an indented code block
 * and for a fence with no language.
 *
 * A block compares this whole string against its own name, so a fence carrying
 * anything beyond the name (` ```timeline {foo} `) is declined rather than
 * claimed-and-trimmed. That is the byte-identity rule doing its job: nothing here
 * could re-emit the extra characters, and dropping them would edit a GM's file on
 * the next autosave.
 */
export function fenceInfo(token: MarkdownToken): string {
  return typeof token.lang === "string" ? token.lang.trim() : "";
}
