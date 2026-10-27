/**
 * The Updates section of the owner area (#29) as data: which of the three
 * ways to follow releases a cafe is on, what Upgrade would deploy, where
 * Roll back goes, and whether a request may be made right now. Pure, so every
 * case is tested without a browser; the components only show it.
 *
 * The owner chooses a channel and perhaps a minor line (`CafeRelease`); the
 * backend decides when a version is deployed. Upgrade and Roll back are the
 * owner asking it to do that now (see DeployRequests in data/types.ts).
 */

import type {
  BackendRequest,
  Cafe,
  CafeRelease,
  Deployment,
  DeploymentStatus,
  Release,
  ReleaseChannel,
} from "../platform/model";
import { compareVersionsDesc } from "../platform/parse";
import { minorLineOf, type ReleaseChoice } from "../platform/validate";
import { hasOpenRequest } from "./requests";

// -- how the cafe follows releases ---------------------------------------------

/**
 *   stable  every new stable version (the default)
 *   beta    new versions first: beta releases, and stable ones too
 *   pinned  stay on one minor line ("1.4"); its patches still apply, so
 *           security fixes reach everyone
 */
export const UPDATE_MODES = ["stable", "beta", "pinned"] as const;
export type UpdateMode = (typeof UPDATE_MODES)[number];

export function updateModeOf(release: CafeRelease): UpdateMode {
  return release.pinned !== null ? "pinned" : release.channel;
}

/**
 * The minor line "Stay on" would name: the one already chosen, else the one
 * the cafe runs now. Null before the first deploy, when there is no line to
 * stay on yet.
 */
export function pinLineOf(release: CafeRelease): string | null {
  if (release.pinned !== null) return release.pinned;
  return release.current ? minorLineOf(release.current) : null;
}

export interface UpdateOption {
  mode: UpdateMode;
  /** The line "Stay on" names; null for the other two. */
  line: string | null;
  /** Staying on a line needs one: not offered before the first deploy. */
  disabled: boolean;
}

/** The three choices, in the order they are shown. */
export function updateOptions(release: CafeRelease): UpdateOption[] {
  const line = pinLineOf(release);
  return [
    { mode: "stable", line: null, disabled: false },
    { mode: "beta", line: null, disabled: false },
    { mode: "pinned", line, disabled: line === null },
  ];
}

/**
 * What choosing `mode` saves. Staying on a line keeps the channel the cafe
 * is on, so its patches come from the same place.
 */
export function choiceFor(
  release: CafeRelease,
  mode: UpdateMode,
): ReleaseChoice {
  if (mode === "pinned") {
    return { channel: release.channel, pinned: pinLineOf(release) };
  }
  return { channel: mode, pinned: null };
}

export const choiceOf = (release: CafeRelease): ReleaseChoice => ({
  channel: release.channel,
  pinned: release.pinned,
});

export const sameChoice = (a: ReleaseChoice, b: ReleaseChoice) =>
  a.channel === b.channel && a.pinned === b.pinned;

// -- what is available ----------------------------------------------------------

/**
 * Stable cafes follow stable releases. Beta cafes follow all of them: a
 * release is published to beta and promoted to stable, so a stable one is
 * also one beta has already had (model.ts, `RELEASE_CHANNELS`).
 */
export function followsChannel(
  channel: ReleaseChannel,
  release: Pick<Release, "channel">,
): boolean {
  return channel === "beta" || release.channel === "stable";
}

/** Releases this cafe could be on, newest first; withdrawn ones are gone. */
export function availableReleases(
  release: CafeRelease,
  releases: readonly Release[],
): Release[] {
  return releases
    .filter((r) => !r.withdrawn && followsChannel(release.channel, r))
    .sort((a, b) => compareVersionsDesc(a.version, b.version));
}

export interface UpgradeOffer {
  release: Release;
  /**
   * The cafe stays on a line and this release is on another: upgrading moves
   * the line it stays on, so the next patch of the old one does not undo it.
   */
  movesLine: boolean;
}

const isNewer = (version: string, than: string) =>
  compareVersionsDesc(version, than) < 0;

/**
 * What Upgrade deploys: the newest release the cafe follows that is newer
 * than the one it runs. Staying on a line, a newer patch of that line comes
 * first; only without one is a newer line offered. Null when there is
 * nothing newer, or nothing deployed yet (setup does the first deploy).
 */
export function upgradeOffer(
  release: CafeRelease,
  releases: readonly Release[],
): UpgradeOffer | null {
  const { current, pinned } = release;
  if (!current) return null;
  const newer = availableReleases(release, releases).filter((r) =>
    isNewer(r.version, current),
  );
  if (pinned === null) {
    return newer[0] ? { release: newer[0], movesLine: false } : null;
  }
  const inLine = newer.find((r) => minorLineOf(r.version) === pinned);
  if (inLine) return { release: inLine, movesLine: false };
  return newer[0] ? { release: newer[0], movesLine: true } : null;
}

/** The version Roll back goes to, or null when there is none to go to. */
export function rollbackTarget(release: CafeRelease): string | null {
  const { current, previous } = release;
  return previous && previous !== current ? previous : null;
}

/** The notes of `version`, or null when its release record is not there. */
export function releaseOf(
  version: string | null,
  releases: readonly Release[],
): Release | null {
  return version ? (releases.find((r) => r.version === version) ?? null) : null;
}

// -- requests ---------------------------------------------------------------------

export const ACTIVE_STATUSES: readonly DeploymentStatus[] = [
  "queued",
  "running",
];

/** Newest first, as the repository returns them. */
export function activeDeployment(
  deployments: readonly Deployment[],
): Deployment | null {
  return deployments.find((d) => ACTIVE_STATUSES.includes(d.status)) ?? null;
}

export type RequestState =
  /** The buttons work. */
  | "ready"
  /** Not live: nothing is deployed to upgrade or roll back. */
  | "not-live"
  /** Another deployment is queued or running, or asked for: one at a time. */
  | "busy";

export function requestState(
  cafe: Pick<Cafe, "status">,
  deployments: readonly Deployment[],
  requests: readonly BackendRequest[] = [],
): RequestState {
  if (cafe.status !== "live") return "not-live";
  return activeDeployment(deployments) || hasOpenRequest(requests)
    ? "busy"
    : "ready";
}

/** The newest deployment that has finished, if any: how the last one went. */
export function lastFinished(
  deployments: readonly Deployment[],
): Deployment | null {
  return deployments.find((d) => !ACTIVE_STATUSES.includes(d.status)) ?? null;
}
