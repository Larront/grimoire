// The text rules of a wikilink target — parsing `[[path|display]]`, stripping
// `#heading` fragments, deriving a display stem. Deliberately free of TipTap and
// ProseMirror so non-editor code (the ledger-level Link Resolver) can apply the
// same rules without pulling an editor into its module graph. `wiki-link.ts`
// re-exports these, so existing imports from there keep working.

// Strip an Obsidian `#heading` / `#^block` fragment from a raw link target.
// Resolution ignores fragments; the node's path attribute keeps them so the
// original [[target#heading]] text round-trips to markdown unchanged.
export function stripWikiFragment(target: string): string {
  const hash = target.indexOf("#");
  return (hash >= 0 ? target.slice(0, hash) : target).trim();
}

// The display title a path falls back to when no explicit alias is given:
// the last path segment with any .md extension and #fragment stripped.
export function wikiStem(path: string): string {
  const base = stripWikiFragment(path) || path;
  return base.split("/").pop()?.replace(/\.md$/, "") ?? base;
}

// Splits the inside of a [[...]] link into its target path and display title.
// `path|display` uses the explicit alias; otherwise the title is the path stem.
export function parseWikiTarget(raw: string): { path: string; title: string } {
  const inner = raw.trim();
  const pipe = inner.indexOf("|");
  const path = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
  const title = pipe >= 0 ? inner.slice(pipe + 1).trim() : wikiStem(path);
  return { path, title };
}
