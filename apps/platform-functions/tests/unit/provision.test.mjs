import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decodeFields } from "../../../../packages/deployer/src/apis/firestore.mjs";
import { startProvisioning } from "../../src/callables.mjs";
import { runDeployment } from "../../src/jobs.mjs";
import {
  CAFE_ID,
  MENU,
  PNG,
  PROJECT,
  SETTINGS,
  SITE,
  call,
  draftCafe,
  testEnv,
} from "../helpers/env.mjs";

/** A cafe waiting to be set up, and the id of the provisioning queued for it. */
async function queued({ cafe = {}, ...options } = {}) {
  const t = await testEnv(options);
  t.store.addCafe(draftCafe(cafe));
  t.store.data.menus.set(CAFE_ID, MENU);
  const { deploymentId } = await startProvisioning(
    t.env,
    call({ cafeId: CAFE_ID }),
  );
  const run = (by = "event-1") => runDeployment(t.env, deploymentId, { by });
  const deployment = () => t.store.getDeployment(deploymentId);
  const cafeNow = () => t.store.getCafe(CAFE_ID);
  return { ...t, deploymentId, run, deployment, cafeNow };
}

const docs = (state, prefix) =>
  [...state.docs.keys()].filter((p) => p.startsWith(prefix)).sort();

describe("startProvisioning", () => {
  it("queues a deployment with every step pending, and marks the cafe provisioning", async () => {
    const t = await queued({ releases: ["1.0.0", "1.1.0", "1.2.0-beta.1"] });
    const d = await t.deployment();
    assert.equal(d.kind, "provision");
    assert.equal(d.status, "queued");
    assert.equal(d.trigger, "owner");
    assert.equal(d.ownerUid, "owner1");
    // The newest stable release: a stable cafe isn't given the beta.
    assert.equal(d.version, "1.1.0");
    assert.deepEqual(
      d.steps.map((s) => [s.id, s.status]),
      [
        ["check", "pending"],
        ["provision", "pending"],
        ["deploy", "pending"],
        ["menu", "pending"],
        ["owner", "pending"],
      ],
    );
    assert.equal((await t.cafeNow()).status, "provisioning");
  });

  it("follows the cafe's channel and the minor line it is pinned to", async () => {
    const beta = await queued({
      releases: ["1.0.0", "1.1.0-beta.1"],
      cafe: { release: { channel: "beta", pinned: null } },
    });
    assert.equal((await beta.deployment()).version, "1.1.0-beta.1");
    const pinned = await queued({
      releases: ["1.0.0", "1.0.3", "1.1.0"],
      cafe: { release: { channel: "stable", pinned: "1.0" } },
    });
    assert.equal((await pinned.deployment()).version, "1.0.3");
  });

  it("refuses a second setup while one is queued or running", async () => {
    const t = await queued();
    await assert.rejects(startProvisioning(t.env, call({ cafeId: CAFE_ID })), {
      code: "failed-precondition",
    });
  });

  it("needs a project, a site and a region, and a release to put there", async () => {
    for (const cafe of [{ projectId: null }, { region: null }]) {
      const t = await testEnv();
      t.store.addCafe(draftCafe(cafe));
      await assert.rejects(
        startProvisioning(t.env, call({ cafeId: CAFE_ID })),
        { code: "failed-precondition", message: /Connect a Firebase project/ },
      );
    }
    const none = await testEnv({ releases: [] });
    none.store.addCafe(draftCafe());
    await assert.rejects(
      startProvisioning(none.env, call({ cafeId: CAFE_ID })),
      { code: "failed-precondition", message: /No release/ },
    );
  });
});

