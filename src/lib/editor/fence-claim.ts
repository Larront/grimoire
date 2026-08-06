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

/** One `key=value` on an info string. Values stay strings; the block reads its own. */
const FENCE_PARAM = /^([a-z][a-z-]*)=([A-Za-z0-9_-]+)$/;

/**
 * A fence's info string as a block name plus `key=value` parameters — `null` when this
 * fence is not the block's, exactly as an empty array declines in `parseMarkdown`.
 *
 * This is the byte-identity rule extended rather than relaxed. A parameter is claimable
 * only because the block can re-emit it: `width=narrow` survives the round trip because
 * the serializer writes that same token back. Anything the serializer could not
 * reproduce is still declined, so the reasons above hold unchanged:
 *
 *   * a parameter the block does not list in `allowed` — it would be dropped,
 *   * a token that is not `key=value` (` ```statblock {foo} `) — nothing to write back,
 *   * the same key twice — one of the two would be lost.
 *
 * The one byte this does not preserve is whitespace *between* recognised tokens, which
 * is canonicalised to single spaces on the way out. That is the same normalisation
 * `fenceInfo` already performs by trimming, and it cannot lose a GM's content: every
 * token it consumed is written back, and a fence holding anything else never gets here.
 */
export function fenceParams(
  token: MarkdownToken,
  name: string,
  allowed: readonly string[],
): Record<string, string> | null {
  const info = fenceInfo(token);
  if (!info) return null;

  const [blockName, ...rest] = info.split(/\s+/);
  if (blockName !== name) return null;

  const params: Record<string, string> = {};
  for (const token of rest) {
    const match = FENCE_PARAM.exec(token);
    if (!match) return null;
    const [, key, value] = match;
    if (!allowed.includes(key) || key in params) return null;
    params[key] = value;
  }
  return params;
}

/**
 * The info string a block writes for those of its parameters that are not at their
 * default — `statblock`, or `statblock width=narrow`. Defaults are omitted rather than
 * spelled out so that a note whose blocks are all default round-trips byte-identically,
 * which is what keeps this change invisible to every file already on disk.
 */
export function fenceInfoFor(name: string, params: Record<string, string>): string {
  const tokens = Object.entries(params).map(([key, value]) => `${key}=${value}`);
  return [name, ...tokens].join(" ");
}
