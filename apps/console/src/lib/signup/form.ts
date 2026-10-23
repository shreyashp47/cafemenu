/**
 * The sign-up form as data: its fields, what each may hold, and the cafe it
 * becomes. Pure, so every rule is tested without a browser; the page in
 * src/app/signup only shows it.
 *
 * Checks return problem codes; the words are in messages/en.json under
 * `signup.problems`.
 */

import {
  MAX_NAME_LENGTH,
  MAX_TABLE_NUMBER,
  THEMES,
  checkAccent,
  isTimeZone,
  newCafeSettings,
  type CafeSettings,
  type ImportSettings,
  type ThemeId,
} from "@cafemenu/shared";
import { isFirestoreLocation } from "../platform/locations";
import type { StartingMenu } from "../platform/model";
import { STARTING_PLAN, type NewCafeInput } from "../platform/validate";
import { OTHER_COUNTRY, countryDefaults } from "./countries";
import {
  listStart,
  needsList,
  startingMenu,
  type MenuChoice,
  type MenuResult,
} from "./menu";
import {
  siteNameFrom,
  siteNameProblem,
  type SiteNameProblem,
} from "./site-name";

/** Firebase's own minimum is 6; an owner's account deserves a little more. */
export const MIN_PASSWORD = 8;
export const DEFAULT_TABLES = 6;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface FormLogo {
  /** The stored PNG, base64. */
  png: string;
  width: number;
  height: number;
  /** The file as chosen, for the hints. */
  original: { width: number; height: number };
}

export interface SignupForm {
  name: string;
  site: string;
  /** False while the web address still follows the cafe's name. */
  siteEdited: boolean;
  email: string;
  password: string;
  /** A code from ./countries.ts, OTHER_COUNTRY, or "" for not chosen yet. */
  country: string;
  currency: string;
  timeZone: string;
  locale: string;
  region: string;
  /** As typed, so a half-typed number is not thrown away. */
  tables: string;
  theme: ThemeId;
  /** "#RRGGBB", or null to keep the theme's own accent. */
  accent: string | null;
  logo: FormLogo | null;
  menu: MenuChoice;
  /** The owner's list, when the menu choice needs one. */
  menuText: string;
}

/** A blank form, for a visitor whose browser is set to `timeZone`. */
export function emptyForm(timeZone = "UTC"): SignupForm {
  return {
    name: "",
    site: "",
    siteEdited: false,
    email: "",
    password: "",
    country: "",
    currency: "USD",
    timeZone: isTimeZone(timeZone) ? timeZone : "UTC",
    locale: "en-US",
    region: "nam5",
    tables: String(DEFAULT_TABLES),
    theme: "cozy",
    accent: null,
    logo: null,
    menu: { kind: "template", id: "coffee-shop" },
    menuText: "",
  };
}

/** The cafe's name, and the web address with it until the owner edits that. */
export function withName(form: SignupForm, name: string): SignupForm {
  return {
    ...form,
    name,
    site: form.siteEdited ? form.site : siteNameFrom(name),
  };
}

export function withSite(form: SignupForm, site: string): SignupForm {
  const clean = site.trim().toLowerCase();
  return { ...form, site: clean, siteEdited: clean !== "" };
}

/**
 * A country, and its currency, time zone, format and region with it. The
 * owner can change each of them afterwards; choosing "somewhere else" keeps
 * what is there for them to set.
 */
export function withCountry(form: SignupForm, country: string): SignupForm {
  const defaults = countryDefaults(country);
  if (!defaults) return { ...form, country };
  return {
    ...form,
    country,
    currency: defaults.currency,
    timeZone: defaults.timeZone,
    locale: defaults.locale,
    region: defaults.region,
  };
}

export const isOtherCountry = (form: SignupForm) =>
  form.country === OTHER_COUNTRY;

/** 1 to 50, or null when the text is not such a number. */
export function tableCount(text: string): number | null {
  if (!/^\d{1,3}$/.test(text.trim())) return null;
  const n = Number(text);
  return n >= 1 && n <= MAX_TABLE_NUMBER ? n : null;
}

function isCurrency(code: string): boolean {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code });
    return true;
  } catch {
    return false;
  }
}

function isLocale(tag: string): boolean {
  try {
    return Intl.getCanonicalLocales(tag)[0] === tag;
  } catch {
    return false;
  }
}

/** What the starting menu's prices are read in. */
export function importSettingsOf(form: SignupForm): ImportSettings {
  const settings = newCafeSettings({
    currency: isCurrency(form.currency) ? form.currency : "USD",
    locale: isLocale(form.locale) ? form.locale : "en-US",
  });
  return {
    currency: settings.currency,
    locale: settings.locale,
    moneyUnit: settings.moneyUnit,
    maxOrderTotal: settings.maxOrderTotal,
  };
}

