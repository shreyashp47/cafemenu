/**
 * Which cafes the platform runs, for `deployer rollout`.
 *
 * A CafeDirectory has two methods:
 *
 *   list() → Cafe[]
 *   recordRelease(id, {current, previous, pinned?}) → void
 *       The cafe now runs `current` (a version string), with `previous`
 *       (or null) to go back to. Called after a deploy or a roll back.
 *       `pinned`, when given, is the minor line it now stays on: a cafe moved
 *       off an unsupported line by a rollout (the support window) stays on
 *       the new one.
 *
 * Cafe {
 *   id, name,
 *   projectId, site,           the cafe's Firebase project and Hosting site
 *   settingsFile, logoFile,    paths to its CafeSettings JSON and logo (or null)
 *   canary,                    true for the cafe a rollout tries first (TOE)
 *   status,                    "live", or draft|provisioning|failed|
 *                              disconnected|suspended: only live ones roll out
 *   release: {channel: "stable"|"beta", pinned: "1.4"|null,
 *             current: "1.4.2"|null, previous: "1.4.1"|null}
 * }
 *
 * createJsonCafeDirectory is the CLI's: one file, `--cafes <cafes.json>`.
 *
 * TODO(#28): a platform-Firestore CafeDirectory that lists the console's
 * `cafes` collection (apps/console/src/lib/platform/model.ts: projectId, site,
 * settings, status, and release {channel, pinned, current, previous}, the last
 * two backend-only) and writes release.current and .previous back. Its cafes
 * carry their settings as a map rather than a file, and the canary is a flag
 * on the platform, not on a cafe.
 */
import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { UsageError } from "./errors.mjs";
import { PROJECT_ID, SITE_NAME } from "./names.mjs";
import { parseVersion } from "./release-package.mjs";

export const CAFE_STATUSES = [
  "draft",
  "provisioning",
  "live",
  "failed",
  "disconnected",
  "suspended",
];

const MINOR_LINE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function versionOrNull(value, where) {
  if (value === undefined || value === null) return null;
  try {
    return parseVersion(value).version;
  } catch {
    throw new UsageError(`${where} isn't a release version: ${value}`);
  }
}

/** One cafe of the file, checked. Throws UsageError. `base` resolves file paths. */
function parseCafe(raw, index, base) {
  const label = `cafe ${index + 1}${typeof raw?.id === "string" ? ` (${raw.id})` : ""}`;
  const fail = (message) => {
    throw new UsageError(`${label}: ${message}`);
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    fail("must be an object.");
  const text = (key) => {
    const value = raw[key];
    if (typeof value !== "string" || !value.trim())
      fail(`"${key}" is required.`);
    return value.trim();
  };
  const id = text("id");
  const projectId = text("projectId");
  if (!PROJECT_ID.test(projectId))
    fail(`"projectId" isn't a Firebase project ID: ${projectId}`);
  const site = text("site");
  if (!SITE_NAME.test(site)) fail(`"site" isn't a Hosting site name: ${site}`);
  const status = raw.status ?? "live";
  if (!CAFE_STATUSES.includes(status))
    fail(`"status" is one of ${CAFE_STATUSES.join(", ")}.`);
  if (raw.canary !== undefined && typeof raw.canary !== "boolean")
    fail(`"canary" is true or false.`);

  const release = raw.release ?? {};
  const channel = release.channel ?? "stable";
  if (channel !== "stable" && channel !== "beta")
    fail(`"release.channel" is "stable" or "beta".`);
  const pinned = release.pinned ?? null;
  if (
    pinned !== null &&
    !(typeof pinned === "string" && MINOR_LINE.test(pinned))
  )
    fail(`"release.pinned" is a minor line such as "1.4", or null.`);
  return {
    id,
    name:
      typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : id,
    projectId,
    site,
    settingsFile: resolve(base, text("settingsFile")),
    logoFile:
      typeof raw.logoFile === "string" && raw.logoFile.trim()
        ? resolve(base, raw.logoFile.trim())
        : null,
    canary: raw.canary === true,
    status,
    release: {
      channel,
      pinned,
      current: versionOrNull(release.current, `${label}: "release.current"`),
      previous: versionOrNull(release.previous, `${label}: "release.previous"`),
    },
  };
}

/** The cafes of a parsed cafes.json. Throws UsageError. */
export function parseCafeList(
  data,
  { source = "the cafe list", base = "." } = {},
) {
  if (!Array.isArray(data?.cafes))
    throw new UsageError(`${source} needs a "cafes" list.`);
  const cafes = data.cafes.map((raw, i) => parseCafe(raw, i, base));
  const seen = new Set();
  for (const cafe of cafes) {
    if (seen.has(cafe.id))
      throw new UsageError(`${source} lists the cafe "${cafe.id}" twice.`);
    seen.add(cafe.id);
  }
  return cafes;
}

async function readJson(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new UsageError(
      `Can't read the cafe list ${path} (${error.code ?? error.message}).`,
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new UsageError(`${path} isn't JSON.`);
  }
}

export function createJsonCafeDirectory(path) {
  return {
    path,
    async list() {
      return parseCafeList(await readJson(path), {
        source: path,
        base: dirname(resolve(path)),
      });
    },
    async recordRelease(id, { current, previous, pinned }) {
      // The file is the person's, so only the cafe's release fields change.
      const data = await readJson(path);
      const entry = data.cafes?.find((cafe) => cafe?.id === id);
      if (!entry) throw new Error(`${path} doesn't list the cafe "${id}".`);
      entry.release = {
        ...entry.release,
        current,
        previous,
        ...(pinned !== undefined && { pinned }),
      };
      const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`);
      await rename(tmp, path);
    },
  };
}
