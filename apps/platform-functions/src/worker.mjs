/**
 * One run of the worker: what `.github/workflows/backend.yml` does every five
 * minutes in place of Cloud Functions (issue #77).
 *
 *   1. the console's requests, oldest first (requests.mjs): each is claimed,
 *      run with the handlers the callables use, and finished with its result;
 *   2. the periodic jobs the Cloud Functions ran on events, now on a timer:
 *      the emails about a new release and about a support window that is
 *      closing (#34, #35). They look at the whole platform, so they run at
 *      most once an hour, not on every run.
 *
 * `env` is runtime.mjs's: the store, Google, mail, the clock. A run never
 * throws for a request that fails (that is written onto the request); what it
 * throws is the platform itself being out of reach, which should fail the
 * workflow run.
 */
import { notifyRelease } from "./mail/notify.mjs";
import { processRequest } from "./requests.mjs";
import { eligibleReleases } from "./versions.mjs";

/** Requests taken per run; the rest wait for the next one. */
export const MAX_REQUESTS = 20;
/** No new request is started after this long, so the run ends inside the workflow's timeout. */
export const START_BUDGET_MS = 10 * 60_000;
export const HOUR_MS = 60 * 60_000;

/**
 * The emails about releases and the support window. The newest stable release
 * is looked at as if it had just been written: a cafe that was told already is
 * not told again (mail/notify.mjs records each email), and a cafe on a line
 * the window has dropped gets its upgrade notice, whichever release is newest.
 */
export async function sendReleaseMail(env) {
  const releases = await env.store.listReleases();
  const newest = eligibleReleases(releases, "stable")[0];
  if (!newest) return { sent: [], skipped: [], failed: [] };
  return notifyRelease(env, { before: null, after: newest });
}

export async function runWorker(
  env,
  {
    by,
    maxRequests = MAX_REQUESTS,
    startBudgetMs = START_BUDGET_MS,
    mailEveryMs = HOUR_MS,
  },
) {
  const started = env.now().getTime();
  const summary = { requests: [], mail: null, errors: [] };

  const open = await env.store.listOpenRequests(maxRequests);
  for (const { id } of open) {
    if (env.now().getTime() - started > startBudgetMs) {
      env.log("warn", "Out of time for this run; the rest wait for the next");
      break;
    }
    try {
      summary.requests.push(await processRequest(env, id, { by }));
    } catch (error) {
      // Only a platform that can't be read or written gets here.
      env.log("error", "A request could not be processed", {
        request: id,
        error: error.stack ?? error.message,
      });
      summary.errors.push({ request: id, error: error.message });
    }
  }

  try {
    if (await env.store.claimJob("mail", env.now().getTime(), mailEveryMs)) {
      summary.mail = await sendReleaseMail(env);
    }
  } catch (error) {
    env.log("error", "The email job failed", {
      error: error.stack ?? error.message,
    });
    summary.errors.push({ job: "mail", error: error.message });
  }
  return summary;
}
