/**
 * One request to the backend (#77), from claim to answer: what the worker
 * (worker.mjs) does with each `requests/{id}` the console wrote.
 *
 *   claim     a transaction marks it `running` with a lease, as claim.mjs
 *             does for deployments: two runs that meet can't both work on
 *             it, and one that died leaves it to be picked up again once
 *             the lease is out
 *   who       the asker is looked up in the platform's Auth: an account that
 *             is gone or disabled can't ask any more
 *   dispatch  to the handlers the Cloud Functions use, unchanged:
 *               check          callables.checkConnection
 *               provision      callables.startProvisioning, then jobs.runDeployment
 *               deploy         callables.requestUpgrade, then the same
 *               rollback       callables.requestRollback, then the same
 *               sync-branding  callables.requestSyncBranding, then the same
 *             so a request is refused for exactly the reasons a callable is,
 *             with the same words, and runs exactly as a deployment does
 *   answer    `status` done or failed, `result`, `error` and `errorCode`; and
 *             while it runs, `progress` ({steps, detail}) copied from the
 *             deployment as it moves
 *
 * A deployment that has to wait (Google busy, out of time, another run on
 * it) puts the request back in the queue with its `deploymentId`, and the
 * next run carries on from there rather than asking again.
 */
import { FINISHED_REQUEST_STATUSES } from "@cafemenu/shared/requests";

import * as calls from "../callables.mjs";
import { FINISHED, MAX_ATTEMPTS, decideClaim } from "../claim.mjs";
import { RequestError, RetryLater } from "../errors.mjs";
import { runDeployment } from "../jobs.mjs";
import { notifyDeployment } from "../mail/notify.mjs";
import { isTransient } from "../retry.mjs";

/**
 * How long a run holds a request. Longer than a run can last (the workflow
 * stops one after 20 minutes), so it is only ever taken over from a run that
 * died.
 */
export const REQUEST_LEASE_MS = 30 * 60_000;

export const CHECK_STEP = {
  id: "check",
  label: "Check CafeMenu's access to your project",
};

const PAUSED =
  "Taking a short break; this carries on by itself in a few minutes.";

const unexpected = (id) =>
  `Something unexpected went wrong. Try again in a few minutes; if it happens again, tell CafeMenu's maintainer this reference: ${id}.`;

/**
 * The asker, as the callables' `request.auth`: their uid, and the verified
 * flag and admin claim from their account as it is now, not as it was when
 * they asked.
 */
export async function askerOf(env, uid) {
  const account =
    typeof uid === "string" && uid ? await env.store.getAccount(uid) : null;
  if (!account || account.disabled) {
    throw new RequestError(
      "permission-denied",
      "This account can't ask CafeMenu for changes any more.",
    );
  }
  return {
    uid,
    token: {
      email: account.email ?? "",
      email_verified: account.emailVerified === true,
      admin: account.admin === true,
    },
  };
}

const withStatus = (steps, from, to) =>
  steps.map((s) => (s.status === from ? { ...s, status: to } : s));

const progressOf = (deployment) => ({
  steps: (deployment?.steps ?? []).map(({ id, label, status }) => ({
    id,
    label,
    status,
  })),
  detail: deployment?.detail ?? null,
});

/**
 * `env` with its store's updateDeployment also copying the deployment's steps
 * and "now doing" line to the request, so the console can show a request's
 * progress from the request alone.
 */
function mirrored(env, job) {
  const { store } = env;
  return {
    ...env,
    store: {
      ...store,
      async updateDeployment(id, patch) {
        await store.updateDeployment(id, patch);
        if (id !== job.deploymentId) return;
        if (!("steps" in patch) && !("detail" in patch)) return;
        job.progress = {
          steps: patch.steps
            ? progressOf(patch).steps
            : (job.progress?.steps ?? []),
          detail:
            "detail" in patch
              ? (patch.detail ?? null)
              : (job.progress?.detail ?? null),
        };
        try {
          await store.updateRequest(job.request.id, { progress: job.progress });
        } catch (error) {
          env.log("warn", "Could not copy progress to the request", {
            request: job.request.id,
            error: error.message,
          });
        }
      },
    },
  };
}

/**
 * Emails the owner about a deployment that ended failed or rolled back, as
 * the notifyOnDeployment function does on Blaze. An email that can't go out
 * never fails the request: notify.mjs logs it and the next write tries again.
 */
async function tellOwner(env, id, before, after) {
  try {
    await notifyDeployment(env, { id, before, after });
  } catch (error) {
    env.log("error", "Could not email the owner", {
      deployment: id,
      error: error.message,
    });
  }
}

/** What a finished deployment means for the request that asked for it. */
function answerOf(deployment) {
  if (!deployment) {
    return {
      status: "failed",
      errorCode: "deployment-missing",
      error: "This update can no longer be found. Ask again.",
    };
  }
  if (!FINISHED.includes(deployment.status)) {
    // Still queued or running: another run has it. Ask again next run.
    throw new RetryLater(`Deployment ${deployment.id} hasn't finished.`);
  }
  const progress = { ...progressOf(deployment), detail: null };
  const result = {
    deploymentId: deployment.id,
    outcome: deployment.status,
    ...(deployment.siteUrl && { siteUrl: deployment.siteUrl }),
  };
  if (deployment.status === "succeeded") {
    return { status: "done", result, progress };
  }
  return {
    status: "failed",
    result,
    progress,
    errorCode: deployment.errorCode ?? deployment.status,
    error: deployment.error ?? "It didn't go through.",
  };
}

