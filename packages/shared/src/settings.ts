/**
 * A cafe's settings: who it is, how it looks, and how it counts money and time.
 *
 * One shape, three places (PLAN.md, "How it fits together"):
 *
 *   - `site.json`, written next to the app at deploy time, so the first paint is
 *     already the cafe's own;
 *   - Firestore `config/site`, the live copy. Only the platform writes it, with
 *     its service account; firestore.rules lets every client read it and none
 *     write it;
 *   - the defaults below, which are the demo cafe, "Mochi & Beans".
 *
 * The app reads them in that order and merges field by field, so a document
 * from an older release that lacks a newer field still works: the missing field
 * comes from the layer underneath. `parseCafeSettings` is that lenient read.
 * `validateCafeSettings` is the strict check for whatever writes them (the
 * console, the deployer): it names every problem instead of papering over it.
 *
 * Plain TypeScript with no dependencies and only erasable syntax, so it runs in
 * the browser, in Node tools and in tests alike.
 */

import {
  LEGACY_MAX_ORDER_TOTAL,
  MAX_ORDER_TOTAL_LIMIT,
  MONEY_UNITS,
  defaultMaxOrderTotal,
  type MoneyUnit,
} from "./money.ts";
import {
  isTimeZone,
  isUtcOffsets,
  utcOffsetsOf,
  type UtcOffsets,
} from "./time-zone.ts";

/**
 * Bump on a change existing documents cannot be read under.
 *
 *   1. TOE's settings, as CafeMenu first wrote them.
 *   2. Money in minor units (#12): adds `moneyUnit` and `maxOrderTotal`. A
 *      version 1 document is from before them, when every cafe kept whole
 *      units, and reads as LEGACY_MONEY.
 */
export const SETTINGS_SCHEMA_VERSION = 2;

/**
 * Theme presets (`data-theme` on the page; see ./themes.ts). TOE's look is
 * "cozy". An unknown theme reads as the default, so a cafe on a newer
 * release's theme still renders on an older one.
 */
export const THEMES = ["cozy", "minimal", "dark", "bistro"] as const;
export type ThemeId = (typeof THEMES)[number];

/** Free for now (issue #17); see ./features.ts for what each plan includes. */
export const PLANS = ["free"] as const;
export type PlanId = (typeof PLANS)[number];

/**
 * The highest table number an order can carry: firestore.rules refuses an
 * order with `tableNumber` outside 1..50.
 */
export const MAX_TABLE_NUMBER = 50;
export const MAX_NAME_LENGTH = 60;
export const MAX_TAGLINE_LENGTH = 80;

export interface CafeSettings {
  /** The shape of this document, SETTINGS_SCHEMA_VERSION when written. */
  schemaVersion: number;
  /** Shown in the header, the tab title, the QR cards and the manifest. */
  name: string;
  /** The line under the name. May be empty. */
  tagline: string;
  theme: ThemeId;
  /** "#RRGGBB" over the theme's own accent, or null to keep the theme's. */
  accent: string | null;
  /**
   * The cafe's logo: a path on the cafe's own site ("/logo.png", written at
   * deploy time) or an https URL. Null keeps the theme's own artwork.
   */
  logo: string | null;
  /** ISO 4217 code: "INR", "EUR", "USD". */
  currency: string;
  /** BCP 47 tag for number and date formats: "en-IN". */
  locale: string;
  /**
   * What the stored prices and totals count: "minor" (paise, cents; see
   * ./money.ts) or "major", whole units, which is TOE's data until #21
   * migrates it.
   */
  moneyUnit: MoneyUnit;
  /**
   * The most one order may total, in `moneyUnit`. firestore.rules reads it
   * from config/site; defaultMaxOrderTotal is where a cafe starts.
   */
  maxOrderTotal: number;
  /** IANA zone the cafe's day runs in: "Asia/Kolkata". */
  timeZone: string;
  /** That zone's offsets, for firestore.rules, which cannot look them up. */
  utcOffsets: UtcOffsets;
  /**
   * The table list until the owner saves one on /admin/qr (config/tables),
   * sorted, each 1..MAX_TABLE_NUMBER.
   */
  tables: number[];
  /**
   * The address printed on QR cards, as an origin: "https://their-cafe.web.app".
   * Null prints whatever address /admin/qr was opened on.
   */
  baseUrl: string | null;
  plan: PlanId;
}

export const SETTINGS_KEYS = [
  "schemaVersion",
  "name",
  "tagline",
  "theme",
  "accent",
  "logo",
  "currency",
  "locale",
  "moneyUnit",
  "maxOrderTotal",
  "timeZone",
  "utcOffsets",
  "tables",
  "baseUrl",
  "plan",
] as const satisfies readonly (keyof CafeSettings)[];

