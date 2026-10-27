/**
 * The free backend end to end (#77): a request the console would write, under
 * the console's real Firestore rules, is processed by the worker program
 * (`npm run worker`, as the workflow runs it) against the Auth and Firestore
 * emulators and the deployer's fake Google. No Functions emulator is running:
 * nothing but the worker does the work.
 *
 * Run with `npm run test:worker` (Node 22.18+, Java 21 for Firestore).
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { Timestamp, getFirestore } from "firebase-admin/firestore";

import {
  SETTINGS,
  SITE,
  publish,
  releasePackage,
} from "../../../../packages/deployer/tests/helpers/release.mjs";
import { startFakeGoogle } from "../helpers/fake-google-server.mjs";
import { solidPng } from "../helpers/png.mjs";

const PROJECT = "demo-cafemenu";
const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8180";
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9199";
const APP = fileURLToPath(new URL("../..", import.meta.url));
const FAKE_PORT = 8399;

process.env.GCLOUD_PROJECT = PROJECT;
process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE;
process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH;
const app = initializeApp({ projectId: PROJECT });
const db = getFirestore(app);
const auth = getAuth(app);

async function signUp(email) {
  const user = await auth.createUser({
    email,
    password: "correct-horse-1",
    emailVerified: true,
  });
  const res = await fetch(
    `http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password: "correct-horse-1",
        returnSecureToken: true,
      }),
    },
  );
  const { idToken } = await res.json();
  return { uid: user.uid, email, idToken };
}

const field = (value) => {
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  return {
    mapValue: {
      fields: Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, field(v)]),
      ),
    },
  };
};

/**
 * Writes a request the way the console does (apps/console/src/lib/data/
 * requests.ts): as the signed-in owner, through the rules, with the server's
 * time. Returns the document's id, or throws what the rules said.
 */
async function ask(who, cafeId, kind, params = {}, extra = {}) {
  const id = `req-${kind}-${Math.random().toString(36).slice(2, 8)}`;
  const name = `projects/${PROJECT}/databases/(default)/documents/requests/${id}`;
  const record = {
    cafeId,
    ownerUid: who.uid,
    by: who.uid,
    kind,
    params,
    status: "queued",
    ...extra,
  };
  const res = await fetch(
    `http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents:commit`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${who.idToken}`,
      },
      body: JSON.stringify({
        writes: [
          {
            update: {
              name,
              fields: Object.fromEntries(
                Object.entries(record).map(([k, v]) => [k, field(v)]),
              ),
            },
            updateTransforms: [
              { fieldPath: "createdAt", setToServerValue: "REQUEST_TIME" },
            ],
            currentDocument: { exists: false },
          },
        ],
      }),
    },
  );
  if (!res.ok) {
    const body = await res.json();
    throw Object.assign(new Error(body.error?.message), {
      status: body.error?.status,
    });
  }
  return id;
}

const exec = promisify(execFile);

/** One run of `npm run worker`, as a process of its own. */
async function runWorker() {
  const { stdout } = await exec(process.execPath, ["src/worker-main.mjs"], {
    cwd: APP,
    env: {
      ...process.env,
      GITHUB_EVENT_NAME: "schedule",
      GITHUB_RUN_ID: String(Date.now()),
      CAFEMENU_FAKE_GOOGLE: `http://127.0.0.1:${FAKE_PORT}`,
    },
    timeout: 120_000,
  });
  return stdout;
}

const request = async (id) => (await db.doc(`requests/${id}`).get()).data();
const release = (version) =>
  db.doc(`releases/${version}`).set({
    channel: "stable",
    notes: "",
    publishedAt: Timestamp.now(),
    schemaVersion: 1,
    withdrawn: false,
  });

