/**
 * Getting a release package and trusting it: download it and SHA256SUMS from
 * the GitHub Release (or take a local file), then run exactly the checks of
 * scripts/release/verify.mjs (docs/releases.md, "Checking a package"), which
 * this imports from the repository rather than copying. The deployer
 * therefore runs from a checkout of the repository, not on its own.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SUMS } from "../../../scripts/release/lib/layout.mjs";
import {
  compareVersions,
  packageFileName,
  parseVersion,
} from "../../../scripts/release/lib/version.mjs";
import {
  VerifyError,
  verifyPackage,
} from "../../../scripts/release/verify.mjs";
import { ActionNeededError, UsageError } from "./errors.mjs";

export { VerifyError, compareVersions, parseVersion };

export const RELEASES =
  "https://github.com/shreyashp47/cafemenu/releases/download";

/** "1.4.2" from "v1.4.2"; throws UsageError for anything that isn't a release version. */
export function releaseVersion(text) {
  try {
    return parseVersion(text).version;
  } catch (error) {
    throw new UsageError(error.message);
  }
}

/** The two asset URLs of a published release (public: no token). */
export function assetUrls(version) {
  return {
    archive: `${RELEASES}/v${version}/${packageFileName(version)}`,
    sums: `${RELEASES}/v${version}/${SUMS}`,
  };
}

async function download(fetchImpl, url) {
  // GitHub answers with a redirect to its storage host, which fetch follows.
  // No Authorization header: the repository is public, and the token the
  // deployer holds is Google's.
  const res = await fetchImpl(url, { method: "GET" });
  if (res.status === 404) {
    throw new ActionNeededError(`${url} doesn't exist.`, {
      hint: "Check the version: it must be a published release of github.com/shreyashp47/cafemenu.",
    });
  }
  if (!res.ok) throw new Error(`GET ${url} failed (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * The verified package: {manifest, files: Map(path → Buffer), sha256,
 * checkedAgainst}. `packagePath` is a local archive with SHA256SUMS next to
 * it; without one, both are downloaded into a temporary folder that is
 * removed again. `sha256` is an expected hash from somewhere trusted more
 * than the release itself. Throws VerifyError for any problem.
 */
export async function getPackage(ctx, { version, packagePath, sha256 }) {
  const { log } = ctx;
  log.step(`Release package ${version}`);
  let verified;
  if (packagePath) {
    log.info(`from ${packagePath}`);
    verified = await verifyPackage(packagePath, { version, sha256 });
  } else {
    const urls = assetUrls(version);
    log.info(`from ${urls.archive}`);
    const dir = await mkdtemp(join(tmpdir(), "cafemenu-release-"));
    try {
      const archivePath = join(dir, packageFileName(version));
      const [archive, sums] = await Promise.all([
        download(ctx.fetchImpl, urls.archive),
        download(ctx.fetchImpl, urls.sums),
      ]);
      await writeFile(archivePath, archive);
      await writeFile(join(dir, SUMS), sums);
      verified = await verifyPackage(archivePath, { version, sha256 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  const { manifest } = verified;
  log.same(
    `verified: sha256 ${verified.sha256.slice(0, 12)}… matches ${verified.checkedAgainst.join(" and ")}, and all ${manifest.files.length} files match release.json`,
  );
  log.info(
    `${manifest.version} (${manifest.channel}), schema ${manifest.schemaVersion} (min ${manifest.minSchemaVersion}), commit ${manifest.gitSha.slice(0, 12)}`,
  );
  return verified;
}

/** A file of the package as text. */
export const packageText = (verified, path) =>
  verified.files.get(path).toString("utf8");
