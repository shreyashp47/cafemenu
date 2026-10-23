/**
 * A small, stateful stand-in for the Google APIs the deployer calls, passed
 * as `fetchImpl`. It answers with the shapes in Google's REST reference
 * (the same ones quoted above each call in src/apis/), keeps enough state
 * that a second run sees what the first one did, and records every request
 * so tests can assert on exactly what was sent.
 *
 * It is a model of the documented behaviour, not of Google's real quirks;
 * those are what the Phase 0 spikes are for.
 */
import { createHash, createPublicKey, createVerify } from "node:crypto";

export const PROJECT = "test-cafe";
export const PROJECT_NUMBER = "123456789012";

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const googleError = (status, code, message) =>
  json(status, { error: { code: status, message, status: code } });

/** The fake's state. Tests change it before a run to set up a scenario. */
export function freshState() {
  return {
    permissions: null, // null = every permission; else a Set
    services: new Map([
      ["firebase.googleapis.com", "ENABLED"],
      ["serviceusage.googleapis.com", "ENABLED"],
    ]),
    database: null,
    // null = Authentication never set up (Google: CONFIGURATION_NOT_FOUND)
    authConfig: {
      signIn: { email: { enabled: false }, anonymous: { enabled: false } },
    },
    webApps: [],
    sites: new Map(),
    takenSites: new Set(["taken-name"]), // owned by some other project
    versions: new Map(),
    uploaded: new Set(), // content hashes Hosting already stores
    releases: [], // newest first
    rulesets: new Map(),
    rulesRelease: null,
    indexes: [],
    users: [],
    docs: new Map(), // Firestore path → fields
    docTimes: new Map(), // Firestore path → {createTime, updateTime}
    commits: 0,
    failCommits: new Set(), // the nth commits (from 1) to answer 503, writing nothing
    afterCommit: null, // (n) => void, after the nth commit is applied
    emails: [],
    github: new Map(), // release asset URL → Buffer, served without a token
  };
}

