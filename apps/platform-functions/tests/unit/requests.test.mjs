/**
 * Requests (#77): the console's documents, claimed and run by the worker with
 * the handlers the callables use. Everything runs on the in-memory store and
 * the deployer's fake Google.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LEASE_MS } from "../../src/claim.mjs";
import {
  MAX_REQUEST_ATTEMPTS,
  claimRequest,
  initialSteps,
  processRequest,
} from "../../src/requests.mjs";
import {
  CAFE_ID,
  MENU,
  OWNER,
  PROJECT,
  draftCafe,
  testEnv,
} from "../helpers/env.mjs";

const BY = "worker:1";

/** A request as the console writes it. */
const request = (kind, params = {}, extra = {}) => ({
  id: `req-${kind}-${Math.random().toString(36).slice(2, 8)}`,
  cafeId: CAFE_ID,
  ownerUid: OWNER.uid,
  by: OWNER.uid,
  kind,
  params,
  status: "queued",
  createdAt: Date.UTC(2026, 9, 1),
  ...extra,
});

/** A platform with the owner's account and a draft cafe, ready to be set up. */
async function platform({ releases = ["1.0.0", "1.1.0"], cafe = {} } = {}) {
  const t = await testEnv({ releases });
  t.store.addAccount(OWNER.uid, { emailVerified: true });
  t.store.addCafe(draftCafe(cafe));
  t.store.data.menus.set(CAFE_ID, MENU);
  const ask = async (kind, params, extra) => {
    const r = request(kind, params, extra);
    t.store.addRequest(r);
    return r;
  };
  const run = (r, by = BY) => processRequest(t.env, r.id, { by });
  const get = (r) => t.store.getRequest(r.id);
  /** Sets the cafe up, as a request would. */
  const goLive = async () => {
    const r = await ask("provision");
    assert.equal((await run(r)).outcome, "done");
    return r;
  };
  return { ...t, ask, run, get, goLive };
}

describe("claiming a request", () => {
  it("gives it to one run only, however many ask at once", async () => {
    const t = await platform();
    const r = await t.ask("check", { projectId: PROJECT });
    const claims = await Promise.all(
      ["worker:a", "worker:b", "worker:c"].map((by) =>
        claimRequest(t.env, r.id, { by }),
      ),
    );
    assert.deepEqual(claims.map((c) => c.outcome).sort(), [
      "busy",
      "busy",
      "claimed",
    ]);
    const taken = await t.get(r);
    assert.equal(taken.status, "running");
    assert.equal(taken.attempts, 1);
    assert.equal(taken.lease.until, t.env.now().getTime() + LEASE_MS);
    assert.deepEqual(
      taken.steps.map((s) => s.status),
      ["pending"],
      "the steps are there from the first claim",
    );
  });

  it("does not run a request twice: the second run finds it done", async () => {
    const t = await platform();
    const r = await t.ask("check", { projectId: PROJECT });
    const [one, two] = await Promise.all([
      t.run(r, "worker:a"),
      t.run(r, "worker:b"),
    ]);
    assert.deepEqual([one.outcome, two.outcome].sort(), ["busy", "done"]);
    assert.equal((await t.run(r, "worker:c")).outcome, "finished");
    assert.equal((await t.get(r)).attempts, 1);
  });

  it("takes back a request whose run died, once its lease is over", async () => {
    const t = await platform();
    const r = await t.ask(
      "check",
      { projectId: PROJECT },
      {
        status: "running",
        attempts: 1,
        lease: { by: "worker:dead", until: t.env.now().getTime() + 1000 },
      },
    );
    assert.equal((await t.run(r)).outcome, "busy", "its lease is still good");
    t.advance(LEASE_MS);
    assert.equal((await t.run(r)).outcome, "done");
    assert.equal((await t.get(r)).attempts, 2);
  });

  it("gives up on one that keeps being taken and dying, and says so", async () => {
    const t = await platform();
    const r = await t.ask(
      "check",
      { projectId: PROJECT },
      {
        status: "running",
        attempts: MAX_REQUEST_ATTEMPTS,
        lease: { by: "worker:dead", until: 0 },
      },
    );
    assert.equal((await t.run(r)).outcome, "failed");
    const done = await t.get(r);
    assert.equal(done.status, "failed");
    assert.equal(done.errorCode, "gave-up");
    assert.equal(done.lease, null);
  });

  it("says a request that is not there is missing, and leaves finished ones alone", async () => {
    const t = await platform();
    assert.equal((await t.run({ id: "nope" })).outcome, "missing");
    const r = await t.ask("check", {}, { status: "done", result: { a: 1 } });
    assert.equal((await t.run(r)).outcome, "finished");
    assert.deepEqual((await t.get(r)).result, { a: 1 });
  });
});

