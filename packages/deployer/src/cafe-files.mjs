/**
 * A cafe's own files, laid over the shared bundle on every deploy (PLAN.md,
 * "One build per release, not per cafe"): site.json, the web app manifest,
 * the logo and the app icons, all made by @cafemenu/shared from the cafe's
 * settings, so the cafe app's build and the deployer agree on them.
 *
 * @cafemenu/shared is TypeScript that a Node which strips types (22.18+)
 * imports directly. Node 20 can't, so it is loaded only by the commands that
 * need it, and tests pass their own stand-in as `ctx.loadShared`.
 */
import { readFile as fsReadFile } from "node:fs/promises";
import zlib from "node:zlib";

import { ActionNeededError, UsageError } from "./errors.mjs";

/** Every path the per-cafe files can take, besides the icons: these are the cafe's, not the release's. */
export const SITE_FILE = "/site.json";
export const MANIFEST_FILE = "/manifest.webmanifest";
export const LOGO_FILE = "/logo.png";

/** @cafemenu/shared and its icon generator, as one object. */
export async function loadShared() {
  try {
    const [main, icons] = await Promise.all([
      import("@cafemenu/shared"),
      import("@cafemenu/shared/icons"),
    ]);
    return { ...main, ...icons };
  } catch (error) {
    if (error.code !== "ERR_UNKNOWN_FILE_EXTENSION") throw error;
    throw new ActionNeededError(
      `Making a cafe's files needs Node 22.18 or later, which reads @cafemenu/shared's TypeScript directly; this is Node ${process.versions.node}.`,
      { hint: "Run the deployer with a newer Node (e.g. `npx -y node@24 bin/deployer.mjs …`)." },
    );
  }
}

/** The paths a deploy treats as the cafe's: replaced on every deploy and by sync-branding. */
export const cafePaths = (shared) =>
  new Set([SITE_FILE, MANIFEST_FILE, LOGO_FILE, ...Object.values(shared.ICON_PATHS)]);

/**
 * Reads and checks the settings file (validateCafeSettings: every field, the
 * current schema) and the logo. Returns {settings, logo}. Throws UsageError.
 */
export async function readCafeInput(shared, { settingsPath, logoPath }, read = fsReadFile) {
  let raw;
  try {
    raw = JSON.parse(await read(settingsPath, "utf8"));
  } catch (error) {
    throw new UsageError(
      `Can't read ${settingsPath} as JSON (${error.code ?? error.message}).`,
    );
  }
  const check = shared.validateCafeSettings(raw);
  if (!check.ok) {
    throw new UsageError(
      [`${settingsPath} isn't valid cafe settings:`, ...check.problems.map((p) => `  - ${p}`)].join("\n"),
    );
  }
  const { settings } = check;
  if (settings.logo === LOGO_FILE && !logoPath) {
    throw new UsageError(`The settings' logo is ${LOGO_FILE}: give the file with --logo <png>.`);
  }
  let logo = null;
  if (logoPath) {
    try {
      logo = await read(logoPath);
    } catch (error) {
      throw new UsageError(`Can't read ${logoPath} (${error.code ?? error.message}).`);
    }
    if (!shared.isPng(logo)) throw new UsageError(`${logoPath} isn't a PNG.`);
  }
  return { settings, logo };
}

/**
 * The cafe's files: [{path, bytes}] for site.json, manifest.webmanifest,
 * /logo.png when there is a logo, and every app icon.
 */
export function cafeFiles(shared, { settings, logo }) {
  const json = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const files = [
    { path: SITE_FILE, bytes: json(shared.siteFileFor(settings)) },
    { path: MANIFEST_FILE, bytes: json(shared.webManifest(settings)) },
  ];
  try {
    if (logo) files.push(shared.siteLogo(logo, zlib));
    files.push(...shared.appIcons(settings, { logo, zlib }));
  } catch (error) {
    if (error.name !== "PngError") throw error;
    throw new UsageError(`The logo can't be read as a PNG (${error.message}).`);
  }
  return files.map(({ path, bytes }) => ({ path, bytes: Buffer.from(bytes) }));
}
