/**
 * DeployRequests in demo mode: a stand-in for the backend (#28). A request
 * writes a `queued` deployment, then a timer walks it through its steps one
 * at a time and finishes it, moving `release.current` and `previous` as the
 * backend would. Nothing is deployed anywhere; the steps are the deployer's
 * own (packages/deployer/src/commands/release.mjs), so the progress an owner
 * sees here is what they will see for real.
 *
 * A run that was in flight when the tab closed is picked up again by
 * resumeDemoRuns(), so a record is never left "running" for ever.
 */

import type { Cafe, Deployment, DeploymentKind } from "../platform/model";
import { compareVersionsDesc } from "../platform/parse";
import { minorLineOf } from "../platform/validate";
import { load, makeId, mutate, type DemoState } from "./demo-store";
import { CodedError, type DeployReceipt, type DeployRequests } from "./types";

/** How long each step of a simulated run takes. Tests set it to 0. */
export const demoRun = { stepMs: 500 };

type StepList = readonly (readonly [id: string, label: string])[];

const DEPLOY_STEPS: StepList = [
  ["package", "Fetch and verify the release package"],
  ["migrations", "Migrate the cafe's data"],
  ["rules", "Firestore rules"],
  ["indexes", "Firestore indexes"],
  ["settings", "Cafe settings"],
  ["hosting", "Hosting"],
  ["smoke", "Smoke test"],
];
const ROLLBACK_STEPS: StepList = [
  ["rules", "Firestore rules"],
  ["hosting", "Hosting"],
  ["smoke", "Smoke test"],
];
const BRANDING_STEPS: StepList = [
  ["settings", "Cafe settings"],
  ["hosting", "Hosting"],
];

const failed = (code: string, message: string) => new CodedError(code, message);

interface Plan {
  kind: DeploymentKind;
  version: string | null;
  fromVersion: string | null;
  steps: StepList;
}

/** Runs of this tab that have a timer going. */
const driven = new Set<string>();

/** Moves the cafe the way a finished deployment would. */
function applyResult(cafe: Cafe, deployment: Deployment) {
  if (deployment.kind === "deploy" && deployment.version) {
    cafe.release.previous = cafe.release.current;
    cafe.release.current = deployment.version;
    // Staying on a line follows the move, or the next patch of the old
    // line would undo it.
    if (cafe.release.pinned !== null) {
      cafe.release.pinned =
        minorLineOf(deployment.version) ?? cafe.release.pinned;
    }
  } else if (deployment.kind === "rollback" && deployment.version) {
    // Then there is nothing to roll back to, so a second press cannot flip
    // forward again (the deployer's own rule).
    cafe.release.current = deployment.version;
    cafe.release.previous = null;
  }
  cafe.updatedAt = Date.now();
}

/** One tick: starts the run, advances a step, or finishes it. */
function advance(state: DemoState, id: string): boolean {
  const deployment = state.deployments.find((d) => d.id === id);
  if (
    !deployment ||
    (deployment.status !== "queued" && deployment.status !== "running")
  ) {
    return false;
  }
  const { steps } = deployment;
  const at = steps.findIndex((s) => s.status === "running");
  if (at === -1) {
    // Not started: the first step begins.
    deployment.status = "running";
    if (steps[0]) steps[0].status = "running";
    return steps.length > 0;
  }
  steps[at].status = "done";
  if (at + 1 < steps.length) {
    steps[at + 1].status = "running";
    return true;
  }
  deployment.status = "succeeded";
  deployment.finishedAt = Date.now();
  const cafe = state.cafes.find((c) => c.id === deployment.cafeId);
  if (cafe) applyResult(cafe, deployment);
  return false;
}

function drive(id: string) {
  if (driven.has(id)) return;
  driven.add(id);
  const tick = () => {
    setTimeout(() => {
      const more = mutate((state) => advance(state, id));
      if (more) tick();
      else driven.delete(id);
    }, demoRun.stepMs);
  };
  tick();
}

