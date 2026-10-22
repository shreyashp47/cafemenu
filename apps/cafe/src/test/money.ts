/**
 * Cafes in the currencies the money tests cover (issue #12): rupees in paise,
 * dollars in cents, yen (no minor unit), and TOE's whole rupees, which is how
 * TOE's data reads until its migration (#21).
 */

import {
  DEFAULT_SETTINGS,
  LEGACY_MONEY,
  newCafeSettings,
  type CafeSettings,
} from "@cafemenu/shared";

/** The demo cafe: INR in paise, a ₹10,000 cap. */
export const INR: CafeSettings = DEFAULT_SETTINGS;
/** Cents, a $150 cap. */
export const USD: CafeSettings = newCafeSettings({
  currency: "USD",
  locale: "en-US",
  timeZone: "America/New_York",
});
/** No minor unit: 1 is ¥1. A ¥20,000 cap. */
export const JPY: CafeSettings = newCafeSettings({
  currency: "JPY",
  locale: "ja-JP",
  timeZone: "Asia/Tokyo",
});
/** TOE until #21: whole rupees, the old ₹10,000 cap. */
export const TOE_RUPEES: CafeSettings = { ...INR, ...LEGACY_MONEY };

/**
 * One latte, in each: the same money, as each cafe stores it, with how it
 * reads. For tests that run the same story in every currency.
 */
export const CURRENCIES = [
  { code: "INR", settings: INR, latte: 18_050, shown: "₹180.50" },
  { code: "USD", settings: USD, latte: 450, shown: "$4.50" },
  { code: "JPY", settings: JPY, latte: 450, shown: "￥450" },
] as const;
