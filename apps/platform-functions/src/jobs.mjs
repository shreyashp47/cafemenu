/**
 * The worker: runs a `deployments/{id}` that a callable queued. One function
 * for every kind (provision, deploy, rollback, branding), started by the
 * document being created and started again by Cloud Functions' event retry
 * while it keeps failing, so it is built to be picked up in the middle:
 *
 *   - claim.mjs: one invocation at a time works on a deployment
 *   - the deployer's commands each read before they write, so repeating one
 *     is safe, and a provisioning run skips the steps it already finished
 *   - a transient failure (Google busy, out of time) puts the deployment back
 *     in the queue and throws, which is what makes Cloud Functions retry; a
 *     deployment is picked up at most MAX_ATTEMPTS times
 *   - any other failure ends the deployment with an explanation (explain.mjs)
 */
import { deployRelease, rollback, syncBranding } from "@cafemenu/deployer";

import { MAX_ATTEMPTS, decideClaim } from "./claim.mjs";
import { createPlatformDeployLog } from "./deploy-log.mjs";
import { RetryLater } from "./errors.mjs";
import { errorText, explain } from "./explain.mjs";
import { createProgress } from "./progress.mjs";
import { provisionCafe } from "./provision-job.mjs";
import { isTransient, withRetry } from "./retry.mjs";
import { minorLine } from "./versions.mjs";

const enoent = (path) =>
  Object.assign(new Error(`no such file: ${path}`), { code: "ENOENT" });

/**
 * The cafe's settings and logo as the files the deployer asks for, kept in
 * memory: it reads `settings.json` and `logo.png` through `ctx.readFile`.
 * The logo counts only when the settings say the cafe has one.
 */
async function cafeInputs(env, cafe) {
  const wantsLogo = cafe.settings?.logo === "/logo.png";
  const logo = wantsLogo ? await env.store.getLogo(cafe.id) : null;
  const files = new Map([["settings.json", JSON.stringify(cafe.settings)]]);
  if (logo) files.set("logo.png", logo);
  return {
    settingsPath: "settings.json",
    logoPath: logo ? "logo.png" : undefined,
    readFile: async (path) => {
      if (!files.has(path)) throw enoent(path);
      return files.get(path);
    },
  };
}

/** Ends a deployment that never got to run (or can't): failed, and the cafe says why. */
async function endWith(env, deployment, cafe, explanation, steps) {
  await env.store.updateDeployment(deployment.id, {
    status: "failed",
    steps,
    error: errorText(explanation),
    errorCode: explanation.code,
    detail: null,
    lease: null,
    finishedAt: env.now(),
  });
  if (deployment.kind === "provision" && cafe) {
    await env.store.setCafeStatus(
      cafe.id,
      explanation.draft ? "draft" : "failed",
      env.now(),
    );
  }
}

/** The failed run's steps: the step that was running failed, the rest stay as they were. */
const failedSteps = (steps) =>
  steps.map((s) => (s.status === "running" ? { ...s, status: "failed" } : s));

export async function runDeployment(env, id, { by }) {
  const { store } = env;
  const claim = await store.transactDeployment(id, (current) => {
    const decision = decideClaim(current, { by, now: env.now().getTime() });
    return {
      patch: decision.patch,
      result: {
        outcome: decision.outcome,
        deployment: current && { ...current, ...decision.patch },
      },
    };
  });
  const { deployment } = claim;

  if (claim.outcome === "missing" || claim.outcome === "finished") {
    return { outcome: claim.outcome };
  }
  if (claim.outcome === "busy") {
    throw new RetryLater(`Deployment ${id} is being worked on by another run.`);
  }
  const cafe = await store.getCafe(deployment.cafeId);

  if (claim.outcome === "exhausted") {
    const why = explain(new Error("gave up"), {
      step: "this deployment",
      deploymentId: id,
    });
    await endWith(
      env,
      deployment,
      cafe,
      {
        ...why,
        message: `CafeMenu tried ${MAX_ATTEMPTS} times and could not finish.`,
      },
      failedSteps(deployment.steps),
    );
    return { outcome: "exhausted" };
  }
  if (!cafe) {
    await endWith(
      env,
      deployment,
      null,
      {
        code: "cafe-missing",
        message: "This cafe no longer exists.",
        hint: "",
      },
      failedSteps(deployment.steps),
    );
    return { outcome: "failed" };
  }
  return work(env, { id, by, deployment, cafe });
}

