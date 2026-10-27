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
 * One exception, the support window (docs/releases.md): a cafe pinned to a
 * minor line that is no longer supported, and past the date it was told to
 * upgrade by, gets the stable release of a supported line instead of waiting
 * for a patch that will never come. That is a "forced move"; the plan marks
 * the cafe with it, and the rollout records why.
 *
 * Which order. The canary (TOE, marked `canary` in the list) first, then the
 * beta cafes, then the stable and pinned cafes, the last two in batches of
 * `batchSize` that go one after another.
 *
 * When to stop. A rollout pauses when failures in a batch cross a threshold:
 * any failure in the canary wave, otherwise more than `failurePercent` of the
 * batch (default 20%, "more than 1 in 5").
 */
import { lineSupport } from "@cafemenu/shared/support-window";

import { compareVersions, parseVersion } from "./release-package.mjs";

export const WAVES = ["canary", "beta", "stable"];
export const DEFAULT_BATCH_SIZE = 5;
export const DEFAULT_FAILURE_PERCENT = 20;

/**
 * Whether `cafe` is to be moved off its pinned line by `version`: it is
 * pinned to a line outside the window whose date has come, and `version` is a
 * stable release of a supported line. {line, upgradeBy, droppedAt} or null.
 *
 * `support` is the support window as the plan takes it: `{window, now}`, with
 * `window` from `supportWindow(releases)` of @cafemenu/shared/support-window
 * and `now` a Date. Without one, nothing is forced.
 */
export function forcedMove(cafe, version, support) {
  const { pinned } = cafe.release;
  const wanted = parseVersion(version);
  if (!support || !pinned || wanted.channel !== "stable") return null;
  if (wanted.line === pinned) return null;
  if (!support.window.supported.includes(wanted.line)) return null;
  const standing = lineSupport(support.window, pinned, support.now);
  if (standing.supported || !standing.due) return null;
  return {
    line: pinned,
    upgradeBy: standing.upgradeBy,
    moveAt: standing.moveAt,
    droppedAt: standing.droppedAt,
  };
}

const day = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Why a forced move happened, in a line: what the rollout records and prints. */
export const forcedReason = (forced, version) =>
  `pinned to ${forced.line}, which stopped being supported on ${day(forced.droppedAt)}; its upgrade-by date, ${day(forced.upgradeBy)}, has passed, so it moves to ${version}`;

/**
 * What the plan does with `cafe` for `version`: {skip, forced}. `skip` is why
 * the cafe should not get it (or null if it should); `forced` is the forced
 * move that is why it does (or null). `cafe` is a CafeDirectory cafe:
 * {status, release: {channel, pinned, current}}.
 */
export function assess(cafe, version, support) {
  const { channel, pinned, current } = cafe.release;
  const wanted = parseVersion(version);
  let forced = null;
  if (cafe.status !== "live")
    return { skip: `its status is ${cafe.status}, not live`, forced };
  if (pinned) {
    if (wanted.channel === "beta")
      return {
        skip: `pinned to ${pinned}, which only gets stable patches`,
        forced,
      };
    if (wanted.line !== pinned) {
      forced = forcedMove(cafe, version, support);
      if (!forced) {
        const standing = support?.window.supported.includes(wanted.line)
          ? lineSupport(support.window, pinned, support.now)
          : null;
        return {
          skip:
            `pinned to ${pinned}, and ${version} is a release of ${wanted.line}` +
            (standing && !standing.supported && standing.upgradeBy
              ? `; ${pinned} is no longer supported, so it moves from ${day(standing.moveAt)}`
              : ""),
          forced,
        };
      }
    }
  } else if (wanted.channel === "beta" && channel !== "beta") {
    return {
      skip: `on the stable channel, and ${version} is a beta`,
      forced,
    };
  }
  if (current) {
    const order = compareVersions(current, version);
    if (order === 0) return { skip: `already runs ${version}`, forced: null };
    if (order > 0)
      return {
        skip: `runs ${current}, which is newer: a cafe never moves down`,
        forced: null,
      };
  }
  return { skip: null, forced };
}

/** Why `cafe` should not get `version`, or null if it should. */
export const skipReason = (cafe, version, support) =>
  assess(cafe, version, support).skip;

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
 * `leaveOut` (already done by an earlier run) are in neither list. A cafe
 * that is being moved off an unsupported line carries `forced` (forcedMove).
 */
export function planRollout(
  cafes,
  version,
  { batchSize = DEFAULT_BATCH_SIZE, leaveOut = new Set(), support = null } = {},
) {
  const byWave = { canary: [], beta: [], stable: [] };
  const skipped = [];
  for (const cafe of cafes) {
    if (leaveOut.has(cafe.id)) continue;
    const { skip, forced } = assess(cafe, version, support);
    if (skip) skipped.push({ cafe, reason: skip });
    else byWave[waveOf(cafe)].push(forced ? { ...cafe, forced } : cafe);
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
