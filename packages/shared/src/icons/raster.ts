/**
 * The little drawing the icons need: fill a shape, stroke round-capped lines,
 * and scale a logo onto a canvas. Shapes are drawn from their signed distance
 * (how far each pixel centre is outside the edge), which anti-aliases every
 * edge by the same one-pixel ramp at any size.
 */

import { parseHex } from "../colour.ts";
import type { RgbaImage } from "./png.ts";

export function createImage(
  width: number,
  height: number,
  fill?: string,
): RgbaImage {
  const image = { width, height, data: new Uint8Array(width * height * 4) };
  if (fill) fillShape(image, () => -1, fill);
  return image;
}

/** Signed distance in pixels from a pixel centre to a shape: < 0 is inside. */
export type Distance = (x: number, y: number) => number;

/** Blends `colour` over `image` wherever `distance` says the shape is. */
export function fillShape(
  image: RgbaImage,
  distance: Distance,
  colour: string,
  bounds: { x0: number; y0: number; x1: number; y1: number } = {
    x0: 0,
    y0: 0,
    x1: image.width,
    y1: image.height,
  },
): void {
  const rgb = parseHex(colour);
  if (!rgb) throw new TypeError(`not a colour: ${colour}`);
  const x0 = Math.max(0, Math.floor(bounds.x0));
  const y0 = Math.max(0, Math.floor(bounds.y0));
  const x1 = Math.min(image.width, Math.ceil(bounds.x1));
  const y1 = Math.min(image.height, Math.ceil(bounds.y1));
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const coverage = Math.min(
        1,
        Math.max(0, 0.5 - distance(x + 0.5, y + 0.5)),
      );
      if (coverage > 0) blend(image, x, y, rgb.r, rgb.g, rgb.b, coverage);
    }
  }
}

/** Source-over of one straight-alpha pixel, `alpha` 0 to 1. */
function blend(
  image: RgbaImage,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  alpha: number,
): void {
  const i = (y * image.width + x) * 4;
  const d = image.data;
  const below = d[i + 3]! / 255;
  const out = alpha + below * (1 - alpha);
  if (out <= 0) return;
  const keep = (below * (1 - alpha)) / out;
  const add = alpha / out;
  d[i] = Math.round(r * add + d[i]! * keep);
  d[i + 1] = Math.round(g * add + d[i + 1]! * keep);
  d[i + 2] = Math.round(b * add + d[i + 2]! * keep);
  d[i + 3] = Math.round(out * 255);
}

/** A rectangle with round corners of radius `r`. */
export function roundedRect(
  x: number,
  y: number,
  width: number,
  height: number,
  r: number,
): Distance {
  const cx = x + width / 2;
  const cy = y + height / 2;
  const hx = width / 2 - r;
  const hy = height / 2 - r;
  return (px, py) => {
    const qx = Math.abs(px - cx) - hx;
    const qy = Math.abs(py - cy) - hy;
    const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
    return outside + Math.min(Math.max(qx, qy), 0) - r;
  };
}

export function circle(cx: number, cy: number, r: number): Distance {
  return (px, py) => Math.hypot(px - cx, py - cy) - r;
}

/** Lines through points [x0, y0, x1, y1, …], each drawn in pixels. */
export type Polyline = readonly number[];

/**
 * Round-capped, round-joined strokes `width` wide, as SVG draws them with
 * `stroke-linecap="round" stroke-linejoin="round"`: the union of a capsule
 * around every segment. Each capsule is measured only over its own box, and
 * the union is the highest coverage any of them gives a pixel.
 */
export function fillStrokes(
  image: RgbaImage,
  lines: readonly Polyline[],
  width: number,
  colour: string,
): void {
  const rgb = parseHex(colour);
  if (!rgb) throw new TypeError(`not a colour: ${colour}`);
  const coverage = new Float32Array(image.width * image.height);
  const half = width / 2;
  const capsule = (ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax;
    const dy = by - ay;
    const length2 = dx * dx + dy * dy;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - half - 1));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - half - 1));
    const x1 = Math.min(image.width, Math.ceil(Math.max(ax, bx) + half + 1));
    const y1 = Math.min(image.height, Math.ceil(Math.max(ay, by) + half + 1));
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const px = x + 0.5 - ax;
        const py = y + 0.5 - ay;
        const t =
          length2 === 0
            ? 0
            : Math.min(1, Math.max(0, (px * dx + py * dy) / length2));
        const d = Math.hypot(px - t * dx, py - t * dy) - half;
        const c = Math.min(1, Math.max(0, 0.5 - d));
        const i = y * image.width + x;
        if (c > coverage[i]!) coverage[i] = c;
      }
    }
  };
  for (const line of lines) {
    if (line.length === 2) capsule(line[0]!, line[1]!, line[0]!, line[1]!);
    for (let i = 0; i + 3 < line.length; i += 2) {
      capsule(line[i]!, line[i + 1]!, line[i + 2]!, line[i + 3]!);
    }
  }
  for (let i = 0; i < coverage.length; i += 1) {
    const c = coverage[i]!;
    if (c > 0) {
      blend(
        image,
        i % image.width,
        Math.floor(i / image.width),
        rgb.r,
        rgb.g,
        rgb.b,
        c,
      );
    }
  }
}