describe("provisioning a cafe", () => {
  it("goes from a draft to a live site, step by step", async () => {
    const t = await queued();
    t.store.data.logos.set(CAFE_ID, PNG);
    t.store.data.cafes.get(CAFE_ID).settings = {
      ...SETTINGS,
      logo: "/logo.png",
    };
    t.store.data.owners.set("owner1", "Asha Rao");

    assert.deepEqual(await t.run(), { outcome: "succeeded" });

    const d = await t.deployment();
    assert.equal(d.status, "succeeded");
    assert.equal(d.error, null);
    assert.ok(d.finishedAt);
    assert.equal(d.siteUrl, `https://${SITE}.web.app`);
    assert.deepEqual(
      d.steps.map((s) => s.status),
      ["done", "done", "done", "done", "done"],
    );

    const cafe = await t.cafeNow();
    assert.equal(cafe.status, "live");
    assert.equal(cafe.release.current, "1.0.0");
    assert.equal(cafe.release.previous, null);

    // The project: provisioned, with the release live and the cafe's own files.
    const { state } = t;
    assert.equal(state.database.locationId, "asia-south1");
    assert.ok(state.sites.has(SITE));
    assert.ok(state.releases.length > 0);
    assert.deepEqual(
      decodeFields(state.docs.get("config/site")).name,
      SETTINGS.name,
    );
    // The menu, in order, and the marker that stops it loading twice.
    assert.deepEqual(docs(state, "menu/"), [
      "menu/start-001",
      "menu/start-002",
    ]);
    const first = decodeFields(state.docs.get("menu/start-001"));
    assert.equal(first.name, "Masala chai");
    assert.equal(first.sortOrder, 10);
    assert.ok(state.docs.has("config/setup"));
    // The owner: an account, a staff record and a set-password email.
    assert.equal(state.users.length, 1);
    assert.equal(state.users[0].email, "owner@example.com");
    const staff = decodeFields(
      state.docs.get(`staff/${state.users[0].localId}`),
    );
    assert.deepEqual(staff, { name: "Asha Rao", role: "owner" });
    assert.equal(state.emails.length, 1);

    // The deploy record is the platform's, not a file.
    const record = await t.store.getRecord(CAFE_ID);
    assert.equal(record.current.version, "1.0.0");
    assert.equal(record.site, SITE);
  });

  it("is safe to run again: a second setup changes nothing", async () => {
    const t = await queued();
    await t.run();
    const before = {
      commits: t.state.commits,
      users: t.state.users.length,
      emails: t.state.emails.length,
      menu: docs(t.state, "menu/"),
    };
    // The owner presses Try again on a cafe that is live? Not allowed...
    await assert.rejects(startProvisioning(t.env, call({ cafeId: CAFE_ID })), {
      code: "failed-precondition",
    });
    // ...but the same deployment picked up twice is: Cloud Functions delivers at least once.
    assert.deepEqual(await t.run("event-2"), { outcome: "finished" });
    assert.equal(t.state.users.length, before.users);
    assert.equal(t.state.emails.length, before.emails);
    assert.deepEqual(docs(t.state, "menu/"), before.menu);
    assert.ok(t.state.commits >= before.commits);
  });

  it("writes progress as it goes: the running step and what it is doing", async () => {
    const t = await queued();
    t.env.progressGapMs = 0;
    const seen = [];
    const update = t.store.updateDeployment.bind(t.store);
    t.store.updateDeployment = async (id, patch) => {
      if (patch.steps) {
        seen.push({
          running: patch.steps.find((s) => s.status === "running")?.id,
          detail: patch.detail,
        });
      }
      return update(id, patch);
    };
    await t.run();
    assert.ok(seen.length >= 2);
    assert.ok(seen.some((s) => s.running === "deploy"));
  });

  it("carries on from the step that failed: finished steps are not repeated", async () => {
    const t = await queued();
    // Google answers 503 to the three tries at the first database write.
    t.state.failCommits = new Set([1, 2, 3, 4, 5, 6]);
    await assert.rejects(t.run(), { name: "RetryLater" });

    let d = await t.deployment();
    assert.equal(d.status, "queued", "back in the queue for the retry");
    assert.deepEqual(
      d.steps.map((s) => s.status),
      ["done", "done", "done", "pending", "pending"],
    );
    assert.equal((await t.cafeNow()).status, "provisioning");

    // The retry (a new event for the same deployment) finishes the job.
    t.state.failCommits = new Set();
    const hostingCalls = t.fake.apiCalls().length;
    assert.deepEqual(await t.run("event-2"), { outcome: "succeeded" });
    d = await t.deployment();
    assert.deepEqual(
      d.steps.map((s) => s.status),
      ["done", "done", "done", "done", "done"],
    );
    assert.equal(d.attempts, 2);
    assert.equal((await t.cafeNow()).status, "live");
    assert.ok(t.fake.apiCalls().length > hostingCalls);
  });

  it("retries a transient failure by itself before giving up on the run", async () => {
    const t = await queued();
    // One 503 on the first commit, then Google recovers.
    t.state.failCommits = new Set([1]);
    assert.deepEqual(await t.run(), { outcome: "succeeded" });
    assert.ok(t.sleeps.includes(2000), "waited before trying again");
  });

  it("hands over to a new invocation when it runs out of time", async () => {
    const t = await queued();
    // The first step takes the whole budget.
    const sleep = t.env.sleep;
    t.state.afterCommit = null;
    const original = t.env.now;
    let jumped = false;
    t.env.now = () => {
      const now = original();
      if (!jumped && t.state.services.size > 2) {
        jumped = true;
        t.advance(8 * 60_000);
      }
      return now;
    };
    void sleep;
    await assert.rejects(t.run(), { name: "RetryLater" });
    const d = await t.deployment();
    assert.equal(d.status, "queued");
    assert.equal(d.steps[0].status, "done");
  });

  it("gives up after four pickups, and says so", async () => {
    const t = await queued();
    await t.store.updateDeployment(t.deploymentId, {
      status: "queued",
      attempts: 4,
    });
    assert.deepEqual(await t.run(), { outcome: "exhausted" });
    const d = await t.deployment();
    assert.equal(d.status, "failed");
    assert.match(d.error, /tried 4 times/);
    assert.equal((await t.cafeNow()).status, "failed");
  });

  it("will not run alongside another invocation that holds the lease", async () => {
    const t = await queued();
    await t.store.updateDeployment(t.deploymentId, {
      status: "running",
      lease: { by: "event-1", until: t.env.now().getTime() + 60_000 },
    });
    await assert.rejects(t.run("event-2"), { name: "RetryLater" });
    // Once the lease has run out, the next one takes over.
    t.advance(2 * 60_000);
    assert.deepEqual(await t.run("event-2"), { outcome: "succeeded" });
  });
});

