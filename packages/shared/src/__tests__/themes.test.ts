import { describe, expect, it } from "vitest";

import { AA_LARGE, AA_TEXT, contrastRatio, isHexColour } from "../colour.ts";
import { DEFAULT_SETTINGS, THEMES } from "../settings.ts";
import {
  COLOUR_TOKENS,
  THEME_COLOURS,
  THEME_PRESETS,
  accentColours,
  checkAccent,
  themeColours,
  themePreset,
  themeVariables,
  type ColourToken,
} from "../themes.ts";
import { webManifest } from "../manifest.ts";

const SURFACES: ColourToken[] = ["paper", "cream", "cream-soft"];

/**
 * Every pairing of text and background the cafe app uses, with the contrast
 * it needs: body text 4.5:1; icons, large text and fills 3:1.
 */
const PAIRS: [ColourToken, ColourToken, number][] = [
  ...(
    [
      "ink",
      "body",
      "muted",
      "primary",
      "primary-dark",
      "secondary-deep",
      "sage-deep",
      "berry-deep",
      "berry",
      "secondary",
    ] as const
  ).flatMap((fg) =>
    SURFACES.map((bg): [ColourToken, ColourToken, number] => [fg, bg, AA_TEXT]),
  ),
  ["primary", "highlight-soft", AA_TEXT],
  ["primary-dark", "highlight-soft", AA_TEXT],
  ["ink", "highlight-soft", AA_TEXT],
  ["ink", "highlight", AA_TEXT],
  ["ink", "tan", AA_TEXT],
  ["ink", "sage-soft", AA_TEXT],
  ["sage-deep", "sage-soft", AA_TEXT],
  ["on-dark", "primary", AA_TEXT],
  ["on-dark", "primary-dark", AA_TEXT],
  ["on-dark", "primary-soft", AA_TEXT],
  ["on-dark", "berry-deep", AA_TEXT],
  ["on-dark", "sage-deep", AA_TEXT],
  ["on-dark", "secondary-deep", AA_TEXT],
  ["primary", "highlight", AA_LARGE],
  ["muted", "tan", AA_LARGE],
  ["on-dark", "berry", AA_LARGE],
  ["on-dark", "sage", AA_LARGE],
  ["sage", "paper", AA_LARGE],
  ["ring", "paper", AA_LARGE],
];

/**
 * TOE's own palette misses a few of these. Cozy has to stay exactly TOE, so
 * they are listed rather than fixed; the new presets have none. Terracotta
 * text is a real miss (the staff board's sound hint): the audit cannot see
 * it on Cozy, whose paper wash hides the background from axe, and caught it
 * on the plain presets.
 */
const COZY_AS_TOE: string[] = [
  "muted on cream",
  "berry on cream",
  "berry on cream-soft",
  "secondary on paper",
  "secondary on cream",
  "secondary on cream-soft",
];

describe("THEME_PRESETS", () => {
  it("has one preset for every theme a cafe can pick", () => {
    expect(Object.keys(THEME_PRESETS)).toEqual([...THEMES]);
    for (const id of THEMES) expect(THEME_PRESETS[id].id).toBe(id);
  });

  it("sets every colour token, as a colour", () => {
    for (const preset of Object.values(THEME_PRESETS)) {
      expect(Object.keys(preset.colours).sort()).toEqual(
        [...COLOUR_TOKENS].sort(),
      );
      for (const value of Object.values(preset.colours)) {
        expect(isHexColour(value)).toBe(true);
      }
    }
  });

  it("keeps Mochi and the doodles to Cozy", () => {
    expect(THEMES.filter((id) => THEME_PRESETS[id].decorated)).toEqual([
      "cozy",
    ]);
  });

  it.each(THEMES)(
    "%s passes WCAG AA wherever the app pairs its colours",
    (id) => {
      const c = THEME_PRESETS[id].colours;
      const failing = PAIRS.filter(
        ([fg, bg, min]) => contrastRatio(c[fg], c[bg]) < min,
      ).map(([fg, bg]) => `${fg} on ${bg}`);
      expect(failing).toEqual(id === "cozy" ? COZY_AS_TOE : []);
    },
  );

  it("falls back to Cozy for a theme this release does not know", () => {
    expect(themePreset("neon").id).toBe("cozy");
    expect(themePreset(null).id).toBe("cozy");
    expect(themePreset("dark").id).toBe("dark");
  });
});

