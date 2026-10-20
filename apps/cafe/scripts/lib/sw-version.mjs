/**
 * Service-worker version stamping (issue #29).
 *
 * public/sw.js names its caches after a VERSION constant, and `activate` deletes
 * every cafe-* cache that is not the current one. That only works if VERSION
 * changes when the app does. It used to be a hardcoded "v1", so it never did.
 *
 * The version is a hash of the exported build itself — every file under out/
 * except sw.js, path and bytes — so it changes exactly when something the
 * browser could have cached changes, and two builds of identical output agree.
 * Hashing the output rather than reading Next's build id means this does not
 * depend on how Next happens to name things this release.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export const PLACEHOLDER = "__SW_VERSION__";
export const SW_FILE = "sw.js";

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const full = join(dir, entry.name);
      return entry.isDirectory() ? listFiles(full) : [full];
    }),
  );
  return nested.flat();
}

/** Short content hash of every file in `outDir` except the service worker. */
export async function buildVersion(outDir) {
  const files = (await listFiles(outDir))
    .map((full) => ({ full, rel: relative(outDir, full).split(sep).join("/") }))
    .filter(({ rel }) => rel !== SW_FILE)
    // Sorted so the hash does not depend on the order the filesystem lists in.
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  if (files.length === 0) {
    throw new Error(`${outDir} has nothing in it to version. Run next build.`);
  }

  const hash = createHash("sha256");
  for (const { full, rel } of files) {
    hash.update(rel);
    hash.update("\0");
    hash.update(await readFile(full));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 12);
}

/**
 * Replaces the placeholder in `source` with `version`. Throws if there is not
 * exactly one placeholder, so a refactor that drops it fails the build instead
 * of quietly shipping a constant version again.
 */
export function stampSource(source, version) {
  if (!/^[0-9a-f]{6,64}$/.test(version)) {
    throw new Error(`Refusing to stamp an odd-looking version: ${version}`);
  }
  const count = source.split(PLACEHOLDER).length - 1;
  if (count !== 1) {
    throw new Error(
      `Expected exactly one ${PLACEHOLDER} in sw.js, found ${count}. ` +
        "Without it the cache version never changes (issue #29).",
    );
  }
  return source.replace(PLACEHOLDER, version);
}

/** Stamps out/sw.js in place and returns the version it wrote. */
export async function stampServiceWorker(outDir) {
  const swPath = join(outDir, SW_FILE);
  const source = await readFile(swPath, "utf8");
  const version = await buildVersion(outDir);
  await writeFile(swPath, stampSource(source, version));
  return version;
}
