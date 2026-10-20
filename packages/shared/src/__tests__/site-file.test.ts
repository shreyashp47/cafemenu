import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "../settings.ts";
import { webManifest } from "../manifest.ts";
import { parseSiteFile, siteFileFor, validateSiteFile } from "../site-file.ts";

describe("parseSiteFile", () => {
  it("splits the settings from the demo flag", () => {
    expect(parseSiteFile({ name: "TOE Cafe", demo: true })).toEqual({
      settings: { name: "TOE Cafe" },
      demo: true,
    });
  });

  it("is not a demo unless the flag is exactly true", () => {
    for (const demo of [undefined, false, "true", 1]) {
      expect(parseSiteFile({ name: "TOE Cafe", demo })?.demo).toBe(false);
    }
  });

  it("refuses something that is not an object", () => {
    for (const raw of [null, "{}", [], 3]) {
      expect(parseSiteFile(raw)).toBeNull();
    }
  });
});

describe("siteFileFor / validateSiteFile", () => {
  it("round-trips a cafe's settings through JSON", () => {
    const file = JSON.parse(JSON.stringify(siteFileFor(DEFAULT_SETTINGS)));
    expect(file).toEqual(DEFAULT_SETTINGS);
    expect(validateSiteFile(file)).toEqual({
      ok: true,
      settings: DEFAULT_SETTINGS,
    });
  });

  it("adds the demo flag only when asked", () => {
    expect(siteFileFor(DEFAULT_SETTINGS, { demo: true })).toEqual({
      ...DEFAULT_SETTINGS,
      demo: true,
    });
    expect(siteFileFor(DEFAULT_SETTINGS, { demo: false })).not.toHaveProperty(
      "demo",
    );
  });

  it("allows the demo flag but checks it and the settings", () => {
    expect(validateSiteFile({ ...DEFAULT_SETTINGS, demo: true }).ok).toBe(true);
    expect(validateSiteFile({ ...DEFAULT_SETTINGS, demo: "yes" })).toEqual({
      ok: false,
      problems: ["demo: must be true, false or absent"],
    });
    expect(validateSiteFile({ demo: true }).ok).toBe(false);
    expect(validateSiteFile([])).toEqual({
      ok: false,
      problems: ["site.json: must be an object"],
    });
  });
});

describe("webManifest", () => {
  it("is TOE's manifest for the demo cafe", () => {
    const manifest = webManifest(DEFAULT_SETTINGS);
    expect(manifest.name).toBe("Mochi & Beans · Good Coffee, Better Days");
    expect(manifest.short_name).toBe("Mochi & Beans");
    expect(manifest.start_url).toBe("/staff");
    expect(manifest.background_color).toBe("#F2E4D3");
    expect(manifest.theme_color).toBe("#7A3E1D");
    expect(manifest.icons.map((i) => i.purpose)).toContain("maskable");
  });

  it("names the cafe, without a dangling separator when it has no tagline", () => {
    const manifest = webManifest({
      ...DEFAULT_SETTINGS,
      name: "TOE Cafe",
      tagline: "",
    });
    expect(manifest.name).toBe("TOE Cafe");
    expect(manifest.short_name).toBe("TOE Cafe");
  });
});
