import * as zlib from "node:zlib";
import { describe, expect, it } from "vitest";

import { contrastRatio } from "../colour.ts";
import { ICON_PATHS } from "../manifest.ts";
import { DEFAULT_SETTINGS } from "../settings.ts";
import { accentColours, THEME_PRESETS } from "../themes.ts";
import {
  appIcons,
  decodePng,
  encodePng,
  PngError,
  siteLogo,
  type RgbaImage,
} from "../icons/index.ts";

const bytes = (b64: string) =>
  Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));

/**
 * 5 × 5 PNGs written by a separate encoder (Python's zlib, a filter type per
 * row cycling through all five), from the formulas in EXPECTED.
 */
const FIXTURES: Record<string, string> = {
  "rgba8, interlaced":
    "iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAAH6aBZzAAAAcElEQVR42mNgYGD4z3CCh6GdQWYBw/UnazbEM6SwMRxmbFgWMZuBL4DhdVGYzvprMRHFDEbMDA+ncTIsZXQIFjubwqZzhIkvQOwNX4DTGwZ2DYavltrc17P1xHbONVScfd5Ep5ZRtILhoRGz4iNkDADf4CQtgu4+pQAAAABJRU5ErkJggg==",
  "palette, 2-bit, tRNS":
    "iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFAgMAAADwAc52AAAADFBMVEX/AAAA/wAAAP8KFB4iiCkEAAAAAnRSTlMAgJsrThgAAAAXSURBVHjaY5BmYNx4nimrgXmJBkvWUwAd0wSrexT1UwAAAABJRU5ErkJggg==",
  "grey, 1-bit, interlaced":
    "iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFAQAAAAHSEyveAAAAF0lEQVR42mNggABGEHGA8QATA8MKxhUADtoC1i6+U00AAAAASUVORK5CYII=",
  "grey, 16-bit, tRNS":
    "iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFEAAAAAD4lKV6AAAAAnRSTlMnELHhbzkAAAA4SURBVHjaY2BgkI4w2xDEkZvAyL1DJkIaCGUimHh2cO/g2QEimSU+iHAId4h0iHCwAMUieARAJAB74A3PJ1dG2gAAAABJRU5ErkJggg==",
  "rgb, 16-bit":
    "iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFEAIAAABSnW3xAAAAYElEQVR42mNgAAOjEwwMwh2pExgY1AVmRDAwWM04rcDA4KfAyMCg90C4AyQt0mEMVmSMxGZiYNB/INIBIoU7MNnMDAxxDuoTJFMkPoh0SD2R+CAMJmFsFpgOkFEgEpUNAEcsJbFhYGM0AAAAAElFTkSuQmCC",
  "grey + alpha, 8-bit":
    "iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAQAAAAnZu5uAAAAKElEQVR42mNgYLBhqGDYwvCBgZHBxoYBApkYYCwbZoYKOShgAfKhAADYswZf+hSaKQAAAABJRU5ErkJggg==",
};

type Pixel = [number, number, number, number];
const EXPECTED: Record<string, (x: number, y: number) => Pixel> = {
  "rgba8, interlaced": (x, y) => [
    (x * 50 + y * 7) % 256,
    (y * 40 + x * 3) % 256,
    (x * y * 11) % 256,
    255 - x * 30 - y * 10,
  ],
  "palette, 2-bit, tRNS": (x, y) =>
    (
      [
        [255, 0, 0, 0],
        [0, 255, 0, 128],
        [0, 0, 255, 255],
        [10, 20, 30, 255],
      ] as Pixel[]
    )[(x + 2 * y) % 4]!,
  "grey, 1-bit, interlaced": (x, y) => {
    const v = (x + y) % 2 ? 255 : 0;
    return [v, v, v, 255];
  },
  "grey, 16-bit, tRNS": (x, y) => {
    const v16 = (x * 7000 + y * 3000) % 65536;
    const v = v16 >> 8;
    return [v, v, v, v16 === 10000 ? 0 : 255];
  },
  "rgb, 16-bit": (x, y) => [
    (x * 13000) >> 8,
    (y * 12000) >> 8,
    ((x + y) * 5000) >> 8,
    255,
  ],
  "grey + alpha, 8-bit": (x, y) => [x * 60, x * 60, x * 60, y * 60],
};

function pixel(image: RgbaImage, x: number, y: number): Pixel {
  const i = (y * image.width + x) * 4;
  return Array.from(image.data.subarray(i, i + 4)) as Pixel;
}

