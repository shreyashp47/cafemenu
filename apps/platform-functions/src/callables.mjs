/**
 * What the console may ask of the backend. Each handler takes the app's `env`
 * (store, Google) and the call as `{auth, data}`, and throws RequestError
 * with a Firebase-style code, so they run the same under the emulator and in
 * a test.
 *
 * Who may call: the cafe's owner, or the platform admin (the `admin` custom
 * claim), and only with a verified email, as the Firestore rules demand of
 * every write. Anyone else gets `permission-denied`, whether or not the cafe
 * exists.
 *
 * A request writes nothing but a `queued` deployment (and the cafe's status
 * for a setup); the worker (jobs.mjs) does the rest.
 */
import { check, ActionNeededError } from "@cafemenu/deployer";

import { isDead } from "./claim.mjs";
import { RequestError } from "./errors.mjs";
import { newSteps } from "./plans.mjs";
import { isTransient } from "./retry.mjs";
import { isReleaseVersion, pickRelease } from "./versions.mjs";

const CAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** firestore.rules' isProjectIdOrNull. */
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

const deny = () =>
  new RequestError("permission-denied", "This isn't your cafe.");

/**
 * The cafe a call is about, and whether the caller is its owner or the admin.
 * Returns {cafe, trigger}.
 */
export async function authorize(env, { auth, data }) {
  if (!auth) {
    throw new RequestError("unauthenticated", "Sign in first.");
  }
  const cafeId = data?.cafeId;
  if (typeof cafeId !== "string" || !CAFE_ID.test(cafeId)) {
    throw new RequestError("invalid-argument", "cafeId is missing.");
  }
  const verified = auth.token?.email_verified === true;
  const admin = verified && auth.token?.admin === true;
  const cafe = await env.store.getCafe(cafeId);
  if (!cafe) {
    throw admin ? new RequestError("not-found", "No such cafe.") : deny();
  }
  if (!admin && !(verified && cafe.ownerUid === auth.uid)) throw deny();
  return { cafe, trigger: admin ? "admin" : "owner" };
}

// -- check connection ---------------------------------------------------------

/**
 * `deployer check` for the cafe's project, as the console's ConnectionResult
 * (apps/console/src/lib/setup/connection.ts): connected, no-access, or
 * missing with each permission once, and the commands that need it.
 */
export function toConnectionResult(answer) {
  const byPermission = new Map();
  for (const [command, gaps] of Object.entries(answer.missing)) {
    for (const { permission, why } of gaps) {
      const seen = byPermission.get(permission);
      if (seen) seen.neededBy.push(command);
      else
        byPermission.set(permission, { permission, why, neededBy: [command] });
    }
  }
  if (answer.ok && byPermission.size === 0) return { status: "connected" };
  return { status: "missing", missing: [...byPermission.values()] };
}

export async function checkConnection(env, request) {
  const { cafe } = await authorize(env, request);
  const projectId = request.data.projectId;
  if (typeof projectId !== "string" || !PROJECT_ID.test(projectId)) {
    throw new RequestError("invalid-argument", "That isn't a project ID.");
  }
  // Only the project saved on the cafe: this must not be a way to ask
  // whether the deploy account is a member of any project there is.
  if (cafe.projectId !== projectId) {
    throw new RequestError(
      "failed-precondition",
      "Save the project ID on the cafe first, then check it.",
    );
  }
  const ctx = await env.google.contextFor(projectId, {
    write: () => {},
    readFile: async () => {
      throw new Error("check reads no files");
    },
  });
  try {
    return toConnectionResult(await check(ctx));
  } catch (error) {
    if (error instanceof ActionNeededError) return { status: "no-access" };
    env.log("warn", "checkConnection failed", { error: error.message });
    throw new RequestError(
      "unavailable",
      isTransient(error)
        ? "Google didn't answer just now. Try again in a minute."
        : "The check couldn't be done. Try again in a minute.",
    );
  }
}

// -- queueing deployments ------------------------------------------------------

/**
 * Queues a deployment for the cafe, unless one is queued or running. Returns
 * {deploymentId}. `plan(cafe)` throws RequestError if the cafe can't have
 * this, and returns {version, fromVersion}.
 */
async function queue(env, { cafe, trigger }, kind, { allow, plan }) {
  const now = env.now();
  const deploymentId = await env.store.queueDeployment(
    cafe.id,
    ({ cafe: current, active }) => {
      if (!current) throw new RequestError("not-found", "No such cafe.");
      if (!allow.includes(current.status)) {
        throw new RequestError(
          "failed-precondition",
          kind === "provision"
            ? "This cafe is already set up, or is being set up."
            : "The cafe is not live.",
        );
      }
      const dead = active.filter((d) => isDead(d, now.getTime()));
      if (active.length > dead.length) {
        throw new RequestError(
          "failed-precondition",
          "Another deployment is queued or running for this cafe.",
        );
      }
      const { version, fromVersion } = plan(current);
      return {
        // Long dead ones no longer block the cafe: close them.
        expire: dead.map((d) => d.id),
        cafeStatus: kind === "provision" ? "provisioning" : undefined,
        deployment: {
          cafeId: current.id,
          ownerUid: current.ownerUid,
          kind,
          version,
          fromVersion,
          status: "queued",
          trigger,
          steps: newSteps(kind),
          error: null,
          errorCode: null,
          detail: null,
          attempts: 0,
          lease: null,
          createdAt: now,
          finishedAt: null,
        },
      };
    },
    now,
  );
  return { deploymentId };
}

/** Set up the cafe's Firebase project, put the newest release on it, and load its menu. */
export async function startProvisioning(env, request) {
  const caller = await authorize(env, request);
  const releases = await env.store.listReleases();
  return queue(env, caller, "provision", {
    allow: ["draft", "failed"],
    plan(cafe) {
      if (!cafe.projectId || !cafe.site || !cafe.region) {
        throw new RequestError(
          "failed-precondition",
          "Connect a Firebase project and choose the web address and region first.",
        );
      }
      const release = pickRelease(releases, cafe.release);
      if (!release) {
        throw new RequestError(
          "failed-precondition",
          "No release is available for this cafe yet.",
        );
      }
      return { version: release.version, fromVersion: null };
    },
  });
}

export async function requestUpgrade(env, request) {
  const caller = await authorize(env, request);
  const { version } = request.data;
  if (!isReleaseVersion(version)) {
    throw new RequestError("invalid-argument", "That isn't a release version.");
  }
  const release = await env.store.getRelease(version);
  if (!release || release.withdrawn === true) {
    throw new RequestError("invalid-argument", "No such release.");
  }
  return queue(env, caller, "deploy", {
    allow: ["live"],
    plan(cafe) {
      if (release.channel === "beta" && cafe.release.channel !== "beta") {
        throw new RequestError(
          "invalid-argument",
          "That is a beta release; this cafe follows the stable channel.",
        );
      }
      return { version, fromVersion: cafe.release.current };
    },
  });
}

export async function requestRollback(env, request) {
  const caller = await authorize(env, request);
  return queue(env, caller, "rollback", {
    allow: ["live"],
    plan(cafe) {
      const { current, previous } = cafe.release;
      if (!previous || previous === current) {
        throw new RequestError(
          "failed-precondition",
          "There is nothing to roll back to.",
        );
      }
      return { version: previous, fromVersion: current };
    },
  });
}

export async function requestSyncBranding(env, request) {
  const caller = await authorize(env, request);
  return queue(env, caller, "branding", {
    allow: ["live"],
    plan: (cafe) => ({ version: cafe.release.current, fromVersion: null }),
  });
}
