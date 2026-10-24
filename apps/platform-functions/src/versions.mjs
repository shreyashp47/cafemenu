/** Which release a cafe gets: its channel and pin applied to the published releases. */
import { compareVersions, parseVersion } from "@cafemenu/deployer";

const parsed = (version) => {
  try {
    return parseVersion(version);
  } catch {
    return null;
  }
};

/** "1.4" for "1.4.2" and "1.5.0-beta.1". */
export const minorLine = (version) => parsed(version)?.line ?? null;

/** Whether `version` is written the way a release is ("1.4.2", not "v1.4.2"). */
export const isReleaseVersion = (version) =>
  typeof version === "string" && parsed(version)?.version === version;

/**
 * The releases a cafe on `channel` may be moved to: published and not
 * withdrawn, and for a stable cafe only stable ones. A beta cafe takes both,
 * since a stable release is also what a beta cafe is waiting for.
 */
export function eligibleReleases(releases, channel) {
  return releases
    .filter(
      (r) =>
        isReleaseVersion(r.version) &&
        r.withdrawn !== true &&
        (channel === "beta" || r.channel === "stable"),
    )
    .sort((a, b) => compareVersions(b.version, a.version));
}

/**
 * The newest release for a cafe's `{channel, pinned}`: what its first deploy
 * puts online. Null when there is none yet.
 */
export function pickRelease(releases, { channel, pinned }) {
  const list = eligibleReleases(releases, channel);
  return (
    (pinned ? list.filter((r) => minorLine(r.version) === pinned) : list)[0] ??
    null
  );
}
