import { describe, expect, it } from "vitest";

import { isDrawableMonogram, monogramOf } from "../monogram.ts";

describe("monogramOf", () => {
  it.each([
    ["Mochi & Beans", "MB"],
    ["TOE Cafe", "TC"],
    ["The Daily Grind", "DG"],
    ["the brew", "B"],
    ["Brew", "B"],
    ["Café Olé", "CO"],
    ["42 Roasters", "4R"],
    ["  bean   there  done that ", "BT"],
    ["The", "T"],
    ["ちゃや", "ち"],
    ["", ""],
  ])("%s → %s", (name, letters) => {
    expect(monogramOf(name)).toBe(letters);
  });

  it("keeps a combined character whole", () => {
    expect(monogramOf("क्षितिज")).toBe("क्षि");
  });

  it("knows which ones the icon glyphs can draw", () => {
    expect(isDrawableMonogram("MB")).toBe(true);
    expect(isDrawableMonogram("4R")).toBe(true);
    expect(isDrawableMonogram("ち")).toBe(false);
    expect(isDrawableMonogram("")).toBe(false);
  });
});
