/**
 * Who works on a deployment right now. A deployment is picked up by a
 * Firestore trigger, which Cloud Functions delivers at least once and retries
 * after a failure, so two invocations can meet. The one that holds the lease
 * (renewed while it works) runs; the other waits or goes away.
 */

export const LEASE_MS = 2 * 60_000;
export const HEARTBEAT_MS = 30_000;
/** Times a deployment may be picked up: the first, and three retries. */
export const MAX_ATTEMPTS = 4;
/** A queued or running deployment this old, with no heartbeat, is dead. */
export const DEAD_AFTER_MS = 2 * 60 * 60_000;

export const FINISHED = ["succeeded", "failed", "rolled-back"];

/**
 * What to do with a deployment when an invocation `by` finds it at `now`
 * (ms): {outcome, patch}.
 *
 *   finished   it is already done: nothing to do
 *   busy       another invocation holds the lease: retry later
 *   exhausted  it was picked up MAX_ATTEMPTS times already: give up
 *   claimed    it is ours; `patch` marks it running with a new lease
 */
export function decideClaim(
  deployment,
  { by, now, leaseMs = LEASE_MS, maxAttempts = MAX_ATTEMPTS },
) {
  if (!deployment) return { outcome: "missing" };
  if (FINISHED.includes(deployment.status)) return { outcome: "finished" };
  const held = deployment.lease && deployment.lease.until > now;
  if (deployment.status === "running" && held) return { outcome: "busy" };
  const attempts = deployment.attempts ?? 0;
  if (attempts >= maxAttempts) return { outcome: "exhausted" };
  return {
    outcome: "claimed",
    patch: {
      status: "running",
      attempts: attempts + 1,
      lease: { by, until: now + leaseMs },
    },
  };
}

/** Whether a queued or running deployment is long dead and no longer blocks the cafe. */
export function isDead(deployment, now) {
  const last = Math.max(
    deployment.lease?.until ?? 0,
    deployment.createdAt ?? 0,
  );
  return now - last > DEAD_AFTER_MS;
}
