/**
 * Who gets a release, and in what order: the pure part of `deployer rollout`.
 *
 * Which cafes. Each cafe's `release` says what it follows (PLAN.md,
 * "Releases"): the stable channel, the beta channel, or a pin to a minor line
 * ("Stay on 1.4"). For one version:
 *
 *   - a beta or rc goes to beta cafes only: stable and pinned cafes never see
 *     one;
 *   - a stable release goes to stable and beta cafes (a beta cafe has to
 *     reach the release its beta led up to), except that a cafe pinned to a
 *     minor line gets it only if it is a release of that line, i.e. a patch;
 *   - a cafe never moves down: the version it runs, or a newer one, is
 *     skipped;
 *   - only live cafes get a release.
 *
 * Which order. The canary (TOE, marked `canary` in the list) first, then the
 * beta cafes, then the stable and pinned cafes, the last two in batches of
 * `batchSize` that go one after another.
 *
 * When to stop. A rollout pauses when failures in a batch cross a threshold:
 * any failure in the canary wave, otherwise more than `failurePercent` of the
 * batch (default 20%, "more than 1 in 5").
 */
import { compareVersions, parseVersion } from "./release-package.mjs";

export const WAVES = ["canary", "beta", "stable"];
export const DEFAULT_BATCH_SIZE = 5;
export const DEFAULT_FAILURE_PERCENT = 20;

/**
 * Why `cafe` should not get `version`, or null if it should. `cafe` is a
 * CafeDirectory cafe: {status, release: {channel, pinned, current}}.
 */
export function skipReason(cafe, version) {
  const { channel, pinned, current } = cafe.release;
  const wanted = parseVersion(version);
  if (cafe.status !== "live") return `its status is ${cafe.status}, not live`;
  if (pinned) {
    if (wanted.channel === "beta")
      return `pinned to ${pinned}, which only gets stable patches`;
    if (wanted.line !== pinned)
      return `pinned to ${pinned}, and ${version} is a release of ${wanted.line}`;
  } else if (wanted.channel === "beta" && channel !== "beta") {
    return `on the stable channel, and ${version} is a beta`;
  }
  if (current) {
    const order = compareVersions(current, version);
    if (order === 0) return `already runs ${version}`;
    if (order > 0)
      return `runs ${current}, which is newer: a cafe never moves down`;
  }
  return null;
}

/** The wave a cafe that gets the release belongs to. */
export function waveOf(cafe) {
  if (cafe.canary) return "canary";
  if (cafe.release.pinned) return "stable";
  return cafe.release.channel === "beta" ? "beta" : "stable";
}

function chunks(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Splits `cafes` into the waves for `version`:
 *   {waves: [{name, batches: [[cafe, …], …]}], skipped: [{cafe, reason}]}
 * Waves nobody is in are left out. The canary wave is one batch. Cafes in
 * `leaveOut` (already done by an earlier run) are in neither list.
 */
export function planRollout(
  cafes,
  version,
  { batchSize = DEFAULT_BATCH_SIZE, leaveOut = new Set() } = {},
) {
  const byWave = { canary: [], beta: [], stable: [] };
  const skipped = [];
  for (const cafe of cafes) {
    if (leaveOut.has(cafe.id)) continue;
    const reason = skipReason(cafe, version);
    if (reason) skipped.push({ cafe, reason });
    else byWave[waveOf(cafe)].push(cafe);
  }
  const waves = WAVES.map((name) => ({
    name,
    batches: chunks(byWave[name], name === "canary" ? Infinity : batchSize),
  })).filter((wave) => wave.batches.length > 0);
  return { waves, skipped };
}

/**
 * Whether `failures` in a batch of `size` cafes pause the rollout: any in the
 * canary wave, otherwise more than `failurePercent` of the batch. (Integers
 * only, so 1 in 5 is not "more than 20%".)
 */
export function crossesThreshold(
  wave,
  { failures, size, failurePercent = DEFAULT_FAILURE_PERCENT },
) {
  if (wave === "canary") return failures > 0;
  return failures * 100 > failurePercent * size;
}