/** Runs a deployment as the worker does, and emails the owner if it failed. */
export async function runAndTell(env, id, { runId, tellEnv = env }) {
  const before = await env.store.getDeployment(id);
  const ran = await runDeployment(env, id, { by: runId });
  const after = await env.store.getDeployment(id);
  await tellOwner(tellEnv, id, before, after);
  return { ran, after };
}

/** A request that becomes a deployment: queue it as the callable does, then run it. */
const viaDeployment = (callable, dataOf) => async (env, job) => {
  const { request } = job;
  if (!job.deploymentId) {
    const { deploymentId } = await callable(env, {
      auth: job.auth,
      data: { cafeId: request.cafeId, ...dataOf(request.params ?? {}) },
    });
    job.deploymentId = deploymentId;
    job.progress = progressOf(await env.store.getDeployment(deploymentId));
    await env.store.updateRequest(request.id, {
      deploymentId,
      progress: job.progress,
    });
  }
  job.touched?.add(job.deploymentId);
  const { after } = await runAndTell(mirrored(env, job), job.deploymentId, {
    runId: job.runId,
    tellEnv: env,
  });
  return answerOf(after);
};

async function runCheck(env, job) {
  job.progress = {
    steps: [{ ...CHECK_STEP, status: "running" }],
    detail: null,
  };
  await env.store.updateRequest(job.request.id, { progress: job.progress });
  const result = await calls.checkConnection(env, {
    auth: job.auth,
    data: {
      cafeId: job.request.cafeId,
      projectId: job.request.params?.projectId,
    },
  });
  return {
    status: "done",
    result,
    progress: { steps: [{ ...CHECK_STEP, status: "done" }], detail: null },
  };
}

/** What each kind of request does. */
export const HANDLERS = {
  check: runCheck,
  provision: viaDeployment(calls.startProvisioning, () => ({})),
  deploy: viaDeployment(calls.requestUpgrade, (params) => ({
    version: params.version,
  })),
  rollback: viaDeployment(calls.requestRollback, () => ({})),
  "sync-branding": viaDeployment(calls.requestSyncBranding, () => ({})),
};

async function answer(env, id, answered) {
  await env.store.updateRequest(id, {
    status: answered.status,
    result: answered.result ?? null,
    error: answered.error ?? null,
    errorCode: answered.errorCode ?? null,
    ...(answered.progress && { progress: answered.progress }),
    ...(answered.technical && { technical: answered.technical }),
    lease: null,
    finishedAt: env.now(),
  });
}

/** A failure, with the step that was running marked failed. */
const failed = (job, fields) => ({
  status: "failed",
  ...fields,
  ...(job.progress && {
    progress: {
      steps: withStatus(job.progress.steps, "running", "failed"),
      detail: null,
    },
  }),
});

/**
 * Claims request `id` for the run `runId` and does it. Returns
 * {id, kind, outcome, code}: outcome is `done` or `failed` (answered), `later`
 * (back in the queue), or `skipped` (gone, finished, or another run has it).
 * `touched` collects the deployments this run has worked on.
 */
export async function processRequest(env, id, { runId, touched } = {}) {
  const now = env.now();
  const claim = await env.store.transactRequest(id, (current) => {
    const decision = decideClaim(current, {
      by: runId,
      now: now.getTime(),
      leaseMs: REQUEST_LEASE_MS,
      finished: FINISHED_REQUEST_STATUSES,
    });
    const patch = decision.patch && {
      ...decision.patch,
      startedAt: current.startedAt ?? now,
    };
    return {
      patch,
      result: {
        outcome: decision.outcome,
        request: current && { ...current, ...patch },
      },
    };
  });
  const { request } = claim;
  const kind = request?.kind ?? null;
  if (!["claimed", "exhausted"].includes(claim.outcome)) {
    return { id, kind, outcome: "skipped", code: claim.outcome };
  }

  const job = {
    request,
    runId,
    touched,
    deploymentId: request.deploymentId ?? null,
    progress: request.progress ?? null,
    auth: null,
  };
  const end = async (answered) => {
    await answer(env, id, answered);
    return {
      id,
      kind,
      outcome: answered.status,
      code: answered.errorCode ?? null,
    };
  };

  if (claim.outcome === "exhausted") {
    return end(
      failed(job, {
        errorCode: "gave-up",
        error: `CafeMenu tried ${MAX_ATTEMPTS} times and couldn't finish this. Ask again; if it happens again, tell CafeMenu's maintainer this reference: ${id}.`,
      }),
    );
  }

  try {
    const handler = Object.hasOwn(HANDLERS, kind) ? HANDLERS[kind] : null;
    if (!handler) {
      throw new RequestError(
        "invalid-argument",
        "CafeMenu doesn't know how to do this.",
      );
    }
    job.auth = await askerOf(env, request.by);
    return await end(await handler(env, job));
  } catch (error) {
    if (error instanceof RequestError) {
      return end(failed(job, { errorCode: error.code, error: error.message }));
    }
    if (error instanceof RetryLater || isTransient(error)) {
      // Back in the queue, with its deployment if it has one: the next run
      // carries on from there.
      await env.store.updateRequest(id, {
        status: "queued",
        lease: null,
        ...(job.deploymentId && { deploymentId: job.deploymentId }),
        progress: {
          steps: withStatus(job.progress?.steps ?? [], "running", "pending"),
          detail: PAUSED,
        },
      });
      return { id, kind, outcome: "later", code: null };
    }
    env.log("error", "A request failed unexpectedly", {
      request: id,
      kind,
      error: error.stack ?? error.message,
    });
    return end(
      failed(job, {
        errorCode: "unexpected",
        error: unexpected(id),
        technical: `${error.name}: ${error.message}`.slice(0, 600),
      }),
    );
  }
}
