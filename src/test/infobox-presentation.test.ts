// The Infobox's float (#176) — the rules that make the panel read like a wiki page's
// summary box on a wide column and a full-width stacked panel on a narrow one.
//
// **Why this test reads a stylesheet instead of rendering something.** The float is
// deliberately CSS and nothing else (#148): no attribute in the fence, no class the
// view decides, nothing in the document that could disagree with the space available.
// That leaves it with no JavaScript seam to test — and jsdom performs no layout, so a
// rendered panel has no width, no container to query and no float to observe. The
// choice is between asserting the rules exist and saying nothing at all about four of
// this ticket's acceptance criteria. So: the subject is the stylesheet, and each
// assertion is one of those criteria.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Read as a file rather than imported: the test runner stubs stylesheet imports to
// nothing, and the subject here is the stylesheet's own text. Relative to the
// runner's working directory, which is the project root.
const css = readFileSync("src/app.css", "utf8");

/** The body of the one `@container` block that carries the float. */
function floatBlock(): string {
  const at = css.indexOf("@container note-column");
  expect(at, "the float lives in a @container query on the note column").toBeGreaterThan(-1);
  const open = css.indexOf("{", at);
  // Nested rules, so the block ends at the brace that balances the first one.
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error("unterminated @container block");
}

describe("the Infobox's float is measured on the block's own column", () => {
  it("makes the text column itself the container", () => {
    // `.tiptap` is the prose column — the editor's own root, not the pane and not the
    // window. Naming it is what lets the query below be read without ambiguity.
    expect(css).toMatch(/\.tiptap\s*\{[^}]*container-type:\s*inline-size/);
    expect(css).toMatch(/\.tiptap\s*\{[^}]*container-name:\s*note-column/);
  });

  it("floats on the column's width and not the viewport's", () => {
    // The clause that would have been got wrong: a half-width pane on an ultrawide has
    // a narrow column and a huge window, so a media query would float the panel into
    // ~270px of prose — four or five words a line.
    expect(css).toContain("@container note-column (min-width: 640px)");
    expect(css).not.toMatch(/@media[^{]*\)\s*\{[^}]*data-infobox-block/);
  });

  it("floats the block beside the prose, at the width the threshold is derived from", () => {
    const block = floatBlock();

    expect(block).toContain("[data-infobox-block]");
    expect(block).toMatch(/float:\s*right/);
    // 300 panel + 24 gap + 320 of readable prose = the 640px threshold above. The
    // three numbers are one derivation and only make sense together.
    expect(css).toMatch(/--infobox-float-width:\s*300px/);
    expect(css).toMatch(/--infobox-float-gap:\s*24px/);
    expect(block).toMatch(/width:\s*var\(--infobox-float-width\)/);
    expect(block).toMatch(/margin-left:\s*var\(--infobox-float-gap\)/);
  });

  it("clears a panel already floating, rather than pairing two beside the prose", () => {
    // A Location note carries one panel per district, and two floats side by side
    // would leave a third of the column for the prose the threshold is about.
    expect(floatBlock()).toMatch(/clear:\s*right/);
  });

  it("records the derivation, so the threshold can be re-derived rather than nudged", () => {
    const preamble = css.slice(Math.max(0, css.indexOf("@container note-column") - 1400));

    expect(preamble).toContain("640");
    expect(preamble).toContain("300");
    expect(preamble).toContain("320");
  });
});

describe("what the float does to the prose around it", () => {
  it("clears the float at every heading level", () => {
    // The built-in Location template is consecutive `##` headings, so ragged wrapping
    // is the common case rather than an edge one. A paragraph wraps, which is the point.
    const headings: string[] = css.match(/\.tiptap h1[\s\S]*?\{[^}]*\}/g) ?? [];
    expect(headings.some((rule) => /clear:\s*both/.test(rule))).toBe(true);
    for (const level of ["h2", "h3", "h4", "h5", "h6"]) {
      expect(headings.some((rule) => rule.includes(`.tiptap ${level}`))).toBe(true);
    }
  });

  it("caps the thumbnail at its floated size, so a stacked panel does not grow it", () => {
    // The panel's own floated width less its padding, off the same variable the float
    // uses, so the cap cannot drift away from what it is a cap on. Upscaling a file the
    // GM dropped in goes visibly soft, and a full-width portrait makes an inline
    // summary the dominant thing on the page.
    expect(css).toMatch(
      /\.infobox-thumb\s*\{[^}]*max-width:\s*calc\(var\(--infobox-float-width\)/,
    );
  });

  it("reflows nothing into columns at any width", () => {
    // The rejected second layout for one block: same content, two arrangements, and
    // every future row feature having to work in both.
    expect(floatBlock()).not.toMatch(/columns|grid-template-columns|column-count/);
    expect(css.match(/@container note-column/g)).toHaveLength(1);
  });
});
