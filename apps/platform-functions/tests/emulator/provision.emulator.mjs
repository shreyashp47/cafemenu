/**
 * The whole path on the emulators: Auth, Firestore and Functions running the
 * real functions, with the deployer's fake Google behind them. A brand-new
 * owner asks for their cafe to be set up, the progress document fills in as
 * the wizard would watch it, and the cafe ends up live; then an upgrade and a
 * rollback, and the refusals.
 *
 * Run with `npm run test:emulator` (Node 22.18+, Java 21 for Firestore).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { Timestamp, getFirestore } from "firebase-admin/firestore";

import { decodeFields } from "../../../../packages/deployer/src/apis/firestore.mjs";
import {
  SETTINGS,
  SITE,
  publish,
  releasePackage,
} from "../../../../packages/deployer/tests/helpers/release.mjs";
import { startFakeGoogle } from "../helpers/fake-google-server.mjs";
import { solidPng } from "../helpers/png.mjs";

const PROJECT = "demo-cafemenu";
const FUNCTIONS = `http://127.0.0.1:5101/${PROJECT}/us-central1`;
const AUTH = "http://127.0.0.1:9199";

process.env.GCLOUD_PROJECT = PROJECT;
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
    `${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`,
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

/** A callable over HTTP, as the Firebase client SDK makes it. */
async function callFunction(name, data, who) {
  const res = await fetch(`${FUNCTIONS}/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(who && { authorization: `Bearer ${who.idToken}` }),
    },
    body: JSON.stringify({ data }),
  });
  const json = await res.json();
  return { status: res.status, ...json };
}

const until = async (what, read, { seconds = 120 } = {}) => {
  const end = Date.now() + seconds * 1000;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
};

const FINISHED = ["succeeded", "failed", "rolled-back"];
const finished = (id) => async () => {
  const d = (await db.doc(`deployments/${id}`).get()).data();
  return FINISHED.includes(d?.status) ? d : null;
};

describe("on the emulators", () => {
  let fake;
  let owner;
  let stranger;
  let cafeId;

  before(async () => {
    fake = await startFakeGoogle();
    for (const version of ["1.0.0", "1.1.0"]) {
      await publish(fake.google, await releasePackage(version));
      await db.doc(`releases/${version}`).set({
        channel: "stable",
        notes: "",
        publishedAt: Timestamp.now(),
        schemaVersion: 1,
        withdrawn: false,
      });
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
          {
            name: "Filter coffee",
            category: "Coffee",
            description: "",
            price: 8000,
            available: true,
          },
        ],
        updatedAt: Timestamp.now(),
      });
  });

  after(async () => {
    await fake?.close();
  });

  it("refuses a caller who is not signed in, and one who does not own the cafe", async () => {
    const anonymous = await callFunction("startProvisioning", { cafeId });
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.error.status, "UNAUTHENTICATED");
    const other = await callFunction("startProvisioning", { cafeId }, stranger);
    assert.equal(other.status, 403);
    assert.equal(other.error.status, "PERMISSION_DENIED");
    assert.equal((await db.collection("deployments").get()).size, 0);
  });

  it("checks the connection for the owner", async () => {
    const answer = await callFunction(
      "checkConnection",
      { cafeId, projectId: "test-cafe" },
      owner,
    );
    assert.deepEqual(answer.result, { status: "connected" });
  });

  let provisioning;

  it("sets a brand-new cafe up while the progress document fills in", async () => {
    const { result, error } = await callFunction(
      "startProvisioning",
      { cafeId },
      owner,
    );
    assert.ok(result, JSON.stringify(error));
    provisioning = result.deploymentId;

    // What the wizard would do: listen to the document.
    const seen = [];
    const stop = db.doc(`deployments/${provisioning}`).onSnapshot((snap) => {
      const d = snap.data();
      seen.push({
        status: d.status,
        steps: d.steps.map((s) => s.status),
        detail: d.detail,
      });
    });
    const d = await until("the setup to finish", finished(provisioning), {
      seconds: 150,
    });
    stop();

    assert.equal(d.status, "succeeded", d.error);
    assert.equal(d.kind, "provision");
    assert.equal(d.ownerUid, owner.uid);
    assert.ok(d.steps.every((s) => s.status === "done"));
    assert.equal(d.siteUrl, `https://${SITE}.web.app`);
    assert.ok(
      seen.some((s) => s.steps.includes("running")),
      "the wizard saw a step running",
    );
    assert.ok(
      seen.some((s) => s.detail),
      "and what it was doing",
    );

    const cafe = (await db.doc(`cafes/${cafeId}`).get()).data();
    assert.equal(cafe.status, "live");
    assert.deepEqual(
      [cafe.release.current, cafe.release.previous],
      ["1.1.0", null],
    );

    const { state } = fake;
    assert.ok(state.sites.has(SITE));
    assert.equal(
      decodeFields(state.docs.get("config/site")).name,
      SETTINGS.name,
    );
    assert.deepEqual(
      [...state.docs.keys()].filter((p) => p.startsWith("menu/")).sort(),
      ["menu/start-001", "menu/start-002"],
    );
    assert.equal(state.users.length, 1);
    assert.equal(state.users[0].email, "owner@example.com");
    assert.equal(state.emails.length, 1);

    // The deploy record is there, for the backend only.
    const record = (
      await db.doc(`cafes/${cafeId}/private/deployRecord`).get()
    ).data();
    assert.equal(record.current.version, "1.1.0");
  });

  it("upgrades and rolls back on request, one at a time", async () => {
    await db.doc("releases/1.2.0").set({
      channel: "stable",
      notes: "",
      publishedAt: Timestamp.now(),
      schemaVersion: 1,
      withdrawn: false,
    });
    await publish(fake.google, await releasePackage("1.2.0"));

    const up = await callFunction(
      "requestUpgrade",
      { cafeId, version: "1.2.0" },
      owner,
    );
    assert.ok(up.result, JSON.stringify(up.error));
    const again = await callFunction(
      "requestUpgrade",
      { cafeId, version: "1.2.0" },
      owner,
    );
    assert.equal(again.error.status, "FAILED_PRECONDITION");
    const d = await until("the upgrade", finished(up.result.deploymentId));
    assert.equal(d.status, "succeeded", d.error);
    let cafe = (await db.doc(`cafes/${cafeId}`).get()).data();
    assert.deepEqual(
      [cafe.release.current, cafe.release.previous],
      ["1.2.0", "1.1.0"],
    );

    const back = await callFunction("requestRollback", { cafeId }, owner);
    assert.ok(back.result, JSON.stringify(back.error));
    const r = await until("the rollback", finished(back.result.deploymentId));
    assert.equal(r.status, "succeeded", r.error);
    cafe = (await db.doc(`cafes/${cafeId}`).get()).data();
    assert.deepEqual(
      [cafe.release.current, cafe.release.previous],
      ["1.1.0", null],
    );

    const sync = await callFunction("requestSyncBranding", { cafeId }, owner);
    const s = await until(
      "the branding sync",
      finished(sync.result.deploymentId),
    );
    assert.equal(s.status, "succeeded", s.error);
    assert.equal(s.kind, "branding");
  });

  // -- emails (#34, #35) ---------------------------------------------------------
  // MAIL_PROVIDER is unset, so the emulated functions log their emails and send
  // them to nobody. What shows they sent them is the record of each one in
  // `cafes/{id}/private/mail`, which is claimed before sending.

  const sentOf = (id) => async () => {
    const mail = (await db.doc(`cafes/${id}/private/mail`).get()).data();
    return mail?.sent ? mail : null;
  };
  const sentKeys = (mail) => Object.keys(mail.sent);

  it("tells a cafe that stays on a version about a newer line, and one on a dropped line to upgrade", async () => {
    const ref = (id) => db.doc(`cafes/${id}`);
    // The cafe set up above stays on 1.1, which the next release drops;
    // another stays on 1.2, which it doesn't.
    await ref(cafeId).update({ "release.pinned": "1.1" });
    const second = db.collection("cafes").doc();
    const first = (await ref(cafeId).get()).data();
    await second.set({
      ...first,
      site: "second-cafe",
      status: "live",
      release: {
        channel: "stable",
        pinned: "1.2",
        current: "1.2.0",
        previous: null,
      },
    });

    await db.doc("releases/1.3.0").set({
      channel: "stable",
      notes: "",
      publishedAt: Timestamp.now(),
      schemaVersion: 1,
      withdrawn: false,
    });

    const dropped = await until("the upgrade notice", sentOf(cafeId));
    assert.equal(sentKeys(dropped).length, 1);
    assert.match(
      sentKeys(dropped)[0],
      /^upgrade-required:1\.1:\d{4}-\d{2}-\d{2}$/,
    );
    const news = await until("the release email", sentOf(second.id));
    assert.deepEqual(sentKeys(news), ["release-available:1.3.0"]);
    assert.ok(news.token, "with the cafe's own unsubscribe token");

    // The unsubscribe link: a GET asks, a POST does it.
    const link = `${FUNCTIONS}/unsubscribe?c=${second.id}&t=${news.token}`;
    const page = await fetch(link);
    assert.equal(page.status, 200);
    assert.match(
      page.headers.get("content-security-policy"),
      /default-src 'none'/,
    );
    assert.match(await page.text(), /Stop emails about new versions\?/);
    assert.equal((await ref(second.id).get()).data().emails, undefined);

    const done = await fetch(link, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "action=unsubscribe",
    });
    assert.match(await done.text(), /You're unsubscribed/);
    assert.deepEqual((await ref(second.id).get()).data().emails, {
      releaseNotices: false,
    });
    const wrong = await fetch(`${FUNCTIONS}/unsubscribe?c=${second.id}&t=nope`);
    assert.equal(wrong.status, 404);
  });

  it("tells the owner when a deployment ends rolled back", async () => {
    const ref = db.collection("deployments").doc();
    await ref.set({
      cafeId,
      ownerUid: owner.uid,
      kind: "deploy",
      version: "1.3.0",
      fromVersion: "1.1.0",
      status: "succeeded", // finished, so the worker leaves it alone
      trigger: "rollout",
      steps: [],
      error: null,
      createdAt: Timestamp.now(),
      finishedAt: Timestamp.now(),
    });
    await ref.update({
      status: "rolled-back",
      error: "The new version didn't pass its checks.",
    });
    const mail = await until("the failure email", async () => {
      const m = (await db.doc(`cafes/${cafeId}/private/mail`).get()).data();
      return sentKeys(m ?? { sent: {} }).includes(`deploy-failed:${ref.id}`)
        ? m
        : null;
    });
    assert.ok(mail.sent[`deploy-failed:${ref.id}`]);
  });
});