describe("accentColours", () => {
  it("is the preset's own tokens without an accent", () => {
    for (const id of THEMES) {
      const own = THEME_PRESETS[id].colours;
      expect(accentColours(id, null)).toEqual({
        primary: own.primary,
        "primary-soft": own["primary-soft"],
        "primary-dark": own["primary-dark"],
        adjusted: false,
      });
    }
  });

  it("keeps an accent that already passes", () => {
    const colours = accentColours("cozy", "#1d4e7a");
    expect(colours.primary).toBe("#1D4E7A");
    expect(colours.adjusted).toBe(false);
  });

  it.each([
    ["cozy", "#FF8800"],
    ["minimal", "#3A86FF"],
    ["bistro", "#F5D08A"],
    ["dark", "#1D4E7A"],
    ["dark", "#000000"],
    ["minimal", "#FFFFFF"],
  ] as const)("moves %s's %s until every use of it passes", (id, accent) => {
    const colours = accentColours(id, accent);
    const c = { ...THEME_PRESETS[id].colours, ...colours };
    expect(colours.adjusted).toBe(true);
    for (const bg of [...SURFACES, "highlight-soft"] as const) {
      expect(contrastRatio(colours.primary, c[bg])).toBeGreaterThanOrEqual(
        AA_TEXT,
      );
      expect(
        contrastRatio(colours["primary-dark"], c[bg]),
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
    for (const fill of ["primary", "primary-soft", "primary-dark"] as const) {
      expect(contrastRatio(c["on-dark"], c[fill])).toBeGreaterThanOrEqual(
        AA_TEXT,
      );
    }
  });

  it("darkens on a light preset and lightens on the dark one", () => {
    expect(accentColours("cozy", "#FF8800").primary).toBe("#8E4B00");
    expect(accentColours("dark", "#1D4E7A").primary).toBe("#7B98B1");
  });
});

describe("checkAccent", () => {
  it("accepts a colour that passes as it is", () => {
    expect(checkAccent("cozy", "#7a3e1d")).toMatchObject({
      ok: true,
      accent: "#7A3E1D",
    });
  });

  it("refuses one that fails, and offers what the app would use", () => {
    const check = checkAccent("minimal", "#FF8800");
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.contrast).toBeLessThan(AA_TEXT);
    expect(check.suggestion).toBe(accentColours("minimal", "#FF8800").primary);
    expect(check.problem).toContain("Minimal");
    expect(check.problem).toContain(check.suggestion);
  });

  it("refuses something that is not a colour", () => {
    expect(checkAccent("cozy", "brown")).toMatchObject({ ok: false });
  });
});

describe("themeVariables and themeColours", () => {
  it("adds nothing over the stylesheet without an accent", () => {
    expect(themeVariables(DEFAULT_SETTINGS)).toEqual({});
  });

  it("sets the three accent tokens with one", () => {
    expect(themeVariables({ theme: "cozy", accent: "#1D4E7A" })).toEqual({
      "--primary": "#1D4E7A",
      "--primary-soft": accentColours("cozy", "#1D4E7A")["primary-soft"],
      "--primary-dark": accentColours("cozy", "#1D4E7A")["primary-dark"],
    });
  });

  it("keeps TOE's manifest and toolbar colours for Cozy", () => {
    expect(THEME_COLOURS.cozy).toEqual({
      background: "#F2E4D3",
      theme: "#7A3E1D",
    });
  });

  it("follows the accent, or the page, by preset", () => {
    expect(themeColours({ theme: "cozy", accent: "#1D4E7A" }).theme).toBe(
      "#1D4E7A",
    );
    expect(themeColours({ theme: "dark", accent: "#1D4E7A" })).toEqual({
      background: "#16110E",
      theme: "#16110E",
    });
    const manifest = webManifest({ ...DEFAULT_SETTINGS, theme: "minimal" });
    expect(manifest.background_color).toBe(THEME_PRESETS.minimal.colours.cream);
    expect(manifest.theme_color).toBe(THEME_PRESETS.minimal.colours.cream);
  });
});
