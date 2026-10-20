/**
 * The credential and request plumbing behind seed:staff and cleanup:orders.
 * Everything goes through an injected fetch and a temporary config directory,
 * so no test here can reach a real project.
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  UsageError,
  connect,
  createAdminClient,
  decodeFields,
  getAccessToken,
  resolveProject,
} from "../lib/admin-client.mjs";

const dirs = [];
async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "admin-client-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

async function configWith(tokens) {
  const dir = await tempDir();
  await mkdir(join(dir, "configstore"), { recursive: true });
  await writeFile(
    join(dir, "configstore", "firebase-tools.json"),
    JSON.stringify({ tokens }),
  );
  return { XDG_CONFIG_HOME: dir };
}

function recordingFetch(respond = () => ({ status: 200, body: {} })) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), ...init });
    const { status, body } = respond(String(url), init);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => (body === undefined ? "" : JSON.stringify(body)),
    };
  };
  return { calls, fetchImpl };
}

describe("getAccessToken", () => {
  const now = Date.parse("2026-09-27T10:00:00Z");

  it("reuses the CLI's access token while it has time left", async () => {
    const env = await configWith({
      access_token: "cached",
      refresh_token: "r",
      expires_at: now + 30 * 60_000,
    });
    const { calls, fetchImpl } = recordingFetch();
    expect(await getAccessToken({ env, fetchImpl, now })).toBe("cached");
    expect(calls).toHaveLength(0);
  });

  it("refreshes a nearly expired token, in memory only", async () => {
    const env = await configWith({
      access_token: "stale",
      refresh_token: "the-refresh-token",
      expires_at: now + 60_000,
    });
    const { calls, fetchImpl } = recordingFetch(() => ({
      status: 200,
      body: { access_token: "fresh" },
    }));
    expect(await getAccessToken({ env, fetchImpl, now })).toBe("fresh");
    expect(calls[0].url).toMatch(/oauth2\/v3\/token$/);
    const form = new URLSearchParams(String(calls[0].body));
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("the-refresh-token");
  });

  it("prefers FIREBASE_TOKEN, for CI-style logins", async () => {
    const { calls, fetchImpl } = recordingFetch(() => ({
      status: 200,
      body: { access_token: "from-ci" },
    }));
    const token = await getAccessToken({
      env: { FIREBASE_TOKEN: "ci-refresh", XDG_CONFIG_HOME: "/nonexistent" },
      fetchImpl,
      now,
    });
    expect(token).toBe("from-ci");
    expect(
      new URLSearchParams(String(calls[0].body)).get("refresh_token"),
    ).toBe("ci-refresh");
  });

  it("tells you to log in when there is no CLI session", async () => {
    await expect(
      getAccessToken({ env: { XDG_CONFIG_HOME: await tempDir() }, now }),
    ).rejects.toThrow(/firebase login/);
  });

  it("tells you to re-authenticate when the refresh is refused", async () => {
    const env = await configWith({ refresh_token: "revoked", expires_at: 0 });
    const { fetchImpl } = recordingFetch(() => ({
      status: 400,
      body: { error: "invalid_grant" },
    }));
    await expect(getAccessToken({ env, fetchImpl, now })).rejects.toThrow(
      /--reauth/,
    );
  });
});

describe("resolveProject", () => {
  it("prefers the flag, then .firebaserc's default", async () => {
    const dir = await tempDir();
    await writeFile(
      join(dir, ".firebaserc"),
      JSON.stringify({ projects: { default: "toi-cafe" } }),
    );
    expect(await resolveProject("other", dir)).toBe("other");
    expect(await resolveProject(undefined, dir)).toBe("toi-cafe");
  });

  it("refuses to guess", async () => {
    await expect(resolveProject(undefined, await tempDir())).rejects.toThrow(
      UsageError,
    );
  });
});

describe("connect", () => {
  it("will not split one script between an emulator and production", async () => {
    await expect(
      connect({
        projectFlag: "p",
        needsAuth: true,
        env: { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" },
      }),
    ).rejects.toThrow(/both/);
  });
});

describe("createAdminClient requests", () => {
  it("merges only name and role into /staff/{uid}", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const client = createAdminClient({
      project: "toi-cafe",
      token: "tok",
      env: {},
      fetchImpl,
    });
    await client.setStaffDoc("u1", { name: "Asha", role: "staff" });
    const [call] = calls;
    expect(call.method).toBe("PATCH");
    expect(call.url).toBe(
      "https://firestore.googleapis.com/v1/projects/toi-cafe/databases/(default)/documents/staff/u1?updateMask.fieldPaths=name&updateMask.fieldPaths=role",
    );
    expect(call.headers.authorization).toBe("Bearer tok");
    expect(JSON.parse(call.body)).toEqual({
      fields: {
        name: { stringValue: "Asha" },
        role: { stringValue: "staff" },
      },
    });
  });

  it("reads a missing staff doc as null, not an error", async () => {
    const { fetchImpl } = recordingFetch(() => ({ status: 404, body: {} }));
    const client = createAdminClient({
      project: "p",
      token: "t",
      env: {},
      fetchImpl,
    });
    expect(await client.getStaffDoc("nobody")).toBeNull();
  });

  it("talks to the emulators with their admin token when asked", async () => {
    const { calls, fetchImpl } = recordingFetch(() => ({
      status: 200,
      body: { users: [{ localId: "u9", email: "a@b.co" }] },
    }));
    const client = createAdminClient({
      project: "demo-cafe",
      token: "ignored",
      env: {
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
        FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
      },
      fetchImpl,
    });
    expect(client.target).toBe("the local emulators");
    expect(await client.lookupUserByEmail("a@b.co")).toEqual({
      uid: "u9",
      email: "a@b.co",
      displayName: undefined,
    });
    expect(calls[0].url).toBe(
      "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/demo-cafe/accounts:lookup",
    );
    expect(calls[0].headers.authorization).toBe("Bearer owner");
  });

  it("surfaces an API error with its message", async () => {
    const { fetchImpl } = recordingFetch(() => ({
      status: 403,
      body: { error: { message: "The caller does not have permission" } },
    }));
    const client = createAdminClient({
      project: "p",
      token: "t",
      env: {},
      fetchImpl,
    });
    await expect(
      client.createUser({ email: "a@b.co", password: "xxxxxxxx" }),
    ).rejects.toThrow(/403.*does not have permission/);
  });

  it("counts with a plain count aggregation, and reads query errors from an array", async () => {
    let fail = false;
    const { calls, fetchImpl } = recordingFetch(() =>
      fail
        ? { status: 400, body: [{ error: { message: "requires an index" } }] }
        : {
            status: 200,
            body: [
              { result: { aggregateFields: { n: { integerValue: "7" } } } },
            ],
          },
    );
    const client = createAdminClient({
      project: "p",
      token: "t",
      env: {},
      fetchImpl,
    });
    const cutoff = new Date("2026-03-27T00:00:00Z");
    expect(await client.countOrdersBefore(cutoff)).toBe(7);
    const sent = JSON.parse(calls[0].body).structuredAggregationQuery;
    // A sum() here would need a composite index the project does not have.
    expect(sent.aggregations).toEqual([{ alias: "n", count: {} }]);
    expect(sent.structuredQuery.where.fieldFilter).toEqual({
      field: { fieldPath: "createdAt" },
      op: "LESS_THAN",
      value: { timestampValue: "2026-03-27T00:00:00.000Z" },
    });
    fail = true;
    await expect(client.countOrdersBefore(cutoff)).rejects.toThrow(
      /\(400\): requires an index/,
    );
  });

  it("decodes the Firestore value types these scripts read", () => {
    expect(
      decodeFields({
        s: { stringValue: "x" },
        i: { integerValue: "42" },
        d: { doubleValue: 1.5 },
        b: { booleanValue: true },
        t: { timestampValue: "2026-01-01T00:00:00Z" },
        n: { nullValue: null },
      }),
    ).toEqual({
      s: "x",
      i: 42,
      d: 1.5,
      b: true,
      t: new Date("2026-01-01T00:00:00Z"),
      n: null,
    });
  });
});
