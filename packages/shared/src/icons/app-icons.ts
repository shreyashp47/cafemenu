/**
 * A cafe's app icons, made at deploy time from its logo, or from its
 * monogram when it has none (PLAN.md, Phase 2: the deployer adds "that cafe's
 * site.json, manifest, logo and icons" to the shared bundle).
 *
 *   import zlib from "node:zlib";
 *   import { appIcons } from "@cafemenu/shared/icons";
 *   for (const file of appIcons(settings, { logo: pngBytes, zlib })) {
 *     await writeFile(join(site, file.path), file.bytes);
 *   }
 *
 * One file for every icon path the build ships (ICON_PATHS), so a deploy
 * replaces all of the demo cafe's and none is left behind:
 *
 *   /icon-192.png, /icon-512.png   "any": a rounded tile, transparent corners
 *   /icon-maskable-512.png         full bleed, the mark inside Android's
 *                                  safe circle (the middle 80%)
 *   /apple-touch-icon.png          180 × 180, full bleed and opaque: iOS
 *                                  rounds the corners itself and turns
 *                                  transparency black
 *   /favicon.ico                   16, 32 and 48, as PNGs inside an ICO
 *   /icon.svg                      the monogram as vectors, or the logo tile
 *
 * The logo must be a PNG (the console turns whatever the owner uploads into
 * one before storing it). It is fitted, never cropped: an opaque logo sits on
 * its own edge colour, so a square logo on white fills the icon; a logo with
 * a transparent background sits on the theme's paper colour, or on its accent
 * if the logo would vanish against the paper.
 */

import { contrastRatio, toHex } from "../colour.ts";
import { ICON_PATHS } from "../manifest.ts";
import { monogramOf } from "../monogram.ts";
import type { CafeSettings } from "../settings.ts";
import { accentColours, themePreset } from "../themes.ts";
import { layoutMonogram, STROKE } from "./glyphs.ts";
import { decodePng, encodePng, type RgbaImage, type Zlib } from "./png.ts";
import {
  createImage,
  drawImage,
  resize,
  roundedRect,
  fillStrokes,
  clipTo,
  type Polyline,
} from "./raster.ts";

export interface IconFile {
  /** Where it goes in the site: "/icon-192.png". */
  path: string;
  /** Its Content-Type. */
  type: string;
  bytes: Uint8Array;
}

export interface IconOptions {
  /** The cafe's logo as a PNG file; null or absent for the monogram. */
  logo?: Uint8Array | null;
  zlib: Zlib;
}

type Settings = Pick<CafeSettings, "name" | "theme" | "accent">;

/** How the mark is placed on one kind of icon. */
interface Layout {
  /** Rounded tile with transparent corners, or a full square. */
  corners: "round" | "square";
  /** The box the mark fits inside, as a fraction of the icon's side. */
  box: number;
  /** For a mask: the mark's diagonal stays inside this fraction too. */
  circle?: number;
}

const LAYOUTS = {
  any: { corners: "round", box: 0.78 },
  maskable: { corners: "square", box: 0.7, circle: 0.72 },
  apple: { corners: "square", box: 0.74 },
  favicon: { corners: "round", box: 0.86 },
} satisfies Record<string, Layout>;

/** How much of the box a monogram's letters may fill (they need air). */
const MONOGRAM_BOX = { width: 0.82, height: 0.62 };

interface Mark {
  background: string;
  /** Draws the mark centred on (cx, cy), at most w × h (and `diagonal`). */
  draw(
    image: RgbaImage,
    cx: number,
    cy: number,
    w: number,
    h: number,
    diagonal: number,
  ): void;
  /** The mark as SVG elements over a 512 tile, when it has a vector form. */
  svg?(size: number, layout: Layout): string;
}

// --- the two kinds of mark ----------------------------------------------------

function fitScale(
  w: number,
  h: number,
  maxW: number,
  maxH: number,
  diagonal: number,
) {
  return Math.min(maxW / w, maxH / h, diagonal / Math.hypot(w, h));
}

