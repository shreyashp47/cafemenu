import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  LEGACY_MONEY,
  SETTINGS_KEYS,
  SETTINGS_SCHEMA_VERSION,
  mergeCafeSettings,
  newCafeSettings,
  parseCafeSettings,
  validateCafeSettings,
  type CafeSettings,
} from "../settings.ts";

const berlin: CafeSettings = {
  schemaVersion: 2,
  name: "Kaffeehaus Mitte",
  tagline: "",
  theme: "cozy",
  accent: "#1D4E7A",
  logo: "/logo.png",
  currency: "EUR",
  locale: "de-DE",
  moneyUnit: "minor",
  maxOrderTotal: 15_000,
  timeZone: "Europe/Berlin",
  utcOffsets: { standard: 60, daylight: 120 },
  tables: [1, 2, 3, 10],
  baseUrl: "https://kaffeehaus-mitte.web.app",
  plan: "free",
};

describe("DEFAULT_SETTINGS", () => {
  it("is the demo cafe TOE shipped with", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      name: "Mochi & Beans",
      tagline: "Good Coffee, Better Days",
      theme: "cozy",
      accent: null,
      logo: null,
      currency: "INR",
      locale: "en-IN",
      moneyUnit: "minor",
      maxOrderTotal: 1_000_000,
      timeZone: "Asia/Kolkata",
      utcOffsets: { standard: 330, daylight: 330 },
      tables: [1, 2, 3, 4, 5, 6],
      baseUrl: null,
      plan: "free",
    });
  });

  it("passes its own strict check", () => {
    expect(validateCafeSettings(DEFAULT_SETTINGS)).toEqual({
      ok: true,
      settings: DEFAULT_SETTINGS,
    });
  });

  it("cannot be changed by accident", () => {
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SETTINGS.tables)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SETTINGS.utcOffsets)).toBe(true);
  });

  it("lists every key in SETTINGS_KEYS", () => {
    expect([...SETTINGS_KEYS].sort()).toEqual(
      Object.keys(DEFAULT_SETTINGS).sort(),
    );
  });
});

