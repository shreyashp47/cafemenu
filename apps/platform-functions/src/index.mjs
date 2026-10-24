/**
 * The platform project's Cloud Functions (2nd gen).
 *
 * Callables, for the console (apps/console/src/lib/data/callables.ts):
 *
 *   checkConnection       "Check connection" in onboarding (#27)
 *   startProvisioning     set a cafe's project up and put CafeMenu on it (#28)
 *   requestUpgrade        Upgrade (#29)
 *   requestRollback       Roll back (#29)
 *   requestSyncBranding   Save branding (#29)
 *
 * The request callables only check who is asking and queue a
 * `deployments/{id}`. `runDeployment` does the work when that document is
 * created, and again if it fails part way: see jobs.mjs.
 *
 * Why a callable and not a request document the owner writes: the rules let
 * only the backend write `deployments`, and a callable checks who may ask,
 * what state the cafe is in and whether another run is under way before
 * anything is queued, with an error the console can show at once.
 */
import { setGlobalOptions } from "firebase-functions/v2";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";

import * as calls from "./callables.mjs";
import { RequestError } from "./errors.mjs";
import { runtimeEnv } from "./runtime.mjs";
import { runDeployment } from "./jobs.mjs";

// [[SPIKE #3]]: the region must match the platform Firestore database's
// location, which Firestore triggers require. Set CAFEMENU_REGION when
// deploying if it isn't us-central1.
const region = process.env.CAFEMENU_REGION || "us-central1";

setGlobalOptions({
  region,
  maxInstances: 10,
  // The runtime identity is the service account owners add to their projects.
  // Left unset, it is the project's default one. [[SPIKE #3]]
  ...(process.env.DEPLOY_SERVICE_ACCOUNT && {
    serviceAccount: process.env.DEPLOY_SERVICE_ACCOUNT,
  }),
});

/** A callable from a handler in callables.mjs, with its RequestErrors as HttpsErrors. */
const callable = (handler, options = {}) =>
  onCall({ cors: true, ...options }, async (request) => {
    try {
      return await handler(await runtimeEnv(), request);
    } catch (error) {
      if (error instanceof RequestError) {
        throw new HttpsError(error.code, error.message);
      }
      throw error;
    }
  });

export const checkConnection = callable(calls.checkConnection, {
  timeoutSeconds: 60,
});
export const startProvisioning = callable(calls.startProvisioning);
export const requestUpgrade = callable(calls.requestUpgrade);
export const requestRollback = callable(calls.requestRollback);
export const requestSyncBranding = callable(calls.requestSyncBranding);

export const runDeploymentJob = onDocumentCreated(
  {
    document: "deployments/{deploymentId}",
    // Run again, from where it stopped, while it keeps failing: jobs.mjs
    // caps the attempts and ends the deployment with an explanation.
    retry: true,
    // The most an event-triggered function may run.
    timeoutSeconds: 540,
    memory: "1GiB",
    concurrency: 1,
  },
  async (event) => {
    await runDeployment(await runtimeEnv(), event.params.deploymentId, {
      by: event.id,
    });
  },
);
