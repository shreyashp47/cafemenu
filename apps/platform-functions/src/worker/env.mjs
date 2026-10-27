/**
 * The worker's `env` (the same shape as runtime.mjs builds for the Cloud
 * Functions): the platform's Firestore and Auth through the Admin SDK, and
 * Google's APIs as the platform's service account, from its JSON key.
 *
 * On GitHub Actions the key is the `PLATFORM_SERVICE_ACCOUNT` secret, which
 * the workflow writes to a file only it can read and names in
 * GOOGLE_APPLICATION_CREDENTIALS for this step alone. The key is read here
 * and never printed: the deployer's auth.mjs keeps the private key out of
 * anything that could be logged.
 *
 * Against the emulators (FIRESTORE_EMULATOR_HOST set) no key is needed, the
 * project must be a `demo-` one, and Google can be the deployer's fake
 * (CAFEMENU_FAKE_GOOGLE), as for the Functions emulator.
 */
import {
  createTokenProvider,
  loadServiceAccountKey,
  loadShared,
} from "@cafemenu/deployer";

import { createMail } from "../mail/setup.mjs";
import { createGoogleSide, fakeGoogleBase, proxyFetch } from "../runtime.mjs";

/** The settings the worker reads from its environment, checked. */
export async function workerSettings(env = process.env) {
  const emulated = Boolean(env.FIRESTORE_EMULATOR_HOST);
  if (emulated) {
    const projectId = env.GCLOUD_PROJECT || env.CAFEMENU_PLATFORM_PROJECT;
    if (!projectId?.startsWith("demo-")) {
      throw new Error(
        `Against the emulators the project must be a demo- one, not "${projectId ?? ""}".`,
      );
    }
    return { emulated, projectId, key: null };
  }
  if (!env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error(
      "No service-account key: set GOOGLE_APPLICATION_CREDENTIALS to the platform service account's key file.",
    );
  }
  const key = await loadServiceAccountKey({ env });
  const projectId = env.CAFEMENU_PLATFORM_PROJECT || key.projectId;
  if (!projectId) {
    throw new Error(
      "The key names no project: set CAFEMENU_PLATFORM_PROJECT to the platform's project ID.",
    );
  }
  if (projectId.startsWith("demo-")) {
    throw new Error("A demo- project only exists on the emulators.");
  }
  return { emulated, projectId, key };
}

export async function workerEnv({ env = process.env, log }) {
  const { emulated, projectId, key } = await workerSettings(env);
  const { getApps, initializeApp, cert } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const { getAuth } = await import("firebase-admin/auth");
  // Loaded here, not at the top: it needs firebase-admin's Firestore, and
  // workerSettings above must load without it (the unit tests run on the
  // repository's Node 20, where that optional dependency isn't installed).
  const { createFirestoreStore } = await import("../store-firestore.mjs");

  const app =
    getApps()[0] ??
    initializeApp({
      projectId,
      ...(key && { credential: cert(env.GOOGLE_APPLICATION_CREDENTIALS) }),
    });
  const db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const now = () => new Date();
  const fake = emulated
    ? fakeGoogleBase({ ...env, GCLOUD_PROJECT: projectId })
    : null;
  const google = createGoogleSide({
    sleep,
    now,
    ...(fake
      ? {
          fetchImpl: proxyFetch(fake),
          getToken: async () => "fake-token-1",
          clientEmail: "deploy@demo-cafemenu.iam.gserviceaccount.com",
        }
      : key
        ? {
            getToken: createTokenProvider({ key }),
            clientEmail: key.clientEmail,
          }
        : {
            // The emulators without a fake Google: nothing may reach the real one.
            getToken: async () => {
              throw new Error(
                "No Google on the emulators: set CAFEMENU_FAKE_GOOGLE.",
              );
            },
            clientEmail: "deploy@demo-cafemenu.iam.gserviceaccount.com",
          }),
  });
  return {
    store: createFirestoreStore({ db, auth: getAuth(app) }),
    google,
    mail: createMail(env, { log }),
    loadShared,
    now,
    sleep,
    log,
  };
}