describe("parseCafeSettings (the lenient read)", () => {
  it("reads a complete, valid document as it is", () => {
    expect(parseCafeSettings(berlin)).toEqual(berlin);
  });

  it("falls back to the defaults for anything that is not an object", () => {
    for (const raw of [undefined, null, "Mochi", 42, [], true]) {
      expect(parseCafeSettings(raw)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it("hands back a copy, never the defaults themselves", () => {
    const parsed = parseCafeSettings({});
    parsed.tables.push(7);
    parsed.utcOffsets.standard = 0;
    expect(DEFAULT_SETTINGS.tables).toEqual([1, 2, 3, 4, 5, 6]);
    expect(DEFAULT_SETTINGS.utcOffsets.standard).toBe(330);
  });

  it("keeps the base's value for each missing field", () => {
    expect(parseCafeSettings({ name: "TOE Cafe" })).toEqual({
      ...DEFAULT_SETTINGS,
      name: "TOE Cafe",
    });
  });

  it("keeps the base's value for each invalid field and takes the rest", () => {
    const parsed = parseCafeSettings({
      name: "",
      tagline: 7,
      theme: "neon",
      accent: "red",
      logo: "javascript:alert(1)",
      currency: "rupees",
      locale: "not a locale",
      moneyUnit: "paise",
      maxOrderTotal: 12.5,
      timeZone: "Mars/Olympus_Mons",
      utcOffsets: { standard: 330 },
      tables: [0, 1],
      baseUrl: "https://cafe.example/menu",
      plan: "gold",
      schemaVersion: 0,
      // and one good field, to show the rest still apply
      currency_: "ignored",
    });
    expect(parsed).toEqual(DEFAULT_SETTINGS);
    expect(parseCafeSettings({ name: "", tagline: "Hi" }).tagline).toBe("Hi");
  });

  it("ignores fields it does not know, such as site.json's demo flag", () => {
    expect(parseCafeSettings({ demo: true, colour: "blue" })).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it("tidies text: trims, folds whitespace, refuses control characters", () => {
    expect(parseCafeSettings({ name: "  TOE \n  Cafe " }).name).toBe(
      "TOE Cafe",
    );
    expect(parseCafeSettings({ name: "TOE\u0000Cafe" }).name).toBe(
      DEFAULT_SETTINGS.name,
    );
    expect(parseCafeSettings({ name: "x".repeat(61) }).name).toBe(
      DEFAULT_SETTINGS.name,
    );
    expect(parseCafeSettings({ name: "x".repeat(60) }).name).toHaveLength(60);
  });

  it("allows an empty tagline, for a cafe that has none", () => {
    expect(parseCafeSettings({ tagline: "" }).tagline).toBe("");
    expect(parseCafeSettings({ tagline: "x".repeat(81) }).tagline).toBe(
      DEFAULT_SETTINGS.tagline,
    );
  });

  it("normalises codes: currency and accent upper case, locale canonical", () => {
    const parsed = parseCafeSettings({
      currency: "eur",
      accent: "#1d4e7a",
      locale: "en-in",
    });
    expect(parsed.currency).toBe("EUR");
    expect(parsed.accent).toBe("#1D4E7A");
    expect(parsed.locale).toBe("en-IN");
  });

  it("takes null for the optional accent, logo and base URL", () => {
    const over = parseCafeSettings(
      { accent: null, logo: null, baseUrl: null },
      berlin,
    );
    expect(over.accent).toBeNull();
    expect(over.logo).toBeNull();
    expect(over.baseUrl).toBeNull();
  });

  it("only takes a logo on the cafe's own site or over https", () => {
    const logo = (value: unknown) => parseCafeSettings({ logo: value }).logo;
    expect(logo("/logo.png")).toBe("/logo.png");
    expect(logo("/brand/logo-2x.webp")).toBe("/brand/logo-2x.webp");
    expect(logo("https://cdn.example/logo.png")).toBe(
      "https://cdn.example/logo.png",
    );
    for (const bad of [
      "logo.png",
      "//evil.example/logo.png",
      "/../secret",
      "/logo.png?x=1",
      "http://cdn.example/logo.png",
      "data:image/png;base64,AAAA",
      "javascript:alert(1)",
      "https://user:pw@cdn.example/logo.png",
    ]) {
      expect(logo(bad)).toBeNull();
    }
  });

  it("reads the base URL as a bare origin", () => {
    const base = (value: unknown) =>
      parseCafeSettings({ baseUrl: value }).baseUrl;
    expect(base("https://toe-cafe.web.app")).toBe("https://toe-cafe.web.app");
    expect(base("https://toe-cafe.web.app/")).toBe("https://toe-cafe.web.app");
    expect(base("http://localhost:4320")).toBe("http://localhost:4320");
    for (const bad of [
      "toe-cafe.web.app",
      "https://toe-cafe.web.app/order",
      "https://toe-cafe.web.app/?table=1",
      "ftp://toe-cafe.web.app",
      "",
    ]) {
      expect(base(bad)).toBeNull();
    }
  });

  it("sorts and de-duplicates tables, and refuses any the rules would", () => {
    expect(parseCafeSettings({ tables: [3, 1, 3, 50] }).tables).toEqual([
      1, 3, 50,
    ]);
    for (const bad of [[], [51], [0], [1.5], ["1"], "1,2", null]) {
      expect(parseCafeSettings({ tables: bad }).tables).toEqual([
        1, 2, 3, 4, 5, 6,
      ]);
    }
  });

  it("works out the offsets of a new time zone that came without them", () => {
    const parsed = parseCafeSettings({ timeZone: "America/New_York" });
    expect(parsed.utcOffsets).toEqual({ standard: -300, daylight: -240 });
  });

  it("keeps the offsets a document gives, even for a new zone", () => {
    const parsed = parseCafeSettings({
      timeZone: "Asia/Kathmandu",
      utcOffsets: { standard: 345, daylight: 345 },
    });
    expect(parsed.utcOffsets).toEqual({ standard: 345, daylight: 345 });
  });

  it("reads a document from before #12 (schemaVersion 1) as whole units", () => {
    // TOE's settings: no unit, no cap. Its menu is in whole rupees, and the
    // rules cap its orders at 10,000 of them.
    const { moneyUnit, maxOrderTotal, ...toe } = berlin;
    expect({ moneyUnit, maxOrderTotal }).not.toEqual(LEGACY_MONEY);
    const parsed = parseCafeSettings({ ...toe, schemaVersion: 1 });
    expect(parsed).toEqual({ ...berlin, schemaVersion: 1, ...LEGACY_MONEY });
    expect(LEGACY_MONEY).toEqual({ moneyUnit: "major", maxOrderTotal: 10_000 });
  });

  it("reads schemaVersion 1 as whole units over a base in minor units", () => {
    // site.json in minor units, config/site still from before #12: the rules
    // read config/site, so the page does too.
    const parsed = parseCafeSettings({ schemaVersion: 1 }, berlin);
    expect(parsed.moneyUnit).toBe("major");
    expect(parsed.maxOrderTotal).toBe(10_000);
  });

  it("gives a new currency its default cap, unless the layer has one", () => {
    expect(parseCafeSettings({ currency: "JPY" }).maxOrderTotal).toBe(20_000);
    expect(parseCafeSettings({ currency: "USD" }).maxOrderTotal).toBe(15_000);
    expect(
      parseCafeSettings({ currency: "USD", maxOrderTotal: 9_900 })
        .maxOrderTotal,
    ).toBe(9_900);
    expect(parseCafeSettings({ name: "Same currency" }, berlin)).toEqual({
      ...berlin,
      name: "Same currency",
    });
  });

  it("keeps the base's offsets when the zone does not change", () => {
    expect(
      parseCafeSettings({ name: "Berlin again" }, berlin).utcOffsets,
    ).toEqual({ standard: 60, daylight: 120 });
  });
});

describe("mergeCafeSettings (site.json, then config/site)", () => {
  it("is the defaults with nothing to merge", () => {
    expect(mergeCafeSettings()).toEqual(DEFAULT_SETTINGS);
    expect(mergeCafeSettings(null, undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("lets the later layer win, field by field", () => {
    const siteJson = {
      name: "TOE Cafe",
      tagline: "Old tagline",
      tables: [1, 2],
    };
    const configSite = { tagline: "New tagline" };
    expect(mergeCafeSettings(siteJson, configSite)).toEqual({
      ...DEFAULT_SETTINGS,
      name: "TOE Cafe",
      tagline: "New tagline",
      tables: [1, 2],
    });
  });

  it("keeps a lower layer's value when the upper one is invalid", () => {
    expect(
      mergeCafeSettings({ currency: "EUR" }, { currency: "euros" }).currency,
    ).toBe("EUR");
  });
});

describe("validateCafeSettings (the strict check for writers)", () => {
  it("passes a complete, valid document and hands it back cleaned", () => {
    const check = validateCafeSettings({
      ...berlin,
      name: "  Kaffeehaus  Mitte ",
      currency: "eur",
      tables: [10, 3, 2, 1],
    });
    expect(check).toEqual({ ok: true, settings: berlin });
  });

  it("names every missing field", () => {
    const check = validateCafeSettings({});
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.problems).toEqual(SETTINGS_KEYS.map((k) => `${k}: missing`));
  });

  it("says what each invalid field should be", () => {
    const check = validateCafeSettings({
      ...berlin,
      accent: "blue",
      tables: [99],
    });
    expect(check).toEqual({
      ok: false,
      problems: [
        'accent: must be a colour like "#7A3E1D", or null',
        "tables: must be a list of whole numbers 1 to 50",
      ],
    });
  });

  it("refuses fields it does not know, which are usually typos", () => {
    const check = validateCafeSettings({ ...berlin, tagLine: "Hi" });
    expect(check).toEqual({ ok: false, problems: ["tagLine: not a setting"] });
  });

  it("refuses another schema version", () => {
    const check = validateCafeSettings({ ...berlin, schemaVersion: 1 });
    expect(check).toEqual({
      ok: false,
      problems: ["schemaVersion: must be 2"],
    });
  });

  it("refuses offsets that do not belong to the time zone", () => {
    const check = validateCafeSettings({
      ...berlin,
      utcOffsets: { standard: 330, daylight: 330 },
    });
    expect(check).toEqual({
      ok: false,
      problems: ["utcOffsets: Europe/Berlin is 60 standard and 120 daylight"],
    });
  });

  it("refuses something that is not an object", () => {
    expect(validateCafeSettings(null)).toEqual({
      ok: false,
      problems: ["settings: must be an object"],
    });
  });
});

describe("newCafeSettings", () => {
  it("fills in the defaults and the zone's offsets", () => {
    const settings = newCafeSettings({
      name: "Flat White",
      currency: "AUD",
      locale: "en-AU",
      timeZone: "Australia/Sydney",
    });
    expect(settings).toEqual({
      ...DEFAULT_SETTINGS,
      name: "Flat White",
      currency: "AUD",
      locale: "en-AU",
      timeZone: "Australia/Sydney",
      utcOffsets: { standard: 600, daylight: 660 },
      maxOrderTotal: 25_000,
    });
    expect(validateCafeSettings(settings).ok).toBe(true);
  });

  it("starts every new cafe in minor units, at the current schema", () => {
    // Even when handed an old schema version: a new cafe has no whole-unit
    // data to be read the old way.
    expect(
      newCafeSettings({ currency: "JPY", schemaVersion: 1 }),
    ).toMatchObject({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      moneyUnit: "minor",
      maxOrderTotal: 20_000,
    });
  });
});
