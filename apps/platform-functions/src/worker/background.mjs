/**
 * The owner emails and the support window, as jobs of the worker (#77). On
 * Blaze, Firestore triggers send these when a release is written
 * (notifyOnRelease); a GitHub Actions job has no triggers, so it looks for
 * what changed instead, and calls the same code (mail/notify.mjs):
 *
 *   release emails   at most every JOBS_EVERY_MS, the releases are compared
 *                    with what the worker saw last time (`backend/worker`).
 *                    Each release that is new, or whose channel or withdrawn
 *                    flag changed, goes through notifyRelease with its old and
 *                    new state, exactly as the trigger would have had it.
 *   support window   once a day, every cafe that stays on a line the window
 *                    has dropped is told to upgrade by its date
 *                    (upgrade-required). An email goes once per line and
 *                    date, so a day that finds nothing new sends nothing.
 *
 * The first run on a platform only remembers the releases there are: it
 * doesn't announce every release ever made. Failed deployments are emailed
 * about as the worker finishes them (requests.mjs), not here.
 *
 * Forcing cafes off a dropped line once the date has passed is still the
 * rollout's job (`deployer rollout`), as it is on Blaze.
 */
import { compareVersions } from "@cafemenu/deployer";

import { notifyRelease } from "../mail/notify.mjs";

/** How often the release emails are looked for. */
export const JOBS_EVERY_MS = 60 * 60_000;
/** How often the support window's notices are looked for. */
export const SUPPORT_EVERY_MS = 24 * 60 * 60_000;

const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const byVersion = (a, b) => {
  try {
    return compareVersions(a.version, b.version);
  } catch {
    return a.version < b.version ? -1 : a.version > b.version ? 1 : 0;
  }
};

/** What the worker remembers of a release: what the emails depend on. */
const seenOf = (release) => ({
  channel: release.channel ?? null,
  withdrawn: release.withdrawn === true,
});

const changedSince = (seen, release) =>
  !seen ||
  seen.channel !== (release.channel ?? null) ||
  seen.withdrawn !== (release.withdrawn === true);

const total = (results, key) =>
  results.reduce((n, result) => n + result[key].length, 0);

/**
 * Runs the jobs that are due (all of them with `force`). Returns
 * {ran, announced, support, sent, skipped, failed}.
 */
export async function runBackgroundJobs(env, { force = false } = {}) {
  const now = env.now().getTime();
  const state = (await env.store.getWorkerState()) ?? {};
  const ranAt = typeof state.jobsRanAt === "number" ? state.jobsRanAt : null;
  if (!force && ranAt !== null && now - ranAt < JOBS_EVERY_MS) {
    return { ran: false };
  }

  const releases = (await env.store.listReleases()).sort(byVersion);
  const seen = isPlainObject(state.releases) ? state.releases : null;
  const results = [];
  const announced = [];
  if (seen) {
    for (const release of releases) {
      const before = seen[release.version] ?? null;
      if (!changedSince(before, release)) continue;
      announced.push(release.version);
      results.push(
        await notifyRelease(env, {
          before: before && { ...before, version: release.version },
          after: release,
        }),
      );
    }
  }

  let supportAt =
    typeof state.supportCheckedAt === "number" ? state.supportCheckedAt : null;
  const supportDue =
    force || supportAt === null || now - supportAt >= SUPPORT_EVERY_MS;
  if (supportDue && releases.length) {
    // The same release as before and after: nothing is announced, and every
    // cafe on a dropped line is looked at.
    const newest = releases.at(-1);
    results.push(await notifyRelease(env, { before: newest, after: newest }));
    supportAt = now;
  }

  await env.store.setWorkerState({
    releases: Object.fromEntries(releases.map((r) => [r.version, seenOf(r)])),
    jobsRanAt: now,
    supportCheckedAt: supportAt,
  });
  return {
    ran: true,
    announced,
    support: supportDue && releases.length > 0,
    sent: total(results, "sent"),
    skipped: total(results, "skipped"),
    failed: total(results, "failed"),
  };
}
