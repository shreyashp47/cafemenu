/**
 * The backend as one run of a job (#77): what the GitHub Actions workflow
 * (.github/workflows/backend.yml) does every 5 minutes, for free, in place
 * of the Cloud Functions that would need Blaze. The functions stay
 * (index.mjs); both call the same handlers, so either can run the platform.
 *
 * One run:
 *
 *   1. requests   the queued requests (and running ones whose run died),
 *                 oldest first but taking turns between cafes, so one cafe
 *                 asking a lot can't hold everyone else up. Each is claimed
 *                 in a transaction and done (requests.mjs). A run stops
 *                 taking new ones after `budgetMs` or `maxRequests`; the rest
 *                 wait for the next run.
 *   2. deployments  any queued deployment no request of this run has worked
 *                 on: one a request put back to wait, or one queued some
 *                 other way (a callable on Blaze, a rollout). On Blaze a
 *                 trigger runs these; here the run does.
 *   3. jobs       the owner emails and the support window (background.mjs),
 *                 when they are due.
 *
 * Returns a summary of what it did, with no personal data in it, which is
 * all the workflow's public log shows.
 */
import { toMillis } from "@cafemenu/shared/support-window";

import { RetryLater } from "../errors.mjs";
import { runBackgroundJobs } from "./background.mjs";
import { processRequest, runAndTell } from "./requests.mjs";

/** A run starts no new request or deployment after this long. */
export const WORKER_BUDGET_MS = 5 * 60_000;
/** The most requests one run answers. */
export const MAX_REQUESTS_PER_RUN = 25;
/** How many open requests a run reads, to share its turns among cafes. */
export const READ_AHEAD = 100;
/** How many queued deployments a run looks at. */
export const MAX_DEPLOYMENTS_PER_RUN = 10;

/**
 * Oldest first, but taking turns: each cafe's oldest request, then each
 * cafe's second, and so on. Cafes come in the order of their oldest request.
 */
export function fairOrder(requests) {
  const byCafe = new Map();
  for (const request of requests) {
    const list = byCafe.get(request.cafeId) ?? [];
    list.push(request);
    byCafe.set(request.cafeId, list);
  }
  const lists = [...byCafe.values()];
  const ordered = [];
  for (let turn = 0; ordered.length < requests.length; turn += 1) {
    for (const list of lists) if (list[turn]) ordered.push(list[turn]);
  }
  return ordered;
}

async function runQueuedDeployment(env, id, { runId }) {
  try {
    const { ran } = await runAndTell(env, id, { runId });
    return { id, outcome: ran.outcome };
  } catch (error) {
    if (error instanceof RetryLater) return { id, outcome: "later" };
    env.log("error", "A deployment failed unexpectedly", {
      deployment: id,
      error: error.stack ?? error.message,
    });
    return { id, outcome: "error" };
  }
}

export async function runWorker(
  env,
  {
    runId,
    budgetMs = WORKER_BUDGET_MS,
    maxRequests = MAX_REQUESTS_PER_RUN,
    jobs = false,
  },
) {
  const started = env.now().getTime();
  const outOfTime = () => env.now().getTime() - started >= budgetMs;
  const touched = new Set();
  const summary = { requests: [], deployments: [], jobs: { ran: false } };

  const now = env.now().getTime();
  // A request waiting for its date (a suspension's notice) isn't touched.
  const due = (r) => !r.notBefore || toMillis(r.notBefore) <= now;
  const open = fairOrder(
    (await env.store.listActiveRequests(READ_AHEAD)).filter(due),
  );
  for (const request of open) {
    const answered = summary.requests.filter((r) => r.outcome !== "skipped");
    if (answered.length >= maxRequests || outOfTime()) break;
    summary.requests.push(
      await processRequest(env, request.id, { runId, touched }),
    );
  }

  for (const deployment of await env.store.listActiveDeployments(
    MAX_DEPLOYMENTS_PER_RUN,
  )) {
    if (touched.has(deployment.id)) continue;
    if (outOfTime()) break;
    summary.deployments.push(
      await runQueuedDeployment(env, deployment.id, { runId }),
    );
  }

  summary.jobs = await runBackgroundJobs(env, { force: jobs });
  return summary;
}

/** Whether a run went wrong in a way the maintainer should hear about. */
export const hadUnexpected = (summary) =>
  summary.requests.some((r) => r.code === "unexpected") ||
  summary.deployments.some((d) => d.outcome === "error");
