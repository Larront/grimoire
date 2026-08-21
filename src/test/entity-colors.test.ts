// The entity colour ramp (#222) — the swatch row every picker in the app draws from.
//
// **Why this test reads a stylesheet.** `entity-colors.ts` claims its five named steps
// ARE the accent presets, and the claim is the whole reason a GM's picker looks like this
// app rather than like a generic Tailwind scale. But the two cannot share a definition:
// `app.css` holds a *theme* that re-resolves on every mode and accent change, and this
// holds *data* frozen into SQLite rows the moment a swatch is clicked. So the agreement
// is by construction and would rot silently — a preset retuned in `app.css` would leave
// the pickers painting last year's crimson, and nothing would fail. This is what fails.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  ACCENT_PRESETS,
  DEFAULT_PIN_COLOR,
  DEFAULT_ANNOTATION_COLOR,
  DEFAULT_ANNOTATION_STROKE,
  ENTITY_COLOR_PRESETS,
} from "$lib/entity-colors";

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

describe("the picker row", () => {
  it("carries every colour an entity can arrive wearing", () => {
    // A default outside the row is a state a GM can leave but never get back to.
    for (const fallback of [
      DEFAULT_PIN_COLOR,
      DEFAULT_ANNOTATION_COLOR,
      DEFAULT_ANNOTATION_STROKE,
    ]) {
      expect(ENTITY_COLOR_PRESETS).toContain(fallback);
    }
  });

  it("leads with the pin default, so a pin's first swatch is where it started", () => {
    expect(ENTITY_COLOR_PRESETS[0]).toBe(DEFAULT_PIN_COLOR);
  });

  it("repeats no colour", () => {
    expect(new Set(ENTITY_COLOR_PRESETS).size).toBe(ENTITY_COLOR_PRESETS.length);
  });

  it("is warm — nothing from the cold Tailwind ramp this replaced", () => {
    // slate-200/400/50, teal-400, sky-400, violet-400, and the cold blue the pin
    // default used to be. Named individually rather than by a hue test: the point is
    // that these specific values were on this specific row (#222).
    const banned = ["#e2e8f0", "#94a3b8", "#f8fafc", "#2dd4bf", "#38bdf8", "#a78bfa", "#4a90c4"];
    for (const hex of banned) expect(ENTITY_COLOR_PRESETS).not.toContain(hex);
  });
});
