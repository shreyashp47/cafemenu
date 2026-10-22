/**
 * Letters for the monogram icons, drawn for this project: a rounded monoline
 * face (every stroke the same weight, round ends), so a monogram needs no
 * font file at deploy time and looks the same on every machine.
 *
 * Each glyph is a set of centre lines on a grid where the capitals run from
 * y = 0 (top) to y = 100 (baseline), drawn with a stroke STROKE units wide.
 * Curves are flattened into short straight pieces here, once.
 */

import type { Polyline } from "./raster.ts";

export const STROKE = 17;
export const CAP_HEIGHT = 100;

export interface Glyph {
  /** Width of the centre lines; the ink is STROKE / 2 wider on each side. */
  width: number;
  lines: Polyline[];
}

/**
 * Points along an ellipse from angle `from` to `to`, in degrees, with 0° at
 * three o'clock and angles growing clockwise (the y axis points down).
 */
function arc(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  from: number,
  to: number,
): number[] {
  const steps = Math.max(2, Math.ceil(Math.abs(to - from) / 6));
  const points: number[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    points.push(
      Math.round((cx + rx * Math.cos(a)) * 100) / 100,
      Math.round((cy + ry * Math.sin(a)) * 100) / 100,
    );
  }
  return points;
}

const g = (width: number, ...lines: number[][]): Glyph => ({ width, lines });

export const GLYPHS: Readonly<Record<string, Glyph>> = {
  A: g(64, [0, 100, 32, 0, 64, 100], [12, 64, 52, 64]),
  B: g(
    58,
    [0, 50, 0, 0, 28, 0, ...arc(28, 25, 25, 25, -90, 90), 0, 50],
    [0, 50, 32, 50, ...arc(32, 75, 26, 25, -90, 90), 0, 100, 0, 50],
  ),
  C: g(80, arc(46, 50, 46, 50, -42, -318)),
  D: g(68, [0, 0, 22, 0, ...arc(22, 50, 46, 50, -90, 90), 0, 100, 0, 0]),
  E: g(52, [52, 0, 0, 0, 0, 100, 52, 100], [0, 50, 42, 50]),
  F: g(52, [52, 0, 0, 0, 0, 100], [0, 50, 42, 50]),
  G: g(92, [...arc(46, 50, 46, 50, -42, -360), 92, 56, 54, 56]),
  H: g(60, [0, 0, 0, 100], [60, 0, 60, 100], [0, 50, 60, 50]),
  I: g(0, [0, 0, 0, 100]),
  J: g(50, [50, 0, 50, 72, ...arc(25, 72, 25, 28, 0, 180)]),
  K: g(58, [0, 0, 0, 100], [58, 0, 0, 62], [21, 40, 60, 100]),
  L: g(50, [0, 0, 0, 100, 50, 100]),
  M: g(76, [0, 100, 0, 0, 38, 66, 76, 0, 76, 100]),
  N: g(62, [0, 100, 0, 0, 62, 100, 62, 0]),
  O: g(92, arc(46, 50, 46, 50, 0, 360)),
  P: g(56, [0, 100, 0, 0, 28, 0, ...arc(28, 28, 28, 28, -90, 90), 0, 56]),
  Q: g(92, arc(46, 50, 46, 50, 0, 360), [58, 72, 94, 106]),
  R: g(
    58,
    [0, 100, 0, 0, 28, 0, ...arc(28, 27, 27, 27, -90, 90), 0, 54],
    [26, 54, 58, 100],
  ),
  S: g(60, [
    ...arc(30, 25, 27, 25, -28, -270),
    ...arc(30, 75, 30, 25, -90, 152),
  ]),
  T: g(64, [0, 0, 64, 0], [32, 0, 32, 100]),
  U: g(62, [0, 0, 0, 68, ...arc(31, 68, 31, 32, 180, 0), 62, 0]),
  V: g(64, [0, 0, 32, 100, 64, 0]),
  W: g(92, [0, 0, 22, 100, 46, 28, 70, 100, 92, 0]),
  X: g(60, [0, 0, 60, 100], [60, 0, 0, 100]),
  Y: g(62, [0, 0, 31, 50, 62, 0], [31, 50, 31, 100]),
  Z: g(58, [0, 0, 58, 0, 0, 100, 58, 100]),
  "0": g(62, arc(31, 50, 31, 50, 0, 360)),
  "1": g(24, [0, 18, 24, 0, 24, 100]),
  "2": g(60, [...arc(29, 29, 29, 29, -168, 30), 0, 100, 60, 100]),
  "3": g(58, [
    ...arc(27, 26, 26, 26, -160, 90),
    ...arc(27, 75, 31, 25, -90, 160),
  ]),
  "4": g(64, [46, 100, 46, 0, 0, 70, 64, 70]),
  "5": g(60, [54, 0, 6, 0, 2, 46, ...arc(30, 69, 30, 31, -140, 152)]),
  "6": g(62, [50, 0, ...arc(31, 69, 31, 31, -150, 210)]),
  "7": g(60, [0, 0, 60, 0, 20, 100]),
  "8": g(60, arc(30, 25, 26, 25, 90, 450), arc(30, 75, 30, 25, -90, 270)),
  "9": g(62, [...arc(31, 31, 31, 31, 30, 390), 12, 100]),
};

/** Drawn when a cafe's name has no letter the glyphs cover. */
export const CUP: Glyph = g(
  86,
  [0, 30, 66, 30],
  [6, 30, 12, 100, 54, 100, 60, 30],
  arc(66, 58, 18, 17, -80, 80),
  [24, 0, 24, 14],
  [42, 0, 42, 14],
);

/**
 * The monogram as centre lines in glyph units, laid out side by side with
 * one stroke of air between letters, and the size of the box they fill
 * (ink included).
 */
export function layoutMonogram(letters: string): {
  lines: Polyline[];
  width: number;
  height: number;
} {
  const glyphs = Array.from(letters, (ch) => GLYPHS[ch]).filter(
    (glyph): glyph is Glyph => glyph !== undefined,
  );
  const set =
    glyphs.length > 0 && glyphs.length === letters.length ? glyphs : [CUP];
  const gap = STROKE * 1.15;
  const lines: Polyline[] = [];
  let x = STROKE / 2;
  for (const glyph of set) {
    for (const line of glyph.lines) {
      lines.push(line.map((v, i) => (i % 2 === 0 ? v + x : v + STROKE / 2)));
    }
    x += glyph.width + STROKE + gap;
  }
  return {
    lines,
    width: x - gap - STROKE / 2,
    height: CAP_HEIGHT + STROKE,
  };
}
