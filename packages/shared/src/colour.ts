/**
 * Colour maths for the themes: WCAG 2.x contrast, and the guard that keeps a
 * cafe's own accent colour readable.
 *
 * TOE learnt this the hard way: its terracotta and sage looked fine and still
 * failed WCAG AA as text, so it carries darker "-deep" twins of them. A cafe's
 * accent gets the same treatment automatically: `fitContrast` walks the colour
 * towards black (or white, on a dark theme) only as far as it takes to pass,
 * so the hue the owner picked survives and only its lightness gives way.
 *
 * Colours are "#RRGGBB" strings throughout. Plain TypeScript with no
 * dependencies, so the cafe app, the console's signup form and the deployer
 * all run the same check.
 */

export interface Rgb {
  /** 0 to 255 each. */
  r: number;
  g: number;
  b: number;
}

/** WCAG AA for body text. */
export const AA_TEXT = 4.5;
/** WCAG AA for large text (24px, or 18.66px bold) and for UI shapes. */
export const AA_LARGE = 3;

/** "#RGB" or "#RRGGBB", any case, to channels; null for anything else. */
export function parseHex(hex: string): Rgb | null {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
  if (short) {
    const [r, g, b] = short.slice(1).map((c) => parseInt(c + c, 16));
    return { r, g, b };
  }
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!long) return null;
  const [r, g, b] = long.slice(1).map((c) => parseInt(c, 16));
  return { r, g, b };
}

export function isHexColour(value: unknown): value is string {
  return typeof value === "string" && parseHex(value) !== null;
}

/** Channels (rounded, clamped) to "#RRGGBB" in upper case. */
export function toHex({ r, g, b }: Rgb): string {
  const part = (c: number) =>
    Math.round(Math.min(255, Math.max(0, c)))
      .toString(16)
      .padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

function rgbOf(colour: string | Rgb): Rgb {
  if (typeof colour !== "string") return colour;
  const rgb = parseHex(colour);
  if (!rgb) throw new TypeError(`not a colour: ${JSON.stringify(colour)}`);
  return rgb;
}

function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(colour: string | Rgb): number {
  const { r, g, b } = rgbOf(colour);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio, 1 to 21. Order does not matter. */
export function contrastRatio(a: string | Rgb, b: string | Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `amount` (0 to 1) of the way from `from` to `to`, in sRGB. */
export function mix(from: string, to: string, amount: number): string {
  const a = rgbOf(from);
  const b = rgbOf(to);
  const t = Math.min(1, Math.max(0, amount));
  return toHex({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  });
}

/** Whether the colour is closer to white than to black, by contrast. */
export function isLight(colour: string): boolean {
  return contrastRatio(colour, "#000000") > contrastRatio(colour, "#FFFFFF");
}

/** The lowest contrast `colour` has against any of `against`. */
export function minContrast(colour: string, against: readonly string[]) {
  return Math.min(...against.map((other) => contrastRatio(colour, other)));
}

/**
 * The colour nearest to `colour` on its way to black (or white) that has at
 * least `min` contrast against every colour in `against`. `colour` itself when
 * it already passes; null when not even black (white) does.
 *
 * Mixing towards black in sRGB scales every channel by the same factor, which
 * keeps the hue: a bright orange becomes a roasted brown, not a grey.
 */
export function fitContrast(
  colour: string,
  against: readonly string[],
  { min = AA_TEXT, toward = "#000000" }: { min?: number; toward?: string } = {},
): string | null {
  const start = toHex(rgbOf(colour));
  if (minContrast(start, against) >= min) return start;
  if (minContrast(toward, against) < min) return null;
  // Once the colour has failed, walking towards the far end only ever helps
  // (each step moves it further from every colour it is measured against),
  // so the first passing step can be found by halving.
  let low = 0;
  let high = 1;
  for (let i = 0; i < 24; i += 1) {
    const middle = (low + high) / 2;
    if (minContrast(mix(start, toward, middle), against) >= min) high = middle;
    else low = middle;
  }
  // `mix` rounds to whole channels, so step on until the rounded colour
  // passes too.
  let fitted = mix(start, toward, high);
  for (let t = high; minContrast(fitted, against) < min && t < 1;) {
    t = Math.min(1, t + 1 / 255);
    fitted = mix(start, toward, t);
  }
  return fitted;
}