describe("when provisioning cannot go on", () => {
  it("says the web address is taken, and lets the owner change it", async () => {
    const t = await queued({ cafe: { site: "taken-name" } });
    assert.deepEqual(await t.run(), { outcome: "failed" });
    const d = await t.deployment();
    assert.equal(d.status, "failed");
    assert.equal(d.errorCode, "site-name-taken");
    assert.match(
      d.error,
      /taken-name\.web\.app is already used by someone else/,
    );
    assert.match(d.error, /Choose another web address/);
    assert.deepEqual(
      d.steps.map((s) => s.status),
      ["done", "failed", "pending", "pending", "pending"],
    );
    // Back to a draft, because the rules only let the owner edit a draft.
    assert.equal((await t.cafeNow()).status, "draft");
  });

  it("names the permissions the deploy account lacks", async () => {
    const t = await queued();
    t.state.permissions = new Set(["firebase.projects.get"]);
    assert.deepEqual(await t.run(), { outcome: "failed" });
    const d = await t.deployment();
    assert.equal(d.errorCode, "missing-permissions");
    assert.match(d.error, /isn't allowed to/);
    assert.match(
      d.error,
      /give deploy@cafemenu-platform.iam.gserviceaccount.com a role/,
    );
    assert.equal(d.steps[0].status, "failed");
    assert.equal((await t.cafeNow()).status, "failed");
    assert.equal(t.state.database, null, "nothing was set up");
  });

  it("says when the deploy account cannot see the project at all", async () => {
    const t = await queued({ cafe: { projectId: "other-project-1a2b" } });
    assert.deepEqual(await t.run(), { outcome: "failed" });
    const d = await t.deployment();
    assert.equal(d.errorCode, "no-access");
    assert.match(d.error, /add .* as a member again/);
  });

  it("explains that sign-in needs one click in the console, with the link", async () => {
    const t = await queued();
    t.state.authConfig = null;
    assert.deepEqual(await t.run(), { outcome: "failed" });
    const d = await t.deployment();
    assert.equal(d.errorCode, "auth-not-started");
    assert.match(d.error, /Get started/);
    assert.match(d.error, new RegExp(`project/${PROJECT}/authentication`));
    assert.equal(d.steps[1].status, "failed");
  });

  it("is plain about what it does not understand, and keeps the detail for the maintainer", async () => {
    const t = await queued();
    t.state.afterCommit = null;
    const original = t.env.google.contextFor.bind(t.env.google);
    t.env.google.contextFor = async (...args) => {
      const ctx = await original(...args);
      ctx.api.get = async () => {
        throw new TypeError("secret internals");
      };
      return ctx;
    };
    assert.deepEqual(await t.run(), { outcome: "failed" });
    const d = await t.deployment();
    assert.equal(d.errorCode, "unexpected");
    assert.match(d.error, /Something unexpected went wrong/);
    assert.match(d.error, new RegExp(`reference ${t.deploymentId}`));
    assert.doesNotMatch(d.error, /secret internals/);
    assert.match(d.technical, /secret internals/);
    assert.ok(t.logs.some((l) => l.level === "error"));
  });

  it("refuses a starting menu priced in another currency", async () => {
    const t = await queued();
    t.store.data.menus.set(CAFE_ID, { ...MENU, currency: "USD" });
    assert.deepEqual(await t.run(), { outcome: "failed" });
    const d = await t.deployment();
    assert.match(d.error, /priced in USD, but the cafe's currency is now INR/);
    assert.equal(d.steps[3].status, "failed");
    // The site is up already; Try again only has the rest to do.
    assert.equal(d.steps[2].status, "done");
  });
});
