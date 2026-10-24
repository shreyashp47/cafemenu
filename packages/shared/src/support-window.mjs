/**
 * The support window (PLAN.md, "Releases"; docs/releases.md, "Support
 * window"): only the latest two minor lines get fixes. A cafe that stays on
 * ("is pinned to") an older line is told to upgrade by a date, and moved on
 * that date.
 *
 * One function, used by the console (the notice in the owner area), the
 * backend (the "upgrade required" email) and the deployer (`rollout`'s forced
 * move), so the three always agree. Plain JavaScript with types in
 * support-window.d.mts, not TypeScript, because the deployer runs on Node 20,
 * which does not strip types.
 *
 * The rules:
 *
 *   - Only published, stable releases count: not a beta or rc, and not one
 *     that was withdrawn. A beta of 1.6 does not push 1.4 out.
 *   - The lines are `major.minor`, compared as numbers (1.10 is newer than
 *     1.9). The supported ones are the newest `supportedLines` (2) of them.
 *   - A line stops being supported the moment the second newer line has had
 *     its first stable release. That time is when it was displaced.
 *   - The owner may upgrade until `upgradeBy`: the displacement time plus
 *     `noticeDays` (30), rounded up to the next midnight UTC, so the notice is
 *     never shorter than that. The day it falls on is the day CafeMenu moves
 *     cafes still on the line: `due` is true from its first moment (00:00 UTC).
 *   - A line nobody published a release of is judged the same way, so a cafe
 *     pinned to a line whose releases were all withdrawn still gets a date.
 *   - With too few dates to know (a release without `publishedAt`), a line is
 *     still unsupported but has no `upgradeBy`, and nothing is forced.
 */

export const SUPPORTED_LINES = 2;
export const NOTICE_DAYS = 30;

const DAY = 86_400_000;
const STABLE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const LINE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Milliseconds from a number, a Date, a date string or a Firestore Timestamp; null if it is none. */
export function toMillis(value) {
  let ms = null;
  if (typeof value === "number") ms = value;
  else if (value instanceof Date) ms = value.getTime();
  else if (typeof value === "string") ms = Date.parse(value);
  else if (typeof value?.toMillis === "function") ms = value.toMillis();
  return Number.isFinite(ms) ? ms : null;
}

/** "1.4" for the stable release "1.4.2"; null for anything else (a beta, "v1.4.2", junk). */
export function stableLineOf(version) {
  const match = typeof version === "string" ? STABLE.exec(version) : null;
  return match ? `${match[1]}.${match[2]}` : null;
}

/** Whether `text` names a minor line: "1.4". */
export const isLine = (text) => typeof text === "string" && LINE.test(text);

/** Positive when line `a` is newer than `b`, as numbers: "1.10" is newer than "1.9". */
export function compareLines(a, b) {
  const [x, y] = [a, b].map((line) => line.split(".").map(Number));
  return x[0] - y[0] || x[1] - y[1];
}

/** The earliest of the dates that are known, or null. */
const earliest = (dates) => {
  const known = dates.filter((d) => d !== null);
  return known.length ? Math.min(...known) : null;
};

/**
 * The lines the published `releases` make up, newest first, and which are
 * supported. `releases`: [{version, channel?, withdrawn?, publishedAt?}], as
 * the platform's `releases` collection holds them. Never throws on a record
 * it can't use; it leaves it out.
 */
export function supportWindow(
  releases,
  { supportedLines = SUPPORTED_LINES, noticeDays = NOTICE_DAYS } = {},
) {
  const byLine = new Map();
  for (const release of releases ?? []) {
    const line = stableLineOf(release?.version);
    if (!line || release.withdrawn === true) continue;
    if (release.channel !== undefined && release.channel !== "stable") continue;
    const dates = byLine.get(line) ?? [];
    dates.push(toMillis(release.publishedAt));
    byLine.set(line, dates);
  }
  const lines = [...byLine]
    .map(([line, dates]) => ({ line, firstPublishedAt: earliest(dates) }))
    .sort((a, b) => compareLines(b.line, a.line));
  return {
    supportedLines,
    noticeDays,
    lines,
    supported: lines.slice(0, supportedLines).map((l) => l.line),
  };
}

/**
 * Where `line` stands in `window` at time `now` (a number, Date or anything
 * toMillis takes): {
 *   line,
 *   supported,   false once `supportedLines` newer lines exist
 *   droppedAt,   when it stopped being supported (ms), or null: supported, or no date to tell
 *   upgradeBy,   the midnight UTC (ms) on which cafes still on it are moved, or null
 *   due,         `now` is at or past upgradeBy
 *   daysLeft,    whole days left until upgradeBy (0 on the day, or after it), or null
 * }
 */
export function lineSupport(window, line, now) {
  const at = toMillis(now);
  const newer = window.lines.filter((l) => compareLines(l.line, line) > 0);
  if (newer.length < window.supportedLines) {
    return {
      line,
      supported: true,
      droppedAt: null,
      upgradeBy: null,
      due: false,
      daysLeft: null,
    };
  }
  // The moment the second (`supportedLines`-th) newer line appeared.
  const dates = newer
    .map((l) => l.firstPublishedAt)
    .filter((d) => d !== null)
    .sort((a, b) => a - b);
  const droppedAt = dates[window.supportedLines - 1] ?? null;
  if (droppedAt === null || at === null) {
    return {
      line,
      supported: false,
      droppedAt,
      upgradeBy: null,
      due: false,
      daysLeft: null,
    };
  }
  const upgradeBy =
    Math.ceil((droppedAt + window.noticeDays * DAY) / DAY) * DAY;
  return {
    line,
    supported: false,
    droppedAt,
    upgradeBy,
    due: at >= upgradeBy,
    daysLeft: Math.max(0, Math.ceil((upgradeBy - at) / DAY)),
  };
}

/**
 * The notice for a cafe: null unless it is pinned to a line that is no longer
 * supported. `release` is the cafe's `release` ({pinned, …}); a cafe that
 * follows a channel is on the newest line anyway and has nothing to be told.
 */
export function supportNotice(release, releases, now, options) {
  if (!isLine(release?.pinned)) return null;
  const standing = lineSupport(
    supportWindow(releases, options),
    release.pinned,
    now,
  );
  return standing.supported ? null : standing;
}
