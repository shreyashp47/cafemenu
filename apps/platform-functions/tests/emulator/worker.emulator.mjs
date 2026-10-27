/**
 * The backend on GitHub Actions (#77), end to end on the emulators: an owner
 * signs in with the Firebase client SDK, as the console does, and writes
 * requests through the platform's real firestore.rules; the worker, run as
 * the workflow runs it (`node src/worker/main.mjs`, its own process), picks
 * them up and does them against the deployer's fake Google; and the owner's
 * live listener sees each one go from queued to done.
 *
 * Only Auth and Firestore are emulated: the worker needs no Cloud Functions.
 * Run with `npm run test:emulator:worker` (Node 22.18+, Java 21). With
 * CAFEMENU_WORKER_DIR=.deploy it runs the worker from the staged package,
 * installed as the workflow installs it (CI does both).
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { initializeApp as initializeAdmin } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import {
  Timestamp,
  getFirestore as getAdminFirestore,
} from "firebase-admin/firestore";
import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
} from "firebase/auth";
import {
  addDoc,
  collection,
  connectFirestoreEmulator,
  doc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setLogLevel,
} from "firebase/firestore";

import { newRequestRecord } from "@cafemenu/shared/requests";

import { decodeFields } from "../../../../packages/deployer/src/apis/firestore.mjs";
import {
  SETTINGS,
  SITE,
  publish,
  releasePackage,
} from "../../../../packages/deployer/tests/helpers/release.mjs";
import { startFakeGoogle } from "../helpers/fake-google-server.mjs";

const PROJECT = "demo-cafemenu";
const CAFE_PROJECT = "test-cafe"; // the project the fake Google answers for
const HOST = "127.0.0.1";
const AUTH_PORT = 9199;
const FS_PORT = 8180;
const PASSWORD = "correct-horse-1";
const APP = join(dirname(fileURLToPath(import.meta.url)), "../..");
const WORKER_DIR = join(APP, process.env.CAFEMENU_WORKER_DIR ?? ".");

setLogLevel("silent");
process.env.GCLOUD_PROJECT = PROJECT;
const admin = initializeAdmin({ projectId: PROJECT }, "seed");
const db = getAdminFirestore(admin);
const adminAuth = getAdminAuth(admin);

/** A verified account, and a browser signed in as it. */
async function owner(email) {
  const user = await adminAuth.createUser({
    email,
    password: PASSWORD,
    emailVerified: true,
  });
  const app = initializeApp(
    { projectId: PROJECT, apiKey: "demo", authDomain: "demo.local" },
    email,
  );
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${HOST}:${AUTH_PORT}`, {
    disableWarnings: true,
  });
  const browser = getFirestore(app);
  connectFirestoreEmulator(browser, HOST, FS_PORT);
  await signInWithEmailAndPassword(auth, email, PASSWORD);
  return { uid: user.uid, email, app, db: browser };
}

/** What the console's requests adapter writes (apps/console/src/lib/data/requests.ts). */
const ask = (who, cafeId, kind, params = {}) =>
  addDoc(
    collection(who.db, "requests"),
    newRequestRecord({ cafeId, kind, params, by: who.uid }, serverTimestamp()),
  );

const runWorker = promisify(execFile);
/** One run of the backend, as the workflow does it. Returns its log. */
async function worker(...args) {
  const { stdout } = await runWorker(
    process.execPath,
    ["src/worker/main.mjs", ...args],
    {
      cwd: WORKER_DIR,
      env: {
        ...process.env,
        GCLOUD_PROJECT: PROJECT,
        FIRESTORE_EMULATOR_HOST:
          process.env.FIRESTORE_EMULATOR_HOST ?? `${HOST}:${FS_PORT}`,
        FIREBASE_AUTH_EMULATOR_HOST:
          process.env.FIREBASE_AUTH_EMULATOR_HOST ?? `${HOST}:${AUTH_PORT}`,
        CAFEMENU_FAKE_GOOGLE: "http://127.0.0.1:8399",
      },
      timeout: 120_000,
    },
  );
  return stdout;
}

/** Everything a request's listener saw, as the console's would. */
function watch(ref) {
  const seen = [];
  const stop = onSnapshot(ref, (snap) => {
    const data = snap.data();
    if (data) seen.push(data);
  });
  return { seen, stop, last: () => seen.at(-1) };
}

const until = async (what, read, seconds = 30) => {
  const end = Date.now() + seconds * 1000;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
};
const finished = (w) => () =>
  ["done", "failed"].includes(w.last()?.status) ? w.last() : null;

async function release(version) {
  await publish(fake.google, await releasePackage(version));
  await db.doc(`releases/${version}`).set({
    channel: "stable",
    notes: "",
    publishedAt: Timestamp.now(),
    schemaVersion: 1,
    withdrawn: false,
  });
}

let fake;
let alice;
let mallory;
let cafeId;
const logs = [];

describe("requests from the console, done by the worker", () => {
  before(async () => {
    fake = await startFakeGoogle();
    for (const version of ["1.0.0", "1.1.0"]) await release(version);
    alice = await owner("alice@owner.test");
    mallory = await owner("mallory@owner.test");
    const ref = db.collection("cafes").doc();
    cafeId = ref.id;
    await ref.set({
      ownerUid: alice.uid,
      ownerEmail: alice.email,
      projectId: CAFE_PROJECT,
      site: SITE,
      region: "asia-south1",
      settings: { ...SETTINGS },
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
    await Promise.all([alice, mallory].map((who) => deleteApp(who.app)));
    await fake?.close();
  });

  it("refuses, at the rules, a request for someone else's cafe", async () => {
    await assert.rejects(ask(mallory, cafeId, "rollback"), {
      code: "permission-denied",
    });
  });

  it("checks the connection, and the owner's listener sees it answered", async () => {
    const ref = await ask(alice, cafeId, "check", { projectId: CAFE_PROJECT });
    const w = watch(ref);
    await until("the request to be seen queued", () =>
      w.seen.some((d) => d.status === "queued"),
    );
    logs.push(await worker());
    const request = await until("the answer", finished(w));
    w.stop();
    assert.equal(request.status, "done", request.error);
    assert.deepEqual(request.result, { status: "connected" });
    assert.equal(request.attempts, 1);
  });

  it("sets the cafe up, with live progress, and the cafe is live", async () => {
    const ref = await ask(alice, cafeId, "provision");
    const w = watch(ref);
    logs.push(await worker());
    const request = await until("the setup", finished(w));
    w.stop();
    assert.equal(request.status, "done", request.error);
    assert.equal(request.result.outcome, "succeeded");
    assert.equal(request.result.siteUrl, `https://${SITE}.web.app`);
    assert.ok(request.progress.steps.every((s) => s.status === "done"));
    assert.ok(
      w.seen.some((d) => d.status === "running"),
      "the owner saw it running",
    );

    const cafe = (await db.doc(`cafes/${cafeId}`).get()).data();
    assert.equal(cafe.status, "live");
    assert.equal(cafe.release.current, "1.1.0");
    const deployment = (
      await db.doc(`deployments/${request.deploymentId}`).get()
    ).data();
    assert.equal(deployment.status, "succeeded");
    assert.equal(deployment.trigger, "owner");
    assert.equal(
      decodeFields(fake.state.docs.get("config/site")).name,
      SETTINGS.name,
    );
    assert.equal(fake.state.users[0].email, alice.email);
  });

  it("upgrades, rolls back and syncs branding, one request each", async () => {
    await release("1.2.0");
    const up = watch(await ask(alice, cafeId, "deploy", { version: "1.2.0" }));
    logs.push(await worker());
    assert.equal((await until("the upgrade", finished(up))).status, "done");
    up.stop();
    let cafe = (await db.doc(`cafes/${cafeId}`).get()).data();
    assert.deepEqual(
      [cafe.release.current, cafe.release.previous],
      ["1.2.0", "1.1.0"],
    );

    const back = watch(await ask(alice, cafeId, "rollback"));
    const sync = watch(await ask(alice, cafeId, "sync-branding"));
    logs.push(await worker());
    assert.equal((await until("the roll back", finished(back))).status, "done");
    assert.equal((await until("the sync", finished(sync))).status, "done");
    back.stop();
    sync.stop();
    cafe = (await db.doc(`cafes/${cafeId}`).get()).data();
    assert.deepEqual(
      [cafe.release.current, cafe.release.previous],
      ["1.1.0", null],
    );
  });

  it("two runs at once do a request once", async () => {
    const ref = await ask(alice, cafeId, "sync-branding");
    const before = (
      await db.collection("deployments").where("cafeId", "==", cafeId).get()
    ).size;
    logs.push(...(await Promise.all([worker(), worker()])));
    const request = (await db.doc(ref.path).get()).data();
    assert.equal(request.status, "done");
    assert.equal(request.attempts, 1);
    const afterCount = (
      await db.collection("deployments").where("cafeId", "==", cafeId).get()
    ).size;
    assert.equal(afterCount, before + 1);
  });

  it("refuses, again at the backend, a request the asker may not make", async () => {
    // Written past the rules, as if they had a hole: the worker checks too.
    const ref = await db.collection("requests").add({
      ...newRequestRecord(
        { cafeId, kind: "sync-branding", by: mallory.uid },
        Timestamp.now(),
      ),
    });
    logs.push(await worker());
    const request = (await ref.get()).data();
    assert.equal(request.status, "failed");
    assert.equal(request.errorCode, "permission-denied");
  });

  it("keeps the public log free of addresses and project IDs", () => {
    const all = logs.join("\n");
    assert.ok(all.includes("request "), all);
    assert.doesNotMatch(all, /@/);
    assert.doesNotMatch(all, new RegExp(CAFE_PROJECT));
    assert.doesNotMatch(all, new RegExp(SITE));
  });
});