async function work(env, { id, by, deployment, cafe }) {
  const { store } = env;
  const startedAt = env.now().getTime();
  const steps = deployment.steps.map((s) => ({ ...s }));
  const progress = createProgress({ env, id, by, steps });
  progress.start();

  let deployerRecord = null;
  const deployLog = createPlatformDeployLog({
    store,
    cafeId: cafe.id,
    // The deployer's own Deployment of this job's kind. A deploy that fails
    // its smoke test is rolled back, which the deployer records too: the
    // owner still sees the deploy, with the smoke test failed.
    onDeployment: (d) => {
      if (d.kind === deployment.kind) deployerRecord = d;
    },
  });
  const inputs = await cafeInputs(env, cafe);
  const fail = (explanation) =>
    endWith(env, deployment, cafe, explanation, failedSteps(progress.steps));

  try {
    if (!cafe.projectId) {
      return await endAfter(progress, () =>
        fail({
          code: "no-project",
          message: "No Firebase project is connected to this cafe.",
          hint: "Connect one on the setup page, then try again.",
        }),
      );
    }
    if (deployment.kind !== "provision" && cafe.status !== "live") {
      return await endAfter(progress, () =>
        fail({
          code: "not-live",
          message: "This cafe isn't live, so there is nothing to update.",
          hint: "",
        }),
      );
    }
    const ctx = await env.google.contextFor(cafe.projectId, {
      write: (line) => {
        env.log("info", line, { deployment: id, cafe: cafe.id });
        progress.line(line);
      },
      readFile: inputs.readFile,
      deployLog,
    });

    let outcome;
    if (deployment.kind === "provision") {
      outcome = await provisionCafe({
        env,
        cafe,
        deployment,
        progress,
        ctx,
        inputs,
        startedAt,
      });
    } else {
      progress.begin(steps[0].id);
      await withRetry(() => runDeployer(ctx, deployment, cafe, inputs), {
        sleep: env.sleep,
        onRetry: (_, attempt) =>
          progress.say(`Google was slow; trying again (${attempt})`),
      });
    }

    // The cafe first, so that when the deployment reads "succeeded" the cafe
    // already shows what it did.
    const finalSteps =
      deployment.kind === "provision"
        ? progress.steps.map((s) => ({ ...s, status: "done" }))
        : (deployerRecord?.steps ?? progress.steps).map((s) => ({
            id: s.id,
            label: s.label,
            status: s.status === "pending" ? "done" : s.status,
          }));
    if (deployment.kind === "provision") {
      await store.setCafeStatus(cafe.id, "live", env.now());
    } else if (deployment.kind === "deploy") {
      const line = minorLine(deployment.version);
      if (cafe.release.pinned && line && line !== cafe.release.pinned) {
        await store.setCafeRelease(cafe.id, { pinned: line });
      }
    }
    await progress.stop();
    await store.updateDeployment(id, {
      status: "succeeded",
      steps: finalSteps,
      error: null,
      errorCode: null,
      detail: null,
      lease: null,
      finishedAt: env.now(),
      ...(outcome && { siteUrl: outcome.siteUrl }),
    });
    return { outcome: "succeeded" };
  } catch (error) {
    await progress.stop();
    const attempts = deployment.attempts ?? 1;
    if (
      error instanceof RetryLater ||
      (isTransient(error) && attempts < MAX_ATTEMPTS)
    ) {
      // Back in the queue, then throw: that is what makes Cloud Functions
      // run it again, from the step it stopped at.
      await store.updateDeployment(id, {
        status: "queued",
        steps: progress.steps.map((s) =>
          s.status === "running" ? { ...s, status: "pending" } : s,
        ),
        detail: "Taking a short break; setup carries on by itself.",
        lease: null,
      });
      throw error instanceof RetryLater ? error : new RetryLater(error.message);
    }
    env.log("error", "Deployment failed", {
      deployment: id,
      cafe: cafe.id,
      error: error.stack ?? error.message,
    });
    const running = progress.steps.find((s) => s.status === "running");
    const explanation = explain(error, {
      project: cafe.projectId,
      clientEmail: await env.google.clientEmail(),
      step: running?.label,
      deploymentId: id,
    });
    // A deploy, rollback or branding sync shows the deployer's own steps. A
    // setup's steps are the platform's; the deployer's are one of them.
    const steps =
      deployment.kind !== "provision" && deployerRecord?.steps
        ? deployerRecord.steps.map((s) => ({
            id: s.id,
            label: s.label,
            status: s.status,
          }))
        : failedSteps(progress.steps);
    await store.updateDeployment(id, {
      status: error.rolledBackTo ? "rolled-back" : "failed",
      steps,
      error: errorText(explanation),
      errorCode: explanation.code,
      technical: `${error.name}: ${error.message}`.slice(0, 600),
      detail: null,
      lease: null,
      finishedAt: env.now(),
    });
    if (deployment.kind === "provision") {
      await store.setCafeStatus(
        cafe.id,
        explanation.draft ? "draft" : "failed",
        env.now(),
      );
    }
    return { outcome: error.rolledBackTo ? "rolled-back" : "failed" };
  }
}

const endAfter = async (progress, end) => {
  await progress.stop();
  await end();
  return { outcome: "failed" };
};

/** The deployer command for a deploy, rollback or branding sync. */
function runDeployer(ctx, deployment, cafe, inputs) {
  const common = { site: cafe.site };
  const files = { settings: inputs.settingsPath, logo: inputs.logoPath };
  switch (deployment.kind) {
    case "deploy":
      return deployRelease(ctx, {
        ...common,
        ...files,
        release: true,
        version: deployment.version,
      });
    case "rollback":
      return rollback(ctx, common);
    case "branding":
      return syncBranding(ctx, { ...common, ...files });
    default:
      throw new Error(`Unknown deployment kind: ${deployment.kind}`);
  }
}
