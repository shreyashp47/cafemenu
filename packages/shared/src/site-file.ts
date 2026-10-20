/**
 * `site.json`: the per-cafe file the deployer writes next to the shared app
 * bundle on every deploy (PLAN.md, "One build per release, not per cafe").
 *
 * It is the cafe's settings (./settings.ts), so the first paint is already the
 * cafe's own before Firestore answers, plus one optional flag:
 *
 *   { ...CafeSettings, "demo": true }
 *
 * `demo: true` marks a preview deploy (the console's live demo, the TOE fixture
 * in CI): the app runs on the in-browser demo store with these settings and
 * never looks for a Firebase project. Without it, the file's presence is what
 * tells the app it is a real cafe, so a real cafe that cannot reach its
 * Firebase config shows a retry screen rather than demo data.
 *
 * The app's own build never contains a site.json; only a deploy adds one.
 */

import {
  validateCafeSettings,
  type CafeSettings,
  type SettingsCheck,
} from "./settings.ts";

export const SITE_FILE_PATH = "/site.json";

export interface SiteFile {
  /** The settings part of the file, unparsed: read it with parseCafeSettings. */
  settings: Record<string, unknown>;
  demo: boolean;
}

/** Splits a fetched site.json into its settings and the demo flag. */
export function parseSiteFile(raw: unknown): SiteFile | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const { demo, ...settings } = raw as Record<string, unknown>;
  return { settings, demo: demo === true };
}

/** The file's contents for these settings, ready for JSON.stringify. */
export function siteFileFor(
  settings: CafeSettings,
  options: { demo?: boolean } = {},
): CafeSettings & { demo?: true } {
  return options.demo ? { ...settings, demo: true } : { ...settings };
}

/** validateCafeSettings for a whole site.json, the demo flag allowed. */
export function validateSiteFile(raw: unknown): SettingsCheck {
  const file = parseSiteFile(raw);
  if (!file) return { ok: false, problems: ["site.json: must be an object"] };
  const { demo } = raw as Record<string, unknown>;
  if (demo !== undefined && typeof demo !== "boolean") {
    return { ok: false, problems: ["demo: must be true, false or absent"] };
  }
  return validateCafeSettings(file.settings);
}
