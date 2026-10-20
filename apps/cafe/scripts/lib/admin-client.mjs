/**
 * A tiny admin client for the owner-run scripts (seed:staff, cleanup:orders).
 *
 * Why REST and not firebase-admin: the Admin SDK wants a service-account key or
 * Application Default Credentials, and ADC comes from `gcloud auth
 * application-default login` — gcloud is not something a cafe owner has
 * installed. What they *do* have, because deploying needs it, is `firebase
 * login`. The Firebase CLI keeps that login's OAuth refresh token in its
 * configstore, and the same token is good for the Identity Toolkit and
 * Firestore REST APIs as the project owner. So these scripts borrow it, read
 * only, and never write it back.
 *
 * Calls made with it are made as the project's owner, over IAM, which means
 * firestore.rules does not apply to them. That is the point — it is how the
 * first owner gets created at all — and also why every script here has a dry
 * run and says exactly what it is about to do.
 *
 * Credentials, first match wins:
 *   1. FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST — talk to the local
 *      emulators instead, with the emulator's built-in admin token.
 *   2. FIREBASE_TOKEN — a refresh token from `firebase login:ci`.
 *   3. The `firebase login` session in
 *      ~/.config/configstore/firebase-tools.json ($XDG_CONFIG_HOME respected).
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// The Firebase CLI's own public OAuth client. A refresh token can only be
// exchanged by the client that minted it, and these are the values
// firebase-tools itself uses (lib/api.js); they are not secret.
const CLI_CLIENT_ID =
  "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const CLI_CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi";
const TOKEN_URL = "https://www.googleapis.com/oauth2/v3/token";

export class UsageError extends Error {}

/** --project, else the "default" alias in .firebaserc. */
export async function resolveProject(flag, cwd = process.cwd()) {
  if (flag) return flag;
  try {
    const rc = JSON.parse(await readFile(join(cwd, ".firebaserc"), "utf8"));
    if (rc?.projects?.default) return rc.projects.default;
  } catch {
    /* fall through to the error below */
  }
  throw new UsageError(
    "No Firebase project. Pass --project=<id> or run `firebase use --add`.",
  );
}

function configstorePath(env) {
  const base = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "configstore", "firebase-tools.json");
}

async function exchangeRefreshToken(refreshToken, fetchImpl) {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLI_CLIENT_ID,
      client_secret: CLI_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(
      `Could not refresh your Firebase login (${res.status}). Run \`firebase login --reauth\` and try again.`,
    );
  }
  return body.access_token;
}

/**
 * An OAuth access token for the logged-in Firebase CLI user. Reuses the CLI's
 * cached access token while it has more than five minutes left, otherwise
 * exchanges the refresh token for a fresh one (in memory only).
 */
export async function getAccessToken({
  env = process.env,
  fetchImpl = fetch,
  now = Date.now(),
} = {}) {
  if (env.FIREBASE_TOKEN) {
    return exchangeRefreshToken(env.FIREBASE_TOKEN, fetchImpl);
  }
  let store;
  try {
    store = JSON.parse(await readFile(configstorePath(env), "utf8"));
  } catch {
    throw new Error(
      "You are not logged in to the Firebase CLI. Run `firebase login` first.",
    );
  }
  const tokens = store?.tokens ?? {};
  if (tokens.access_token && Number(tokens.expires_at) > now + 5 * 60_000) {
    return tokens.access_token;
  }
  if (!tokens.refresh_token) {
    throw new Error(
      "Your Firebase CLI login has no refresh token. Run `firebase login --reauth`.",
    );
  }
  return exchangeRefreshToken(tokens.refresh_token, fetchImpl);
}

// --- Firestore value encoding (only what these scripts store) ---------------

export function decodeValue(v) {
  if (!v || typeof v !== "object") return undefined;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return new Date(v.timestampValue);
  if ("nullValue" in v) return null;
  return undefined;
}

export function decodeFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [k, decodeValue(v)]),
  );
}

function encodeString(value) {
  return { stringValue: String(value) };
}

// --- the client -------------------------------------------------------------

/**
 * `token` is an OAuth access token (ignored for whichever service is
 * emulated), and `fetchImpl` is injectable so the request shapes can be tested
 * without a network.
 */
