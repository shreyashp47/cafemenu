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
 *   the admin log    each release that is new, promoted or withdrawn since
 *                    the last look is written to the admin log (#78), which
 *                    lists publishing a release among the admin's actions.
 *                    The entry's id says what changed, so it is written once.
 *
 *   the directory    at the same hourly pace, every account in the platform's
 *                    Auth is copied to `owners/{uid}` (email, name, sign-up
 *                    and last sign-in, admin, disabled), for the admin's
 *                    owners directory (#78), which a browser can't read from
 *                    Auth itself. Only the entries that changed are written,
 *                    and their status (active or suspended) is left alone.
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

/**
 * What changed about a release, as the admin log's action: published,
 * promoted to stable, or withdrawn. Null for nothing the log keeps.
 */
export function releaseAction(before, release) {
  if (!before) return "publish-release";
  if (release.withdrawn === true && before.withdrawn !== true)
    return "withdraw-release";
  if (release.channel === "stable" && before.channel !== "stable")
    return "promote-release";
  return null;
}

/** The release workflow's entry: no person to name, the version instead. */
async function logRelease(env, action, release) {
  const id = `${action}-${release.version}`;
  await env.store.addAdminLog(id, {
    at: env.now(),
    by: "release-workflow",
    byEmail: null,
    action,
    cafeId: null,
    ownerUid: null,
    reason: null,
    details: { version: release.version, channel: release.channel ?? null },
    requestId: null,
  });
}

const total = (results, key) =>
  results.reduce((n, result) => n + result[key].length, 0);

/** What the directory copies from an account. Times in ms. */
const DIRECTORY_FIELDS = [
  "email",
  "name",
  "createdAt",
  "lastSignInAt",
  "admin",
  "disabled",
];

/**
 * Copies every account to the owners directory, writing only the entries
 * that changed. Returns {accounts, changed}.
 */
export async function syncDirectory(env) {
  const accounts = await env.store.listAccounts();
  const records = await env.store.listOwnerRecords();
  let changed = 0;
  for (const account of accounts) {
    const have = records.get(account.uid) ?? null;
    const want = Object.fromEntries(
      DIRECTORY_FIELDS.map((key) => [key, account[key] ?? null]),
    );
    if (!have?.status) want.status = "active";
    const same =
      have && Object.entries(want).every(([key, value]) => have[key] === value);
    if (same) continue;
    await env.store.setOwnerRecord(account.uid, {
      ...want,
      syncedAt: env.now().getTime(),
    });
    changed += 1;
  }
  return { accounts: accounts.length, changed };
}

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
      const action = releaseAction(before, release);
      if (action) await logRelease(env, action, release);
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

  const directory = await syncDirectory(env);

  await env.store.setWorkerState({
    releases: Object.fromEntries(releases.map((r) => [r.version, seenOf(r)])),
    jobsRanAt: now,
    supportCheckedAt: supportAt,
  });
  return {
    ran: true,
    announced,
    support: supportDue && releases.length > 0,
    directory,
    sent: total(results, "sent"),
    skipped: total(results, "skipped"),
    failed: total(results, "failed"),
  };
}
