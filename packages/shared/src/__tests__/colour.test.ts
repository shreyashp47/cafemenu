import { describe, expect, it } from "vitest";

import {
  AA_TEXT,
  contrastRatio,
  fitContrast,
  isHexColour,
  isLight,
  luminance,
  mix,
  parseHex,
  toHex,
} from "../colour.ts";

describe("hex colours", () => {
  it("reads both lengths in any case, and nothing else", () => {
    expect(parseHex("#7a3e1d")).toEqual({ r: 122, g: 62, b: 29 });
    expect(parseHex("#FFF")).toEqual({ r: 255, g: 255, b: 255 });
    for (const bad of ["7A3E1D", "#7A3E1", "#GGGGGG", "", "red"]) {
      expect(parseHex(bad)).toBeNull();
      expect(isHexColour(bad)).toBe(false);
    }
  });

  it("writes upper case, rounded and clamped", () => {
    expect(toHex({ r: 122, g: 62, b: 29 })).toBe("#7A3E1D");
    expect(toHex({ r: 300, g: -4, b: 127.6 })).toBe("#FF0080");
  });
});

describe("WCAG contrast", () => {
  it("runs from 1:1 to 21:1, either way round", () => {
    expect(luminance("#000000")).toBe(0);
    expect(luminance("#FFFFFF")).toBe(1);
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#7A3E1D", "#7A3E1D")).toBe(1);
  });

  it("agrees with the numbers TOE's palette comments quote", () => {
    // globals.css: terracotta under cream text 2.9:1, sage on light 2.99:1,
    // berry as text on paper 3.6:1 (on the cream page, as measured here).
    expect(contrastRatio("#C97B3D", "#F8EFE3")).toBeCloseTo(2.89, 2);
    expect(contrastRatio("#6B8E5A", "#F2E4D3")).toBeCloseTo(2.98, 2);
    expect(contrastRatio("#C0505B", "#F2E4D3")).toBeCloseTo(3.7, 2);
  });

  it("tells light from dark", () => {
    expect(isLight("#F2E4D3")).toBe(true);
    expect(isLight("#7A3E1D")).toBe(false);
  });
});

describe("mix", () => {
  it("walks in a straight line through sRGB", () => {
    expect(mix("#000000", "#FFFFFF", 0.5)).toBe("#808080");
    expect(mix("#7A3E1D", "#000000", 0)).toBe("#7A3E1D");
    expect(mix("#7A3E1D", "#000000", 1)).toBe("#000000");
  });
});

describe("fitContrast", () => {
  const cream = ["#F2E4D3", "#FFFCF7"];

  it("keeps a colour that already passes", () => {
    expect(fitContrast("#7A3E1D", cream)).toBe("#7A3E1D");
  });

  it("darkens a failing colour just far enough, keeping its hue", () => {
    const fitted = fitContrast("#FF8800", cream)!;
    for (const bg of cream) {
      expect(contrastRatio(fitted, bg)).toBeGreaterThanOrEqual(AA_TEXT);
    }
    // One step less dark would fail.
    const lighter = mix(fitted, "#FF8800", 0.03);
    expect(
      Math.min(...cream.map((bg) => contrastRatio(lighter, bg))),
    ).toBeLessThan(AA_TEXT);
    // Every channel scaled by the same factor: the hue is the same orange.
    const { r, g, b } = parseHex(fitted)!;
    expect(b).toBe(0);
    expect(g / r).toBeCloseTo(0x88 / 0xff, 1);
  });

  it("lightens towards white for a dark background", () => {
    const fitted = fitContrast("#1D4E7A", ["#16110E"], { toward: "#FFFFFF" })!;
    expect(contrastRatio(fitted, "#16110E")).toBeGreaterThanOrEqual(AA_TEXT);
    expect(luminance(fitted)).toBeGreaterThan(luminance("#1D4E7A"));
  });

  it("gives up when not even black would pass", () => {
    expect(fitContrast("#FF8800", ["#000000", "#FFFFFF"])).toBeNull();
    expect(fitContrast("#202020", ["#303030"])).toBeNull();
  });
});
