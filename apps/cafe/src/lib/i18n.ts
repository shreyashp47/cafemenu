/**
 * Every word the app shows people lives in messages/en.json, and comes out
 * through t(). No i18n library: this is the whole of it, so a cafe's first
 * load stays small.
 *
 *   t("staff.markReady")                      -> "Mark ready"
 *   t("order.tableTitle", { table: 4 })       -> "Table 4"     ("Table {table}")
 *   t("order.itemsGoing", { count: 3 })       -> "3 items going on order #soon."
 *
 * A message is a string, with {name} for what the caller fills in, or an
 * object keyed by plural category ("one", "other", …; "zero" for exactly 0)
 * and picked by the `count` argument with Intl.PluralRules, so a language
 * with more forms than English's two only adds keys.
 *
 * Keys are checked against en.json by the compiler (MessageKey), and
 * src/lib/__tests__/messages.test.ts checks that each one is used.
 *
 * The language is the cafe's locale (settings.locale, "en-IN"): its first
 * part picks the catalogue, and English is the only one so far, which every
 * other language falls back to. The whole tag is still what dates and
 * numbers are formatted with (see getLocale), so "en-IN" and "en-US" share
 * words and differ in separators.
 */

import { DEFAULT_SETTINGS } from "@cafemenu/shared";

import en from "../../messages/en.json";
// Types only: the staff words are fetched by the routes that show them.
import type enStaff from "../../messages/en.staff.json";

/** A message that varies with a count. Only `other` is required. */
interface PluralMessage {
  other: string;
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
}

type Paths<T> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : T[K] extends { other: string }
      ? K
      : `${K}.${Paths<T[K]>}`;
}[keyof T & string];

/** Every message in messages/en.json and en.staff.json, as the dotted path to it. */
export type MessageKey = Paths<typeof en> | Paths<typeof enStaff>;

export type MessageParams = Record<string, string | number>;

/**
 * What each language has loaded, as the files it is made of. English starts
 * with messages/en.json, the words of the customer's screens and of the code
 * they share. The staff board, the owner dashboard and the join page add
 * messages/en.staff.json by importing src/lib/staff-messages.ts, so a customer's
 * phone never downloads words it will not show.
 */
const CATALOGUES: Record<string, object[]> = { en: [en] };

/** Adds a file of messages to a language. Adding the same one twice is fine. */
export function addMessages(language: string, messages: object): void {
  const parts = (CATALOGUES[language] ??= []);
  if (!parts.includes(messages)) parts.push(messages);
}

let locale: string = DEFAULT_SETTINGS.locale;

/** The cafe's locale, for Intl: the whole tag, region and all. */
export function getLocale(): string {
  return locale;
}

/** Called by src/lib/settings.ts whenever the cafe's settings change. */
export function setLocale(next: string): void {
  locale = next;
}

/** The language whose words are shown for a locale: English until another is added. */
function languageOf(tag: string): string {
  const language = tag.split("-")[0].toLowerCase();
  return language in CATALOGUES ? language : "en";
}

function lookup(
  parts: readonly object[],
  key: string,
): string | PluralMessage | undefined {
  const path = key.split(".");
  for (const part of parts) {
    let node: unknown = part;
    for (const step of path) {
      if (typeof node !== "object" || node === null) break;
      node = (node as Record<string, unknown>)[step];
    }
    if (
      typeof node === "string" ||
      (typeof node === "object" && node !== null)
    ) {
      return node as string | PluralMessage;
    }
  }
  return undefined;
}

const pluralRules = new Map<string, Intl.PluralRules>();

/** The language the words are in for a cafe locale, for <html lang>. */
export function getLanguage(tag: string = locale): string {
  return languageOf(tag);
}

function pluralCategory(language: string, count: number): string {
  let rules = pluralRules.get(language);
  if (!rules) {
    rules = new Intl.PluralRules(language);
    pluralRules.set(language, rules);
  }
  return rules.select(count);
}

/**
 * The message for `key` in the cafe's language, with {name} replaced from
 * `params`. A placeholder nobody filled stays as written, and a key with no
 * message comes back as itself: visible, never a blank on screen.
 */
export function t(key: MessageKey, params?: MessageParams): string {
  const language = languageOf(locale);
  const found = lookup(CATALOGUES[language], key) ?? lookup(CATALOGUES.en, key);
  if (found === undefined) return key;
  let text: string;
  if (typeof found === "string") {
    text = found;
  } else {
    const count = Number(params?.count);
    text =
      (count === 0 ? found.zero : undefined) ??
      found[pluralCategory(language, count) as keyof PluralMessage] ??
      found.other;
  }
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

const numberFormats = new Map<string, Intl.NumberFormat>();

/** A plain number in the cafe's locale: 1,000 or 1.000, 10,00,000 in India. */
export function formatNumber(value: number): string {
  let format = numberFormats.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(locale);
    numberFormats.set(locale, format);
  }
  return format.format(value);
}
