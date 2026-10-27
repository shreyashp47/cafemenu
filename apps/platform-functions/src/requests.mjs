/**
 * Requests: how the console asks the backend for something when there are no
 * Cloud Functions to call (issue #77, the free way to run this backend).
 *
 * The console writes a `requests/{id}` and watches it. The worker (worker.mjs,
 * run on a schedule by .github/workflows/backend.yml) claims it, does what it
 * asks with the same handlers the callables use (callables.mjs, jobs.mjs), and
 * writes the progress and the result back onto it:
 *
 *   cafeId, ownerUid  the cafe, and its owner (copied, so an owner's query can
 *                     filter on it). null for the admin's `publish` and `rollout`
 *   by                the uid that asked
 *   kind              provision | check | deploy | rollback | sync-branding
 *                     (and the admin's publish | rollout, not run yet)
 *   params            {} · {projectId} · {version}
 *   status            queued → running → done | failed
 *   steps, detail     what is happening, as a deployment shows it
 *   result            what a `check` found, or {deploymentId, status, siteUrl}
 *   error, errorCode  why it failed, in words the owner can act on, and a
 *                     Firebase-style code (the console has words for them)
 *   deploymentId      the deployment a deploy, rollback, sync or setup made
 *   attempts, lease   who works on it (claim.mjs)
 *
 * Only the console writes the first block, only the worker the rest; the rules
 * (apps/console/firestore.rules) hold each side to it. The worker does not
 * trust the document: who asked is looked up in Auth again, and the same
 * checks as the callables run (who owns the cafe, what state it is in).
 */
import { RetryLater, RequestError } from "./errors.mjs";
import { decideClaim } from "./claim.mjs";
import * as calls from "./callables.mjs";
import { runDeployment } from "./jobs.mjs";
import { notifyDeployment } from "./mail/notify.mjs";
import { newSteps } from "./plans.mjs";

/** Times a request may be picked up: the first, and four more after a run ended early. */
export const MAX_REQUEST_ATTEMPTS = 5;
export const REQUEST_FINISHED = ["done", "failed"];

const CHECK_STEPS = [
  { id: "check", label: "Check CafeMenu's access to your project" },
];

/**
 * What each kind runs: the callables.mjs handler, the data it is given from
 * the request's params, and (for the ones that deploy) the deployment kind
 * whose steps it shows.
 */
const CAFE_KINDS = {
  provision: {
    call: calls.startProvisioning,
    data: () => ({}),
    deployment: "provision",
  },
  check: {
    call: calls.checkConnection,
    data: (params) => ({ projectId: params.projectId }),
  },
  deploy: {
    call: calls.requestUpgrade,
    data: (params) => ({ version: params.version }),
    deployment: "deploy",
  },
  rollback: {
    call: calls.requestRollback,
    data: () => ({}),
    deployment: "rollback",
  },
  "sync-branding": {
    call: calls.requestSyncBranding,
    data: () => ({}),
    deployment: "branding",
  },
};

/** Kinds the rules let the admin write that nothing here runs yet (#30, #32). */
const NOT_RUN = ["publish", "rollout"];

export const REQUEST_KINDS = [...Object.keys(CAFE_KINDS), ...NOT_RUN];

const pending = (steps) =>
  steps.map(({ id, label }) => ({ id, label, status: "pending" }));

/** The steps a request shows before it has run: the plan of what it will do. */
export function initialSteps(kind) {
  const spec = CAFE_KINDS[kind];
  if (!spec) return [];
  return spec.deployment ? newSteps(spec.deployment) : pending(CHECK_STEPS);
}

/** A step list after the request ended: what ran is done, what was running failed. */
const settle = (steps, ok) =>
  (steps ?? []).map((s) => ({
    ...s,
    status: ok
      ? s.status === "pending" || s.status === "running"
        ? "done"
        : s.status
      : s.status === "running"
        ? "failed"
        : s.status,
  }));

/**
 * Takes the request for this run, or says why not: {outcome, request} where
 * outcome is claimed | busy | finished | exhausted | missing. Atomic: two
 * runs never both get "claimed" (claim.mjs).
 */
export function claimRequest(env, id, { by }) {
  return env.store.transactRequest(id, (current) => {
    const decision = decideClaim(current, {
      by,
      now: env.now().getTime(),
      maxAttempts: MAX_REQUEST_ATTEMPTS,
      finished: REQUEST_FINISHED,
    });
    const patch =
      decision.patch && !current.steps?.length
        ? { ...decision.patch, steps: initialSteps(current.kind) }
        : decision.patch;
    return {
      patch,
      result: {
        outcome: decision.outcome,
        request: current && { ...current, ...patch },
      },
    };
  });
}

/**
 * Runs one request. Never throws for a request that can't be done (it is
 * written as failed, which is the answer); throws RetryLater when it should
 * be put back and tried again by the next run.
 */