const hex = (p: Pixel) =>
  `#${p
    .slice(0, 3)
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();

describe("decodePng", () => {
  it.each(Object.keys(FIXTURES))("reads %s", (name) => {
    const image = decodePng(bytes(FIXTURES[name]!), zlib);
    expect([image.width, image.height]).toEqual([5, 5]);
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        expect(pixel(image, x, y)).toEqual(EXPECTED[name]!(x, y));
      }
    }
  });

  it("refuses what is not a PNG, or is damaged", () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3]), zlib)).toThrow(PngError);
    const damaged = bytes(FIXTURES["rgb, 16-bit"]!);
    damaged[40] ^= 0xff;
    expect(() => decodePng(damaged, zlib)).toThrow(PngError);
  });

  it("refuses an image too large to decode safely", () => {
    const huge = encodePng(
      { width: 1, height: 1, data: new Uint8Array(4) },
      zlib,
    );
    new DataView(huge.buffer).setUint32(16, 100_000); // IHDR width
    expect(() => decodePng(huge, zlib)).toThrow(PngError);
  });
});

describe("encodePng", () => {
  it("round-trips, as RGB when opaque and RGBA when not", () => {
    const data = new Uint8Array(7 * 3 * 4).map((_, i) => (i * 37) % 256);
    const translucent = { width: 7, height: 3, data };
    const opaque = {
      width: 7,
      height: 3,
      data: data.map((v, i) => (i % 4 === 3 ? 255 : v)),
    };
    for (const image of [translucent, opaque]) {
      const png = encodePng(image, zlib);
      expect(decodePng(png, zlib)).toEqual(image);
      expect(png[25]).toBe(image === opaque ? 2 : 6); // IHDR colour type
    }
  });
});

type Cafe = Parameters<typeof appIcons>[0];
const cafe: Cafe = { name: "Mochi & Beans", theme: "cozy", accent: null };

function icons(options: Parameters<typeof appIcons>[1], settings = cafe) {
  return Object.fromEntries(
    appIcons(settings, options).map((f) => [f.path, f]),
  );
}

describe("appIcons, from the monogram", () => {
  const files = icons({ zlib });
  const png = (path: string) => decodePng(files[path]!.bytes, zlib);
  const accent = THEME_PRESETS.cozy.colours.primary;
  const ink = THEME_PRESETS.cozy.colours["on-dark"];

  it("writes every icon path the build ships, at its size", () => {
    expect(Object.keys(files).sort()).toEqual(Object.values(ICON_PATHS).sort());
    expect(png(ICON_PATHS.any192).width).toBe(192);
    expect(png(ICON_PATHS.any512).width).toBe(512);
    expect(png(ICON_PATHS.maskable).width).toBe(512);
    expect(png(ICON_PATHS.apple).width).toBe(180);
  });

  it("draws the letters in the accent's text colour on the accent", () => {
    const icon = png(ICON_PATHS.any512);
    expect(hex(pixel(icon, 256, 40))).toBe(accent);
    const colours = new Set<string>();
    for (let x = 0; x < 512; x += 1) colours.add(hex(pixel(icon, x, 256)));
    expect(colours).toContain(ink);
  });

  it("rounds the corners of the 'any' icons and squares the others", () => {
    expect(pixel(png(ICON_PATHS.any192), 0, 0)[3]).toBe(0);
    expect(pixel(png(ICON_PATHS.any512), 511, 511)[3]).toBe(0);
    for (const path of [ICON_PATHS.maskable, ICON_PATHS.apple]) {
      const icon = png(path);
      for (let i = 3; i < icon.data.length; i += 4) {
        expect(icon.data[i]).toBe(255);
      }
    }
  });

  it("keeps the maskable icon's letters inside Android's safe circle", () => {
    const icon = png(ICON_PATHS.maskable);
    for (let y = 0; y < 512; y += 2) {
      for (let x = 0; x < 512; x += 2) {
        if (Math.hypot(x + 0.5 - 256, y + 0.5 - 256) > 0.4 * 512) {
          expect(hex(pixel(icon, x, y))).toBe(accent);
        }
      }
    }
  });

  it("packs 16, 32 and 48 pixel PNGs into the favicon", () => {
    const ico = files[ICON_PATHS.favicon]!.bytes;
    const view = new DataView(ico.buffer, ico.byteOffset);
    expect(view.getUint16(2, true)).toBe(1);
    expect(view.getUint16(4, true)).toBe(3);
    const sizes = [0, 1, 2].map((i) => {
      const at = view.getUint32(6 + 16 * i + 12, true);
      const length = view.getUint32(6 + 16 * i + 8, true);
      return decodePng(ico.subarray(at, at + length), zlib).width;
    });
    expect(sizes).toEqual([16, 32, 48]);
  });

  it("writes the SVG icon as vectors", () => {
    const svg = new TextDecoder().decode(files[ICON_PATHS.svg]!.bytes);
    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 512 512"/);
    expect(svg).toContain(`fill="${accent}"`);
    expect(svg).toContain(`stroke="${ink}"`);
    expect(svg).not.toContain("<image");
  });

  it("follows the theme and a cafe's own accent", () => {
    const dark = icons({ zlib }, { ...cafe, theme: "dark", accent: "#1D4E7A" });
    const tile = pixel(decodePng(dark[ICON_PATHS.apple]!.bytes, zlib), 4, 4);
    expect(hex(tile)).toBe(accentColours("dark", "#1D4E7A").primary);
  });

  it("draws a cup for a name with no letter it has", () => {
    const cup = icons({ zlib }, { ...cafe, name: "喫茶店" });
    expect(cup[ICON_PATHS.any512]!.bytes).not.toEqual(
      files[ICON_PATHS.any512]!.bytes,
    );
  });
});

describe("appIcons, from a logo", () => {
  // A red disc on a transparent square, and the same on opaque white.
  function disc(background: Pixel | null): Uint8Array {
    const size = 300;
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const inside = Math.hypot(x - 150, y - 150) < 120;
        const p: Pixel = inside
          ? [200, 30, 40, 255]
          : (background ?? [0, 0, 0, 0]);
        data.set(p, (y * size + x) * 4);
      }
    }
    return encodePng({ width: size, height: size, data }, zlib);
  }

  it("puts a transparent logo on the theme's paper", () => {
    const files = icons({ zlib, logo: disc(null) });
    const apple = decodePng(files[ICON_PATHS.apple]!.bytes, zlib);
    expect(hex(pixel(apple, 2, 2))).toBe(THEME_PRESETS.cozy.colours.paper);
    expect(hex(pixel(apple, 90, 90))).toBe("#C81E28");
    expect(new TextDecoder().decode(files[ICON_PATHS.svg]!.bytes)).toContain(
      "data:image/png;base64,",
    );
  });

  it("puts an opaque logo on its own edge colour", () => {
    const apple = decodePng(
      icons({ zlib, logo: disc([255, 255, 255, 255]) })[ICON_PATHS.apple]!
        .bytes,
      zlib,
    );
    expect(hex(pixel(apple, 2, 2))).toBe("#FFFFFF");
  });

  it("picks a tile the logo shows up on", () => {
    // A white logo would vanish on Minimal's white paper.
    const size = 40;
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i += 1) {
      const x = i % size;
      data.set(x > 8 && x < 32 ? [255, 255, 255, 255] : [0, 0, 0, 0], i * 4);
    }
    const logo = encodePng({ width: size, height: size, data }, zlib);
    const apple = decodePng(
      icons({ zlib, logo }, { ...cafe, theme: "minimal" })[ICON_PATHS.apple]!
        .bytes,
      zlib,
    );
    const tile = hex(pixel(apple, 2, 2));
    expect(contrastRatio(tile, "#FFFFFF")).toBeGreaterThan(2.2);
  });

  it("refuses a logo it cannot read rather than shipping the monogram", () => {
    expect(() =>
      appIcons(DEFAULT_SETTINGS, { zlib, logo: new Uint8Array([1, 2, 3]) }),
    ).toThrow(PngError);
  });
});

describe("siteLogo", () => {
  it("shrinks a large logo and leaves a small one alone", () => {
    const big = encodePng(
      {
        width: 1200,
        height: 600,
        data: new Uint8Array(1200 * 600 * 4).fill(200),
      },
      zlib,
    );
    const shrunk = decodePng(siteLogo(big, zlib).bytes, zlib);
    expect([shrunk.width, shrunk.height]).toEqual([512, 256]);
    const small = encodePng(
      { width: 64, height: 64, data: new Uint8Array(64 * 64 * 4).fill(9) },
      zlib,
    );
    expect(siteLogo(small, zlib)).toEqual({
      path: "/logo.png",
      type: "image/png",
      bytes: small,
    });
  });
});
