/**
 * The super admin's requests (#78, docs/super-admin-requirements.md), done by
 * the worker on the deployer's fake Google and the platform's data in
 * memory: suspend, reactivate, delete, maintenance (one cafe and bulk),
 * appointing admins, the admin log, and the owners directory. Each `describe`
 * names the section 7 acceptance criterion it covers.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { skipReason } from "@cafemenu/deployer";
import { ADMIN_POLICY } from "@cafemenu/shared/admin-policy";
import { newRequestRecord } from "@cafemenu/shared/requests";

import { decodeFields } from "../../../../packages/deployer/src/apis/firestore.mjs";
import { requestSyncBranding } from "../../src/callables.mjs";
import { notifyDeployment } from "../../src/mail/notify.mjs";
import { syncDirectory } from "../../src/worker/background.mjs";
import { processRequest } from "../../src/worker/requests.mjs";
import { runWorker } from "../../src/worker/worker.mjs";
import {
  CAFE_ID,
  MENU,
  OWNER,
  SITE,
  call,
  draftCafe,
  testEnv,
} from "../helpers/env.mjs";

const ADMIN = { uid: "admin1", email: "admin@cafemenu.example" };
const DAY = 86_400_000;
const HOUR = 3_600_000;

/** A live cafe on 1.0.0, its owner, and an admin. */
async function platform() {
  const t = await testEnv({ releases: ["1.0.0"] });
  t.store.addAccount(OWNER.uid, { email: OWNER.email, name: "Asha" });
  t.store.addAccount(ADMIN.uid, { email: ADMIN.email, admin: true });
  t.store.data.emails.set(OWNER.uid, OWNER.email);
  t.store.addCafe(draftCafe());
  t.store.data.menus.set(CAFE_ID, MENU);
  let runs = 0;
  const run = (options = {}) => {
    runs += 1;
    return runWorker(t.env, { runId: `run-${runs}`, ...options });
  };
  const ask = (kind, params = {}, { by = OWNER.uid, cafeId = CAFE_ID } = {}) =>
    t.store.addRequest(
      newRequestRecord({ cafeId, kind, params, by }, t.env.now()),
    );
  const admin = (kind, params, cafeId = CAFE_ID) =>
    ask(kind, params, { by: ADMIN.uid, cafeId });
  const setup = ask("provision");
  await run();
  assert.equal((await t.store.getRequest(setup)).status, "done");
  t.outbox.length = 0;
  return {
    ...t,
    run,
    ask,
    admin,
    request: (id) => t.store.getRequest(id),
    cafeNow: () => t.store.getCafe(CAFE_ID),
    account: (uid = OWNER.uid) => t.store.getAccount(uid),
    log: () => [...t.store.data.adminLog.values()],
    site: () => decodeFields(t.state.docs.get("config/site")),
  };
}

const SUSPEND = { reason: "abuse", note: "Spam orders.", effectiveAt: null };
const MAINTENANCE = {
  reason: "migration",
  note: "Moving prices to paise.",
  message: "Back after a short update.",
  until: null,
  startsAt: null,
  endsAt: null,
  batch: null,
};