export async function processRequest(env, id, { by }) {
  const claim = await claimRequest(env, id, { by });
  const { request } = claim;
  if (["missing", "finished", "busy"].includes(claim.outcome)) {
    return { id, outcome: claim.outcome };
  }
  if (claim.outcome === "exhausted") {
    await finish(env, request, {
      status: "failed",
      error: `CafeMenu tried ${MAX_REQUEST_ATTEMPTS} times and could not finish.`,
      errorCode: "gave-up",
    });
    return { id, outcome: "failed" };
  }

  try {
    const done = await execute(env, request, { by });
    await finish(env, request, done);
    return { id, kind: request.kind, outcome: done.status };
  } catch (error) {
    if (error instanceof RetryLater) {
      // Back in the queue; the deployment (if there is one) carries on from
      // where it stopped, because the request remembers it.
      await env.store.updateRequest(id, {
        status: "queued",
        lease: null,
        detail: error.message.includes("another run")
          ? "Waiting for another run to finish."
          : "Taking a short break; this carries on by itself.",
      });
      return { id, kind: request.kind, outcome: "queued" };
    }
    if (error instanceof RequestError) {
      await finish(env, request, {
        status: "failed",
        error: error.message,
        errorCode: error.code,
      });
      return { id, kind: request.kind, outcome: "failed", code: error.code };
    }
    env.log("error", "Request failed", {
      request: id,
      kind: request.kind,
      error: error.stack ?? error.message,
    });
    await finish(env, request, {
      status: "failed",
      error: "Something went wrong on CafeMenu's side. Try again in a minute.",
      errorCode: "internal",
    });
    return { id, kind: request.kind, outcome: "failed", code: "internal" };
  }
}

/** Does what the request asks. Returns {status, result?, error?, errorCode?, steps?}. */
async function execute(env, request, { by }) {
  const spec = CAFE_KINDS[request.kind];
  if (!spec) {
    throw new RequestError(
      NOT_RUN.includes(request.kind) ? "unimplemented" : "invalid-argument",
      NOT_RUN.includes(request.kind)
        ? "The backend doesn't run this kind of request yet."
        : "That isn't something the backend can do.",
    );
  }
  // Who asked is looked up again, now, not taken from the document.
  const account = await env.store.getAccount(request.by);
  if (!account) {
    throw new RequestError(
      "permission-denied",
      "That account no longer exists.",
    );
  }
  const call = {
    auth: {
      uid: request.by,
      token: {
        email_verified: account.emailVerified,
        admin: account.admin,
      },
    },
    data: { cafeId: request.cafeId, ...spec.data(request.params ?? {}) },
  };

  if (!spec.deployment) {
    return {
      status: "done",
      result: await spec.call(env, call),
      steps: settle(request.steps, true),
    };
  }

  let { deploymentId } = request;
  if (!deploymentId) {
    ({ deploymentId } = await spec.call(env, call));
    // Remembered at once: a run that stops now picks this deployment up again.
    await env.store.updateRequest(request.id, { deploymentId });
  }
  await runDeployment(
    mirrorProgress(env, request, deploymentId, by),
    deploymentId,
    {
      by,
    },
  );

  const deployment = await env.store.getDeployment(deploymentId);
  if (!deployment) {
    throw new RequestError("not-found", "The update this started is gone.");
  }
  await tellOwnerIfFailed(env, deployment);
  const result = {
    deploymentId,
    status: deployment.status,
    ...(deployment.siteUrl && { siteUrl: deployment.siteUrl }),
  };
  if (deployment.status === "succeeded") {
    return {
      status: "done",
      result,
      steps: deployment.steps ?? settle(request.steps, true),
    };
  }
  return {
    status: "failed",
    result,
    error: deployment.error ?? "The update did not finish.",
    errorCode: deployment.errorCode ?? "failed",
    steps: deployment.steps ?? settle(request.steps, false),
  };
}

/**
 * An env whose deployment writes also go onto the request: its steps and
 * what is happening now, so the console shows progress from the request
 * alone, and its lease, so the request is not taken from a worker that is
 * still at it.
 */
function mirrorProgress(env, request, deploymentId, by) {
  return {
    ...env,
    store: {
      ...env.store,
      async updateDeployment(id, patch) {
        await env.store.updateDeployment(id, patch);
        if (id !== deploymentId) return;
        const mirrored = {};
        if (patch.steps) mirrored.steps = patch.steps;
        if (patch.detail !== undefined) mirrored.detail = patch.detail;
        if (patch.lease) mirrored.lease = { by, until: patch.lease.until };
        if (Object.keys(mirrored).length) {
          await env.store.updateRequest(request.id, mirrored);
        }
      },
    },
  };
}

/** The emails the Cloud Functions send for a deployment that ended badly. */
async function tellOwnerIfFailed(env, deployment) {
  try {
    await notifyDeployment(env, {
      id: deployment.id,
      before: { status: "running" },
      after: deployment,
    });
  } catch (error) {
    env.log("warn", "Could not email about a failed deployment", {
      deployment: deployment.id,
      error: error.message,
    });
  }
}

/** Writes the end of a request: it is not worked on any more. */
function finish(env, request, outcome) {
  const ok = outcome.status === "done";
  return env.store.updateRequest(request.id, {
    status: outcome.status,
    steps: outcome.steps ?? settle(request.steps, ok),
    detail: null,
    lease: null,
    result: outcome.result ?? null,
    error: ok ? null : (outcome.error ?? null),
    errorCode: ok ? null : (outcome.errorCode ?? null),
    finishedAt: env.now(),
  });
}
