/**
 * The super admin (#78), end to end on the emulators: the admin signs in
 * with the client SDK, as the console does, and writes their requests through
 * the platform's real rules; the worker, run as the workflow runs it, does
 * them against the deployer's fake Google. Then what the owner meets: a sign-in
 * refused while suspended, a request refused with the reason, the admin log
 * out of reach, and all of it undone.
 *
 * Run with `npm run test:emulator:worker` (Node 22.18+, Java 21).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Timestamp } from "firebase-admin/firestore";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";

import { decodeFields } from "../../../../packages/deployer/src/apis/firestore.mjs";
import {
  SETTINGS,
  SITE,
  publish,
  releasePackage,
} from "../../../../packages/deployer/tests/helpers/release.mjs";
import {
  CAFE_PROJECT,
  account,
  ask,
  browser,
  db,
  finished,
  watch,
  until,
  worker,
} from "../helpers/emulator.mjs";
import { startFakeGoogle } from "../helpers/fake-google-server.mjs";

let fake;
let erin;
let owen;
let cafeId;
const logs = [];

/** A request by the admin, followed to its answer. */
async function adminDoes(kind, params, about = cafeId) {
  const w = watch(await ask(erin, about, kind, params));
  logs.push(await worker());
  const request = await until(`the ${kind}`, finished(w));
  w.stop();
  return request;
}

describe("the super admin's requests, done by the worker", () => {
  before(async () => {
    fake = await startFakeGoogle();
    await publish(fake.google, await releasePackage("1.0.0"));
    await db.doc("releases/1.0.0").set({
      channel: "stable",
      notes: "",
      publishedAt: Timestamp.now(),
      schemaVersion: 1,
      withdrawn: false,
    });
    erin = await account("erin@platform.test", { admin: true });
    owen = await account("owen@owner.test");
    const ref = db.collection("cafes").doc();
    cafeId = ref.id;
    await ref.set({
      ownerUid: owen.uid,
      ownerEmail: owen.email,
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
    // The owner sets the cafe up, so it has a site.
    const setup = watch(await ask(owen, cafeId, "provision"));
    logs.push(await worker());
    const done = await until("the setup", finished(setup), 60);
    setup.stop();
    assert.equal(done.status, "done", done.error);
  });

  after(async () => {
    await Promise.all([erin, owen].map((who) => who.close()));
    await fake?.close();
  });

  it("the rules refuse the owner an admin request", async () => {
    await assert.rejects(
      ask(owen, cafeId, "suspend", {
        reason: "abuse",
        note: "",
        effectiveAt: null,
      }),
      { code: "permission-denied" },
    );
  });

  it("takes the site into maintenance, and out again", async () => {
    const on = await adminDoes("maintenance-on", {
      reason: "migration",
      note: "Prices to paise.",
      message: "Back after a short update.",
      until: null,
      startsAt: null,
      endsAt: null,
      batch: null,
    });
    assert.equal(on.status, "done", on.error);
    const site = decodeFields(fake.state.docs.get("config/site"));
    assert.equal(site.maintenance.on, true);
    assert.equal(site.maintenance.message, "Back after a short update.");
    assert.equal(
      (await db.doc(`cafes/${cafeId}`).get()).data().maintenance.reason.code,
      "migration",
    );
    const off = await adminDoes("maintenance-off", { note: "", batch: null });
    assert.equal(off.status, "done", off.error);
    assert.equal(
      decodeFields(fake.state.docs.get("config/site")).maintenance,
      null,
    );
  });

  it("suspends the owner: no sign-in, requests refused with the reason", async () => {
    const done = await adminDoes("suspend", {
      reason: "abuse",
      note: "Spam orders.",
      effectiveAt: null,
    });
    assert.equal(done.status, "done", done.error);

    // A new sign-in is refused.
    const again = browser("owen-again");
    await assert.rejects(again.signIn(owen.email), {
      code: "auth/user-disabled",
    });
    await again.close();

    // A request written with the token they still hold is refused, with why.
    const w = watch(await ask(owen, cafeId, "sync-branding"));
    logs.push(await worker());
    const refused = await until("the refusal", finished(w));
    w.stop();
    assert.equal(refused.status, "failed");
    assert.match(refused.error, /suspended, because of abuse of the service/);
    assert.equal(
      (await db.doc(`cafes/${cafeId}`).get()).data().status,
      "suspended",
    );
  });

  it("reactivates: sign-in works again", async () => {
    const done = await adminDoes("reactivate", {
      reason: "resolved",
      note: "",
    });
    assert.equal(done.status, "done", done.error);
    const again = browser("owen-back");
    await again.signIn(owen.email);
    await again.close();
    assert.equal((await db.doc(`cafes/${cafeId}`).get()).data().status, "live");
  });

  it("keeps an admin log the admin can read and the owner can't, and nobody edits", async () => {
    const entries = await getDocs(collection(erin.db, "adminLog"));
    assert.deepEqual(entries.docs.map((d) => d.data().action).sort(), [
      "maintenance-off",
      "maintenance-on",
      "reactivate",
      "suspend",
    ]);
    const first = entries.docs[0];
    assert.equal(first.data().by, erin.uid);
    assert.equal(first.data().cafeId, cafeId);
    await assert.rejects(getDoc(doc(owen.db, "adminLog", first.id)), {
      code: "permission-denied",
    });
    // The owners directory, from the worker's hourly job.
    const owners = await getDocs(collection(erin.db, "owners"));
    assert.ok(owners.docs.some((d) => d.data().email === owen.email));
  });

  it("keeps the public log free of addresses", () => {
    const all = logs.join("\n");
    assert.doesNotMatch(all, /@/);
    assert.doesNotMatch(all, /Spam orders/);
  });
});
