// Note markdown as an excerpt: the words, without the notation that carries them.
//
// Two consumers: the wikilink hover preview (#168), which used to show the note body's
// first 280 characters verbatim, and a map pin's details. For a Bestiary note — mostly fenced
// ```statblock — that is a box of backticks, and the GM learns nothing from it.
//
// What this is *not* is a renderer. ADR-0016 §8 has the Note Block pattern owning
// no rendering outside the note's own editor, and #167 turned that into a standing
// rule: a block renders only inside the editor; any other surface showing note
// content shows text. The preview stays on the text side of that line, and this
// module is why it can — a fence becomes a *named line* rather than a rendered
// block, so nothing here hosts a Linked Text Field and #156's precondition (a
// linked field is interactive only inside a surface providing wikilink delegation)
// is never put to the test by a `pointer-events-none` tooltip.
//
// `[[wikilinks]]` used to keep their brackets here, as "honest notation" — #156 ruled
// out showing a filed link as flat text in a surface that looks rendered. The 2026-10
// design review revisited it with the owner: in a card read at a glance, the brackets
// were the noise ("[[The Ashfen Marshes]] … [[The Order of Embers]]") and the GM read
// past them to the names. So a link is its name, in plain words. The excerpt is still
// text, never rendered, so nothing in it looks clickable — #156's concern was a link
// that looks live and is not, and plain words make no such claim.
//
// If Grimoire ever grows a real read-only rendering surface, the preview should
// switch to it and this module should be deleted rather than extended.

import { titleCaseCalloutType } from "$lib/editor/callout-block";
import { parseWikiTarget } from "$lib/editor/wiki-target";

// ─── Line grammar ─────────────────────────────────────────────────────────────

/** ```` ```statblock ```` or `~~~`, at CommonMark's three-space indent tolerance. */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*([^`]*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/** `> [!warning]- The bridge is out` — the callout header, quote marker included. */
const CALLOUT_HEADER = /^ {0,3}>[ \t]?\[!([^\]\s]+)\][-+]?[ \t]*(.*)$/;

/** One or more `>` quote markers opening a line. */
const QUOTE_MARKERS = /^ {0,3}(?:>[ \t]?)+/;

/** `## Tactics` — an ATX heading with something after the hashes. */
const HEADING = /^ {0,3}#{1,6}[ \t]+(.+)$/;

/** A heading with nothing after the hashes, which contributes no words. */
const EMPTY_HEADING = /^ {0,3}#{1,6}[ \t]*$/;

/** `- `, `* `, `+ `, `1. `, `2) ` — a list item's marker. */
const LIST_MARKER = /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+/;

/** `---`, `***`, `___` on their own line. */
const THEMATIC_BREAK = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/;

/**
 * `![alt](path)` as the whole line — Grimoire writes a ledger image this way — with the
 * `{align=right width=40%}` an aligned image carries after it. That used to leak into the
 * excerpt as text.
 */
const LONE_IMAGE = /^ {0,3}!\[([^\]]*)\]\([^)]*\)(?:\{[^}]*\})?[ \t]*$/;

/** `- [ ] buy rope` — a task's box, once the list marker is off. */
const TASK_BOX = /^\[[ xX]\][ \t]+/;

/** `[^1]: …` — a footnote's definition, which is apparatus rather than the note. */
const FOOTNOTE_DEFINITION = /^ {0,3}\[\^[^\]]+\]:/;

/** `| Toll | 2cp |` — a table row. */
const TABLE_ROW = /^ {0,3}\|.*\|[ \t]*$/;

/** `|---|:--:|` — a table's alignment row. */
const TABLE_RULE = /^ {0,3}\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/;

/** `# Goblin Scout` — the name line three of the four fences open with. */
const FENCE_NAME = /^#[ \t]+(.+)$/;

// ─── Fences ───────────────────────────────────────────────────────────────────

/**
 * The fences whose first `# …` line names the *block* — Infobox, Statblock and
 * Scene all follow that convention (`scene-block.svelte.ts` states it).
 *
 * Timeline is deliberately absent even though its fence is full of `# …` lines:
 * there each one titles an *event*, so reading the first as the block's name would
 * label a whole timeline with whatever happened first. It gets counted instead.
 */
const NAME_BEARING_FENCES = new Set(["statblock", "infobox", "scene"]);

/**
 * `Statblock — Goblin Scout`: what a fence contributes to an excerpt, or null for nothing.
 *
 * An Infobox contributes nothing (2026-10 design review). Most NPCs and places open with
 * one, and it read as the bare word "Infobox" on the card's first line — its facts thrown
 * away — so a templated NPC previewed as "Infobox / Description / Personality". The
 * owner's call: a preview is the note's prose.
 */
