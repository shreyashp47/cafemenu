/**
 * The logo an owner uploads at sign-up: which files are taken, and what is
 * kept. The browser redraws it as a PNG of at most SETUP_LOGO_SIDE pixels a
 * side (./logo-image.ts), because the icon generator in @cafemenu/shared
 * reads PNG only and the largest icon is 512 pixels; that PNG is what goes to
 * `cafes/{id}/setup/logo`, and provisioning (#28) turns it into the site's
 * /logo.png and app icons.
 */

import { SETUP_LOGO_MAX_BYTES, SETUP_LOGO_SIDE } from "../platform/model";

/**
 * PNG, JPEG and WebP. Not SVG, which can carry scripts and would need
 * drawing anyway, nor GIF or HEIC, which not every browser can draw.
 */
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
/** The file as chosen: a phone photo of a printed logo fits easily. */
export const LOGO_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
/** The longer side below which a logo looks blurred on a home screen. */
export const LOGO_MIN_SIDE = 192;
/** At or above this the largest icon is drawn from real pixels. */
export const LOGO_GOOD_SIDE = SETUP_LOGO_SIDE;
/** Sizes to try, largest first, until the PNG fits SETUP_LOGO_MAX_BYTES. */
export const LOGO_STEPS = [SETUP_LOGO_SIDE, 384, 256] as const;

export type LogoProblem =
  "type" | "file-size" | "unreadable" | "too-small" | "too-detailed";

/** What can be said from the file alone, before reading it. */
export function logoFileProblem(file: {
  type: string;
  size: number;
}): LogoProblem | null {
  if (!(LOGO_TYPES as readonly string[]).includes(file.type)) return "type";
  if (file.size > LOGO_MAX_UPLOAD_BYTES) return "file-size";
  return null;
}

export function logoSizeProblem(size: {
  width: number;
  height: number;
}): LogoProblem | null {
  return Math.max(size.width, size.height) < LOGO_MIN_SIDE ? "too-small" : null;
}

/**
 * Advice that does not stop the upload: smaller than the largest icon, or
 * too wide or tall to read well in a square one.
 */
export function logoHints(size: {
  width: number;
  height: number;
}): ("small" | "not-square")[] {
  const long = Math.max(size.width, size.height);
  const short = Math.min(size.width, size.height);
  const hints: ("small" | "not-square")[] = [];
  if (long < LOGO_GOOD_SIDE) hints.push("small");
  if (short > 0 && long / short > 3) hints.push("not-square");
  return hints;
}

/** `width` × `height` scaled down to fit `max` a side, never up. */
export function fitInside(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export const fitsStored = (bytes: number) => bytes <= SETUP_LOGO_MAX_BYTES;