describe("dispatching a request", () => {
  it("checks the connection, and answers with the console's ConnectionResult", async () => {
    const t = await platform();
    const r = await t.ask("check", { projectId: PROJECT });
    assert.deepEqual(await t.run(r), {
      id: r.id,
      kind: "check",
      outcome: "done",
    });
    const done = await t.get(r);
    assert.equal(done.status, "done");
    assert.deepEqual(done.result, { status: "connected" });
    assert.deepEqual(
      done.steps.map((s) => s.status),
      ["done"],
    );
    assert.equal(done.error, null);
    assert.equal(done.lease, null);
    assert.equal(done.finishedAt.getTime(), t.env.now().getTime());
  });

  it("reports a project it can't see as no-access, still as a finished check", async () => {
    const t = await platform({ cafe: { projectId: "other-project-1a2b" } });
    const r = await t.ask("check", { projectId: "other-project-1a2b" });
    await t.run(r);
    const done = await t.get(r);
    assert.equal(done.status, "done");
    assert.deepEqual(done.result, { status: "no-access" });
  });

  it("sets a cafe up: provisions, deploys, loads the menu, and goes live", async () => {
    const t = await platform();
    const r = await t.ask("provision");
    assert.deepEqual(
      initialSteps("provision").map((s) => s.id),
      ["check", "provision", "deploy", "menu", "owner"],
    );
    assert.equal((await t.run(r)).outcome, "done");

    const done = await t.get(r);
    assert.equal(done.status, "done");
    assert.ok(done.deploymentId);
    assert.deepEqual(
      [done.result.deploymentId, done.result.status],
      [done.deploymentId, "succeeded"],
    );
    assert.ok(done.result.siteUrl.startsWith("https://"));
    assert.ok(done.steps.every((s) => s.status === "done"));
    const cafe = await t.store.getCafe(CAFE_ID);
    assert.equal(cafe.status, "live");
    assert.equal(cafe.release.current, "1.1.0");
    const deployment = await t.store.getDeployment(done.deploymentId);
    assert.equal(deployment.trigger, "owner");
    assert.equal(deployment.status, "succeeded");
  });

  it("shows the deployment's progress on the request while it works", async () => {
    const t = await platform();
    t.env.progressGapMs = 0;
    const seen = [];
    const update = t.store.updateRequest;
    t.store.updateRequest = async (id, patch) => {
      if (patch.steps) seen.push(patch.steps.map((s) => s.status).join());
      return update(id, patch);
    };
    const r = await t.ask("provision");
    await t.run(r);
    assert.ok(
      seen.some((s) => s.includes("running")),
      "a step was seen running",
    );
    assert.ok(seen.some((s) => s.includes("done,running")));
  });

  it("upgrades, rolls back and syncs branding for a live cafe", async () => {
    const t = await platform({ releases: ["1.0.0", "1.1.0", "1.2.0"] });
    t.store.data.releases.get("1.1.0").withdrawn = true;
    t.store.data.releases.get("1.2.0").withdrawn = true;
    await t.goLive();
    t.store.data.releases.get("1.1.0").withdrawn = false;
    t.store.data.releases.get("1.2.0").withdrawn = false;

    const up = await t.ask("deploy", { version: "1.2.0" });
    assert.equal((await t.run(up)).outcome, "done");
    assert.deepEqual((await t.store.getCafe(CAFE_ID)).release, {
      channel: "stable",
      pinned: null,
      current: "1.2.0",
      previous: "1.0.0",
    });
    assert.deepEqual(
      (await t.get(up)).steps.map((s) => s.id),
      [
        "package",
        "migrations",
        "rules",
        "indexes",
        "settings",
        "hosting",
        "smoke",
      ],
    );

    const back = await t.ask("rollback");
    assert.equal((await t.run(back)).outcome, "done");
    assert.equal((await t.store.getCafe(CAFE_ID)).release.current, "1.0.0");

    const sync = await t.ask("sync-branding");
    assert.equal((await t.run(sync)).outcome, "done");
    const done = await t.get(sync);
    assert.equal(
      (await t.store.getDeployment(done.deploymentId)).kind,
      "branding",
    );
  });
});

