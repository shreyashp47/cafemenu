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

type Catalogue = typeof en;

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

/** Every message in messages/en.json, as the dotted path to it. */
export type MessageKey = Paths<Catalogue>;

export type MessageParams = Record<string, string | number>;

const CATALOGUES: Record<string, Catalogue> = { en };

let locale: string = DEFAULT_SETTINGS.locale;

/** The cafe's locale, for Intl: the whole tag, region and all. */
export function getLocale(): string {
  return locale;
}

/** Called by src/lib/settings.ts whenever the cafe's settings change. */
export function setLocale(next: string): void {
  locale = next;
}

function catalogueFor(tag: string): Catalogue {
  return CATALOGUES[tag.split("-")[0].toLowerCase()] ?? en;
}

function lookup(
  catalogue: Catalogue,
  key: string,
): string | PluralMessage | undefined {
  let node: unknown = catalogue;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" || (typeof node === "object" && node !== null)
    ? (node as string | PluralMessage)
    : undefined;
}

const pluralRules = new Map<string, Intl.PluralRules>();

function pluralCategory(tag: string, count: number): string {
  let rules = pluralRules.get(tag);
  if (!rules) {
    try {
      rules = new Intl.PluralRules(tag);
    } catch {
      rules = new Intl.PluralRules("en");
    }
    pluralRules.set(tag, rules);
  }
  return rules.select(count);
}

/**
 * The message for `key` in the cafe's language, with {name} replaced from
 * `params`. A placeholder nobody filled stays as written, and a key with no
 * message comes back as itself: visible, never a blank on screen.
 */
export function t(key: MessageKey, params?: MessageParams): string {
  const found = lookup(catalogueFor(locale), key) ?? lookup(en, key);
  if (found === undefined) return key;
  let text: string;
  if (typeof found === "string") {
    text = found;
  } else {
    const count = Number(params?.count);
    text =
      (count === 0 ? found.zero : undefined) ??
      found[pluralCategory(locale, count) as keyof PluralMessage] ??
      found.other;
  }
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}
