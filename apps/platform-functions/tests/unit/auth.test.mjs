import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createGoogleClient } from "@cafemenu/deployer";

import {
  authorize,
  checkConnection,
  requestSyncBranding,
  startProvisioning,
  toConnectionResult,
} from "../../src/callables.mjs";
import {
  CAFE_ID,
  OWNER,
  PROJECT,
  call,
  draftCafe,
  testEnv,
} from "../helpers/env.mjs";

const OTHER = { uid: "someone-else", email: "other@example.com" };

async function withCafe(cafe = {}) {
  const t = await testEnv();
  t.store.addCafe(draftCafe(cafe));
  return t;
}

describe("who may ask", () => {
  it("the cafe's owner, with a verified email", async () => {
    const t = await withCafe();
    const { cafe, trigger } = await authorize(t.env, call({ cafeId: CAFE_ID }));
    assert.equal(cafe.id, CAFE_ID);
    assert.equal(trigger, "owner");
  });

  it("the admin, whose claim only counts with a verified email", async () => {
    const t = await withCafe();
    const admin = await authorize(
      t.env,
      call({ cafeId: CAFE_ID }, OTHER, { admin: true }),
    );
    assert.equal(admin.trigger, "admin");
    await assert.rejects(
      authorize(
        t.env,
        call({ cafeId: CAFE_ID }, OTHER, {
          admin: true,
          email_verified: false,
        }),
      ),
      { code: "permission-denied" },
    );
  });

  it("nobody else: not another owner, not an unverified owner, not a stranger who guesses an id", async () => {
    const t = await withCafe();
    await assert.rejects(authorize(t.env, call({ cafeId: CAFE_ID }, OTHER)), {
      code: "permission-denied",
    });
    await assert.rejects(
      authorize(
        t.env,
        call({ cafeId: CAFE_ID }, OWNER, { email_verified: false }),
      ),
      { code: "permission-denied" },
    );
    // A cafe that doesn't exist looks the same as one that isn't yours...
    await assert.rejects(authorize(t.env, call({ cafeId: "nope" }, OTHER)), {
      code: "permission-denied",
    });
    // ...except to the admin, who may know.
    await assert.rejects(
      authorize(t.env, call({ cafeId: "nope" }, OTHER, { admin: true })),
      { code: "not-found" },
    );
  });

  it("needs a signed-in caller and a plain cafe id", async () => {
    const t = await withCafe();
    await assert.rejects(
      authorize(t.env, { auth: null, data: { cafeId: CAFE_ID } }),
      {
        code: "unauthenticated",
      },
    );
    for (const cafeId of [undefined, "", "a/b", "../x", 7, "x".repeat(65)]) {
      await assert.rejects(authorize(t.env, call({ cafeId })), {
        code: "invalid-argument",
      });
    }
  });

  it("every request handler asks first", async () => {
    const t = await withCafe();
    await assert.rejects(
      startProvisioning(t.env, call({ cafeId: CAFE_ID }, OTHER)),
      { code: "permission-denied" },
    );
    await assert.rejects(
      requestSyncBranding(t.env, call({ cafeId: CAFE_ID }, OTHER)),
      { code: "permission-denied" },
    );
    assert.equal(t.store.data.deployments.size, 0, "nothing was queued");
  });
});

describe("checkConnection", () => {
  const ask = (t, projectId = PROJECT, who = OWNER) =>
    checkConnection(t.env, call({ cafeId: CAFE_ID, projectId }, who));

  it("connected when every permission is there", async () => {
    const t = await withCafe();
    assert.deepEqual(await ask(t), { status: "connected" });
  });

  it("lists each missing permission once, with what needs it", async () => {
    const t = await withCafe();
    t.state.permissions = new Set(["firebase.projects.get"]);
    const result = await ask(t);
    assert.equal(result.status, "missing");
    const names = result.missing.map((m) => m.permission);
    assert.equal(new Set(names).size, names.length);
    const rules = result.missing.find(
      (m) => m.permission === "firebaserules.releases.update",
    );
    assert.deepEqual(rules.neededBy, ["deploy", "rollback"]);
    assert.match(rules.why, /rules/);
  });

  it("no-access when the deploy account can't see the project", async () => {
    const t = await withCafe({ projectId: "other-project-1a2b" });
    assert.deepEqual(await ask(t, "other-project-1a2b"), {
      status: "no-access",
    });
  });

  it("only for the project saved on the cafe, and only for its owner", async () => {
    const t = await withCafe();
    await assert.rejects(ask(t, "another-project-9z"), {
      code: "failed-precondition",
    });
    await assert.rejects(ask(t, "Not A Project"), { code: "invalid-argument" });
    await assert.rejects(ask(t, PROJECT, OTHER), { code: "permission-denied" });
  });

  it("answers `unavailable` when Google fails, rather than a wrong verdict", async () => {
    const t = await withCafe();
    const original = t.env.google.contextFor.bind(t.env.google);
    t.env.google.contextFor = async (...args) => ({
      ...(await original(...args)),
      api: createGoogleClient({
        fetchImpl: async () =>
          new Response('{"error":{"status":"UNAVAILABLE","message":"down"}}', {
            status: 503,
          }),
        getToken: async () => "fake-token-1",
        sleep: async () => {},
      }),
    });
    await assert.rejects(ask(t), {
      code: "unavailable",
      message: /Try again in a minute/,
    });
  });

  it("toConnectionResult merges a permission needed by two commands", () => {
    assert.deepEqual(
      toConnectionResult({
        ok: false,
        missing: {
          provision: [{ permission: "a.b.c", why: "do x" }],
          deploy: [{ permission: "a.b.c", why: "do x" }],
        },
      }),
      {
        status: "missing",
        missing: [
          {
            permission: "a.b.c",
            why: "do x",
            neededBy: ["provision", "deploy"],
          },
        ],
      },
    );
    assert.deepEqual(toConnectionResult({ ok: true, missing: {} }), {
      status: "connected",
    });
  });
});
