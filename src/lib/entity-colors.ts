/*
  The colours the app hands out as data: the five accent presets, and what a pin or
  annotation is born wearing.

  THESE ARE DATA, NOT THEME. Every colour a GM gives a thing they made is written into
  SQLite — `pins.color`, `map_annotations.color`, `scenes.thumbnail_color` — and read back
  verbatim forever after. That is why the values here are literal hex and not
  `var(--primary)`: a token stored on a row would re-resolve when the GM switched accent
  or mode, and a red pin placed under Crimson would silently become a purple one under
  Arcane. The theme moves; a choice the GM made about their world does not.

  WHAT A GM CAN PICK is any colour at all, from `ColorPicker` — scenes, pins and
  annotations alike. They used to pick from a row of swatches drawn from this file; that
  row is gone, and with it the job of deciding which colours a GM may use. What is left
  here is the defaults, which still have to be chosen well because most things are never
  recoloured.

  THE PRESETS ARE THE ACCENT CLASSES' VALUES. The five named steps below are the dark-mode
  values of `.accent-crimson` … `.accent-amber` in `app.css`. Settings' accent list builds
  from them, and the PDF scene-link layer pairs highlights with their hues. The repetition
  is deliberate and one-directional: the stylesheets remain the only place a *theme* value
  is defined, and this file is the frozen copy. `src/test/entity-colors.test.ts` fails if
  the two drift apart — including against `shared/tokens.css`, which ships crimson a third
  time as the default `--primary`.
*/

// The five fills are derived with `wash` rather than written out, so a retuned preset
// cannot leave its own wash behind on the old hue.
import { wash } from "./color";

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
  The colour a pin wears when nobody has chosen one, and where the picker opens for a pin
  that has none of its own.

  It was `#4a90c4`, a cold blue, in a system whose §2 says its neutrals lean toward the
  red-brown axis and "never cold grey" (#222). Brass is the warm mid-luminance step: it
  holds up over a bright parchment map and a dark one alike, which the darker presets do
  not, and it stays clear of the accent. That last part is deliberate — DESIGN.md spends
  the accent on active states precisely because it is scarce, and every pin on a map
  wearing it would be the least scarce thing on screen. It sits beside Amber rather than
  being Amber for the same reason.
*/
export const DEFAULT_PIN_COLOR = "#b89a5e";

/*
  The Ember text family's DARK values, for what an annotation is born wearing. An
  annotation is most often a label read against an arbitrary photograph, so it starts
  near-white with a quieter outline, and warm because the map underneath is.

  Dark deliberately, not "whichever mode the GM is in". These sit on the map image, not on
  the app's background: the surface an annotation is read against is a picture the GM
  supplied, and it does not lighten when they switch to light mode.
*/
const EMBER_ASH = "#f0ece8";
const EMBER_ASH_MUTED = "#a39e99";

/** What an annotation is born wearing — a shape's fill, a text label's colour — and what
    the picker's Default puts back. */
export const DEFAULT_ANNOTATION_COLOR = EMBER_ASH;
/** What an annotation's outline is born wearing, and what Default puts back. */
export const DEFAULT_ANNOTATION_STROKE = EMBER_ASH_MUTED;
