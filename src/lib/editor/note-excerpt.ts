// Note markdown as an excerpt: the words, without the notation that carries them.
//
// The one consumer is the wikilink hover preview (#168), which used to show the
// note body's first 280 characters verbatim. For a Bestiary note — mostly fenced
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
// The same reasoning keeps `[[wikilinks]]` in their brackets. #156 ruled out
// showing a filed link as flat text, and in a surface that *looks* rendered that
// is exactly what stripping the brackets would do. In an excerpt the brackets are
// honest notation — "there is a link here, open the note to follow it" — so they
// survive every pass below. Anything that starts rendering this text instead of
// displaying it as an excerpt has to revisit that.
//
// If Grimoire ever grows a real read-only rendering surface, the preview should
// switch to it and this module should be deleted rather than extended.

import { titleCaseCalloutType } from "$lib/editor/callout-block";

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

/** `![alt](path)` as the whole line — Grimoire writes a ledger image this way. */
const LONE_IMAGE = /^ {0,3}!\[([^\]]*)\]\([^)]*\)[ \t]*$/;

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

/** `Statblock — Goblin Scout`: what a fence contributes to an excerpt. */
function fenceDescriptor(info: string, body: string[]): string {
  const kind = info.trim().toLowerCase();
  if (!kind) return "Code";

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

/**
 * A line's inline markers removed, leaving the words they decorated.
 *
 * `_underscore_` emphasis is left alone on purpose: file_names and stat_keys are
 * common in a GM's prose and stripping them mangles more text than it tidies.
 * `[[wikilinks]]` are left alone for the reason in this module's header — the
 * markdown-link rule below refuses a `[` that follows another `[` so it cannot
 * reach inside one.
 */
function stripInline(line: string): string {
  return line
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(?<!\[)\[([^[\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/~~(.+?)~~/g, "$1");
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
  const units = sliceToFragment(unitsOf(body), fragment);

  const out: string[] = [];
  for (const unit of units) {
    if (unit.kind === "fence") {
      out.push(fenceDescriptor(unit.info, unit.body));
      continue;
    }

    const line = unit.text;
    if (THEMATIC_BREAK.test(line) || EMPTY_HEADING.test(line)) {
      out.push("");
      continue;
    }

    const image = LONE_IMAGE.exec(line);
    if (image) {
      const alt = image[1].trim();
      out.push(alt ? `Image — ${alt}` : "Image");
      continue;
    }

    const heading = HEADING.exec(line);
    const text = heading ? heading[1] : line.replace(LIST_MARKER, "");
    out.push(stripInline(text).trim());
  }

  // Collapse the blank runs the strippings leave behind, so the five lines the
  // preview has room for are five lines of note rather than of whitespace.
  return out
    .join("\n")
    .replace(/\n{2,}/g, "\n\n")
    .trim();
}