export function menuOf(form: SignupForm): MenuResult {
  return startingMenu(form.menu, form.menuText, importSettingsOf(form));
}

/**
 * After any change: a starter that was priced in the old currency and has no
 * prices in the new one opens as its list, for the owner to price. Run it on
 * every change to the form, with the form from before the change.
 */
export function settleMenu(before: SignupForm, after: SignupForm): SignupForm {
  if (after.menu.kind !== "template") return after;
  const now = importSettingsOf(after);
  const pricedBefore = !needsList(after.menu, importSettingsOf(before));
  return pricedBefore && needsList(after.menu, now)
    ? { ...after, menuText: listStart(after.menu, now) }
    : after;
}

export type FieldProblems = Partial<{
  name: "required" | "too-long";
  /** "taken" comes from the web address check, not from here. */
  site: SiteNameProblem | "taken";
  email: "required" | "invalid";
  password: "required" | "too-short";
  country: "required";
  currency: "invalid";
  timeZone: "invalid";
  locale: "invalid";
  region: "invalid";
  tables: "invalid";
  accent: "invalid" | "contrast";
  menu: "empty" | "rows";
}>;

export type FieldName = keyof FieldProblems;

/** In page order, so the first one can take the focus. */
export const FIELD_ORDER: readonly FieldName[] = [
  "name",
  "site",
  "tables",
  "country",
  "currency",
  "timeZone",
  "locale",
  "region",
  "accent",
  "menu",
  "email",
  "password",
];

/**
 * Every problem with the form at once. `needsAccount` is false when the
 * owner is already signed in, so the email and password are not asked.
 */
export function formProblems(
  form: SignupForm,
  { needsAccount = true }: { needsAccount?: boolean } = {},
): FieldProblems {
  const problems: FieldProblems = {};
  const name = form.name.replace(/\s+/g, " ").trim();
  if (!name) problems.name = "required";
  else if (name.length > MAX_NAME_LENGTH) problems.name = "too-long";

  const site = siteNameProblem(form.site);
  if (site) problems.site = site;

  if (needsAccount) {
    const email = form.email.trim();
    if (!email) problems.email = "required";
    else if (!EMAIL.test(email)) problems.email = "invalid";
    if (!form.password) problems.password = "required";
    else if (form.password.length < MIN_PASSWORD) {
      problems.password = "too-short";
    }
  }

  if (!form.country) problems.country = "required";
  if (!isCurrency(form.currency)) problems.currency = "invalid";
  if (!isTimeZone(form.timeZone)) problems.timeZone = "invalid";
  if (!isLocale(form.locale)) problems.locale = "invalid";
  if (!isFirestoreLocation(form.region)) problems.region = "invalid";
  if (tableCount(form.tables) === null) problems.tables = "invalid";

  if (form.accent !== null) {
    const check = checkAccent(form.theme, form.accent);
    if (!check.ok) {
      problems.accent = /^#[0-9a-f]{6}$/i.test(form.accent)
        ? "contrast"
        : "invalid";
    }
  }

  const menu = menuOf(form);
  if (menu.problem) problems.menu = menu.problem;
  return problems;
}

export const firstProblem = (problems: FieldProblems): FieldName | null =>
  FIELD_ORDER.find((field) => problems[field]) ?? null;

/**
 * The cafe's settings. Every field is set here, rather than left to the
 * defaults, which are the demo cafe's ("Mochi & Beans", its tagline). Assumes
 * formProblems found nothing.
 */
export function settingsOf(form: SignupForm): CafeSettings {
  const count = tableCount(form.tables) ?? DEFAULT_TABLES;
  return newCafeSettings({
    name: form.name,
    tagline: "",
    theme: (THEMES as readonly string[]).includes(form.theme)
      ? form.theme
      : "cozy",
    accent: form.accent ? form.accent.toUpperCase() : null,
    // Written into the site as /logo.png by provisioning (#28).
    logo: form.logo ? "/logo.png" : null,
    currency: form.currency,
    locale: form.locale,
    timeZone: form.timeZone,
    tables: Array.from({ length: count }, (_, i) => i + 1),
    // The QR cards print the address they are opened on until a custom
    // domain is set up.
    baseUrl: null,
    plan: STARTING_PLAN,
  });
}

/** What CafeRepository.create takes, and what goes in the setup documents. */
export function cafeOf(form: SignupForm): {
  input: NewCafeInput;
  menu: StartingMenu | null;
} {
  return {
    input: { site: form.site, region: form.region, settings: settingsOf(form) },
    menu: menuOf(form).menu,
  };
}