function monogramMark(settings: Settings): Mark {
  const preset = themePreset(settings.theme);
  const background = accentColours(preset.id, settings.accent).primary;
  const ink = preset.colours["on-dark"];
  const layout = layoutMonogram(monogramOf(settings.name));

  const place = (
    cx: number,
    cy: number,
    w: number,
    h: number,
    diagonal: number,
  ) => {
    const scale = fitScale(
      layout.width,
      layout.height,
      w * MONOGRAM_BOX.width,
      h * MONOGRAM_BOX.height,
      diagonal,
    );
    const ox = cx - (layout.width * scale) / 2;
    const oy = cy - (layout.height * scale) / 2;
    const lines: Polyline[] = layout.lines.map((line) =>
      line.map((v, i) => (i % 2 === 0 ? ox + v * scale : oy + v * scale)),
    );
    return { lines, width: STROKE * scale };
  };

  return {
    background,
    draw(image, cx, cy, w, h, diagonal) {
      const { lines, width } = place(cx, cy, w, h, diagonal);
      fillStrokes(image, lines, width, ink);
    },
    svg(size, l) {
      const { lines, width } = place(
        size / 2,
        size / 2,
        size * l.box,
        size * l.box,
        size * (l.circle ?? 2),
      );
      const d = lines
        .map((line) => {
          const pts: string[] = [];
          for (let i = 0; i < line.length; i += 2) {
            pts.push(
              `${i === 0 ? "M" : "L"}${round(line[i]!)} ${round(line[i + 1]!)}`,
            );
          }
          return line.length === 2 ? `${pts[0]}z` : pts.join("");
        })
        .join("");
      return `<path d="${d}" fill="none" stroke="${ink}" stroke-width="${round(width)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    },
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/** The average colour of the logo's border, when the border is opaque. */
function opaqueEdge(logo: RgbaImage): string | null {
  const { width, height, data } = logo;
  let count = 0;
  let solid = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  const visit = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    count += 1;
    if (data[i + 3]! >= 250) {
      solid += 1;
      r += data[i]!;
      g += data[i + 1]!;
      b += data[i + 2]!;
    }
  };
  for (let x = 0; x < width; x += 1) {
    visit(x, 0);
    if (height > 1) visit(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    visit(0, y);
    if (width > 1) visit(width - 1, y);
  }
  if (solid < count * 0.95) return null;
  return toHex({ r: r / solid, g: g / solid, b: b / solid });
}

/** The logo's average colour, weighted by how opaque each pixel is. */
function averageInk(logo: RgbaImage): string | null {
  let weight = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < logo.data.length; i += 4) {
    const a = logo.data[i + 3]! / 255;
    weight += a;
    r += logo.data[i]! * a;
    g += logo.data[i + 1]! * a;
    b += logo.data[i + 2]! * a;
  }
  return weight < 1
    ? null
    : toHex({ r: r / weight, g: g / weight, b: b / weight });
}

/** A tile colour the logo stands out on. */
function tileFor(logo: RgbaImage, settings: Settings): string {
  const edge = opaqueEdge(logo);
  if (edge) return edge;
  const preset = themePreset(settings.theme);
  const candidates = [
    preset.colours.paper,
    accentColours(preset.id, settings.accent).primary,
    "#FFFFFF",
    "#141414",
  ];
  const ink = averageInk(logo);
  if (!ink) return candidates[0]!;
  return (
    candidates.find((c) => contrastRatio(c, ink) >= 2.2) ??
    candidates.reduce((a, b) =>
      contrastRatio(a, ink) >= contrastRatio(b, ink) ? a : b,
    )
  );
}

function logoMark(logo: RgbaImage, settings: Settings): Mark {
  return {
    background: tileFor(logo, settings),
    draw(image, cx, cy, w, h, diagonal) {
      const scale = fitScale(logo.width, logo.height, w, h, diagonal);
      const fitted = resize(logo, logo.width * scale, logo.height * scale);
      drawImage(image, fitted, cx - fitted.width / 2, cy - fitted.height / 2);
    },
  };
}

// --- one icon ----------------------------------------------------------------

function render(mark: Mark, size: number, layout: Layout): RgbaImage {
  const image = createImage(size, size, mark.background);
  const box = size * layout.box;
  mark.draw(
    image,
    size / 2,
    size / 2,
    box,
    box,
    layout.circle ? size * layout.circle : Infinity,
  );
  if (layout.corners === "round") {
    clipTo(image, roundedRect(0, 0, size, size, size * 0.22));
  }
  return image;
}

/** An ICO file holding each image as a PNG (Windows Vista onwards, every browser). */
export function encodeIco(images: RgbaImage[], zlib: Zlib): Uint8Array {
  const pngs = images.map((image) => encodePng(image, zlib));
  const headerSize = 6 + 16 * images.length;
  const total = headerSize + pngs.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(2, 1, true); // type: icon
  view.setUint16(4, images.length, true);
  let offset = headerSize;
  images.forEach((image, i) => {
    const entry = 6 + 16 * i;
    out[entry] = image.width >= 256 ? 0 : image.width;
    out[entry + 1] = image.height >= 256 ? 0 : image.height;
    view.setUint16(entry + 4, 1, true); // colour planes
    view.setUint16(entry + 6, 32, true); // bits per pixel
    view.setUint32(entry + 8, pngs[i]!.length, true);
    view.setUint32(entry + 12, offset, true);
    out.set(pngs[i]!, offset);
    offset += pngs[i]!.length;
  });
  return out;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function svgIcon(mark: Mark, png192: Uint8Array): string {
  const size = 512;
  const tile = `<rect width="${size}" height="${size}" rx="${round(size * 0.22)}" fill="${mark.background}"/>`;
  const body = mark.svg
    ? `${tile}${mark.svg(size, LAYOUTS.any)}`
    : `<image width="${size}" height="${size}" href="data:image/png;base64,${base64(png192)}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${body}</svg>\n`;
}

/**
 * Every app icon for a cafe, from its logo (PNG bytes) or, without one, its
 * monogram in its theme's accent. Throws a PngError when the logo cannot be
 * read, rather than quietly shipping the monogram.
 */
export function appIcons(settings: Settings, options: IconOptions): IconFile[] {
  const { zlib } = options;
  const mark = options.logo
    ? logoMark(decodePng(options.logo, zlib), settings)
    : monogramMark(settings);
  const png = (size: number, layout: Layout) =>
    encodePng(render(mark, size, layout), zlib);

  const any192 = png(192, LAYOUTS.any);
  return [
    { path: ICON_PATHS.any192, type: "image/png", bytes: any192 },
    {
      path: ICON_PATHS.any512,
      type: "image/png",
      bytes: png(512, LAYOUTS.any),
    },
    {
      path: ICON_PATHS.maskable,
      type: "image/png",
      bytes: png(512, LAYOUTS.maskable),
    },
    {
      path: ICON_PATHS.apple,
      type: "image/png",
      bytes: png(180, LAYOUTS.apple),
    },
    {
      path: ICON_PATHS.favicon,
      type: "image/x-icon",
      bytes: encodeIco(
        [16, 32, 48].map((size) => render(mark, size, LAYOUTS.favicon)),
        zlib,
      ),
    },
    {
      path: ICON_PATHS.svg,
      type: "image/svg+xml",
      bytes: new TextEncoder().encode(svgIcon(mark, any192)),
    },
  ];
}

/**
 * The logo as the site serves it (`settings.logo = "/logo.png"`): the same
 * PNG, shrunk to at most `maxSide` pixels, so the header and the QR cards do
 * not download a print-sized original.
 */
export function siteLogo(
  logo: Uint8Array,
  zlib: Zlib,
  maxSide = 512,
): IconFile {
  const image = decodePng(logo, zlib);
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const bytes =
    scale < 1
      ? encodePng(
          resize(image, image.width * scale, image.height * scale),
          zlib,
        )
      : logo;
  return { path: "/logo.png", type: "image/png", bytes };
}
