/**
 * The support window as the owner area shows it (#35; docs/releases.md, "The
 * support window"): only the latest two minor lines are supported, and a cafe
 * that stays on an older one is told to upgrade by a date. The maths is
 * @cafemenu/shared's, the same the backend's email and the deployer's forced
 * move use; this only turns it into what the page says. Pure, so every case
 * is tested without a browser.
 */

import { supportNotice, supportWindow } from "@cafemenu/shared/support-window";
import type { CafeRelease, Release } from "../platform/model";
import { upgradeOffer } from "./updates";

export interface SupportView {
  /** The minor line the cafe stays on: "1.3". */
  line: string;
  /** The last day to upgrade, as that day's midnight UTC. Null if not yet known. */
  upgradeBy: number | null;
  /** Whole days left counting today; 0 once the date has passed. */
  daysLeft: number | null;
  /** The date has passed: CafeMenu moves the cafe in its next update. */
  due: boolean;
  /** The lines that are supported now, newest first: ["1.5", "1.4"]. */
  supported: string[];
  /** The version Upgrade would put on, or null if there is nothing to upgrade to. */
  target: string | null;
}

/**
 * The notice for a cafe, or null when it needs none: it follows a channel
 * rather than a line, its line is supported, or the releases aren't known
 * (not loaded, or none published), because a guess would frighten for nothing.
 */
export function supportView(
  release: CafeRelease,
  releases: readonly Release[],
  now: number,
): SupportView | null {
  const notice = supportNotice(release, releases, now);
  if (!notice) return null;
  return {
    line: notice.line,
    upgradeBy: notice.upgradeBy,
    daysLeft: notice.daysLeft,
    due: notice.due,
    supported: supportWindow(releases).supported,
    target: upgradeOffer(release, releases)?.release.version ?? null,
  };
}

/** The lines supported now, newest first; empty before two releases exist. */
export function supportedLines(releases: readonly Release[]): string[] {
  return supportWindow(releases).supported;
}