/** The demo cafe, and every field a cafe has not set. */
export const DEFAULT_SETTINGS: CafeSettings = deepFreeze({
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

// --- fields -----------------------------------------------------------------

/** Each field's check: the clean value, or undefined when it is not valid. */
type Parsers = {
  [K in keyof CafeSettings]: (value: unknown) => CafeSettings[K] | undefined;
};

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function text(min: number, max: number) {
  return (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined;
    const clean = value.replace(/\s+/g, " ").trim();
    if (CONTROL_CHARS.test(clean)) return undefined;
    return clean.length >= min && clean.length <= max ? clean : undefined;
  };
}

function oneOf<T extends string>(options: readonly T[]) {
  return (value: unknown): T | undefined =>
    options.includes(value as T) ? (value as T) : undefined;
}

function nullable<T>(parse: (value: unknown) => T | undefined) {
  return (value: unknown): T | null | undefined =>
    value === null ? null : parse(value);
}

function hexColour(value: unknown): string | undefined {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toUpperCase()
    : undefined;
}

function logoRef(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 500) return undefined;
  // A file on the cafe's own site. No "..", no "//host", nothing that needs
  // escaping in a URL.
  if (/^\/(?!\/)[A-Za-z0-9._~\-/]+$/.test(value) && !value.includes("..")) {
    return value;
  }
  return httpsUrl(value);
}

function httpsUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function origin(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    const bare =
      (url.pathname === "/" || url.pathname === "") &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password;
    return bare && (url.protocol === "https:" || url.protocol === "http:")
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
}

function currencyCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const code = value.toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : undefined;
}

function localeTag(value: unknown): string | undefined {
  if (typeof value !== "string" || value === "" || value.length > 35) {
    return undefined;
  }
  try {
    return Intl.getCanonicalLocales(value)[0];
  } catch {
    return undefined;
  }
}

function orderCap(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_ORDER_TOTAL_LIMIT
    ? value
    : undefined;
}

function timeZone(value: unknown): string | undefined {
  // Kept as written: engines disagree on canonical names (some answer
  // "Asia/Calcutta" for "Asia/Kolkata"), and either is a valid zone.
  return isTimeZone(value) ? value : undefined;
}

function offsets(value: unknown): UtcOffsets | undefined {
  return isUtcOffsets(value)
    ? { standard: value.standard, daylight: value.daylight }
    : undefined;
}

function tableList(value: unknown): number[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const ok = value.every(
    (n) =>
      typeof n === "number" &&
      Number.isInteger(n) &&
      n >= 1 &&
      n <= MAX_TABLE_NUMBER,
  );
  if (!ok) return undefined;
  return [...new Set(value as number[])].sort((a, b) => a - b);
}

function schemaVersion(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : undefined;
}

const PARSERS: Parsers = {
  schemaVersion,
  name: text(1, MAX_NAME_LENGTH),
  tagline: text(0, MAX_TAGLINE_LENGTH),
  theme: oneOf(THEMES),
  accent: nullable(hexColour),
  logo: nullable(logoRef),
  currency: currencyCode,
  locale: localeTag,
  moneyUnit: oneOf(MONEY_UNITS),
  maxOrderTotal: orderCap,
  timeZone,
  utcOffsets: offsets,
  tables: tableList,
  baseUrl: nullable(origin),
  plan: oneOf(PLANS),
};

/**
 * What a valid value looks like, for validateCafeSettings. Kept apart from the
 * parsers so the app, which only ever reads settings, does not ship them.
 */
const EXPECTS: { [K in keyof CafeSettings]: string } = {
  schemaVersion: "a whole number from 1",
  name: `text of 1 to ${MAX_NAME_LENGTH} characters`,
  tagline: `text of up to ${MAX_TAGLINE_LENGTH} characters`,
  theme: `one of ${THEMES.join(", ")}`,
  accent: 'a colour like "#7A3E1D", or null',
  logo: 'a path like "/logo.png", an https URL, or null',
  currency: 'an ISO 4217 code like "INR"',
  locale: 'a language tag like "en-IN"',
  moneyUnit: `one of ${MONEY_UNITS.join(", ")}`,
  maxOrderTotal: "a whole number from 1, in moneyUnit",
  timeZone: 'an IANA zone like "Asia/Kolkata"',
  utcOffsets:
    "{ standard, daylight } in whole minutes east of UTC, daylight at least standard",
  tables: `a list of whole numbers 1 to ${MAX_TABLE_NUMBER}`,
  baseUrl: 'an origin like "https://their-cafe.web.app", or null',
  plan: `one of ${PLANS.join(", ")}`,
};

// --- reading ----------------------------------------------------------------

/**
 * How a version 1 document's money reads: whole units, and the cap the rules
 * had for every cafe before #12. firestore.rules uses the same cap when
 * config/site has none.
 */
