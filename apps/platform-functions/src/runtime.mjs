/**
 * The real world, wired together once per instance: the platform's Firestore
 * and Auth through the Admin SDK, and Google's APIs as the function's runtime
 * service account. The tests build an `env` of their own with the same shape:
 *
 *   store       the platform's data (store-firestore.mjs)
 *   google      {clientEmail(), contextFor(project, {write, readFile, deployLog})}
 *               contextFor makes the deployer's command context
 *   mail        {sender, consoleUrl, unsubscribeUrl}: how emails go out (mail/)
 *   loadShared  @cafemenu/shared, with its icons (Node 22.18+ imports its TypeScript)
 *   now, sleep, log
 */
import {
  createGoogleClient,
  createLogger,
  loadShared as loadRealShared,
} from "@cafemenu/deployer";

export function createGoogleSide({
  getToken,
  fetchImpl = fetch,
  clientEmail,
  sleep,
  now,
  loadShared = loadRealShared,
}) {
  return {
    clientEmail: async () =>
      typeof clientEmail === "function" ? clientEmail() : clientEmail,
    async contextFor(project, { write, readFile, deployLog }) {
      return {
        api: createGoogleClient({ fetchImpl, getToken, sleep }),
        log: createLogger({ write }),
        project,
        dryRun: false,
        clientEmail: await this.clientEmail(),
        readFile,
        fetchImpl,
        loadShared,
        now,
        sleep,
        deployLog,
      };
    },
  };
}

/**
 * The runtime service account's address, for messages ("add X as a member")
 * and nothing else: asked of the metadata server once.
 * UNVERIFIED: run in spike #3 (that the metadata server answers in a 2nd gen function).
 */
export function metadataServiceAccount(fetchImpl = fetch) {
  let email;
  return async () => {
    if (email) return email;
    try {
      const res = await fetchImpl(
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email",
        { headers: { "Metadata-Flavor": "Google" } },
      );
      if (res.ok) email = (await res.text()).trim();
    } catch {
      /* not on Google Cloud: the generic wording is used */
    }
    return email ?? "CafeMenu's deploy account";
  };
}

/**
 * Under the emulators, and only there, Google (and GitHub, for the release
 * package) can be a fake served from `CAFEMENU_FAKE_GOOGLE`: the emulator
 * tests point it at the deployer's fake Google. Needs the Functions
 * emulator's own variable (or, for the worker, the Firestore emulator's) and
 * a `demo-` project, which can't exist for real, so a deployed function or
 * the backend's workflow can never take this path.
 */
export function fakeGoogleBase(env = process.env) {
  const base = env.CAFEMENU_FAKE_GOOGLE;
  const demo = (env.GCLOUD_PROJECT ?? "").startsWith("demo-");
  const emulated =
    env.FUNCTIONS_EMULATOR === "true" || Boolean(env.FIRESTORE_EMULATOR_HOST);
  return base && emulated && demo ? base : null;
}

/** A fetch that sends everything to the fake at `base`, saying where it was meant to go. */
export function proxyFetch(base, fetchImpl = fetch) {
  return (url, init = {}) =>
    fetchImpl(base, {
      ...init,
      headers: { ...init.headers, "x-cafemenu-url": String(url) },
    });
}

let cached = null;

/** The production env, built on first use. */
export function runtimeEnv() {
  // A setup that failed is tried again by the next call, not remembered.
  cached ??= build().catch((error) => {
    cached = null;
    throw error;
  });
  return cached;
}

async function build() {
  const { getApps, initializeApp, applicationDefault } =
    await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const { getAuth } = await import("firebase-admin/auth");
  const { logger } = await import("firebase-functions/logger");
  const { createFirestoreStore } = await import("./store-firestore.mjs");
  const { createMail } = await import("./mail/setup.mjs");

  const app = getApps()[0] ?? initializeApp();
  const db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const now = () => new Date();
  const fake = fakeGoogleBase();
  const google = createGoogleSide({
    sleep,
    now,
    ...(fake
      ? {
          fetchImpl: proxyFetch(fake),
          getToken: async () => "fake-token-1",
          clientEmail: "deploy@demo-cafemenu.iam.gserviceaccount.com",
        }
      : {
          getToken: async () =>
            (await applicationDefault().getAccessToken()).access_token,
          clientEmail: metadataServiceAccount(),
        }),
  });
  const log = (level, message, fields) => logger[level](message, fields);
  return {
    store: createFirestoreStore({ db, auth: getAuth(app) }),
    google,
    mail: createMail(process.env, { log }),
    loadShared: loadRealShared,
    now,
    sleep,
    log,
  };
}
