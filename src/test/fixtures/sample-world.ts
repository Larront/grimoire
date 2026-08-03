// The bundled sample world, read from where it ships.
//
// Every test about the sample ledger reads `src-tauri/sample-world/` itself rather than
// a copy, for the reason #182 gave when it did the same: a copy passes while the shipped
// note ships a fence Grimoire mis-reads. The path is relative to the runner's working
// directory, which is the project root.
//
// Extracted when the second consumer arrived (#186) — encounter-grouping.test.ts read
// one note this way, and the sample world's block tour reads all ten.
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "$lib/utils";

export const VAULT = "src-tauri/sample-world";

/**
 * The vale, note by note. Written out rather than walked because this project's
 * TypeScript config has no types for `readdirSync` — and because a list is the plainer
 * statement of "these ten and no more". The *count* is owned by `sample_world_integrity`
 * (`commands/sample.rs`), which counts rows in the ledger the notes were imported into,
 * so a note added on disk and forgotten here fails there rather than passing quietly.
 */
export const NOTES = [
  "Start Here.md",
  "The Ashfen Chronicle.md",
  "Characters/Aldric Vane.md",
  "Characters/Mira Ashvale.md",
  "Encounters/The Shadow in the Hall.md",
  "Locations/The Ember Keep.md",
  "Locations/Thornhaven Village.md",
  "Lore/The Ashfen Marshes.md",
  "Lore/The War of Embers.md",
  "Sessions/Session 1 — The Arrival.md",
];

/** A shipped note's raw bytes, and the body the editor is actually handed. */
export function shipped(rel: string): { raw: string; body: string } {
  const raw = readFileSync(`${VAULT}/${rel}`, "utf8");
  // Frontmatter is split off before the editor sees a byte of a note, so a test that
  // opens the raw file opens something the app never does.
  return { raw, body: parseFrontmatter(raw).body };
}

/**
 * Whether a ledger-relative path names a file the vault actually ships.
 *
 * A read rather than an `existsSync`, because this project's TypeScript config has types
 * for `readFileSync` alone. The files it is asked about are a few hundred bytes.
 */
export function shipsFile(rel: string): boolean {
  try {
    readFileSync(`${VAULT}/${rel}`, "utf8");
    return true;
  } catch {
    return false;
  }
}

/** The YAML between a note's `---` fences — what `parseFrontmatter` consumes and drops. */
export function frontmatterBlock(raw: string): string {
  return raw.startsWith("---\n") ? raw.slice(4, raw.indexOf("\n---", 4)) : "";
}

/**
 * The body of a note's first ```lang fence, without either backtick line.
 *
 * One reading of a fence's bounds, because three hand-rolled `indexOf` pairs in one file
 * is three chances to be off by the length of the word `infobox`.
 */
export function fenceBody(raw: string, lang: string): string {
  const open = raw.indexOf("```" + lang);
  if (open < 0) return "";
  const bodyStart = raw.indexOf("\n", open) + 1;
  return raw.slice(bodyStart, raw.indexOf("\n```", open) + 1);
}
