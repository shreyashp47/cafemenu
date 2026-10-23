/**
 * The choices behind the "Where it is" fields: every currency and time zone
 * the browser knows, the number formats of the countries in ./countries.ts,
 * and a time zone's offsets in words. Names come from Intl.DisplayNames, so
 * they follow the console's language.
 */

import { formatMoney, utcOffsetsOf } from "@cafemenu/shared";
import { COUNTRIES, countryZones } from "./countries";

export interface Option {
  value: string;
  label: string;
}

const byLabel = (language: string) => (a: Option, b: Option) =>
  a.label.localeCompare(b.label, language);

function supported(kind: "currency" | "timeZone"): string[] {
  try {
    return Intl.supportedValuesOf(kind);
  } catch {
    return [];
  }
}

function displayName(
  language: string,
  type: "currency" | "language",
  code: string,
): string | null {
  try {
    const name = new Intl.DisplayNames([language], { type }).of(code);
    return name && name !== code ? name : null;
  } catch {
    return null;
  }
}

/**
 * "INR · Indian Rupee", every currency the browser knows, plus `current`
 * when it does not know that one, so a choice is never silently lost.
 */
export function currencyOptions(current: string, language = "en"): Option[] {
  const codes = new Set(supported("currency"));
  if (current) codes.add(current);
  return [...codes]
    .map((code) => {
      const name = displayName(language, "currency", code);
      return { value: code, label: name ? `${code} · ${name}` : code };
    })
    .sort((a, b) => a.value.localeCompare(b.value));
}

/** "America/Argentina/Buenos_Aires" as "America / Argentina / Buenos Aires". */
export const zoneLabel = (zone: string) =>
  zone.replace(/_/g, " ").split("/").join(" / ");

/**
 * The engine's own name for a zone. Engines disagree: some list
 * "Asia/Calcutta" where the country list says "Asia/Kolkata", and both work.
 */
function canonicalZone(zone: string): string {
  try {
    return new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions()
      .timeZone;
  } catch {
    return zone;
  }
}

/**
 * The country's own zones first, then every other zone the browser knows,
 * and `current` wherever it belongs. A zone of the country is not listed
 * again under another of its names.
 */
export function zoneOptions(
  country: string,
  current: string,
): { here: Option[]; all: Option[] } {
  const hereZones = countryZones(country);
  const allZones = new Set(supported("timeZone"));
  allZones.add(current);
  for (const zone of hereZones) {
    allZones.delete(zone);
    allZones.delete(canonicalZone(zone));
  }
  const option = (zone: string) => ({ value: zone, label: zoneLabel(zone) });
  return {
    here: hereZones.map(option),
    all: [...allZones].sort().map(option),
  };
}

/** "English (India) · en-IN": the formats of every country in the list. */
export function localeOptions(current: string, language = "en"): Option[] {
  const tags = new Set(Object.values(COUNTRIES).map((c) => c.locale));
  if (current) tags.add(current);
  return [...tags]
    .map((tag) => {
      const name = displayName(language, "language", tag);
      return { value: tag, label: name ? `${name} · ${tag}` : tag };
    })
    .sort(byLabel(language));
}

/** 330 as "UTC+05:30", -300 as "UTC−05:00" (a real minus sign). */
export function utcLabel(minutes: number): string {
  const sign = minutes < 0 ? "−" : "+";
  const whole = Math.abs(minutes);
  const hh = String(Math.floor(whole / 60)).padStart(2, "0");
  const mm = String(whole % 60).padStart(2, "0");
  return `UTC${sign}${hh}:${mm}`;
}

/** The zone's offsets this year: one when it has no daylight saving. */
export function zoneOffsets(
  zone: string,
): { standard: string; daylight: string | null } | null {
  try {
    const { standard, daylight } = utcOffsetsOf(zone);
    return {
      standard: utcLabel(standard),
      daylight: daylight === standard ? null : utcLabel(daylight),
    };
  } catch {
    return null;
  }
}

/** A fixed moment, so the sample does not change while the page is open. */
const SAMPLE_DATE = Date.UTC(2026, 2, 14, 12, 30);

/** How a price and a date look in this format: "₹1,234.50", "14 Mar 2026". */
export function formatSample(
  locale: string,
  currency: string,
  timeZone: string,
): { price: string; date: string } | null {
  try {
    return {
      price: formatMoney(123450, { currency, locale, moneyUnit: "minor" }),
      date: new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeZone,
      }).format(SAMPLE_DATE),
    };
  } catch {
    return null;
  }
}