export function createFakeGoogle({ publicKeyPem, state = freshState() } = {}) {
  const calls = [];
  const unhandled = [];
  const operations = new Map();
  let counter = 0;
  let tokens = 0;
  let clock = Date.UTC(2026, 9, 1);
  const next = (prefix) => `${prefix}${(counter += 1)}`;
  const tick = () => new Date((clock += 60_000)).toISOString();

  // A document's times: a test that fills state.docs directly gets the
  // clock's start as both.
  const docTimes = (docPath) =>
    state.docTimes.get(docPath) ?? {
      createTime: new Date(Date.UTC(2026, 9, 1)).toISOString(),
      updateTime: new Date(Date.UTC(2026, 9, 1)).toISOString(),
    };
  const setDoc = (docPath, fields, time) => {
    state.docTimes.set(docPath, {
      createTime: state.docs.has(docPath) ? docTimes(docPath).createTime : time,
      updateTime: time,
    });
    state.docs.set(docPath, fields);
  };

  /** A not-yet-done operation that is done (with `response`) when polled. */
  const operation = (name, response) => {
    operations.set(name, { name, done: true, response });
    return json(200, { name, done: false });
  };

  const verifyAssertion = (assertion) => {
    const [header, claims, signature] = assertion.split(".");
    if (publicKeyPem) {
      const ok = createVerify("RSA-SHA256")
        .update(`${header}.${claims}`)
        .verify(
          createPublicKey(publicKeyPem),
          Buffer.from(signature, "base64url"),
        );
      if (!ok) return null;
    }
    return {
      header: JSON.parse(Buffer.from(header, "base64url").toString()),
      claims: JSON.parse(Buffer.from(claims, "base64url").toString()),
    };
  };

  function route(method, url, body, raw) {
    const host = url.hostname;
    const path = decodeURIComponent(url.pathname);
    const q = url.searchParams;
    let m;

    // --- operations, on any API ------------------------------------------
    if (method === "GET") {
      const name = path.replace(/^\/v1(beta1)?\//, "");
      if (operations.has(name)) return json(200, operations.get(name));
    }

    // --- Cloud Resource Manager ------------------------------------------
    if (host === "cloudresourcemanager.googleapis.com") {
      if (
        method === "POST" &&
        (m = path.match(/^\/v3\/projects\/([^/:]+):testIamPermissions$/))
      ) {
        if (m[1] !== PROJECT)
          return googleError(
            403,
            "PERMISSION_DENIED",
            "The caller does not have permission",
          );
        const held = body.permissions.filter(
          (p) => !state.permissions || state.permissions.has(p),
        );
        return json(200, held.length ? { permissions: held } : {});
      }
    }

    // --- Service Usage ---------------------------------------------------
    if (host === "serviceusage.googleapis.com") {
      if (
        method === "GET" &&
        path === `/v1/projects/${PROJECT_NUMBER}/services:batchGet`
      ) {
        return json(200, {
          services: q.getAll("names").map((name) => ({
            name,
            state: state.services.get(name.split("/").pop()) ?? "DISABLED",
          })),
        });
      }
      if (
        method === "POST" &&
        path === `/v1/projects/${PROJECT_NUMBER}/services:batchEnable`
      ) {
        if (body.serviceIds.length > 20)
          return googleError(400, "INVALID_ARGUMENT", "too many");
        for (const id of body.serviceIds) state.services.set(id, "ENABLED");
        return operation(next("operations/acat."), {});
      }
    }

    // --- Firebase Management ---------------------------------------------
    if (host === "firebase.googleapis.com") {
      if (method === "GET" && path === `/v1beta1/projects/${PROJECT}`) {
        return json(200, {
          projectId: PROJECT,
          projectNumber: PROJECT_NUMBER,
          displayName: "Test Cafe",
          state: "ACTIVE",
        });
      }
      if (method === "GET" && path === `/v1beta1/projects/${PROJECT}/webApps`) {
        return json(200, state.webApps.length ? { apps: state.webApps } : {});
      }
      if (
        method === "POST" &&
        path === `/v1beta1/projects/${PROJECT}/webApps`
      ) {
        const appId = `1:${PROJECT_NUMBER}:web:${next("abc")}`;
        const app = {
          name: `projects/${PROJECT}/webApps/${appId}`,
          appId,
          displayName: body.displayName,
          projectId: PROJECT,
          state: "ACTIVE",
        };
        state.webApps.push(app);
        return operation(next("operations/workflows/"), app);
      }
      if (
        method === "GET" &&
        (m = path.match(
          new RegExp(`^/v1beta1/projects/${PROJECT}/webApps/([^/]+)/config$`),
        ))
      ) {
        if (!state.webApps.some((a) => a.appId === m[1]))
          return googleError(404, "NOT_FOUND", "no app");
        return json(200, {
          projectId: PROJECT,
          appId: m[1],
          apiKey: "AIza-fake",
          authDomain: `${PROJECT}.firebaseapp.com`,
          storageBucket: `${PROJECT}.firebasestorage.app`,
          messagingSenderId: PROJECT_NUMBER,
        });
      }
    }

    // --- Firestore -------------------------------------------------------
    if (host === "firestore.googleapis.com") {
      if (state.services.get("firestore.googleapis.com") !== "ENABLED") {
        return googleError(
          403,
          "PERMISSION_DENIED",
          "Cloud Firestore API has not been used in project before or it is disabled. SERVICE_DISABLED",
        );
      }
      const db = `/v1/projects/${PROJECT}/databases/(default)`;
      if (method === "GET" && path === db) {
        return state.database
          ? json(200, state.database)
          : googleError(
              404,
              "NOT_FOUND",
              "The database (default) does not exist",
            );
      }
      if (method === "POST" && path === `/v1/projects/${PROJECT}/databases`) {
        if (q.get("databaseId") !== "(default)")
          return googleError(400, "INVALID_ARGUMENT", "bad id");
        if (state.database)
          return googleError(409, "ALREADY_EXISTS", "Database already exists");
        state.database = {
          name: `projects/${PROJECT}/databases/(default)`,
          locationId: body.locationId,
          type: body.type,
        };
        return operation(
          `projects/${PROJECT}/databases/(default)/operations/${next("op")}`,
          state.database,
        );
      }
      if (method === "GET" && path === `${db}/collectionGroups/-/indexes`) {
        return json(
          200,
          state.indexes.length ? { indexes: state.indexes } : {},
        );
      }
      if (
        method === "POST" &&
        (m = path.match(/\/collectionGroups\/([^/]+)\/indexes$/)) &&
        path.startsWith(db)
      ) {
        const fields = [...body.fields];
        const last = fields.at(-1);
        // Google adds __name__ in the last field's direction.
        if (last.fieldPath !== "__name__")
          fields.push({
            fieldPath: "__name__",
            order: last.order ?? "ASCENDING",
          });
        state.indexes.push({
          name: `projects/${PROJECT}/databases/(default)/collectionGroups/${m[1]}/indexes/${next("idx")}`,
          queryScope: body.queryScope,
          fields,
          state: "CREATING",
          apiScope: "ANY_API",
          density: "SPARSE_ALL",
        });
        return json(200, {
          name: `${db.slice(4)}/operations/${next("op")}`,
          done: false,
        });
      }
      const docs = `${db.slice(4)}/documents/`;
      const resource = (docPath) => ({
        name: `${docs}${docPath}`,
        fields: state.docs.get(docPath),
        ...docTimes(docPath),
      });
      if (method === "POST" && path === `${db}/documents:runQuery`) {
        const { from, orderBy, startAt, limit } = body.structuredQuery;
        if (
          from.length !== 1 ||
          from[0].allDescendants ||
          orderBy?.[0]?.field.fieldPath !== "__name__" ||
          (startAt && startAt.before !== false)
        )
          return googleError(
            400,
            "INVALID_ARGUMENT",
            "the fake can't run that query",
          );
        const after = startAt?.values[0].referenceValue.slice(docs.length);
        const found = [...state.docs.keys()]
          .filter((p) => {
            const [collection, id, ...rest] = p.split("/");
            return collection === from[0].collectionId && id && !rest.length;
          })
          .sort()
          .filter((p) => after === undefined || p > after)
          .slice(0, limit);
        const readTime = new Date(clock).toISOString();
        return json(
          200,
          found.length
            ? found.map((p) => ({ document: resource(p), readTime }))
            : [{ readTime }],
        );
      }
      if (method === "POST" && path === `${db}/documents:commit`) {
        state.commits += 1;
        if (state.failCommits.has(state.commits))
          return googleError(503, "UNAVAILABLE", "The service is unavailable");
        if (body.writes.length > 500)
          return googleError(400, "INVALID_ARGUMENT", "too many writes");
        for (const { update, currentDocument } of body.writes) {
          const docPath = update.name.slice(docs.length);
          const exists = state.docs.has(docPath);
          const { exists: want, updateTime } = currentDocument ?? {};
          if (
            (want !== undefined && want !== exists) ||
            (updateTime && docTimes(docPath).updateTime !== updateTime)
          )
            return googleError(
              400,
              "FAILED_PRECONDITION",
              "precondition failed",
            );
        }
        const commitTime = tick();
        for (const { update, updateMask } of body.writes) {
          const docPath = update.name.slice(docs.length);
          const merged = { ...(state.docs.get(docPath) ?? {}) };
          for (const field of updateMask.fieldPaths) {
            if (field in update.fields) merged[field] = update.fields[field];
            else delete merged[field];
          }
          setDoc(docPath, merged, commitTime);
        }
        state.afterCommit?.(state.commits);
        return json(200, {
          writeResults: body.writes.map(() => ({ updateTime: commitTime })),
          commitTime,
        });
      }
      if (
        (m = path.match(
          new RegExp(`^${db.replace(/[()]/g, "\\$&")}/documents/(.+)$`),
        ))
      ) {
        const docPath = m[1];
        if (method === "GET") {
          return state.docs.has(docPath)
            ? json(200, resource(docPath))
            : googleError(404, "NOT_FOUND", "no doc");
        }
        if (method === "PATCH") {
          const mask = q.getAll("updateMask.fieldPaths");
          const merged = { ...(state.docs.get(docPath) ?? {}) };
          for (const field of mask) merged[field] = body.fields[field];
          setDoc(docPath, merged, tick());
          return json(200, resource(docPath));
        }
      }
    }

    // --- Identity Toolkit ------------------------------------------------
    if (host === "identitytoolkit.googleapis.com") {
      if (path === `/v2/projects/${PROJECT}/config`) {
        if (method === "GET") {
          return state.authConfig
            ? json(200, state.authConfig)
            : googleError(404, "NOT_FOUND", "CONFIGURATION_NOT_FOUND");
        }
        if (method === "PATCH") {
          if (!state.authConfig)
            return googleError(404, "NOT_FOUND", "CONFIGURATION_NOT_FOUND");
          for (const fieldPath of q.get("updateMask").split(",")) {
            const keys = fieldPath.split(".");
            let from = body;
            let to = state.authConfig;
            for (const key of keys.slice(0, -1)) {
              from = from[key];
              to = to[key] ??= {};
            }
            to[keys.at(-1)] = from[keys.at(-1)];
          }
          return json(200, state.authConfig);
        }
      }
      if (
        method === "POST" &&
        path === `/v1/projects/${PROJECT}/accounts:lookup`
      ) {
        const users = state.users.filter((u) => body.email.includes(u.email));
        return json(
          200,
          users.length
            ? { kind: "identitytoolkit#GetAccountInfoResponse", users }
            : { kind: "identitytoolkit#GetAccountInfoResponse" },
        );
      }
      if (method === "POST" && path === `/v1/projects/${PROJECT}/accounts`) {
        if (state.users.some((u) => u.email === body.email))
          return googleError(400, undefined, "EMAIL_EXISTS");
        const user = {
          localId: next("uid"),
          email: body.email,
          displayName: body.displayName,
          emailVerified: false,
        };
        state.users.push(user);
        return json(200, {
          localId: user.localId,
          email: user.email,
          displayName: user.displayName,
        });
      }
      if (
        method === "POST" &&
        path === `/v1/projects/${PROJECT}/accounts:sendOobCode`
      ) {
        if (!state.users.some((u) => u.email === body.email))
          return googleError(400, undefined, "EMAIL_NOT_FOUND");
        state.emails.push(body);
        return json(200, { email: body.email });
      }
    }

    // --- Firebase Rules --------------------------------------------------
    if (host === "firebaserules.googleapis.com") {
      const release = `/v1/projects/${PROJECT}/releases/cloud.firestore`;
      if (method === "GET" && path === release) {
        return state.rulesRelease
          ? json(200, state.rulesRelease)
          : googleError(404, "NOT_FOUND", "no release");
      }
      if (
        method === "GET" &&
        (m = path.match(
          new RegExp(`^/v1/(projects/${PROJECT}/rulesets/[^/]+)$`),
        ))
      ) {
        const ruleset = state.rulesets.get(m[1]);
        return ruleset
          ? json(200, ruleset)
          : googleError(404, "NOT_FOUND", "no ruleset");
      }
      if (method === "POST" && path === `/v1/projects/${PROJECT}/rulesets`) {
        if (
          !body.source?.files?.[0]?.content?.includes("service cloud.firestore")
        ) {
          return googleError(400, "INVALID_ARGUMENT", "Compilation error");
        }
        const ruleset = {
          name: `projects/${PROJECT}/rulesets/${next("rs")}`,
          source: body.source,
          createTime: tick(),
        };
        state.rulesets.set(ruleset.name, ruleset);
        return json(200, ruleset);
      }
      if (method === "POST" && path === `/v1/projects/${PROJECT}/releases`) {
        if (state.rulesRelease)
          return googleError(409, "ALREADY_EXISTS", "Release already exists");
        state.rulesRelease = {
          name: body.name,
          rulesetName: body.rulesetName,
          createTime: tick(),
        };
        return json(200, state.rulesRelease);
      }
      if (method === "PATCH" && path === release) {
        if (!state.rulesRelease)
          return googleError(404, "NOT_FOUND", "no release");
        state.rulesRelease = {
          ...state.rulesRelease,
          rulesetName: body.release.rulesetName,
          updateTime: tick(),
        };
        return json(200, state.rulesRelease);
      }
    }

    // --- Hosting ---------------------------------------------------------
    if (host === "firebasehosting.googleapis.com") {
      if (state.services.get("firebasehosting.googleapis.com") !== "ENABLED") {
        return googleError(
          403,
          "PERMISSION_DENIED",
          "Firebase Hosting API has not been used in project before or it is disabled. SERVICE_DISABLED",
        );
      }
      if (
        (m = path.match(
          new RegExp(`^/v1beta1/projects/${PROJECT}/sites/([^/]+)$`),
        ))
      ) {
        const site = state.sites.get(m[1]);
        if (method === "GET")
          return site
            ? json(200, site)
            : googleError(404, "NOT_FOUND", "Requested entity was not found.");
        if (method === "PATCH" && site && q.get("updateMask") === "appId") {
          site.appId = body.appId;
          return json(200, site);
        }
      }
      if (method === "POST" && path === `/v1beta1/projects/${PROJECT}/sites`) {
        const id = q.get("siteId");
        if (state.sites.has(id) || state.takenSites.has(id)) {
          return googleError(
            409,
            "ALREADY_EXISTS",
            `Site ${id} already exists`,
          );
        }
        const site = {
          name: `projects/${PROJECT_NUMBER}/sites/${id}`,
          defaultUrl: `https://${id}.web.app`,
          appId: body.appId,
          type: "USER_SITE",
        };
        if (q.get("validateOnly") !== "true") state.sites.set(id, site);
        return json(200, site);
      }
      if (
        method === "POST" &&
        (m = path.match(/^\/v1beta1\/sites\/([^/]+)\/versions$/))
      ) {
        const name = `sites/${m[1]}/versions/${next("ver")}`;
        const version = {
          name,
          status: "CREATED",
          config: body.config ?? {},
          files: new Map(),
        };
        state.versions.set(name, version);
        return json(200, { name, status: "CREATED", config: version.config });
      }
      if (
        method === "POST" &&
        (m = path.match(
          /^\/v1beta1\/(sites\/[^/]+\/versions\/[^/:]+):populateFiles$/,
        ))
      ) {
        const version = state.versions.get(m[1]);
        if (Object.keys(body.files).length > 1000)
          return googleError(400, "INVALID_ARGUMENT", "too many files");
        for (const [filePath, hash] of Object.entries(body.files))
          version.files.set(filePath, hash);
        const required = [...new Set(Object.values(body.files))].filter(
          (h) => !state.uploaded.has(h),
        );
        const res = {
          uploadUrl: `https://upload-firebasehosting.googleapis.com/upload/${m[1]}/files`,
        };
        if (required.length) res.uploadRequiredHashes = required;
        return json(200, res);
      }
      if (
        method === "PATCH" &&
        (m = path.match(/^\/v1beta1\/(sites\/[^/]+\/versions\/[^/]+)$/))
      ) {
        const version = state.versions.get(m[1]);
        if (q.get("updateMask") !== "status" || body.status !== "FINALIZED")
          return googleError(400, "INVALID_ARGUMENT", "bad patch");
        const missing = [...version.files.values()].filter(
          (h) => !state.uploaded.has(h),
        );
        if (missing.length)
          return googleError(
            400,
            "FAILED_PRECONDITION",
            `${missing.length} files not uploaded`,
          );
        version.status = "FINALIZED";
        return json(200, {
          name: version.name,
          status: version.status,
          config: version.config,
        });
      }
      if (
        method === "POST" &&
        (m = path.match(/^\/v1beta1\/sites\/([^/]+)\/releases$/))
      ) {
        const version = state.versions.get(q.get("versionName"));
        if (!version || version.status !== "FINALIZED")
          return googleError(
            400,
            "FAILED_PRECONDITION",
            "version not finalized",
          );
        const release = {
          name: `sites/${m[1]}/channels/live/releases/${next("rel")}`,
          version: {
            name: version.name,
            status: version.status,
            config: version.config,
          },
          type: "DEPLOY",
          releaseTime: tick(),
          message: body.message,
        };
        state.releases.unshift(release);
        return json(200, release);
      }
      if (
        method === "GET" &&
        (m = path.match(/^\/v1beta1\/sites\/([^/]+)\/channels\/live$/))
      ) {
        const release = state.releases[0];
        return json(200, {
          name: `sites/${m[1]}/channels/live`,
          ...(release && { release }),
        });
      }
      if (
        method === "GET" &&
        /^\/v1beta1\/sites\/[^/]+\/channels\/live\/releases$/.test(path)
      ) {
        return json(
          200,
          state.releases.length ? { releases: state.releases } : {},
        );
      }
      if (
        method === "GET" &&
        (m = path.match(/^\/v1beta1\/(sites\/[^/]+\/versions\/[^/]+)$/))
      ) {
        const version = state.versions.get(m[1]);
        return version
          ? json(200, {
              name: version.name,
              status: version.status,
              config: version.config,
            })
          : googleError(404, "NOT_FOUND", "no version");
      }
      if (
        method === "GET" &&
        (m = path.match(/^\/v1beta1\/(sites\/[^/]+\/versions\/[^/]+)\/files$/))
      ) {
        const version = state.versions.get(m[1]);
        return json(200, {
          files: [...version.files].map(([filePath, hash]) => ({
            path: filePath,
            hash,
            status: "ACTIVE",
          })),
        });
      }
    }

    if (host === "upload-firebasehosting.googleapis.com" && method === "POST") {
      if (
        (m = path.match(
          /^\/upload\/(sites\/[^/]+\/versions\/[^/]+)\/files\/([0-9a-f]{64})$/,
        ))
      ) {
        const actual = createHash("sha256").update(raw).digest("hex");
        if (actual !== m[2])
          return googleError(400, "INVALID_ARGUMENT", "hash mismatch");
        state.uploaded.add(m[2]);
        return new Response(null, { status: 200 });
      }
    }

    unhandled.push(`${method} ${url}`);
    return googleError(
      501,
      "UNIMPLEMENTED",
      `fake-google has no route for ${method} ${url}`,
    );
  }

  async function fetchImpl(input, init = {}) {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const headers = Object.fromEntries(
      Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    );
    const raw = Buffer.isBuffer(init.body) ? init.body : null;
    let body;
    if (typeof init.body === "string") {
      body = headers["content-type"]?.includes("json")
        ? JSON.parse(init.body)
        : Object.fromEntries(new URLSearchParams(init.body));
    }
    calls.push({ method, url: url.toString(), body, raw, headers });

    if (url.toString() === "https://oauth2.googleapis.com/token") {
      if (body?.grant_type !== "urn:ietf:params:oauth:grant-type:jwt-bearer") {
        return json(400, { error: "unsupported_grant_type" });
      }
      if (!verifyAssertion(body.assertion)) {
        return json(400, {
          error: "invalid_grant",
          error_description: "Invalid JWT Signature.",
        });
      }
      tokens += 1;
      return json(200, {
        access_token: `fake-token-${tokens}`,
        expires_in: 3599,
        token_type: "Bearer",
      });
    }
    if (url.hostname === "github.com") {
      const asset = method === "GET" && state.github.get(url.toString());
      return asset
        ? new Response(asset, { status: 200 })
        : new Response("Not Found", { status: 404 });
    }
    if (!/^Bearer fake-token-\d+$/.test(headers.authorization ?? "")) {
      return googleError(
        401,
        "UNAUTHENTICATED",
        "Request had invalid authentication credentials.",
      );
    }
    return route(method, url, body, raw);
  }

  return {
    fetchImpl,
    state,
    calls,
    unhandled,
    /** Calls to the APIs, without the token exchange. */
    apiCalls: () =>
      calls.filter((c) => !c.url.startsWith("https://oauth2.googleapis.com/")),
  };
}

/** POSTs that only read. Everything else that isn't a GET writes. */
export const READ_ONLY_POST = [
  /:testIamPermissions$/,
  /\/documents:runQuery$/,
  /\/accounts:lookup$/,
  /[?&]validateOnly=true(&|$)/,
];

export const isWrite = (call) =>
  call.method !== "GET" &&
  !(call.method === "POST" && READ_ONLY_POST.some((re) => re.test(call.url)));
