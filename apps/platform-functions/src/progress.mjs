/**
 * What the owner watches: a deployment's steps, and the line saying what is
 * happening now. Changes are written at most every `minGapMs`, and a timer
 * renews the worker's lease while a single step takes long.
 */
import { HEARTBEAT_MS, LEASE_MS } from "./claim.mjs";
import { stepForTitle } from "./plans.mjs";

export function createProgress({
  env,
  id,
  by,
  steps,
  minGapMs = env.progressGapMs ?? 1500,
  heartbeatMs = HEARTBEAT_MS,
}) {
  let detail = null;
  let dirty = false;
  let lastWrite = 0;
  let timer = null;
  let writing = Promise.resolve();

  const write = () => {
    dirty = false;
    lastWrite = env.now().getTime();
    const patch = {
      steps: steps.map((s) => ({ ...s })),
      detail,
      lease: { by, until: lastWrite + LEASE_MS },
    };
    writing = writing
      .then(() => env.store.updateDeployment(id, patch))
      .catch((error) =>
        env.log("warn", "Could not write progress", {
          id,
          error: error.message,
        }),
      );
    return writing;
  };
  const touch = () => {
    dirty = true;
    if (env.now().getTime() - lastWrite >= minGapMs) write();
  };
  const step = (stepId) => steps.find((s) => s.id === stepId);

  return {
    steps,
    start() {
      timer = setInterval(() => write(), heartbeatMs);
      timer.unref?.();
    },
    /** Writes anything still waiting, and stops the timer. */
    async stop() {
      clearInterval(timer);
      if (dirty) write();
      await writing;
    },
    status: (stepId) => step(stepId)?.status,
    begin(stepId) {
      step(stepId).status = "running";
      touch();
    },
    done(stepId) {
      step(stepId).status = "done";
      touch();
    },
    fail(stepId) {
      step(stepId).status = "failed";
      touch();
    },
    say(text) {
      detail = text;
      touch();
    },
    /**
     * A line the deployer printed. A `> title` line starts one of its steps:
     * the steps before it are done, it is running, and the title is what is
     * happening now.
     */
    line(text) {
      if (!text.startsWith("> ")) return;
      const title = text.slice(2);
      detail = title;
      const at = steps.findIndex((s) => s.id === stepForTitle(title, steps));
      if (at !== -1) {
        steps.forEach((s, i) => {
          if (i < at && s.status !== "failed") s.status = "done";
          else if (i === at) s.status = "running";
        });
      }
      touch();
    },
    /** The deployer's final steps replace the plan's: what really ran. */
    adopt(deployerSteps) {
      steps.splice(0, steps.length, ...deployerSteps.map((s) => ({ ...s })));
    },
  };
}
