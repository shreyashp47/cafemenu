/**
 * Money: whole numbers in the cafe's unit, shown in the cafe's currency.
 *
 * Every price and total a cafe stores is an integer, so a cart never sums to
 * 99.999999999. Which integer depends on the settings' `moneyUnit`:
 *
 *   - "minor", every cafe from #12 on: the currency's smallest unit. Paise for
 *     INR, cents for USD and EUR, yen for JPY (which has no smaller unit),
 *     fils for KWD (three digits). ₹180.50 is 18050.
 *   - "major", TOE's data until its migration (#21): whole units of the
 *     currency. ₹180 is 180, and there is no ₹180.50.
 *
 * Settings written before #12 (schemaVersion 1) read as "major"; see
 * parseCafeSettings and apps/cafe/docs/decisions.md, "Any currency".
 *
 * The digits come from `Intl` (CLDR), not a table, so any ISO 4217 code works.
 * Like the rest of this package: no dependencies, erasable syntax only.
 */

import type { CafeSettings } from "./settings.ts";

export const MONEY_UNITS = ["minor", "major"] as const;
export type MoneyUnit = (typeof MONEY_UNITS)[number];

/** What turning an integer into money needs. */
export type MoneySettings = Pick<
  CafeSettings,
  "currency" | "locale" | "moneyUnit"
>;

/**
 * The order cap every cafe had before #12, in whole units of its currency:
 * firestore.rules said `total <= 10000`. It is still what the rules use when
 * config/site does not say otherwise.
 */
export const LEGACY_MAX_ORDER_TOTAL = 10_000;

/** Ten to the twelfth: more than any cafe's cap, in any currency's unit. */
export const MAX_ORDER_TOTAL_LIMIT = 1_000_000_000_000;

/** Decimal places of the currency: 2 for INR, USD, EUR; 0 for JPY; 3 for KWD. */
export function currencyDigits(currency: string, locale = "en"): number {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits!;
  } catch {
    return 2;
  }
}

/** Decimal places in the stored integers: the currency's, or 0 for whole units. */
export function moneyDigits(settings: MoneySettings): number {
  return settings.moneyUnit === "major"
    ? 0
    : currencyDigits(settings.currency, settings.locale);
}

// One formatter per locale, currency and number of decimals: building one costs
// far more than using it, and the reports format hundreds of amounts at a time.
const formats = new Map<string, Intl.NumberFormat>();

function formatter(settings: MoneySettings, digits: number, shown: number) {
  const key = `${settings.locale}|${settings.currency}|${digits}|${shown}`;
  let format = formats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(settings.locale, {
      style: "currency",
      currency: settings.currency,
      minimumFractionDigits: shown,
      maximumFractionDigits: digits,
    });
    formats.set(key, format);
  }
  return format;
}

/**
 * "₹180", "₹180.50", "$4.50", "¥1,200", "1.234,50 €": an amount as the cafe's
 * customers read it. Decimals only when there is something after the point,
 * so a menu in whole rupees reads as it always did.
 */
export function formatMoney(amount: number, settings: MoneySettings): string {
  const digits = moneyDigits(settings);
  const whole = Number.isFinite(amount) ? Math.round(amount) : 0;
  const scale = 10 ** digits;
  const shown = whole % scale === 0 ? 0 : digits;
  return formatter(settings, digits, shown).format(whole / scale);
}

/** "₹", "$", "¥", "€": for labels like "Price (₹)". */
export function currencySymbol(settings: MoneySettings): string {
  const parts = formatter(settings, 0, 0).formatToParts(0);
  return parts.find((p) => p.type === "currency")?.value ?? settings.currency;
}

/**
 * The amount as a plain decimal, "180.50", "180", "1200": no symbol, no
 * grouping, a point for the decimal. For the CSV, and for a price field.
 * `padded` keeps every decimal place ("180.00"), as a spreadsheet column wants.
 */