describe("a request that can't be done", () => {
  it("is refused when the asker doesn't own the cafe, and nothing is queued", async () => {
    const t = await platform();
    t.store.addAccount("stranger", { emailVerified: true });
    const r = await t.ask(
      "provision",
      {},
      { by: "stranger", ownerUid: "stranger" },
    );
    assert.deepEqual(await t.run(r), {
      id: r.id,
      kind: "provision",
      outcome: "failed",
      code: "permission-denied",
    });
    const done = await t.get(r);
    assert.equal(done.status, "failed");
    assert.equal(done.errorCode, "permission-denied");
    assert.equal(done.error, "This isn't your cafe.");
    assert.equal(done.lease, null);
    assert.equal(t.store.data.deployments.size, 0);
    assert.equal((await t.store.getCafe(CAFE_ID)).status, "draft");
  });

  it("is refused for an account that is not verified, or is gone", async () => {
    const t = await platform();
    t.store.addAccount(OWNER.uid, { emailVerified: false });
    const unverified = await t.ask("provision");
    await t.run(unverified);
    assert.equal((await t.get(unverified)).errorCode, "permission-denied");

    const gone = await t.ask("provision", {}, { by: "nobody" });
    await t.run(gone);
    assert.equal((await t.get(gone)).errorCode, "permission-denied");
    assert.equal(t.store.data.deployments.size, 0);
  });

  it("does not take the document's word that the asker is the admin", async () => {
    const t = await platform();
    t.store.addAccount("stranger", { emailVerified: true });
    const r = await t.ask(
      "provision",
      {},
      { by: "stranger", ownerUid: "stranger", admin: true, byAdmin: true },
    );
    await t.run(r);
    assert.equal((await t.get(r)).errorCode, "permission-denied");
    // The account's own claim is what counts.
    t.store.addAccount("boss", { emailVerified: true, admin: true });
    const boss = await t.ask("provision", {}, { by: "boss", ownerUid: "boss" });
    assert.equal((await t.run(boss)).outcome, "done");
  });

  it("fails with the handler's words: not live, nothing to roll back, a project that isn't the cafe's", async () => {
    const t = await platform();
    const rollback = await t.ask("rollback");
    await t.run(rollback);
    assert.equal((await t.get(rollback)).errorCode, "failed-precondition");

    const other = await t.ask("check", { projectId: "someone-elses-project" });
    await t.run(other);
    const done = await t.get(other);
    assert.equal(done.errorCode, "failed-precondition");
    assert.match(done.error, /Save the project ID on the cafe first/);
    assert.deepEqual(
      done.steps.map((s) => s.status),
      ["pending"],
    );
  });

  it("fails a kind nothing runs, and one nobody knows", async () => {
    const t = await platform();
    t.store.addAccount("boss", { emailVerified: true, admin: true });
    const publish = await t.ask(
      "publish",
      { version: "1.3.0" },
      { by: "boss", cafeId: null },
    );
    await t.run(publish);
    assert.equal((await t.get(publish)).errorCode, "unimplemented");
    const odd = await t.ask("format-disk");
    await t.run(odd);
    assert.equal((await t.get(odd)).errorCode, "invalid-argument");
  });

  it("fails with the deployer's explanation when the deployment fails, and emails the owner once", async () => {
    const t = await platform({ cafe: { projectId: "other-project-1a2b" } });
    t.store.data.emails.set(OWNER.uid, OWNER.email);
    const r = await t.ask("provision");
    assert.equal((await t.run(r)).outcome, "failed");

    const done = await t.get(r);
    assert.equal(done.status, "failed");
    assert.ok(done.error);
    assert.ok(done.errorCode);
    assert.equal(done.result.status, "failed");
    const deployment = await t.store.getDeployment(done.deploymentId);
    assert.equal(deployment.status, "failed");
    assert.equal(done.error, deployment.error);
    assert.ok(done.steps.some((s) => s.status === "failed"));
    assert.equal((await t.store.getCafe(CAFE_ID)).status, "failed");
    assert.equal(t.outbox.length, 1);
    assert.equal(t.outbox[0].to, OWNER.email);
  });

  it("says something went wrong, and not what, when the backend itself breaks", async () => {
    const t = await platform();
    t.store.getAccount = async () => {
      throw new Error("secret detail: key AIza-not-for-owners");
    };
    const r = await t.ask("check", { projectId: PROJECT });
    assert.equal((await t.run(r)).code, "internal");
    const done = await t.get(r);
    assert.equal(done.errorCode, "internal");
    assert.doesNotMatch(done.error, /secret|AIza/);
    assert.ok(t.logs.some((l) => l.level === "error"));
  });
});

describe("a request that has to wait", () => {
  it("goes back in the queue when Google is slow, and carries on with the same deployment", async () => {
    const t = await platform();
    // Google answers 503 to the tries at the first database write.
    t.state.failCommits = new Set([1, 2, 3, 4, 5, 6]);
    const r = await t.ask("provision");
    assert.deepEqual(await t.run(r), {
      id: r.id,
      kind: "provision",
      outcome: "queued",
    });
    let waiting = await t.get(r);
    assert.equal(waiting.status, "queued");
    assert.equal(waiting.lease, null);
    assert.ok(waiting.detail);
    assert.ok(waiting.deploymentId, "it remembers the deployment");
    assert.equal(t.store.data.deployments.size, 1);

    t.state.failCommits = new Set();
    assert.equal((await t.run(r, "worker:2")).outcome, "done");
    waiting = await t.get(r);
    assert.equal(waiting.status, "done");
    assert.equal(waiting.attempts, 2);
    assert.equal(t.store.data.deployments.size, 1, "no second deployment");
    assert.equal((await t.store.getCafe(CAFE_ID)).status, "live");
  });

  it("is put back, not failed, while another run holds its deployment", async () => {
    const t = await platform();
    const r = await t.ask("provision");
    const queued = await t.run(r);
    assert.equal(queued.outcome, "done");

    // A request that points at a deployment someone else is working on.
    const dep = (await t.get(r)).deploymentId;
    await t.store.updateDeployment(dep, {
      status: "running",
      lease: { by: "other", until: t.env.now().getTime() + 60_000 },
    });
    const again = await t.ask("provision", {}, { deploymentId: dep });
    assert.equal((await t.run(again)).outcome, "queued");
    const waiting = await t.get(again);
    assert.equal(waiting.status, "queued");
    assert.match(waiting.detail, /another run/);
  });
});