describe("the worker, for requests the console wrote", () => {
  let fake;
  let owner;
  let stranger;
  let cafeId;

  before(async () => {
    fake = await startFakeGoogle({ port: FAKE_PORT });
    for (const version of ["1.0.0", "1.1.0"]) {
      await publish(fake.google, await releasePackage(version));
      await release(version);
    }
    owner = await signUp("owner@example.com");
    stranger = await signUp("stranger@example.com");
    const ref = db.collection("cafes").doc();
    cafeId = ref.id;
    await ref.set({
      ownerUid: owner.uid,
      ownerEmail: owner.email,
      projectId: "test-cafe",
      site: SITE,
      region: "asia-south1",
      settings: { ...SETTINGS, logo: "/logo.png" },
      release: {
        channel: "stable",
        pinned: null,
        current: null,
        previous: null,
      },
      status: "draft",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await ref
      .collection("setup")
      .doc("logo")
      .set({ png: solidPng(), updatedAt: Timestamp.now() });
    await ref
      .collection("setup")
      .doc("menu")
      .set({
        source: "template",
        template: "coffee-shop",
        currency: "INR",
        items: [
          {
            name: "Masala chai",
            category: "Tea",
            description: "",
            price: 6000,
            available: true,
          },
        ],
        updatedAt: Timestamp.now(),
      });
  });

  after(async () => {
    await fake?.close();
  });

  it("refuses, at the rules, a request the owner may not make", async () => {
    await assert.rejects(ask(stranger, cafeId, "provision"), {
      status: "PERMISSION_DENIED",
    });
    await assert.rejects(
      ask(owner, cafeId, "provision", {}, { status: "done" }),
      { status: "PERMISSION_DENIED" },
    );
    await assert.rejects(ask(owner, cafeId, "publish"), {
      status: "PERMISSION_DENIED",
    });
    assert.equal((await db.collection("requests").get()).size, 0);
  });

  it("does nothing, and says so, when nothing is asked", async () => {
    assert.match(await runWorker(), /Requests: none\./);
  });

  it("answers a connection check", async () => {
    const id = await ask(owner, cafeId, "check", { projectId: "test-cafe" });
    const queued = await request(id);
    assert.equal(queued.status, "queued");
    assert.ok(queued.createdAt, "with the server's time");

    assert.match(await runWorker(), /Requests: 1 done\./);
    const done = await request(id);
    assert.equal(done.status, "done");
    assert.deepEqual(done.result, { status: "connected" });
    assert.deepEqual(
      done.steps.map((s) => s.status),
      ["done"],
    );
    assert.equal(done.attempts, 1);
    assert.equal(done.lease, null);
  });

  it("sets a cafe up from a request, and shows each step done on it", async () => {
    const id = await ask(owner, cafeId, "provision");
    assert.match(await runWorker(), /Requests: 1 done\./);

    const done = await request(id);
    assert.equal(done.status, "done", done.error);
    assert.equal(done.result.status, "succeeded");
    assert.equal(done.result.siteUrl, `https://${SITE}.web.app`);
    assert.ok(done.steps.length > 1);
    assert.ok(done.steps.every((s) => s.status === "done"));

    const deployment = (
      await db.doc(`deployments/${done.deploymentId}`).get()
    ).data();
    assert.equal(deployment.status, "succeeded");
    assert.equal(deployment.ownerUid, owner.uid);
    const cafe = (await db.doc(`cafes/${cafeId}`).get()).data();
    assert.equal(cafe.status, "live");
    assert.deepEqual(
      [cafe.release.current, cafe.release.previous],
      ["1.1.0", null],
    );
    assert.ok(fake.state.sites.has(SITE));
    assert.equal(fake.state.users.length, 1);
  });

  it("upgrades, rolls back and syncs branding from requests, in the order they were asked", async () => {
    await release("1.2.0");
    await publish(fake.google, await releasePackage("1.2.0"));
    const up = await ask(owner, cafeId, "deploy", { version: "1.2.0" });
    const back = await ask(owner, cafeId, "rollback");
    const sync = await ask(owner, cafeId, "sync-branding");

    // One run does all three, one after the other.
    assert.match(await runWorker(), /Requests: 3 done\./);
    for (const id of [up, back, sync]) {
      const done = await request(id);
      assert.equal(done.status, "done", done.error);
    }
    const cafe = (await db.doc(`cafes/${cafeId}`).get()).data();
    assert.deepEqual(
      [cafe.release.current, cafe.release.previous],
      ["1.1.0", null],
    );
    const kinds = await Promise.all(
      [up, back, sync].map(async (id) => {
        const { deploymentId } = await request(id);
        return (await db.doc(`deployments/${deploymentId}`).get()).data().kind;
      }),
    );
    assert.deepEqual(kinds, ["deploy", "rollback", "branding"]);
  });

  it("answers a request the cafe's state refuses, in words, and one forged past the rules", async () => {
    // Nothing to roll back to now.
    const refused = await ask(owner, cafeId, "rollback");
    // Written by the backend's account (no rules), as if the rules had a hole.
    const forged = db.collection("requests").doc("forged");
    await forged.set({
      cafeId,
      ownerUid: stranger.uid,
      by: stranger.uid,
      kind: "deploy",
      params: { version: "1.2.0" },
      status: "queued",
      createdAt: Timestamp.now(),
    });
    assert.match(await runWorker(), /Requests: 2 failed\./);

    const one = await request(refused);
    assert.equal(one.status, "failed");
    assert.equal(one.errorCode, "failed-precondition");
    assert.match(one.error, /nothing to roll back to/);
    const two = await request("forged");
    assert.equal(two.status, "failed");
    assert.equal(two.errorCode, "permission-denied");
    const cafe = (await db.doc(`cafes/${cafeId}`).get()).data();
    assert.equal(
      cafe.release.current,
      "1.1.0",
      "the forged deploy did nothing",
    );
  });

  it("never lets two runs take the same request", async () => {
    await release("1.3.0");
    await publish(fake.google, await releasePackage("1.3.0"));
    const id = await ask(owner, cafeId, "deploy", { version: "1.3.0" });
    const [a, b] = await Promise.all([runWorker(), runWorker()]);
    const outcomes = [a, b].map((o) => /Requests: (.*?)\./.exec(o)[1]);
    assert.equal(
      outcomes.filter((o) => o === "1 done").length,
      1,
      `one run did it: ${outcomes.join(" | ")}`,
    );
    const done = await request(id);
    assert.equal(done.status, "done", done.error);
    assert.equal(done.attempts, 1);
    const deployments = await db
      .collection("deployments")
      .where("version", "==", "1.3.0")
      .get();
    assert.equal(deployments.size, 1);
  });

  it("tells a cafe on a line the window dropped to upgrade, once", async () => {
    // 1.0, 1.1 and 1.2 are old now, 1.3 is out: only 1.3 and 1.2 are supported.
    const second = db.collection("cafes").doc();
    const first = (await db.doc(`cafes/${cafeId}`).get()).data();
    await second.set({
      ...first,
      site: "second-cafe",
      status: "live",
      release: {
        channel: "stable",
        pinned: "1.1",
        current: "1.1.0",
        previous: null,
      },
    });
    await db.doc("state/worker").delete();

    assert.match(await runWorker(), /emails: \d+ sent, 0 failed\./);
    const mail = (await db.doc(`cafes/${second.id}/private/mail`).get()).data();
    assert.ok(
      Object.keys(mail.sent).some((key) =>
        key.startsWith("upgrade-required:1.1:"),
      ),
      `sent: ${Object.keys(mail.sent)}`,
    );

    // Not due again for an hour, and never twice.
    assert.match(await runWorker(), /emails: not due\./);
    await db.doc("state/worker").delete();
    assert.match(await runWorker(), /emails: 0 sent, 0 failed\./);
  });
});