function fenceDescriptor(info: string, body: string[]): string | null {
  const kind = info.trim().toLowerCase();
  if (!kind) return "Code";
  if (kind === "infobox") return null;

  if (NAME_BEARING_FENCES.has(kind)) {
    const label = kind.charAt(0).toUpperCase() + kind.slice(1);
    const name = body.map((line) => FENCE_NAME.exec(line)?.[1]?.trim()).find(Boolean);
    return name ? `${label} — ${name}` : label;
  }

  if (kind === "timeline") {
    const events = body.filter((line) => FENCE_NAME.test(line)).length;
    return events ? `Timeline — ${events} event${events === 1 ? "" : "s"}` : "Timeline";
  }

  // A GM's ```python is an ordinary code block, and saying so beats naming a
  // language as though it were one of Grimoire's blocks.
  return `Code — ${info.trim()}`;
}

// ─── Inline notation ──────────────────────────────────────────────────────────

/** Characters a backslash can escape, held aside so no rule below reads them as markup. */
const ESCAPABLE = "\\`*_{}[]()#+-.!|~<>";
const HELD = (i: number) => String.fromCharCode(0xe000 + i);

/**
 * A line's inline markers removed, leaving the words they decorated.
 *
 * `_underscore_` emphasis is left alone on purpose: file_names and stat_keys are
 * common in a GM's prose and stripping them mangles more text than it tidies.
 * `[[wikilinks]]` read as the name the editor would show — the display text, not the
 * file path, and without the brackets (see this module's header). A sample note's
 * `[[Lore/The Ashfen Marshes.md]]` reads as "The Ashfen Marshes" and an aliased
 * `[[People/Aldric|the Regent]]` as "the Regent". An embed `![[…]]` reads the same way.
 * The markdown-link rule refuses a `[` that follows another `[` so it cannot reach
 * inside a wikilink.
 *
 * A backslash-escaped character is held aside first and put back last, as itself: `\*x\*`
 * used to come out as `\x\`, the escapes read as emphasis.
 */
function stripInline(line: string): string {
  return line
    .replace(/\\(.)/g, (whole, ch: string) => {
      const at = ESCAPABLE.indexOf(ch);
      return at >= 0 ? HELD(at) : whole;
    })
    .replace(/!?\[\[([^[\]]+)\]\]/g, (_, inner: string) => parseWikiTarget(inner).title)
    .replace(/!\[([^\]]*)\]\([^)]*\)(?:\{[^}]*\})?/g, "$1")
    .replace(/(?<!\[)\[([^[\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\^[^\]]+\]/g, "")
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/[\ue000-\ue0ff]/g, (held) => ESCAPABLE[held.charCodeAt(0) - 0xe000]);
}

// ─── Units ────────────────────────────────────────────────────────────────────

type Unit = { kind: "line"; text: string } | { kind: "fence"; info: string; body: string[] };

/**
 * A body split into the things an excerpt reasons about: plain lines and whole
 * fences.
 *
 * Quote markers come off first, and a callout header becomes a plain line before
 * they do — a Callout is a blockquote rather than a fence, so `> [!warning] The
 * bridge is out` would otherwise reach the reader as notation. De-quoting first is
 * also what lets a fence nested inside a callout be seen at all (#158 found one
 * indented there), since the fence scan below only reads column zero.
 */
function unitsOf(body: string): Unit[] {
  const lines = body.split("\n").map((line) => {
    const callout = CALLOUT_HEADER.exec(line);
    if (callout) {
      const label = titleCaseCalloutType(callout[1]);
      const title = callout[2].trim();
      return title ? `${label} — ${title}` : label;
    }
    return line.replace(QUOTE_MARKERS, "");
  });

  const units: Unit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE_OPEN.exec(lines[i]);
    if (!open) {
      units.push({ kind: "line", text: lines[i] });
      continue;
    }
    const marker = open[1];
    const collected: string[] = [];
    i++;
    for (; i < lines.length; i++) {
      const close = FENCE_CLOSE.exec(lines[i]);
      if (close && close[1][0] === marker[0] && close[1].length >= marker.length) break;
      collected.push(lines[i]);
    }
    // An unterminated fence ends at the end of the body, as a reader would take it.
    units.push({ kind: "fence", info: open[2], body: collected });
  }
  return units;
}

/**
 * The units from `#heading` onward, or all of them when nothing matches.
 *
 * Falling back rather than showing nothing is the point: a `#^blockid` fragment
 * and a heading that has since been renamed both land here, and an excerpt of the
 * wrong part of the right note still identifies the note.
 */
