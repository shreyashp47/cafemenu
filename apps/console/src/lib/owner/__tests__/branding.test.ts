import { newCafeSettings, validateCafeSettings } from "@cafemenu/shared";
import { describe, expect, it } from "vitest";
import {
  brandingChange,
  brandingFormOf,
  brandingProblems,
  firstBrandingProblem,
  settingsFromBranding,
  strictProblems,
  type BrandingForm,
} from "../branding";

const base = newCafeSettings({
  name: "Lantern Café",
  tagline: "Slow coffee",
  currency: "INR",
  locale: "en-IN",
  timeZone: "Asia/Kolkata",
  tables: [1, 2, 3],
  maxOrderTotal: 777_000,
});

const form = (over: Partial<BrandingForm> = {}): BrandingForm => ({
  ...brandingFormOf(base),
  ...over,
});

const LOGO = {
  png: "AAAA",
  width: 512,
  height: 512,
  original: { width: 800, height: 800 },
};

describe("the form", () => {
  it("starts as the cafe is, and changes nothing", () => {
    expect(brandingProblems(form())).toEqual({});
    expect(settingsFromBranding(base, form())).toEqual(base);
    expect(brandingChange(base, form())).toEqual({
      changed: false,
      currencyChanged: false,
      logoChanged: false,
    });
  });

  it("names every problem at once, and the first in page order", () => {
    const problems = brandingProblems(
      form({
        name: "  ",
        tagline: "x".repeat(81),
        accent: "#12",
        currency: "XX",
        timeZone: "Mars/Base",
        locale: "en_US",
      }),
    );
    expect(problems).toEqual({
      name: "required",
      tagline: "too-long",
      accent: "invalid",
      currency: "invalid",
      timeZone: "invalid",
      locale: "invalid",
    });
    expect(firstBrandingProblem(problems)).toBe("name");
    expect(
      firstBrandingProblem({ locale: "invalid", currency: "invalid" }),
    ).toBe("currency");
    expect(firstBrandingProblem({})).toBeNull();
  });

  it("limits the name to 60 characters, spaces collapsed", () => {
    expect(brandingProblems(form({ name: "a".repeat(61) })).name).toBe(
      "too-long",
    );
    expect(brandingProblems(form({ name: `${"a ".repeat(30)}` })).name).toBe(
      undefined,
    );
  });

  it("refuses an accent that fails the contrast guard, as the sign-up does", () => {
    expect(brandingProblems(form({ accent: "#F5B041" })).accent).toBe(
      "contrast",
    );
    expect(
      brandingProblems(form({ accent: "#785620" })).accent,
    ).toBeUndefined();
    // The same colour can pass one theme and fail another.
    expect(
      brandingProblems(form({ theme: "dark", accent: "#785620" })).accent,
    ).toBe("contrast");
  });
});

describe("the settings it makes", () => {
  it("changes the fields it edits, and nothing else", () => {
    const next = settingsFromBranding(
      base,
      form({
        name: "  Lantern   House ",
        tagline: "",
        theme: "bistro",
        accent: "#785620",
        locale: "en-GB",
      }),
    );
    expect(next).toEqual({
      ...base,
      name: "Lantern House",
      tagline: "",
      theme: "bistro",
      accent: "#785620",
      locale: "en-GB",
    });
    // The owner's order cap, tables and plan are theirs and the backend's.
    expect(next.maxOrderTotal).toBe(777_000);
    expect(next.tables).toEqual([1, 2, 3]);
    expect(next.plan).toBe(base.plan);
    expect(next.moneyUnit).toBe(base.moneyUnit);
  });

  it("works the UTC offsets out again for a new time zone", () => {
    const next = settingsFromBranding(
      base,
      form({ timeZone: "America/New_York" }),
    );
    expect(next.timeZone).toBe("America/New_York");
    expect(next.utcOffsets).toEqual({ standard: -300, daylight: -240 });
    expect(validateCafeSettings(next).ok).toBe(true);
    expect(strictProblems(next)).toEqual([]);
  });

  it("upper-cases the accent, and clears it for the theme's own", () => {
    expect(settingsFromBranding(base, form({ accent: "#785620" })).accent).toBe(
      "#785620",
    );
    expect(settingsFromBranding(base, form({ accent: "#abcdef" })).accent).toBe(
      "#ABCDEF",
    );
    const own = newCafeSettings({ ...base, accent: "#785620" });
    expect(settingsFromBranding(own, form({ accent: null })).accent).toBeNull();
  });

  it("keeps, replaces or removes the logo", () => {
    const withLogo = newCafeSettings({ ...base, logo: "/logo.png" });
    expect(settingsFromBranding(withLogo, form()).logo).toBe("/logo.png");
    expect(
      settingsFromBranding(withLogo, form({ logo: { kind: "remove" } })).logo,
    ).toBeNull();
    expect(
      settingsFromBranding(
        base,
        form({ logo: { kind: "replace", logo: LOGO } }),
      ).logo,
    ).toBe("/logo.png");
    // An https logo the owner put there is kept until they change it.
    const url = newCafeSettings({ ...base, logo: "https://x.test/l.png" });
    expect(settingsFromBranding(url, form()).logo).toBe("https://x.test/l.png");
  });

  it("is a copy: editing it does not touch the cafe's own tables", () => {
    const next = settingsFromBranding(base, form());
    next.tables.push(9);
    expect(base.tables).toEqual([1, 2, 3]);
  });

  it("is valid under the strict check for any theme the form offers", () => {
    for (const theme of ["cozy", "minimal", "dark", "bistro"] as const) {
      expect(
        strictProblems(settingsFromBranding(base, form({ theme }))),
      ).toEqual([]);
    }
  });
});

describe("what changed", () => {
  it("sees a change to any edited field", () => {
    for (const over of [
      { name: "Other" },
      { tagline: "Hi" },
      { theme: "dark" as const },
      { accent: "#785620" },
      { locale: "en-GB" },
      { timeZone: "Asia/Dubai" },
    ]) {
      expect(brandingChange(base, form(over)).changed).toBe(true);
    }
  });

  it("does not see spacing around a name as a change", () => {
    expect(
      brandingChange(base, form({ name: "  Lantern  Café " })).changed,
    ).toBe(false);
  });

  it("knows when the currency or the logo changes", () => {
    expect(brandingChange(base, form({ currency: "USD" }))).toEqual({
      changed: true,
      currencyChanged: true,
      logoChanged: false,
    });
    expect(
      brandingChange(base, form({ logo: { kind: "replace", logo: LOGO } })),
    ).toEqual({ changed: true, currencyChanged: false, logoChanged: true });
    expect(
      brandingChange(base, form({ logo: { kind: "remove" } })).logoChanged,
    ).toBe(true);
  });
});
