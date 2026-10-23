import { isTimeZone, utcOffsetsOf } from "@cafemenu/shared";
import { describe, expect, it } from "vitest";
import { isFirestoreLocation } from "../../platform/locations";
import {
  COUNTRIES,
  COUNTRY_CODES,
  countriesByName,
  countryDefaults,
  countryName,
  countryZones,
  guessCountry,
} from "../countries";

describe("the country list", () => {
  it("has no country twice", () => {
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
  });

  it.each(COUNTRY_CODES)("%s fills in values the settings accept", (code) => {
    const c = COUNTRIES[code];
    expect(code).toMatch(/^[A-Z]{2}$/);
    expect(Intl.supportedValuesOf("currency")).toContain(c.currency);
    for (const zone of countryZones(code)) expect(isTimeZone(zone)).toBe(true);
    // As written: the settings keep the canonical form of a locale.
    expect(Intl.getCanonicalLocales(c.locale)[0]).toBe(c.locale);
    expect(isFirestoreLocation(c.region)).toBe(true);
    expect(new Set(countryZones(code)).size).toBe(countryZones(code).length);
  });

  it("knows the countries' names", () => {
    expect(countryName("IN")).toBe("India");
    expect(countryName("GB")).toBe("United Kingdom");
    const names = countriesByName().map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("gives India its one zone, and the US its others after New York", () => {
    expect(countryDefaults("IN")).toMatchObject({
      currency: "INR",
      timeZone: "Asia/Kolkata",
      locale: "en-IN",
      region: "asia-south1",
    });
    expect(utcOffsetsOf("Asia/Kolkata")).toEqual({
      standard: 330,
      daylight: 330,
    });
    expect(countryZones("US")[0]).toBe("America/New_York");
    expect(countryZones("US")).toContain("America/Los_Angeles");
    expect(countryDefaults("XX")).toBeNull();
    expect(countryZones("XX")).toEqual([]);
  });
});

describe("guessing the visitor's country", () => {
  it("reads the region of the browser's languages, first match wins", () => {
    expect(guessCountry(["en-IN", "en"])).toBe("IN");
    expect(guessCountry(["fr", "de-AT"])).toBe("AT");
  });

  it("falls back to the time zone, and a bare language says nothing", () => {
    expect(guessCountry(["en"])).toBeNull();
    expect(guessCountry(["en"], "Asia/Kolkata")).toBe("IN");
    expect(guessCountry(["en"], "America/Chicago")).toBe("US");
    expect(guessCountry(["not a tag!"], "Mars/Olympus")).toBeNull();
  });
});