function sliceToFragment(units: Unit[], fragment: string): Unit[] {
  const want = fragment.trim().toLowerCase();
  if (!want) return units;
  const at = units.findIndex(
    (unit) => unit.kind === "line" && HEADING.exec(unit.text)?.[1].trim().toLowerCase() === want,
  );
  return at >= 0 ? units.slice(at) : units;
}

// ─── The excerpt ──────────────────────────────────────────────────────────────

/** One line of an excerpt, and whether it names a section rather than saying something. */
interface ExcerptLine {
  text: string;
  heading: boolean;
  /** A heading's level, 1 to 6; 0 for a line that is not one. */
  level: number;
}

function excerptLines(body: string, fragment: string): ExcerptLine[] {
  const units = sliceToFragment(unitsOf(body), fragment);
  const blank: ExcerptLine = { text: "", heading: false, level: 0 };

  const out: ExcerptLine[] = [];
  for (const unit of units) {
    if (unit.kind === "fence") {
      const named = fenceDescriptor(unit.info, unit.body);
      out.push(named === null ? blank : { text: named, heading: false, level: 0 });
      continue;
    }

    const line = unit.text;
    if (
      THEMATIC_BREAK.test(line) ||
      EMPTY_HEADING.test(line) ||
      FOOTNOTE_DEFINITION.test(line) ||
      TABLE_RULE.test(line)
    ) {
      out.push(blank);
      continue;
    }

    const image = LONE_IMAGE.exec(line);
    if (image) {
      const alt = image[1].trim();
      out.push({ text: alt ? `Image — ${alt}` : "Image", heading: false, level: 0 });
      continue;
    }

    // A table row reads as its cells: `| Toll | 2cp |` is "Toll · 2cp".
    if (TABLE_ROW.test(line)) {
      const cells = line
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell) => stripInline(cell).trim())
        .filter(Boolean);
      out.push({ text: cells.join(" · "), heading: false, level: 0 });
      continue;
    }

    const heading = HEADING.exec(line);
    const text = heading ? heading[1] : line.replace(LIST_MARKER, "").replace(TASK_BOX, "");
    const level = heading ? (line.trim().match(/^#+/)?.[0].length ?? 1) : 0;
    out.push({ text: stripInline(text).trim(), heading: !!heading, level });
  }

  // A heading with nothing under it says nothing: a templated NPC's "Description /
  // Personality / Notes", waiting to be filled in, previewed as exactly those words. A
  // heading followed by a deeper one is a parent section, and stays.
  // Until nothing changes, since a parent whose only child section was empty is empty too.
  const emptyHeadingsOut = (lines: ExcerptLine[]) =>
    lines.filter((line, i) => {
      if (!line.heading) return true;
      const next = lines.slice(i + 1).find((later) => later.text);
      return !!next && (!next.heading || next.level > line.level);
    });
  let kept = emptyHeadingsOut(out);
  for (let before = out.length; kept.length < before; ) {
    before = kept.length;
    kept = emptyHeadingsOut(kept);
  }

  // Collapse the blank runs the strippings leave behind.
  const collapsed: ExcerptLine[] = [];
  for (const line of kept) {
    if (!line.text && (!collapsed.length || !collapsed[collapsed.length - 1].text)) continue;
    collapsed.push(line);
  }
  while (collapsed.length && !collapsed[collapsed.length - 1].text) collapsed.pop();
  return collapsed;
}

/**
 * A note body as prose: fences named, notation stripped, blank runs collapsed.
 *
 * `fragment` is a wikilink's `#heading` without its `#` — pass it and the excerpt
 * opens at that section rather than at the top of the note, which is what a GM
 * hovering `[[Goblin Scout#Tactics]]` is asking about.
 *
 * The result is unbounded; clamping is the caller's, since only the caller knows
 * how much room it has.
 */
export function noteExcerpt(body: string, fragment = ""): string {
  return excerptLines(body, fragment)
    .map((line) => line.text)
    .join("\n");
}

/** A paragraph of an excerpt, or a section's name — what a card draws differently. */
export interface ExcerptBlock {
  kind: "heading" | "text";
  text: string;
}

/**
 * The same excerpt as blocks: headings apart, a paragraph's lines joined. For a surface
 * with room to set a heading as a heading — the link preview — where a flat string made
 * "Description" read as a sentence of the note.
 */
export function noteExcerptBlocks(body: string, fragment = ""): ExcerptBlock[] {
  const blocks: ExcerptBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "text", text: paragraph.join("\n") });
    paragraph = [];
  };
  for (const line of excerptLines(body, fragment)) {
    if (line.heading) {
      flush();
      blocks.push({ kind: "heading", text: line.text });
    } else if (!line.text) {
      flush();
    } else {
      paragraph.push(line.text);
    }
  }
  flush();
  return blocks;
}
