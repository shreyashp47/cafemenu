import { describe, expect, it } from "vitest";
import {
  currencyOptions,
  formatSample,
  localeOptions,
  utcLabel,
  zoneLabel,
  zoneOffsets,
  zoneOptions,
} from "../places";

describe("time zones", () => {
  it("writes offsets as UTC±HH:MM, with a real minus sign", () => {
    expect(utcLabel(330)).toBe("UTC+05:30");
    expect(utcLabel(0)).toBe("UTC+00:00");
    expect(utcLabel(-300)).toBe("UTC−05:00");
    expect(utcLabel(345)).toBe("UTC+05:45");
  });

  it("gives one offset without daylight saving, two with it", () => {
    expect(zoneOffsets("Asia/Kolkata")).toEqual({
      standard: "UTC+05:30",
      daylight: null,
    });
    expect(zoneOffsets("Europe/London")).toEqual({
      standard: "UTC+00:00",
      daylight: "UTC+01:00",
    });
    expect(zoneOffsets("Not/A_Zone")).toBeNull();
  });

  it("lists the country's zones first, and not again under all", () => {
    const { here, all } = zoneOptions("AU", "Australia/Perth");
    expect(here[0]).toEqual({
      value: "Australia/Sydney",
      label: "Australia / Sydney",
    });
    expect(here.map((z) => z.value)).toContain("Australia/Perth");
    expect(all.map((z) => z.value)).not.toContain("Australia/Sydney");
    expect(all.map((z) => z.value)).toContain("Europe/Paris");
    // Nor under the older name some engines list it by.
    const india = zoneOptions("IN", "Asia/Kolkata").all.map((z) => z.value);
    expect(india).not.toContain("Asia/Kolkata");
    expect(india).not.toContain("Asia/Calcutta");
    expect(zoneLabel("America/Argentina/Buenos_Aires")).toBe(
      "America / Argentina / Buenos Aires",
    );
  });

  it("keeps a zone the owner picked, even one the browser lists elsewhere", () => {
    const { here, all } = zoneOptions("other", "Asia/Kolkata");
    expect(here).toEqual([]);
    expect(all.map((z) => z.value)).toContain("Asia/Kolkata");
  });
});

describe("currencies and formats", () => {
  it("names currencies, and never drops the chosen one", () => {
    const options = currencyOptions("INR");
    expect(options.find((o) => o.value === "INR")?.label).toBe(
      "INR · Indian Rupee",
    );
    expect(currencyOptions("ZZZ").map((o) => o.value)).toContain("ZZZ");
  });

  it("offers every country's format, and the chosen one", () => {
    const values = localeOptions("en-IN").map((o) => o.value);
    expect(values).toContain("en-IN");
    expect(values).toContain("fr-FR");
    expect(localeOptions("gsw-CH").map((o) => o.value)).toContain("gsw-CH");
  });

  it("shows a price and a date as the format writes them", () => {
    const india = formatSample("en-IN", "INR", "Asia/Kolkata");
    expect(india?.price).toBe("₹1,234.50");
    // "14 Mar 2026" or "14-Mar-2026", by the engine's CLDR.
    expect(india?.date).toMatch(/^14.Mar.2026$/);
    expect(formatSample("de-DE", "EUR", "Europe/Berlin")?.price).toBe(
      "1.234,50\u00a0€",
    );
    expect(formatSample("not a locale", "INR", "Asia/Kolkata")).toBeNull();
  });
});
