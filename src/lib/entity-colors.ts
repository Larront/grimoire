/*
  The colours a GM can pick for a thing they made, and the one place the picker rows come
  from.

  THESE ARE DATA, NOT THEME. Every value here is written into SQLite the moment a GM
  clicks it — `pins.color`, `map_annotations.color`, `scenes.thumbnail_color` — and read
  back verbatim forever after. That is why they are literal hex and not `var(--primary)`:
  a token stored on a row would re-resolve when the GM switched accent or mode, and a red
  pin placed under Crimson would silently become a purple one under Arcane. The theme
  moves; a choice the GM made about their world does not.

  THE VALUES ARE THE ACCENT PRESETS ANYWAY. The five named steps below are the dark-mode
  values of `.accent-crimson` … `.accent-amber` in `app.css`, so a picker row reads as
  this app's palette rather than as some other program's. The repetition is deliberate and
  one-directional: the stylesheets remain the only place a *theme* value is defined, and
  this file is the frozen copy the *data* ramp is drawn from. `src/test/entity-colors.test.ts`
  fails if the two drift apart — including against `shared/tokens.css`, which ships
  crimson a third time as the default `--primary`.

  This is not the Dataviz Exception's "palette to spend on their data" (DESIGN.md §2).
  That clause forbids the APP assigning accent presets to encode a category; nothing here
  is assigned. A GM reaching for Crimson on a pin is choosing it, one pin at a time, and
  the app's answer to "which colours may I choose from?" ought to be the app's own.

  WHAT THIS RAMP IS NOT is a generic Tailwind scale. The annotation picker used to be nine
  Tailwind defaults — teal-400, sky-400, violet-400, slate-200 — in a system whose
  DESIGN.md §2 rules out cold grey in as many words, which is how a GM ended up drawing a
  slate-200 rectangle on a warm parchment map (#222). The warmth is the point. Anything
  added here belongs to the Iron/Ember/accent families or it does not belong here.
*/

/** `#rrggbb` at the given alpha. The five fills are derived rather than written out, so
    a retuned preset cannot leave its own wash behind on the old hue. */
function wash(hex: string, alpha: number): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

const ACCENTS = [
  { name: "crimson", label: "Crimson", swatch: "#c2483d" },
  { name: "arcane", label: "Arcane", swatch: "#9b6bbf" },
  { name: "verdant", label: "Verdant", swatch: "#5c9e6e" },
  { name: "ice", label: "Ice", swatch: "#5b9ec9" },
  { name: "amber", label: "Amber", swatch: "#c49a3c" },
] as const;

/**
 * The five preset names, as a type.
 *
 * `AccentPreset` in the ledger store is `accent-${AccentName}`, and the accent picker in
 * Settings builds its options by interpolating exactly that — so a sixth preset added
 * here, or a rename, is a type error there rather than a swatch quietly missing from
 * Settings. That picker used to state the five names a fourth time.
 */
export type AccentName = (typeof ACCENTS)[number]["name"];

/** One accent preset, as data: the swatch a GM picks and the wash it fills behind.
    Distinct from the store's `AccentPreset`, which is the *class* the theme applies. */
export interface AccentSwatch {
  /** Matches the `.accent-<name>` class in app.css. */
  readonly name: AccentName;
  readonly label: string;
  /** The dark-mode `--primary` of that class. */
  readonly swatch: string;
  /** The same hue at 18%, for fills behind an icon (scene thumbnails). */
  readonly bg: string;
}

export const ACCENT_PRESETS: readonly AccentSwatch[] = ACCENTS.map((a) => ({
  ...a,
  bg: wash(a.swatch, 0.18),
}));

/*
  The colour a pin wears when nobody has chosen one, and the FIRST swatch in the picker —
  which is the constraint that decides it. A default outside the presets is a state a GM
  can leave but never get back to.

  It was `#4a90c4`, a cold blue, in a system whose §2 says its neutrals lean toward the
  red-brown axis and "never cold grey". Brass is the warm mid-luminance step: it holds up
  over a bright parchment map and a dark one alike, which the darker presets do not, and
  it stays clear of the accent. That last part is deliberate — DESIGN.md spends the accent
  on active states precisely because it is scarce, and every pin on a map wearing it would
  be the least scarce thing on screen. It sits beside Amber rather than being Amber for
  the same reason.
*/
export const DEFAULT_PIN_COLOR = "#b89a5e";

/*
  The Ember text family's DARK values, as pickable data — three warm steps from near-white
  to a deep grey-brown. An annotation is most often a label read against an arbitrary
  photograph, so the row needs a legibility range, and needs it warm because the map
  underneath is.

  Dark deliberately, not "whichever mode the GM is in". These sit on the map image, not on
  the app's background: the surface an annotation is read against is a picture the GM
  supplied, and it does not lighten when they switch to light mode. `--foreground-faint`
  in light mode is `#a39e99`, the same value as `--foreground-muted` in dark — following
  the mode would have collapsed two swatches of this row into one.
*/
const EMBER_ASH = "#f0ece8";
const EMBER_ASH_MUTED = "#a39e99";
const EMBER_ASH_FAINT = "#6b6460";

/** What an annotation is born wearing — a shape's fill, a text label's colour. */
export const DEFAULT_ANNOTATION_COLOR = EMBER_ASH;
/** What an annotation's outline is born wearing. Both are in the row below, so a GM who
    recolours a shape can get back to how it arrived. */
export const DEFAULT_ANNOTATION_STROKE = EMBER_ASH_MUTED;

/**
 * The swatch row every entity picker shows: pins, annotation fills, annotation strokes.
 *
 * One row rather than one per entity. The alternative — a pin ramp and an annotation ramp
 * — is what this file replaced, and the two had drifted into different colour systems
 * on the same map (#222). Ordered so that the two defaults a GM can arrive at without
 * choosing (pin brass, annotation ash) are in it and reachable again.
 *
 * NOTHING MIGRATES. A pin or annotation already saved with one of the retired colours
 * keeps it: the row is that GM's choice, made on their map, and rewriting it to the
 * nearest new swatch would be this file overruling them to tidy itself up. The picker
 * shows such a value as the custom swatch, wearing the colour, so it reads as chosen
 * rather than as missing — and picking from the row is how they move to it, if they want
 * to. What changes is only what a *new* pin or annotation is born wearing.
 */
export const ENTITY_COLOR_PRESETS: readonly string[] = [
  DEFAULT_PIN_COLOR,
  ...ACCENT_PRESETS.map((p) => p.swatch),
  EMBER_ASH,
  EMBER_ASH_MUTED,
  EMBER_ASH_FAINT,
];
