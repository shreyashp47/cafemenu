/**
 * The Branding and locale section of the owner area (#29) as data: the
 * settings an owner edits after sign-up (name, tagline, logo, theme, accent,
 * currency, time zone, language), what each may hold, and the CafeSettings
 * they become. Pure, so every rule is tested without a browser.
 *
 * Only these fields are edited here. The tables, the order cap, the address
 * on the QR cards, the money unit and the plan are the cafe's own dashboard's
 * or the backend's, and carry over exactly as they are.
 *
 * Checks return problem codes; the words are in messages/en.json under
 * `cafe.branding.problems`.
 */

import {
  MAX_NAME_LENGTH,
  MAX_TAGLINE_LENGTH,
  THEMES,
  checkAccent,
  isTimeZone,
  utcOffsetsOf,
  validateCafeSettings,
  type CafeSettings,
  type ThemeId,
} from "@cafemenu/shared";
import { isCurrency, isLocale, type FormLogo } from "../signup/form";

/** The path on the cafe's own site where deploys put a logo. */
export const SITE_LOGO_PATH = "/logo.png";

/** What happens to the logo when the form is saved. */
export type LogoChange =
  { kind: "keep" } | { kind: "remove" } | { kind: "replace"; logo: FormLogo };

export interface BrandingForm {
  name: string;
  tagline: string;
  theme: ThemeId;
  /** "#RRGGBB", or null to keep the theme's own accent. */
  accent: string | null;
  currency: string;
  timeZone: string;
  locale: string;
  logo: LogoChange;
}

const isTheme = (value: string): value is ThemeId =>
  (THEMES as readonly string[]).includes(value);

/** The form as the cafe has it now. */
export function brandingFormOf(settings: CafeSettings): BrandingForm {
  return {
    name: settings.name,
    tagline: settings.tagline,
    theme: settings.theme,
    accent: settings.accent,
    currency: settings.currency,
    timeZone: settings.timeZone,
    locale: settings.locale,
    logo: { kind: "keep" },
  };
}

export type BrandingProblems = Partial<{
  name: "required" | "too-long";
  tagline: "too-long";
  accent: "invalid" | "contrast";
  currency: "invalid";
  timeZone: "invalid";
  locale: "invalid";
}>;

export type BrandingField = keyof BrandingProblems;

/** In page order, so the first one can take the focus. */
export const BRANDING_FIELD_ORDER: readonly BrandingField[] = [
  "name",
  "tagline",
  "accent",
  "currency",
  "timeZone",
  "locale",
];

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

export function brandingProblems(form: BrandingForm): BrandingProblems {
  const problems: BrandingProblems = {};
  const name = collapse(form.name);
  if (!name) problems.name = "required";
  else if (name.length > MAX_NAME_LENGTH) problems.name = "too-long";
  if (collapse(form.tagline).length > MAX_TAGLINE_LENGTH) {
    problems.tagline = "too-long";
  }
  if (form.accent !== null) {
    if (!/^#[0-9a-f]{6}$/i.test(form.accent)) problems.accent = "invalid";
    else if (!checkAccent(form.theme, form.accent).ok) {
      problems.accent = "contrast";
    }
  }
  if (!isCurrency(form.currency)) problems.currency = "invalid";
  if (!isTimeZone(form.timeZone)) problems.timeZone = "invalid";
  if (!isLocale(form.locale)) problems.locale = "invalid";
  return problems;
}

export const firstBrandingProblem = (
  problems: BrandingProblems,
): BrandingField | null =>
  BRANDING_FIELD_ORDER.find((field) => problems[field]) ?? null;

/**
 * The settings the form makes: `base` with these fields over it. The time
 * zone's UTC offsets are worked out again, because the rules and the cafe's
 * own security rules read them from the settings. Assumes brandingProblems
 * found nothing; the repository then runs the strict check as well.
 */
export function settingsFromBranding(
  base: CafeSettings,
  form: BrandingForm,
): CafeSettings {
  const logo =
    form.logo.kind === "keep"
      ? base.logo
      : form.logo.kind === "remove"
        ? null
        : SITE_LOGO_PATH;
  return {
    ...base,
    name: collapse(form.name),
    tagline: collapse(form.tagline),
    theme: isTheme(form.theme) ? form.theme : base.theme,
    accent: form.accent ? form.accent.toUpperCase() : null,
    logo,
    currency: form.currency,
    timeZone: form.timeZone,
    utcOffsets: utcOffsetsOf(form.timeZone),
    locale: form.locale,
    // Copies, so editing the saved record cannot reach the form's base.
    tables: [...base.tables],
  };
}

export interface BrandingChange {
  /** Anything at all differs: whether Save does something. */
  changed: boolean;
  /** The prices now read in another currency (see the warning for it). */
  currencyChanged: boolean;
  logoChanged: boolean;
}

export function brandingChange(
  base: CafeSettings,
  form: BrandingForm,
): BrandingChange {
  const next = settingsFromBranding(base, form);
  const logoChanged = form.logo.kind !== "keep";
  const differs = (Object.keys(next) as (keyof CafeSettings)[]).some(
    (key) => JSON.stringify(next[key]) !== JSON.stringify(base[key]),
  );
  return {
    changed: differs || logoChanged,
    currencyChanged: next.currency !== base.currency,
    logoChanged,
  };
}

/**
 * The strict check the repository will make, run on what the form makes, so
 * a field only the strict check knows about is still caught before Save.
 */
export function strictProblems(settings: CafeSettings): string[] {
  const check = validateCafeSettings(settings);
  return check.ok ? [] : check.problems;
}