// --- scaling ------------------------------------------------------------------

/**
 * One axis of a resample, on premultiplied floats: a triangle filter as wide
 * as the scale step, so shrinking averages every source pixel it covers
 * (no shimmer on a detailed logo) and enlarging is bilinear.
 */
function resampleAxis(
  src: Float32Array,
  srcLength: number,
  lines: number,
  dstLength: number,
  horizontal: boolean,
  srcWidth: number,
): Float32Array {
  const out = new Float32Array(
    horizontal ? dstLength * lines * 4 : srcWidth * dstLength * 4,
  );
  const scale = srcLength / dstLength;
  const radius = Math.max(1, scale);
  for (let i = 0; i < dstLength; i += 1) {
    const centre = (i + 0.5) * scale - 0.5;
    const first = Math.max(0, Math.floor(centre - radius) + 1);
    const last = Math.min(srcLength - 1, Math.ceil(centre + radius) - 1);
    const weights: number[] = [];
    let total = 0;
    for (let s = first; s <= last; s += 1) {
      const w = Math.max(0, 1 - Math.abs(s - centre) / radius);
      weights.push(w);
      total += w;
    }
    if (total === 0) {
      const nearest = Math.min(srcLength - 1, Math.max(0, Math.round(centre)));
      weights.length = 0;
      for (let s = first; s <= last; s += 1)
        weights.push(s === nearest ? 1 : 0);
      total = 1;
    }
    for (let line = 0; line < lines; line += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = 0; k < weights.length; k += 1) {
        const w = weights[k]! / total;
        if (w === 0) continue;
        const s = first + k;
        const j = horizontal
          ? (line * srcLength + s) * 4
          : (s * srcWidth + line) * 4;
        r += src[j]! * w;
        g += src[j + 1]! * w;
        b += src[j + 2]! * w;
        a += src[j + 3]! * w;
      }
      const o = horizontal
        ? (line * dstLength + i) * 4
        : (i * srcWidth + line) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }
  return out;
}

/** `image` scaled to `width` × `height`. */
export function resize(
  image: RgbaImage,
  width: number,
  height: number,
): RgbaImage {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const pre = new Float32Array(image.width * image.height * 4);
  for (let i = 0; i < pre.length; i += 4) {
    const a = image.data[i + 3]! / 255;
    pre[i] = image.data[i]! * a;
    pre[i + 1] = image.data[i + 1]! * a;
    pre[i + 2] = image.data[i + 2]! * a;
    pre[i + 3] = a;
  }
  const across = resampleAxis(
    pre,
    image.width,
    image.height,
    w,
    true,
    image.width,
  );
  const down = resampleAxis(across, image.height, w, h, false, w);
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    const a = down[i + 3]!;
    data[i + 3] = Math.round(Math.min(1, a) * 255);
    if (a > 0) {
      data[i] = Math.round(Math.min(255, down[i]! / a));
      data[i + 1] = Math.round(Math.min(255, down[i + 1]! / a));
      data[i + 2] = Math.round(Math.min(255, down[i + 2]! / a));
    }
  }
  return { width: w, height: h, data };
}

/**
 * Draws `src` over `dst` with its top-left corner at (x, y), clipped to
 * `clip` when given (a shape outside which nothing is drawn).
 */
export function drawImage(
  dst: RgbaImage,
  src: RgbaImage,
  x: number,
  y: number,
  clip?: Distance,
): void {
  const left = Math.round(x);
  const top = Math.round(y);
  for (let sy = 0; sy < src.height; sy += 1) {
    const dy = top + sy;
    if (dy < 0 || dy >= dst.height) continue;
    for (let sx = 0; sx < src.width; sx += 1) {
      const dx = left + sx;
      if (dx < 0 || dx >= dst.width) continue;
      const i = (sy * src.width + sx) * 4;
      let alpha = src.data[i + 3]! / 255;
      if (clip) {
        alpha *= Math.min(1, Math.max(0, 0.5 - clip(dx + 0.5, dy + 0.5)));
      }
      if (alpha > 0) {
        blend(
          dst,
          dx,
          dy,
          src.data[i]!,
          src.data[i + 1]!,
          src.data[i + 2]!,
          alpha,
        );
      }
    }
  }
}

/** Every pixel's alpha, kept only inside `shape` (for rounded icon corners). */
export function clipTo(image: RgbaImage, shape: Distance): void {
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const coverage = Math.min(1, Math.max(0, 0.5 - shape(x + 0.5, y + 0.5)));
      const i = (y * image.width + x) * 4 + 3;
      image.data[i] = Math.round(image.data[i]! * coverage);
    }
  }
}