describe("Suspend: the owner can't sign in, their requests are refused with the reason, rollouts skip them, and they get an email. Reactivate undoes all of it.", () => {
  it("suspends, and reactivates", async () => {
    const t = await platform();
    const id = t.admin("suspend", SUSPEND);
    await t.run();
    assert.equal(
      (await t.request(id)).status,
      "done",
      (await t.request(id)).error,
    );

    // The owner can't sign in to the console.
    assert.equal((await t.account()).disabled, true);
    // Their cafe is suspended, and says why; the site itself is untouched.
    const cafe = await t.cafeNow();
    assert.equal(cafe.status, "suspended");
    assert.equal(cafe.suspendedFrom, "live");
    assert.deepEqual(cafe.statusReason, {
      code: "abuse",
      note: "Spam orders.",
    });
    assert.equal(cafe.statusChangedBy, ADMIN.uid);
    assert.equal(t.site().maintenance ?? null, null);
    assert.equal(t.store.data.owners.get(OWNER.uid).status, "suspended");
    // They are told, with the reason.
    assert.equal(t.outbox.length, 1);
    assert.equal(t.outbox[0].to, OWNER.email);
    assert.equal(t.outbox[0].subject, "Your CafeMenu account is suspended");
    assert.match(t.outbox[0].text, /abuse of the service \(Spam orders\.\)/);

    // Their requests are refused, with the reason.
    const asked = t.ask("sync-branding");
    await t.run();
    const refused = await t.request(asked);
    assert.equal(refused.status, "failed");
    assert.equal(refused.errorCode, "permission-denied");
    assert.match(refused.error, /suspended, because of abuse of the service/);

    // Rollouts skip them.
    assert.match(
      skipReason({ status: cafe.status, release: cafe.release }, "1.0.1", null),
      /suspended, not live/,
    );

    // Reactivate undoes all of it.
    t.outbox.length = 0;
    const back = t.admin("reactivate", { reason: "resolved", note: "Sorted." });
    await t.run();
    assert.equal((await t.request(back)).status, "done");
    assert.equal((await t.account()).disabled, false);
    const again = await t.cafeNow();
    assert.equal(again.status, "live");
    assert.equal(again.suspendedFrom, null);
    assert.equal(t.store.data.owners.get(OWNER.uid).status, "active");
    assert.equal(t.outbox.length, 1);
    assert.equal(t.outbox[0].subject, "Your CafeMenu account is active again");
    const works = t.ask("sync-branding");
    await t.run();
    assert.equal((await t.request(works)).status, "done");
  });

  it("sends a suspended owner nothing but the notices about their account", async () => {
    const t = await platform();
    t.admin("suspend", SUSPEND);
    await t.run();
    t.outbox.length = 0;
    const result = await notifyDeployment(t.env, {
      id: "dep-x",
      before: { status: "running" },
      after: { status: "failed", cafeId: CAFE_ID, kind: "deploy", error: "x" },
    });
    assert.deepEqual(result.skipped, [
      {
        cafe: CAFE_ID,
        kind: "deploy-failed",
        why: "the owner's account is suspended",
      },
    ]);
    assert.equal(t.outbox.length, 0);
  });

  it("waits out a notice period, telling the owner now; reactivating first calls it off", async () => {
    const t = await platform();
    const early = t.admin("suspend", {
      reason: "non-payment",
      note: "",
      effectiveAt: t.env.now(),
    });
    await t.run();
    const refused = await t.request(early);
    assert.equal(refused.status, "failed");
    assert.match(refused.error, /7 days' notice/);

    const later = new Date(t.env.now().getTime() + 7 * DAY);
    const id = t.admin("suspend", {
      reason: "non-payment",
      note: "Invoice 12.",
      effectiveAt: later,
    });
    let summary = await t.run();
    assert.equal(summary.requests.find((r) => r.id === id).code, "scheduled");
    let request = await t.request(id);
    assert.equal(request.status, "queued");
    assert.deepEqual(request.notBefore, later);
    assert.equal((await t.account()).disabled, false, "not yet");
    assert.equal(t.outbox.length, 1);
    assert.match(t.outbox[0].subject, /will be suspended on/);

    // Runs before the date leave it alone, and send nothing again.
    summary = await t.run();
    assert.equal(summary.requests.length, 0);
    t.advance(7 * DAY);
    await t.run();
    request = await t.request(id);
    assert.equal(request.status, "done");
    assert.equal((await t.account()).disabled, true);
    assert.equal(t.outbox.length, 2);

    // Called off: a fresh one, reactivated before its date.
    const t2 = await platform();
    const pending = t2.admin("suspend", {
      reason: "non-payment",
      note: "",
      effectiveAt: new Date(t2.env.now().getTime() + 8 * DAY),
    });
    await t2.run();
    t2.admin("reactivate", { reason: "payment-received", note: "" });
    await t2.run();
    const off = await t2.request(pending);
    assert.equal(off.status, "failed");
    assert.equal(off.errorCode, "cancelled");
    t2.advance(9 * DAY);
    await t2.run();
    assert.equal((await t2.account()).disabled, false);
  });
});

describe("Delete removes the owner's CafeMenu login and record, keeps the log, and leaves their Firebase project untouched.", () => {
  it("wants the web address typed out", async () => {
    const t = await platform();
    const id = t.admin("delete-owner", {
      reason: "owner-request",
      note: "",
      confirm: "someone-else",
    });
    await t.run();
    assert.equal((await t.request(id)).errorCode, "invalid-argument");
    assert.ok(await t.cafeNow());
  });

  it("deletes everything CafeMenu holds about the owner but the log", async () => {
    const t = await platform();
    // History to delete, and a log entry from before that stays.
    t.admin("maintenance-on", MAINTENANCE);
    await t.run();
    const owned = t.ask("sync-branding");
    await t.run();
    assert.equal(t.store.data.deployments.size > 0, true);
    await syncDirectory(t.env);
    const before = t.log().length;
    const googleCalls = t.fake.apiCalls().length;
    t.outbox.length = 0;

    const id = t.admin("delete-owner", {
      reason: "owner-request",
      note: "Asked by email.",
      confirm: SITE,
    });
    await t.run();
    assert.equal(
      (await t.request(id)).status,
      "done",
      (await t.request(id)).error,
    );

    assert.equal(await t.account(), null, "the login is gone");
    assert.equal(await t.cafeNow(), null, "the cafe record is gone");
    assert.equal(t.store.data.owners.has(OWNER.uid), false);
    assert.equal(
      [...t.store.data.deployments.values()].some((d) => d.cafeId === CAFE_ID),
      false,
    );
    assert.equal(await t.request(owned), null, "their requests are gone");
    assert.equal(t.store.data.records.has(CAFE_ID), false);
    assert.ok(await t.request(id), "the admin's own request stays");
    // The log keeps every entry, this one added.
    assert.equal(t.log().length, before + 1);
    assert.equal(t.log().at(-1).action, "delete-owner");
    assert.deepEqual(t.log().at(-1).details.sites, [SITE]);
    // Nothing went to the owner's own project.
    assert.equal(t.fake.apiCalls().length, googleCalls);
    assert.equal(t.site().name, "Lantern Cafe");
    // They were told, before their address went.
    assert.equal(t.outbox.length, 1);
    assert.equal(t.outbox[0].subject, "Your CafeMenu account has been deleted");
  });

  it("won't delete an admin", async () => {
    const t = await platform();
    t.store.data.accounts.get(OWNER.uid).admin = true;
    const id = t.admin("delete-owner", {
      reason: "owner-request",
      note: "",
      confirm: SITE,
    });
    await t.run();
    assert.equal((await t.request(id)).errorCode, "failed-precondition");
  });
});

describe("Admin maintenance on: the site's setting, written within the backend's run; the owner gets an email. Off: ordering works again.", () => {
  it("writes config/site's maintenance in the cafe's project, and the platform's record", async () => {
    const t = await platform();
    const until = new Date(t.env.now().getTime() + 2 * HOUR);
    const id = t.admin("maintenance-on", { ...MAINTENANCE, until });
    await t.run();
    assert.equal(
      (await t.request(id)).status,
      "done",
      (await t.request(id)).error,
    );
    assert.deepEqual(t.site().maintenance, {
      on: true,
      by: "admin",
      message: "Back after a short update.",
      until,
      startsAt: null,
      endsAt: null,
    });
    const cafe = await t.cafeNow();
    assert.equal(cafe.maintenance.on, true);
    assert.deepEqual(cafe.maintenance.reason, {
      code: "migration",
      note: "Moving prices to paise.",
    });
    assert.equal(t.outbox.length, 1);
    assert.equal(
      t.outbox[0].subject,
      "Lantern Cafe's site is into maintenance",
    );
    assert.match(t.outbox[0].text, /work on your cafe's data/);

    t.outbox.length = 0;
    const off = t.admin("maintenance-off", { note: "Done.", batch: null });
    await t.run();
    assert.equal((await t.request(off)).status, "done");
    assert.equal(t.site().maintenance, null);
    assert.equal((await t.cafeNow()).maintenance, null);
    assert.equal(
      t.outbox[0].subject,
      "Lantern Cafe's site is out of maintenance",
    );
  });

  it("starts on time, and gives notice where the policy says", async () => {
    const t = await platform();
    const startsAt = new Date(t.env.now().getTime() + DAY);
    const endsAt = new Date(t.env.now().getTime() + DAY + 3 * HOUR);
    t.admin("maintenance-on", { ...MAINTENANCE, startsAt, endsAt });
    await t.run();
    assert.deepEqual(
      [t.site().maintenance.startsAt, t.site().maintenance.endsAt],
      [startsAt, endsAt],
    );
    assert.match(t.outbox[0].subject, /will go into maintenance/);

    const soon = t.admin("maintenance-on", {
      ...MAINTENANCE,
      reason: "non-payment",
    });
    await t.run();
    assert.match((await t.request(soon)).error, /7 days' notice/);
  });

  it("says plainly when CafeMenu can no longer reach the cafe's project", async () => {
    const t = await platform();
    // Google refuses: as when the owner took CafeMenu's access away.
    t.state.services.set("firestore.googleapis.com", "DISABLED");
    const id = t.admin("maintenance-on", MAINTENANCE);
    await t.run();
    const request = await t.request(id);
    assert.equal(request.status, "failed");
    assert.equal(request.errorCode, "failed-precondition");
  });
});

describe("Bulk maintenance on several cafes, resumable if cut off.", () => {
  it("does each cafe's request on its own, and carries on in the next run", async () => {
    const t = await platform();
    // Two more live cafes (on the same fake project, which is all it has).
    for (const id of ["cafe2", "cafe3"]) {
      t.store.addCafe({
        ...(await t.cafeNow()),
        id,
        site: id,
      });
    }
    const batch = "b-20261101";
    const ids = [CAFE_ID, "cafe2", "cafe3"].map((cafeId) =>
      t.admin("maintenance-on", { ...MAINTENANCE, batch }, cafeId),
    );
    // A run cut off after one cafe.
    await t.run({ maxRequests: 1 });
    const statuses = async () =>
      Promise.all(ids.map(async (id) => (await t.request(id)).status));
    assert.deepEqual(await statuses(), ["done", "queued", "queued"]);
    // The next run carries on.
    await t.run();
    assert.deepEqual(await statuses(), ["done", "done", "done"]);
    for (const id of ["cafe2", "cafe3"]) {
      assert.equal((await t.store.getCafe(id)).maintenance.batch, batch);
    }
    // And the batch is undone the same way.
    const offs = [CAFE_ID, "cafe2", "cafe3"].map((cafeId) =>
      t.admin("maintenance-off", { note: "", batch }, cafeId),
    );
    await t.run();
    for (const id of offs) assert.equal((await t.request(id)).status, "done");
    assert.equal(t.site().maintenance, null);
  });
});

describe("Every admin action appears in the admin log, and the log can't be edited.", () => {
  it("logs who, what, which cafe, when and why, once per request", async () => {
    const t = await platform();
    t.env.policy = { ...ADMIN_POLICY, appointOtherAdmins: true };
    t.store.addAccount("helper", { email: "helper@cafemenu.example" });
    const asked = [
      t.admin("maintenance-on", MAINTENANCE),
      t.admin("maintenance-off", { note: "Done.", batch: null }),
      t.admin("suspend", SUSPEND),
      t.admin("reactivate", { reason: "resolved", note: "" }),
      t.admin(
        "appoint-admin",
        { email: "helper@cafemenu.example", note: "Weekend cover." },
        null,
      ),
      t.admin(
        "remove-admin",
        { email: "helper@cafemenu.example", note: "" },
        null,
      ),
    ];
    for (const id of asked) {
      // One at a time, in order.
      await processRequest(t.env, id, { runId: "r" });
      assert.equal((await t.request(id)).status, "done", id);
    }
    const entries = t.store.data.adminLog;
    assert.deepEqual(
      asked.map((id) => entries.get(id)?.action),
      [
        "maintenance-on",
        "maintenance-off",
        "suspend",
        "reactivate",
        "appoint-admin",
        "remove-admin",
      ],
    );
    const suspension = entries.get(asked[2]);
    assert.equal(suspension.by, ADMIN.uid);
    assert.equal(suspension.byEmail, ADMIN.email);
    assert.equal(suspension.cafeId, CAFE_ID);
    assert.equal(suspension.ownerUid, OWNER.uid);
    assert.deepEqual(suspension.reason, {
      code: "abuse",
      note: "Spam orders.",
    });
    assert.ok(suspension.at instanceof Date);
    assert.equal(entries.get(asked[4]).cafeId, null);

    // A request done again (its run died after the work) logs nothing new,
    // and the entry stays as it was.
    const copy = structuredClone(suspension);
    await t.store.updateRequest(asked[2], { status: "queued" });
    await processRequest(t.env, asked[2], { runId: "again" });
    assert.equal(entries.size, asked.length);
    assert.deepEqual(entries.get(asked[2]), copy);
  });

  it("refuses, at the backend too, an admin request from someone who isn't one", async () => {
    const t = await platform();
    const id = t.ask("suspend", SUSPEND);
    await t.run();
    const request = await t.request(id);
    assert.equal(request.errorCode, "permission-denied");
    assert.equal((await t.account()).disabled, false);
    assert.equal(t.store.data.adminLog.size, 0);
  });
});

describe("Appointing admins", () => {
  it("is switched off by the policy for now (decision 6)", async () => {
    const t = await platform();
    t.store.addAccount("helper", { email: "helper@cafemenu.example" });
    const id = t.admin(
      "appoint-admin",
      { email: "helper@cafemenu.example", note: "" },
      null,
    );
    await t.run();
    assert.match((await t.request(id)).error, /switched off for now/);
    assert.equal((await t.account("helper")).admin, false);
  });

  it("when on, appoints and removes, but never the last admin", async () => {
    const t = await platform();
    t.env.policy = { ...ADMIN_POLICY, appointOtherAdmins: true };
    const lone = t.admin(
      "remove-admin",
      { email: ADMIN.email, note: "" },
      null,
    );
    await t.run();
    assert.match((await t.request(lone)).error, /last admin can't be removed/);
    assert.equal((await t.account(ADMIN.uid)).admin, true);

    t.store.addAccount("helper", { email: "helper@cafemenu.example" });
    t.admin(
      "appoint-admin",
      { email: "helper@cafemenu.example", note: "" },
      null,
    );
    await t.run();
    assert.equal((await t.account("helper")).admin, true);
    assert.equal(t.store.data.owners.get("helper").admin, true);
    const remove = t.admin(
      "remove-admin",
      { email: "helper@cafemenu.example", note: "" },
      null,
    );
    await t.run();
    assert.equal((await t.request(remove)).status, "done");
    assert.equal((await t.account("helper")).admin, false);

    const nobody = t.admin(
      "appoint-admin",
      { email: "nobody@cafemenu.example", note: "" },
      null,
    );
    await t.run();
    assert.equal((await t.request(nobody)).errorCode, "not-found");
  });
});

describe("The owners directory", () => {
  it("copies every account from Auth, writes only what changed, and keeps the status", async () => {
    const t = await platform();
    // The worker's first run (in platform()) copied both accounts.
    assert.deepEqual([...t.store.data.owners.keys()].sort(), [
      ADMIN.uid,
      OWNER.uid,
    ]);
    t.store.data.accounts.get(OWNER.uid).lastSignInAt = Date.UTC(2026, 9, 20);
    assert.deepEqual(await syncDirectory(t.env), { accounts: 2, changed: 1 });
    assert.deepEqual(
      (({ syncedAt, ...rest }) => rest)(t.store.data.owners.get(OWNER.uid)),
      {
        email: OWNER.email,
        name: "Asha",
        createdAt: Date.UTC(2026, 8, 1),
        lastSignInAt: Date.UTC(2026, 9, 20),
        admin: false,
        disabled: false,
        status: "active",
      },
    );
    assert.deepEqual(await syncDirectory(t.env), { accounts: 2, changed: 0 });

    t.admin("suspend", SUSPEND);
    await t.run();
    await syncDirectory(t.env);
    const entry = t.store.data.owners.get(OWNER.uid);
    assert.equal(entry.status, "suspended", "the sync leaves the status alone");
    assert.equal(entry.disabled, true);
  });

  it("records the emails a cafe was sent, for its history", async () => {
    const t = await platform();
    t.admin("maintenance-on", MAINTENANCE);
    await t.run();
    assert.deepEqual(
      t.store.data.emailLog.get(CAFE_ID).map((e) => e.kind),
      ["maintenance-on"],
    );
  });
});

describe("An update queued before the owner was suspended", () => {
  it("doesn't go out: the cafe isn't live any more", async () => {
    const t = await platform();
    // Queued by a callable (Blaze) while live, then the owner was suspended.
    const { deploymentId } = await requestSyncBranding(
      t.env,
      call({ cafeId: CAFE_ID }),
    );
    t.admin("suspend", SUSPEND);
    const summary = await t.run();
    assert.equal(summary.requests[0].outcome, "done");
    assert.deepEqual(summary.deployments, [
      { id: deploymentId, outcome: "failed" },
    ]);
    assert.equal(
      (await t.store.getDeployment(deploymentId)).errorCode,
      "not-live",
    );
  });
});