export function moneyToDecimal(
  amount: number,
  settings: MoneySettings,
  { padded = false }: { padded?: boolean } = {},
): string {
  const digits = moneyDigits(settings);
  const whole = Number.isFinite(amount) ? Math.round(amount) : 0;
  const sign = whole < 0 ? "-" : "";
  const text = String(Math.abs(whole)).padStart(digits + 1, "0");
  if (digits === 0) return sign + text;
  const units = text.slice(0, -digits);
  const fraction = text.slice(-digits);
  return !padded && /^0+$/.test(fraction)
    ? sign + units
    : `${sign}${units}.${fraction}`;
}

/**
 * What an owner typed into a price field, as the stored integer: "4.5" and
 * "4,50" are 450 cents, "180" is 18000 paise, "1200" is 1200 yen. Either a
 * point or a comma marks the decimals, since cafes type both; nothing else
 * (no symbol, no grouping, no sign). Null when it is not a price in this
 * currency: more decimals than it has, or not a number at all.
 */
export function parseMoneyInput(
  text: string,
  settings: MoneySettings,
): number | null {
  const digits = moneyDigits(settings);
  const match = /^(\d*)(?:[.,](\d*))?$/.exec(text.trim());
  if (!match) return null;
  const [, units, fraction = ""] = match;
  if (units === "" && fraction === "") return null;
  if (fraction.length > digits) return null;
  const amount = Number(units + fraction.padEnd(digits, "0"));
  return Number.isSafeInteger(amount) ? amount : null;
}

// --- order caps -------------------------------------------------------------

/**
 * Default cap on one order, in whole units of the currency: about US$150 in
 * late 2026, rounded to a figure that reads well. TOE's ₹10,000 sets the
 * scale; a prank order is only worth placing if it is big, and a real table
 * rarely comes near this. The platform can store any cap per cafe
 * (`maxOrderTotal`); these are only where it starts.
 */
const ORDER_CAPS: Record<string, number> = {
  INR: 10_000,
  USD: 150,
  EUR: 150,
  GBP: 150,
  CHF: 150,
  CAD: 200,
  AUD: 250,
  NZD: 250,
  SGD: 200,
  HKD: 1_200,
  JPY: 20_000,
  CNY: 1_000,
  KRW: 200_000,
  TWD: 5_000,
  THB: 5_000,
  MYR: 700,
  IDR: 2_500_000,
  PHP: 8_000,
  VND: 4_000_000,
  KHR: 600_000,
  LAK: 3_000_000,
  MMK: 300_000,
  PKR: 40_000,
  BDT: 20_000,
  LKR: 45_000,
  NPR: 20_000,
  UZS: 2_000_000,
  AED: 550,
  SAR: 550,
  QAR: 550,
  KWD: 50,
  ILS: 550,
  EGP: 7_500,
  TRY: 5_000,
  ZAR: 2_500,
  NGN: 250_000,
  KES: 20_000,
  GHS: 2_500,
  UGX: 550_000,
  TZS: 400_000,
  BRL: 800,
  MXN: 2_500,
  ARS: 150_000,
  CLP: 150_000,
  COP: 600_000,
  PEN: 550,
  PYG: 1_000_000,
  SEK: 1_500,
  NOK: 1_500,
  DKK: 1_000,
  ISK: 20_000,
  PLN: 600,
  CZK: 3_500,
  HUF: 55_000,
  RON: 700,
  UAH: 6_000,
};

/**
 * A currency missing from the table gets a cap in whole units that only an
 * absurd order reaches in most currencies. Too generous rather than too
 * tight: a cap below a real table's bill would turn honest customers away.
 */
const UNLISTED_ORDER_CAP = 1_000_000;

/**
 * The cap a cafe starts with, in its own unit (`moneyUnit`): ₹10,000 is
 * 1,000,000 paise, or 10,000 whole rupees.
 */
export function defaultMaxOrderTotal(settings: MoneySettings): number {
  const cap = ORDER_CAPS[settings.currency] ?? UNLISTED_ORDER_CAP;
  return cap * 10 ** moneyDigits(settings);
}
