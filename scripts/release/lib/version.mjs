/**
 * Release versions and channels.
 *
 * A release is tagged vX.Y.Z (stable) or vX.Y.Z-beta.N / vX.Y.Z-rc.N (beta).
 * Anything else is refused, including valid semver such as -alpha.1 or +build:
 * the deployer only knows these two channels, and a tag it cannot place should
 * fail the release rather than ship to nobody, or to everybody.
 */

import { PACKAGE_NAME } from "./layout.mjs";

const NUMBER = "(0|[1-9]\\d*)";
const VERSION = new RegExp(
  `^${NUMBER}\\.${NUMBER}\\.${NUMBER}(?:-(beta|rc)\\.${NUMBER})?$`,
);

/**
 * Parses "v0.1.0-beta.1" or "0.1.0-beta.1". Throws on anything that is not a
 * release version.
 */
export function parseVersion(input) {
  const text = String(input);
  const version = text.startsWith("v") ? text.slice(1) : text;
  const match = VERSION.exec(version);
  const numbers = match
    ? [match[1], match[2], match[3], match[5]].filter(Boolean).map(Number)
    : [];
  if (!match || !numbers.every(Number.isSafeInteger)) {
    throw new Error(
      `"${text}" is not a release version: use vX.Y.Z, vX.Y.Z-beta.N or vX.Y.Z-rc.N`,
    );
  }
  const [, major, minor, patch, label, number] = match;
  return {
    version,
    tag: `v${version}`,
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: label ? { label, number: Number(number) } : null,
    channel: label ? "beta" : "stable",
    // The minor line an owner can stay on ("Stay on 1.4") while patches apply.
    line: `${major}.${minor}`,
  };
}

/** Semver precedence: negative if a < b, positive if a > b, 0 if equal. */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (const key of ["major", "minor", "patch"])
    if (x[key] !== y[key]) return x[key] - y[key];

  // A release outranks its own prereleases; "beta" < "rc" as plain text, as
  // semver compares them.
  if (!x.prerelease || !y.prerelease)
    return (x.prerelease ? -1 : 0) - (y.prerelease ? -1 : 0);

  if (x.prerelease.label !== y.prerelease.label)
    return x.prerelease.label < y.prerelease.label ? -1 : 1;

  return x.prerelease.number - y.prerelease.number;
}

/** cafemenu-cafe-0.1.0-beta.1.tar.gz */
export function packageFileName(version) {
  return `${PACKAGE_NAME}-${parseVersion(version).version}.tar.gz`;
}
