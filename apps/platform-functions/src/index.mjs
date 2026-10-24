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
 * Emails to owners (#34), from changes to the platform's own data:
 *
 *   notifyOnRelease       a release was written: a new version for the cafes
 *                         that stay on one, and the upgrade-by notices of the
 *                         support window (#35)
 *   notifyOnDeployment    a deployment ended failed or rolled back
 *   unsubscribe           the link in the emails an owner may switch off
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
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentWritten,
} from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";

import * as calls from "./callables.mjs";
import { RequestError } from "./errors.mjs";
import { runtimeEnv } from "./runtime.mjs";
import { runDeployment } from "./jobs.mjs";
import { notifyDeployment, notifyRelease } from "./mail/notify.mjs";
import { UNSUBSCRIBE_HEADERS, handleUnsubscribe } from "./mail/unsubscribe.mjs";

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

// -- emails ----------------------------------------------------------------------

// The Resend key is a secret of the function, bound only when Resend is the
// provider, so a platform that sends nothing (MAIL_PROVIDER unset, "log")
// deploys with no secret to create. [[SPIKE #3]]: deploy-time reads of
// MAIL_PROVIDER from `.env.<project>` are unverified.
const secrets =
  process.env.MAIL_PROVIDER?.trim().toLowerCase() === "resend"
    ? [defineSecret("RESEND_API_KEY")]
    : [];

export const notifyOnRelease = onDocumentWritten(
  { document: "releases/{version}", secrets },
  async (event) => {
    // The version is the document's id, not a field of it.
    const { version } = event.params;
    const record = (snap) => (snap.exists ? { ...snap.data(), version } : null);
    await notifyRelease(await runtimeEnv(), {
      before: event.data ? record(event.data.before) : null,
      after: event.data ? record(event.data.after) : null,
    });
  },
);

export const notifyOnDeployment = onDocumentUpdated(
  { document: "deployments/{deploymentId}", secrets },
  async (event) => {
    await notifyDeployment(await runtimeEnv(), {
      id: event.params.deploymentId,
      before: event.data?.before.data() ?? null,
      after: event.data?.after.data() ?? null,
    });
  },
);

export const unsubscribe = onRequest({ cors: false }, async (req, res) => {
  const { status, html } = await handleUnsubscribe(await runtimeEnv(), {
    method: req.method,
    query: req.query,
    body: req.body,
  });
  res.set(UNSUBSCRIBE_HEADERS).status(status).send(html);
});
