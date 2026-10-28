// The accent presets as data (#222) — what Settings' accent list and the PDF scene-link
// layer draw from.
//
// **Why this test reads a stylesheet.** `entity-colors.ts` claims its five named steps
// ARE the accent presets. But the two cannot share a definition: `app.css` holds a
// *theme* that re-resolves on every mode and accent change, and this holds *data* that
// must not. So the agreement is by construction and would rot silently — a preset retuned
// in `app.css` would leave Settings' swatches and the PDF highlights painting last year's
// crimson, and nothing would fail. This is what fails.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ACCENT_PRESETS } from "$lib/entity-colors";

// Relative to the runner's working directory, which is the project root.
const css = readFileSync("src/app.css", "utf8");

/** The dark-mode `--primary` declared by `.accent-<name>` — the rule with no `.light`. */
function darkPrimary(name: string): string | null {
  const rule = new RegExp(String.raw`\n\.accent-${name}\s*\{([^}]*)\}`).exec(css);
  if (!rule) return null;
  return /--primary:\s*([^;]+);/.exec(rule[1])?.[1].trim() ?? null;
}

describe("entity colour presets", () => {
  it("names the same five presets app.css does", () => {
    const inCss = [...css.matchAll(/(?:^|\n)\.accent-([a-z]+)\s*\{/g)].map((m) => m[1]);
    expect(inCss).toEqual(ACCENT_PRESETS.map((p) => p.name));
  });

  for (const preset of ACCENT_PRESETS) {
    it(`${preset.name}'s swatch is that preset's dark --primary`, () => {
      expect(darkPrimary(preset.name)).toBe(preset.swatch);
    });
  }

  // The third copy, and the one a review caught this test missing: `shared/tokens.css`
  // ships crimson's two values as the app's *default* `--primary`, which is what a GM
  // who has never opened Settings is looking at.
  it("agrees with the shipped default primary in shared/tokens.css", () => {
    const tokens = readFileSync("shared/tokens.css", "utf8");
    const crimson = ACCENT_PRESETS.find((p) => p.name === "crimson")!;
    // The first `--primary` in the file is `:root`'s; the later one is `.light`'s, which
    // is a value this module deliberately does not carry.
    const shippedDefault = /--primary:\s*([^;]+);/.exec(tokens)?.[1].trim();
    expect(shippedDefault).toBe(crimson.swatch);
  });
});
