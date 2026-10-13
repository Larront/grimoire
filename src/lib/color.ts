/*
  Colour arithmetic for the pickers: hex ⇄ RGB ⇄ HSV, the wash a chosen colour is drawn
  as, and reading back what a scene has stored.

  HSV because that is the shape of a picker a person drags: hue is the strip, and
  saturation and value are the two axes of the square. Nothing here knows about themes;
  a colour a GM picks is data, as `entity-colors.ts` explains.
*/

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Hue 0–360, saturation and value 0–1. */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#rgb`, `rgb`, `#rrggbb` or `rrggbb` → lowercase `#rrggbb`; anything else → null. */
export function normalizeHex(input: string): string | null {
  const m = input.trim().match(HEX);
  if (!m) return null;
  const digits =
    m[1].length === 3
      ? m[1]
          .split("")
          .map((c) => c + c)
          .join("")
      : m[1];
  return `#${digits.toLowerCase()}`;
}

export function hexToRgb(hex: string): Rgb {
  const n = normalizeHex(hex);
  if (!n) throw new Error(`not a hex colour: ${hex}`);
  return {
    r: parseInt(n.slice(1, 3), 16),
    g: parseInt(n.slice(3, 5), 16),
    b: parseInt(n.slice(5, 7), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const part = (x: number) =>
    Math.round(Math.max(0, Math.min(255, x)))
      .toString(16)
      .padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const d = max - Math.min(rn, gn, bn);
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const c = v * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = v - c;
  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
}

export const hexToHsv = (hex: string): Hsv => rgbToHsv(hexToRgb(hex));
export const hsvToHex = (hsv: Hsv): string => rgbToHex(hsvToRgb(hsv));

/** `#rrggbb` at the given alpha, as `rgba(...)`. */
export function wash(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/*
  A stored colour as hex, whatever form it was stored in. The picker stores `#rrggbb`. A
  scene coloured from the old preset row holds that preset's 18% wash
  (`rgba(194,72,61,0.18)`), read back as the hue it washes; a pin or annotation may hold
  `rgb(...)` or `#rgb` from before. Nothing in a ledger is rewritten to tidy this up.
*/
export function storedColorHex(stored: string | null): string | null {
  if (!stored) return null;
  const hex = normalizeHex(stored);
  if (hex) return hex;
  const m = stored.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  return m ? rgbToHex({ r: +m[1], g: +m[2], b: +m[3] }) : null;
}