export function createAdminClient({
  project,
  token,
  env = process.env,
  fetchImpl = fetch,
}) {
  const fsEmu = env.FIRESTORE_EMULATOR_HOST;
  const authEmu = env.FIREBASE_AUTH_EMULATOR_HOST;
  const firestoreBase = fsEmu
    ? `http://${fsEmu}/v1`
    : "https://firestore.googleapis.com/v1";
  const authBase = authEmu
    ? `http://${authEmu}/identitytoolkit.googleapis.com/v1`
    : "https://identitytoolkit.googleapis.com/v1";
  const docsRoot = `projects/${project}/databases/(default)/documents`;

  async function call(url, { method = "GET", body, emulator } = {}) {
    const res = await fetchImpl(url, {
      method,
      headers: {
        // The emulators accept the literal "owner" as an admin credential.
        authorization: `Bearer ${emulator ? "owner" : token}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 404 && method === "GET") return null;
    const text = await res.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      /* an HTML error page; the raw text is reported below */
    }
    if (!res.ok) {
      // Query endpoints stream an array, so their error arrives as [{ error }].
      const error = Array.isArray(json) ? json[0]?.error : json?.error;
      const message = error?.message ?? text.slice(0, 200);
      throw new Error(`${method} ${url} failed (${res.status}): ${message}`);
    }
    return json;
  }

  const fs = (path, opts) =>
    call(`${firestoreBase}/${path}`, { ...opts, emulator: Boolean(fsEmu) });
  const auth = (path, opts) =>
    call(`${authBase}/projects/${project}/${path}`, {
      ...opts,
      emulator: Boolean(authEmu),
    });

  function ordersBefore(cutoff) {
    return {
      from: [{ collectionId: "orders" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "createdAt" },
          op: "LESS_THAN",
          value: { timestampValue: cutoff.toISOString() },
        },
      },
    };
  }

  return {
    project,
    target: fsEmu || authEmu ? "the local emulators" : `project ${project}`,

    async lookupUserByEmail(email) {
      const res = await auth("accounts:lookup", {
        method: "POST",
        body: { email: [email] },
      });
      const user = res?.users?.[0];
      return user
        ? {
            uid: user.localId,
            email: user.email,
            displayName: user.displayName,
          }
        : null;
    },

    async createUser({ email, password, displayName }) {
      const res = await auth("accounts", {
        method: "POST",
        body: { email, password, displayName, emailVerified: false },
      });
      return { uid: res.localId };
    },

    async getStaffDoc(uid) {
      const doc = await fs(`${docsRoot}/staff/${encodeURIComponent(uid)}`);
      return doc ? decodeFields(doc.fields) : null;
    },

    /** Creates or merges: only `name` and `role` are touched. */
    async setStaffDoc(uid, { name, role }) {
      const mask = "updateMask.fieldPaths=name&updateMask.fieldPaths=role";
      await fs(`${docsRoot}/staff/${encodeURIComponent(uid)}?${mask}`, {
        method: "PATCH",
        body: {
          fields: { name: encodeString(name), role: encodeString(role) },
        },
      });
    },

    /**
     * How many orders were created before `cutoff`. A count aggregation costs
     * one read per thousand matches, so a dry run is cheap even on a big
     * collection. (No `sum(total)`: that needs a composite createdAt+total
     * index, and a count is all the decision needs.)
     */
    async countOrdersBefore(cutoff) {
      const res = await fs(`${docsRoot}:runAggregationQuery`, {
        method: "POST",
        body: {
          structuredAggregationQuery: {
            structuredQuery: ordersBefore(cutoff),
            aggregations: [{ alias: "n", count: {} }],
          },
        },
      });
      const fields = res?.[0]?.result?.aggregateFields ?? {};
      return decodeValue(fields.n) ?? 0;
    },

    /** Oldest-first orders before `cutoff`: document name and createdAt only. */
    async listOrdersBefore(cutoff, limit) {
      const res = await fs(`${docsRoot}:runQuery`, {
        method: "POST",
        body: {
          structuredQuery: {
            ...ordersBefore(cutoff),
            orderBy: [
              { field: { fieldPath: "createdAt" }, direction: "ASCENDING" },
            ],
            select: { fields: [{ fieldPath: "createdAt" }] },
            limit,
          },
        },
      });
      return (res ?? [])
        .filter((row) => row.document)
        .map((row) => ({
          name: row.document.name,
          createdAt: decodeValue(row.document.fields?.createdAt),
        }));
    },

    async deleteDocuments(names) {
      if (names.length === 0) return;
      const res = await fs(`${docsRoot}:batchWrite`, {
        method: "POST",
        body: { writes: names.map((name) => ({ delete: name })) },
      });
      const failed = (res?.status ?? []).filter((s) => s && s.code);
      if (failed.length > 0) {
        throw new Error(
          `${failed.length} of ${names.length} deletes failed: ${failed[0].message ?? failed[0].code}`,
        );
      }
    },
  };
}

/**
 * Builds a client from whichever credentials are available. `needsAuth` is for
 * scripts that touch Firebase Auth as well as Firestore: pointing only one of
 * them at an emulator would quietly send the other half to production.
 */
export async function connect({
  projectFlag,
  needsAuth = false,
  env = process.env,
} = {}) {
  const project = await resolveProject(projectFlag);
  const fsEmu = Boolean(env.FIRESTORE_EMULATOR_HOST);
  const authEmu = Boolean(env.FIREBASE_AUTH_EMULATOR_HOST);
  if (needsAuth && fsEmu !== authEmu) {
    throw new UsageError(
      "Set both FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST, or neither.",
    );
  }
  const allEmulated = fsEmu && (!needsAuth || authEmu);
  const token = allEmulated ? "owner" : await getAccessToken({ env });
  return createAdminClient({ project, token, env });
}
