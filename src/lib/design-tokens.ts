/**
 * Read a design token off `<html>` at call time, so the value follows light/dark and the
 * GM's accent without anything having to re-subscribe.
 *
 * For the two surfaces that CANNOT name a token: Leaflet and Cytoscape write colours onto
 * SVG presentation attributes (`stroke`, `fill`), where a `var()` does not resolve, so
 * the drawing code has to hand over a concrete value. Everything with a stylesheet should
 * keep saying `var(--foreground-muted)` and never come here.
 *
 * The `fallback` is the token's own dark value from `shared/tokens.css`, reached only in
 * the moment before the stylesheet applies (and under a test renderer that loads none).
 * NOTHING READ HERE IS EVER STORED — that is the line between this and
 * `$lib/entity-colors`, whose literals are frozen because a GM picked them and a ledger
 * remembers them. A value from here is the theme, and the theme is allowed to change.
 */
export function readToken(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  return (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
    fallback
  );
}