/** Picks up runs left queued or running by an earlier visit. */
export function resumeDemoRuns() {
  for (const d of load().deployments) {
    if (d.status === "queued" || d.status === "running") drive(d.id);
  }
}

function newDeployment(cafe: Cafe, plan: Plan): Deployment {
  return {
    id: makeId("dep"),
    cafeId: cafe.id,
    ownerUid: cafe.ownerUid,
    kind: plan.kind,
    version: plan.version,
    fromVersion: plan.fromVersion,
    status: "queued",
    trigger: "owner",
    steps: plan.steps.map(([id, label]) => ({
      id,
      label,
      status: "pending" as const,
    })),
    error: null,
    createdAt: Date.now(),
    finishedAt: null,
  };
}

/**
 * The requests, over the caller's own cafe: `ownCafe` is the demo store's
 * version of the rules' "verified and owns it" (demo.ts).
 */
export function demoDeployRequests(
  ownCafe: (state: DemoState, cafeId: string) => Cafe,
): DeployRequests {
  const request = async (
    cafeId: string,
    plan: (cafe: Cafe, state: DemoState) => Plan,
  ): Promise<DeployReceipt> => {
    const id = mutate((state) => {
      const cafe = ownCafe(state, cafeId);
      if (cafe.status !== "live") {
        throw failed("failed-precondition", "The cafe is not live.");
      }
      const busy = state.deployments.some(
        (d) =>
          d.cafeId === cafe.id &&
          (d.status === "queued" || d.status === "running"),
      );
      if (busy) {
        throw failed("failed-precondition", "A deployment is running.");
      }
      const deployment = newDeployment(cafe, plan(cafe, state));
      state.deployments.push(deployment);
      return deployment.id;
    });
    drive(id);
    return { deploymentId: id };
  };

  return {
    upgrade: (cafe, version) =>
      request(cafe.id, (stored, state) => {
        const release = state.releases.find((r) => r.version === version);
        if (!release || release.withdrawn) {
          throw failed("invalid-argument", "No such release.");
        }
        if (release.channel === "beta" && stored.release.channel !== "beta") {
          throw failed("invalid-argument", "That is a beta release.");
        }
        return {
          kind: "deploy",
          version,
          fromVersion: stored.release.current,
          steps: DEPLOY_STEPS,
        };
      }),
    rollback: (cafe) =>
      request(cafe.id, (stored) => {
        const { current, previous } = stored.release;
        if (!previous || previous === current) {
          throw failed("failed-precondition", "Nothing to roll back to.");
        }
        return {
          kind: "rollback",
          version: previous,
          fromVersion: current,
          steps: ROLLBACK_STEPS,
        };
      }),
    syncBranding: (cafe) =>
      request(cafe.id, (stored) => ({
        kind: "branding",
        version: stored.release.current,
        fromVersion: null,
        steps: BRANDING_STEPS,
      })),
  };
}

/**
 * Demo mode's stand-in for the backend finishing setup (#28): the signed-in
 * owner's draft cafe goes live on the second-newest stable release, so there
 * is a newer one to upgrade to. Without it a demo cafe stays a draft for ever.
 */
export function demoGoLive(
  ownCafe: (state: DemoState, cafeId: string) => Cafe,
  cafeId: string,
) {
  mutate((state) => {
    const cafe = ownCafe(state, cafeId);
    if (cafe.status !== "draft" && cafe.status !== "provisioning") return;
    const stable = state.releases
      .filter((r) => r.channel === "stable" && !r.withdrawn)
      .map((r) => r.version)
      .sort(compareVersionsDesc);
    cafe.status = "live";
    cafe.projectId ??= `${cafe.site}-demo`;
    cafe.release.current = stable[1] ?? stable[0] ?? null;
    cafe.release.previous = null;
    cafe.updatedAt = Date.now();
  });
}