export const LEGACY_MONEY: Readonly<
  Pick<CafeSettings, "moneyUnit" | "maxOrderTotal">
> = Object.freeze({
  moneyUnit: "major",
  maxOrderTotal: LEGACY_MAX_ORDER_TOTAL,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function copy(settings: CafeSettings): CafeSettings {
  return {
    ...settings,
    utcOffsets: { ...settings.utcOffsets },
    tables: [...settings.tables],
  };
}

/**
 * Reads one layer of settings over `base`: every field of `raw` that is valid
 * replaces the base's, and everything else (missing, wrong type, out of range)
 * keeps the base's value. Never throws, whatever `raw` is.
 *
 * A layer that moves the cafe to another time zone without saying its offsets
 * gets them worked out, rather than keeping the base's, which belong to a
 * different zone. One that moves it to another currency without a cap gets
 * that currency's default.
 *
 * A layer at schemaVersion 1 was written before money had a unit, when every
 * cafe stored whole units: whatever the base says, it reads as LEGACY_MONEY.
 * This is what keeps TOE's whole rupees from reading as paise until #21
 * migrates them.
 */
export function parseCafeSettings(
  raw: unknown,
  base: CafeSettings = DEFAULT_SETTINGS,
): CafeSettings {
  const out = copy(base);
  if (!isRecord(raw)) return out;
  const legacy = raw.schemaVersion === 1;
  if (legacy) Object.assign(out, LEGACY_MONEY);
  const target = out as unknown as Record<string, unknown>;
  for (const key of SETTINGS_KEYS) {
    if (!(key in raw)) continue;
    const value = PARSERS[key](raw[key]);
    if (value !== undefined) target[key] = value;
  }
  if (out.timeZone !== base.timeZone && !isUtcOffsets(raw.utcOffsets)) {
    out.utcOffsets = utcOffsetsOf(out.timeZone);
  }
  if (
    !legacy &&
    out.currency !== base.currency &&
    orderCap(raw.maxOrderTotal) === undefined
  ) {
    out.maxOrderTotal = defaultMaxOrderTotal(out);
  }
  return out;
}

/**
 * Layers settings over the defaults, lowest first: `mergeCafeSettings(siteJson,
 * configSite)` is the deploy-time file with the live document over it. A null
 * or undefined layer is skipped.
 */
export function mergeCafeSettings(...layers: unknown[]): CafeSettings {
  return layers.reduce<CafeSettings>(
    (settings, layer) => parseCafeSettings(layer, settings),
    DEFAULT_SETTINGS,
  );
}

// --- writing ----------------------------------------------------------------

export type SettingsCheck =
  { ok: true; settings: CafeSettings } | { ok: false; problems: string[] };

/**
 * The strict check, for whatever writes settings: every field present and
 * valid, nothing unknown, the current schema version, and offsets that match
 * the time zone. The cap is the platform's to choose, so any whole number in
 * range passes. Returns the cleaned settings (trimmed text, upper-case codes,
 * sorted tables) when it passes, and every problem when it does not.
 */
export function validateCafeSettings(raw: unknown): SettingsCheck {
  if (!isRecord(raw)) {
    return { ok: false, problems: ["settings: must be an object"] };
  }
  const problems: string[] = [];
  for (const key of Object.keys(raw)) {
    if (!(SETTINGS_KEYS as readonly string[]).includes(key)) {
      problems.push(`${key}: not a setting`);
    }
  }
  for (const key of SETTINGS_KEYS) {
    if (!(key in raw)) {
      problems.push(`${key}: missing`);
    } else if (PARSERS[key](raw[key]) === undefined) {
      problems.push(`${key}: must be ${EXPECTS[key]}`);
    }
  }
  if (problems.length > 0) return { ok: false, problems };

  const settings = parseCafeSettings(raw);
  if (settings.schemaVersion !== SETTINGS_SCHEMA_VERSION) {
    problems.push(`schemaVersion: must be ${SETTINGS_SCHEMA_VERSION}`);
  }
  const expected = utcOffsetsOf(settings.timeZone);
  if (
    expected.standard !== settings.utcOffsets.standard ||
    expected.daylight !== settings.utcOffsets.daylight
  ) {
    problems.push(
      `utcOffsets: ${settings.timeZone} is ${expected.standard} standard and ${expected.daylight} daylight`,
    );
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, settings };
}

/**
 * Settings for a new cafe: the defaults with `fields` over them, offsets worked
 * out from the time zone and the cap from the currency, at the current schema
 * version, money in minor units. Still worth a validateCafeSettings before
 * writing, since `fields` may be bad.
 */
export function newCafeSettings(fields: Partial<CafeSettings>): CafeSettings {
  return parseCafeSettings(
    { ...fields, schemaVersion: SETTINGS_SCHEMA_VERSION },
    DEFAULT_SETTINGS,
  );
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}
