/**
 * The backend as a job (#77): requests claimed once, done by the callables'
 * own handlers, answered on the request; deployments queued some other way;
 * the email and support-window jobs; and what the public log may show. On
 * the deployer's fake Google and the platform's data in memory.
 */
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { newRequestRecord } from "@cafemenu/shared/requests";

import { requestSyncBranding } from "../../src/callables.mjs";
import { createGoogleSide, fakeGoogleBase } from "../../src/runtime.mjs";
import { runBackgroundJobs } from "../../src/worker/background.mjs";
import { workerSettings } from "../../src/worker/env.mjs";
import {
  createPublicLog,
  redact,
  summaryLines,
} from "../../src/worker/log.mjs";
import {
  REQUEST_LEASE_MS,
  processRequest,
} from "../../src/worker/requests.mjs";
import {
  fairOrder,
  hadUnexpected,
  runWorker,
} from "../../src/worker/worker.mjs";
import {
  CAFE_ID,
  CLIENT_EMAIL,
  MENU,
  OWNER,
  call,
  draftCafe,
  testEnv,
} from "../helpers/env.mjs";

const MINUTE = 60_000;
const DAY = 86_400_000;

/**
 * The platform with one owner and their draft cafe, and `ask` to write a
 * request as the console does (newRequestRecord, @cafemenu/shared).
 */
async function platform({ releases = ["1.0.0", "1.1.0", "1.2.0"] } = {}) {
  const t = await testEnv({ releases });
  t.store.addAccount(OWNER.uid, { email: OWNER.email });
  t.store.addCafe(draftCafe());
  t.store.data.menus.set(CAFE_ID, MENU);
  let runs = 0;
  const ask = (kind, params = {}, { by = OWNER.uid, cafeId = CAFE_ID } = {}) =>
    t.store.addRequest(
      newRequestRecord({ cafeId, kind, params, by }, t.env.now()),
    );
  const run = (options = {}) => {
    runs += 1;
    return runWorker(t.env, { runId: `run-${runs}`, ...options });
  };
  return {
    ...t,
    ask,
    run,
    request: (id) => t.store.getRequest(id),
    cafeNow: () => t.store.getCafe(CAFE_ID),
  };
}

/** The same, with the cafe set up and live on 1.0.0, and 1.1.0 and 1.2.0 out. */
async function livePlatform() {
  const t = await platform();
  // Setting it up puts the newest release on it; start from 1.0.0 instead.
  t.store.data.releases.get("1.1.0").withdrawn = true;
  t.store.data.releases.get("1.2.0").withdrawn = true;
  const setup = t.ask("provision");
  await t.run();
  assert.equal((await t.request(setup)).status, "done");
  assert.equal((await t.cafeNow()).status, "live");
  t.store.data.releases.get("1.1.0").withdrawn = false;
  t.store.data.releases.get("1.2.0").withdrawn = false;
  return t;
}

describe("claiming a request", () => {
  it("lets one run have it: a second run that meets it leaves it alone", async () => {
    const t = await livePlatform();
    const id = t.ask("sync-branding");
    const deploymentsBefore = t.store.data.deployments.size;

    const [first, second] = await Promise.all([t.run(), t.run()]);

    const outcomes = [first, second].map(
      (s) => s.requests.find((r) => r.id === id)?.outcome,
    );
    assert.deepEqual(outcomes.sort(), ["done", "skipped"]);
    const request = await t.request(id);
    assert.equal(request.status, "done");
    assert.equal(request.attempts, 1, "claimed once");
    assert.equal(t.store.data.deployments.size, deploymentsBefore + 1);
    const deployment = await t.store.getDeployment(request.deploymentId);
    assert.equal(deployment.status, "succeeded");
    assert.equal(deployment.attempts, 1, "and its deployment run once");
  });

  it("leaves a request that is finished, and one that is gone", async () => {
    const t = await platform();
    const id = t.ask("check", { projectId: draftCafe().projectId });
    await t.run();
    assert.equal((await t.request(id)).status, "done");
    assert.deepEqual(await processRequest(t.env, id, { runId: "again" }), {
      id,
      kind: "check",
      outcome: "skipped",
      code: "finished",
    });
    assert.equal(
      (await processRequest(t.env, "nope", { runId: "x" })).code,
      "missing",
    );
  });

  it("takes over a request whose run died, once its lease has run out", async () => {
    const t = await platform();
    const id = t.ask("check", { projectId: draftCafe().projectId });
    await t.store.updateRequest(id, {
      status: "running",
      attempts: 1,
      lease: { by: "a-run-that-died", until: t.env.now().getTime() + MINUTE },
    });
    let summary = await t.run();
    assert.equal(summary.requests[0].code, "busy");
    assert.equal((await t.request(id)).status, "running");

    t.advance(REQUEST_LEASE_MS);
    summary = await t.run();
    assert.equal(summary.requests[0].outcome, "done");
    assert.equal((await t.request(id)).attempts, 2);
  });

  it("gives up after four pickups, and says so with a reference", async () => {
    const t = await platform();
    const id = t.ask("rollback");
    await t.store.updateRequest(id, { attempts: 4 });
    await t.run();
    const request = await t.request(id);
    assert.equal(request.status, "failed");
    assert.equal(request.errorCode, "gave-up");
    assert.match(request.error, new RegExp(id));
    assert.equal(request.lease, null);
  });
});

describe("what each kind does", () => {
  it("check: answers with what the deployer's check found", async () => {
    const t = await platform();
    const id = t.ask("check", { projectId: draftCafe().projectId });
    const summary = await t.run();
    assert.deepEqual(summary.requests, [
      { id, kind: "check", outcome: "done", code: null },
    ]);
    const request = await t.request(id);
    assert.deepEqual(request.result, { status: "connected" });
    assert.deepEqual(
      request.progress.steps.map((s) => [s.id, s.status]),
      [["check", "done"]],
    );
    assert.ok(request.finishedAt instanceof Date);
  });

  it("check: names each permission the deploy account lacks", async () => {
    const t = await platform();
    t.state.permissions = new Set();
    const id = t.ask("check", { projectId: draftCafe().projectId });
    await t.run();
    const { result } = await t.request(id);
    assert.equal(result.status, "missing");
    assert.ok(result.missing.length > 0);
    assert.ok(result.missing.every((m) => m.permission && m.neededBy.length));
  });

  it("provision: sets the cafe up, and the request shows the deployment's steps as they move", async () => {
    const t = await platform();
    const id = t.ask("provision");
    const seen = [];
    const update = t.store.updateRequest;
    t.store.updateRequest = async (rid, patch) => {
      if (rid === id && patch.progress) {
        seen.push(patch.progress.steps.map((s) => s.status).join(","));
      }
      return update(rid, patch);
    };
    await t.run();

    const request = await t.request(id);
    assert.equal(request.status, "done", request.error);
    assert.equal(request.result.outcome, "succeeded");
    assert.equal(request.result.siteUrl, `https://${draftCafe().site}.web.app`);
    assert.equal(request.result.deploymentId, request.deploymentId);
    assert.deepEqual(
      request.progress.steps.map((s) => s.id),
      ["check", "provision", "deploy", "menu", "owner"],
    );
    assert.ok(request.progress.steps.every((s) => s.status === "done"));
    assert.ok(
      seen.some((s) => s.includes("running")),
      `a step was seen running: ${seen.join(" | ")}`,
    );
    const cafe = await t.cafeNow();
    assert.equal(cafe.status, "live");
    assert.equal(cafe.release.current, "1.2.0");
    const deployment = await t.store.getDeployment(request.deploymentId);
    assert.equal(deployment.trigger, "owner");
  });

  it("deploy, rollback and sync-branding: do what the owner area's buttons ask", async () => {
    const t = await livePlatform();
    const up = t.ask("deploy", { version: "1.1.0" });
    await t.run();
    assert.equal((await t.request(up)).status, "done");
    assert.equal((await t.cafeNow()).release.current, "1.1.0");

    const back = t.ask("rollback");
    await t.run();
    assert.equal((await t.request(back)).status, "done");
    const cafe = await t.cafeNow();
    assert.deepEqual(
      [cafe.release.current, cafe.release.previous],
      ["1.0.0", null],
    );

    const sync = t.ask("sync-branding");
    await t.run();
    const request = await t.request(sync);
    assert.equal(request.status, "done");
    const deployment = await t.store.getDeployment(request.deploymentId);
    assert.equal(deployment.kind, "branding");
  });

  it("the admin may ask for any cafe, and the deployment says it was the admin", async () => {
    const t = await livePlatform();
    t.store.addAccount("admin1", { admin: true });
    const id = t.ask("sync-branding", {}, { by: "admin1" });
    await t.run();
    const request = await t.request(id);
    assert.equal(request.status, "done");
    const deployment = await t.store.getDeployment(request.deploymentId);
    assert.equal(deployment.trigger, "admin");
  });
});

describe("when a request can't be done", () => {
  it("refuses someone who doesn't own the cafe, with the callable's words, and queues nothing", async () => {
    const t = await livePlatform();
    t.store.addAccount("stranger");
    const before = t.store.data.deployments.size;
    const id = t.ask("sync-branding", {}, { by: "stranger" });
    const summary = await t.run();
    assert.deepEqual(summary.requests, [
      {
        id,
        kind: "sync-branding",
        outcome: "failed",
        code: "permission-denied",
      },
    ]);
    const request = await t.request(id);
    assert.equal(request.error, "This isn't your cafe.");
    assert.equal(t.store.data.deployments.size, before);
  });

  it("refuses an account that is gone, disabled or never verified", async () => {
    const t = await livePlatform();
    t.store.addAccount("disabled", { disabled: true });
    t.store.addAccount("unverified", { emailVerified: false });
    // Each of them as if they owned the cafe.
    for (const uid of ["gone", "disabled", "unverified"]) {
      t.store.data.cafes.get(CAFE_ID).ownerUid = uid;
      const id = t.ask("sync-branding", {}, { by: uid });
      await t.run();
      const request = await t.request(id);
      assert.equal(request.status, "failed", uid);
      assert.equal(request.errorCode, "permission-denied", uid);
    }
  });

  it("refuses a kind it doesn't know", async () => {
    const t = await platform();
    const id = t.store.addRequest({
      cafeId: CAFE_ID,
      kind: "delete-everything",
      params: {},
      status: "queued",
      createdAt: t.env.now(),
      by: OWNER.uid,
    });
    await t.run();
    assert.equal((await t.request(id)).errorCode, "invalid-argument");
  });

  it("one at a time: refused while another deployment is queued", async () => {
    const t = await livePlatform();
    // Queued some other way (a callable on Blaze), not yet run.
    await requestSyncBranding(t.env, call({ cafeId: CAFE_ID }));
    const id = t.ask("deploy", { version: "1.1.0" });
    await t.run();
    const request = await t.request(id);
    assert.equal(request.status, "failed");
    assert.equal(request.errorCode, "failed-precondition");
    assert.match(request.error, /queued or running/);
  });

  it("a deployment that fails its smoke test fails the request with its words, and the owner is emailed", async () => {
    const t = await livePlatform();
    t.state.siteHook = (url) =>
      url.pathname === "/staff"
        ? new Response("boom", { status: 500 })
        : undefined;
    const id = t.ask("deploy", { version: "1.1.0" });
    await t.run();
    const request = await t.request(id);
    assert.equal(request.status, "failed");
    assert.equal(request.errorCode, "smoke-test-failed");
    assert.match(request.error, /1\.1\.0 was rolled back/);
    assert.equal(request.result.outcome, "rolled-back");
    assert.equal(
      request.progress.steps.find((s) => s.id === "smoke").status,
      "failed",
    );
    assert.equal((await t.cafeNow()).release.current, "1.0.0");
    assert.equal(t.outbox.length, 1);
    assert.match(t.outbox[0].subject, /rolled back|didn't go through/i);
    assert.equal(t.outbox[0].to, OWNER.email);
  });

  it("puts the request back when Google is busy, and the next run carries on with the same deployment", async () => {
    const t = await livePlatform();
    // Google answers 503 to every read of the cafe's settings, for a while.
    let busy = true;
    t.env.google = createGoogleSide({
      getToken: async () => "fake-token-1",
      clientEmail: CLIENT_EMAIL,
      sleep: t.env.sleep,
      now: t.env.now,
      loadShared: t.env.loadShared,
      fetchImpl: (url, init = {}) =>
        busy && /documents\/config\/site/.test(String(url))
          ? Response.json(
              { error: { code: 503, status: "UNAVAILABLE", message: "busy" } },
              { status: 503 },
            )
          : t.fake.fetchImpl(url, init),
    });
    const id = t.ask("sync-branding");
    let summary = await t.run();
    assert.equal(summary.requests[0].outcome, "later");
    let request = await t.request(id);
    assert.equal(request.status, "queued");
    assert.ok(request.deploymentId);
    assert.match(request.progress.detail, /carries on by itself/);
    assert.equal(
      (await t.store.getDeployment(request.deploymentId)).status,
      "queued",
    );

    busy = false;
    const deployments = t.store.data.deployments.size;
    summary = await t.run();
    assert.equal(summary.requests[0].outcome, "done");
    request = await t.request(id);
    assert.equal(request.status, "done");
    assert.equal(t.store.data.deployments.size, deployments, "not asked again");
    const deployment = await t.store.getDeployment(request.deploymentId);
    assert.equal(deployment.status, "succeeded");
    assert.equal(deployment.attempts, 2);
  });

  it("anything unexpected fails the request with a reference, and the run says so", async () => {
    const t = await livePlatform();
    t.store.queueDeployment = async () => {
      throw new TypeError("a bug");
    };
    const id = t.ask("sync-branding");
    const summary = await t.run();
    const request = await t.request(id);
    assert.equal(request.status, "failed");
    assert.equal(request.errorCode, "unexpected");
    assert.match(request.error, new RegExp(`reference: ${id}`));
    assert.equal(request.technical, "TypeError: a bug");
    assert.ok(hadUnexpected(summary));
    assert.ok(t.logs.some((l) => l.level === "error"));
  });
});

describe("a run", () => {
  it("takes turns between cafes, oldest first within each", () => {
    const r = (id, cafeId) => ({ id, cafeId });
    assert.deepEqual(
      fairOrder([
        r(1, "a"),
        r(2, "a"),
        r(3, "a"),
        r(4, "b"),
        r(5, "c"),
        r(6, "b"),
      ]).map((x) => x.id),
      [1, 4, 5, 2, 6, 3],
    );
  });

  it("answers at most `maxRequests`, leaving the rest queued for the next run", async () => {
    const t = await platform();
    const projectId = draftCafe().projectId;
    const first = t.ask("check", { projectId });
    const second = t.ask("check", { projectId });
    await t.run({ maxRequests: 1 });
    assert.equal((await t.request(first)).status, "done");
    assert.equal((await t.request(second)).status, "queued");
    await t.run();
    assert.equal((await t.request(second)).status, "done");
  });

  it("starts nothing new once its time is up", async () => {
    const t = await platform();
    const id = t.ask("check", { projectId: draftCafe().projectId });
    const summary = await t.run({ budgetMs: 0 });
    assert.deepEqual(summary.requests, []);
    assert.equal((await t.request(id)).status, "queued");
  });

  it("runs a deployment queued some other way, and emails the owner when it fails", async () => {
    const t = await livePlatform();
    const { deploymentId } = await requestSyncBranding(
      t.env,
      call({ cafeId: CAFE_ID }),
    );
    let summary = await t.run();
    assert.deepEqual(summary.deployments, [
      { id: deploymentId, outcome: "succeeded" },
    ]);

    // A settings logo that isn't there: the sync fails, and the owner hears.
    t.store.data.cafes.get(CAFE_ID).settings.logo = "/logo.png";
    const failing = await requestSyncBranding(t.env, call({ cafeId: CAFE_ID }));
    summary = await t.run();
    assert.equal(summary.deployments[0].outcome, "failed");
    assert.equal(
      (await t.store.getDeployment(failing.deploymentId)).status,
      "failed",
    );
    assert.equal(t.outbox.length, 1);
    assert.equal(t.outbox[0].to, OWNER.email);
  });
});

describe("the email and support-window jobs", () => {
  /** A cafe that stays on `line`, running `current`. */
  const pinnedCafe = (id, line, current) =>
    draftCafe({
      id,
      site: id,
      ownerUid: OWNER.uid,
      status: "live",
      release: { channel: "stable", pinned: line, current, previous: null },
    });

  async function withPinned() {
    const t = await testEnv({ releases: ["1.0.0", "1.1.0", "1.2.0"] });
    t.store.addAccount(OWNER.uid, { email: OWNER.email });
    t.store.data.emails.set(OWNER.uid, OWNER.email);
    const published = {
      "1.0.0": "2026-08-01",
      "1.1.0": "2026-09-01",
      "1.2.0": "2026-09-25",
    };
    for (const [version, date] of Object.entries(published)) {
      t.store.data.releases.get(version).publishedAt = Date.parse(date);
    }
    // 1.0 was dropped when 1.2.0 came out; 1.2 is supported.
    t.store.addCafe(pinnedCafe("old-cafe", "1.0", "1.0.0"));
    t.store.addCafe(pinnedCafe("new-cafe", "1.2", "1.2.0"));
    return t;
  }
  const kinds = (outbox) =>
    outbox.map((e) =>
      /^Please upgrade/.test(e.subject)
        ? "upgrade-required"
        : "release-available",
    );

  it("the first run remembers the releases without announcing them, and tells a dropped line to upgrade", async () => {
    const t = await withPinned();
    const done = await runBackgroundJobs(t.env);
    assert.equal(done.ran, true);
    assert.deepEqual(done.announced, []);
    assert.equal(done.support, true);
    assert.deepEqual(kinds(t.outbox), ["upgrade-required"]);
    assert.deepEqual(Object.keys((await t.store.getWorkerState()).releases), [
      "1.0.0",
      "1.1.0",
      "1.2.0",
    ]);
  });

  it("runs at most hourly, unless asked to now", async () => {
    const t = await withPinned();
    await runBackgroundJobs(t.env);
    assert.deepEqual(await runBackgroundJobs(t.env), { ran: false });
    assert.equal((await runBackgroundJobs(t.env, { force: true })).ran, true);
    t.advance(61 * MINUTE);
    assert.equal((await runBackgroundJobs(t.env)).ran, true);
  });

  it("announces a new stable release to the cafes that stay on a line, once", async () => {
    const t = await withPinned();
    await runBackgroundJobs(t.env);
    t.outbox.length = 0;

    // A beta is not announced.
    t.store.addRelease({
      version: "1.3.0-beta.1",
      channel: "beta",
      withdrawn: false,
      publishedAt: Date.parse("2026-09-30"),
    });
    let done = await runBackgroundJobs(t.env, { force: true });
    assert.deepEqual(done.announced, ["1.3.0-beta.1"]);
    assert.deepEqual(t.outbox, []);

    t.store.addRelease({
      version: "1.3.0",
      channel: "stable",
      withdrawn: false,
      publishedAt: t.env.now().getTime(),
    });
    done = await runBackgroundJobs(t.env, { force: true });
    assert.deepEqual(done.announced, ["1.3.0"]);
    // new-cafe (1.2) hears of 1.3.0. old-cafe was already told to upgrade.
    assert.deepEqual(kinds(t.outbox), ["release-available"]);
    assert.match(t.outbox[0].subject, /1\.3\.0/);

    await runBackgroundJobs(t.env, { force: true });
    assert.equal(t.outbox.length, 1, "not twice");

    // And each is in the admin log (#78), once; the first run's are not.
    assert.deepEqual(
      [...t.store.data.adminLog.keys()],
      ["publish-release-1.3.0-beta.1", "publish-release-1.3.0"],
    );
    assert.deepEqual(
      t.store.data.adminLog.get("publish-release-1.3.0").details,
      { version: "1.3.0", channel: "stable" },
    );
  });

  it("logs a release promoted to stable or withdrawn", async () => {
    const t = await withPinned();
    await runBackgroundJobs(t.env);
    t.store.data.releases.get("1.2.0").withdrawn = true;
    t.store.data.releases.get("1.1.0").channel = "beta";
    await runBackgroundJobs(t.env, { force: true });
    t.store.data.releases.get("1.1.0").channel = "stable";
    await runBackgroundJobs(t.env, { force: true });
    assert.deepEqual(
      [...t.store.data.adminLog.values()].map((e) => [
        e.action,
        e.details.version,
        e.by,
      ]),
      [
        ["withdraw-release", "1.2.0", "release-workflow"],
        ["promote-release", "1.1.0", "release-workflow"],
      ],
    );
  });

  it("looks at the support window once a day", async () => {
    const t = await withPinned();
    await runBackgroundJobs(t.env);
    t.advance(2 * 60 * MINUTE);
    assert.equal((await runBackgroundJobs(t.env)).support, false);
    t.advance(DAY);
    assert.equal((await runBackgroundJobs(t.env)).support, true);
    assert.equal(t.outbox.length, 1, "the same notice is not sent again");
  });

  it("is part of every run, when due", async () => {
    const t = await withPinned();
    const summary = await runWorker(t.env, { runId: "r1" });
    assert.equal(summary.jobs.ran, true);
    assert.equal(
      (await runWorker(t.env, { runId: "r2" })).jobs.ran,
      false,
      "within the hour",
    );
    assert.equal(
      (await runWorker(t.env, { runId: "r3", jobs: true })).jobs.ran,
      true,
    );
  });
});

describe("the public log", () => {
  it("hides email addresses", () => {
    assert.equal(
      redact("Email to owner@example.com: hi, cc <a.b+c@x.co>"),
      "Email to <email>: hi, cc <<email>>",
    );
  });

  it("prints warnings and errors as fixed words, and nothing of the deployer's output", () => {
    const lines = [];
    const { log, counts } = createPublicLog({ write: (l) => lines.push(l) });
    log("info", "> Firestore rules", { project: "their-project" });
    log("info", "Email to owner@example.com: Please upgrade Mochi");
    log("warn", "Could not write progress", { id: "d1", error: "secret" });
    log("error", "Email failed: Resend refused owner@example.com");
    assert.deepEqual(lines, [
      "warn: Could not write progress",
      "error: Email failed: Resend refused <email>",
    ]);
    assert.deepEqual(counts, { info: 2, warn: 1, error: 1 });
  });

  it("prints everything when verbose, for a machine of your own", () => {
    const lines = [];
    const { log } = createPublicLog({
      write: (l) => lines.push(l),
      verbose: true,
    });
    log("info", "> Hosting", { cafe: "c1" });
    assert.deepEqual(lines, ['info: > Hosting {"cafe":"c1"}']);
  });

  it("sums a run up by ids, kinds and outcomes only", () => {
    assert.deepEqual(
      summaryLines({
        requests: [
          { id: "r1", kind: "check", outcome: "done", code: null },
          {
            id: "r2",
            kind: "deploy",
            outcome: "failed",
            code: "failed-precondition",
          },
        ],
        deployments: [{ id: "d1", outcome: "later" }],
        jobs: {
          ran: true,
          announced: ["1.3.0"],
          support: true,
          sent: 2,
          skipped: 1,
          failed: 0,
        },
      }),
      [
        "request r1 (check): done",
        "request r2 (deploy): failed [failed-precondition]",
        "deployment d1: later",
        "jobs: 1 release change(s), support window checked; emails 2 sent, 1 not needed, 0 failed",
      ],
    );
    assert.deepEqual(
      summaryLines({ requests: [], deployments: [], jobs: { ran: false } }),
      ["nothing to do"],
    );
  });
});

describe("the worker's settings", () => {
  const keyFile = async (json) => {
    const dir = await mkdtemp(join(tmpdir(), "worker-key-"));
    const path = join(dir, "key.json");
    await writeFile(path, JSON.stringify(json));
    return path;
  };
  const KEY = {
    type: "service_account",
    client_email: "cafemenu-deploy@getcafemenu.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----\nnot a real one\n",
    project_id: "getcafemenu",
  };

  it("needs the service account's key, and takes the project from it", async () => {
    await assert.rejects(workerSettings({}), /No service-account key/);
    const path = await keyFile(KEY);
    const settings = await workerSettings({
      GOOGLE_APPLICATION_CREDENTIALS: path,
    });
    assert.equal(settings.projectId, "getcafemenu");
    assert.equal(settings.emulated, false);
    assert.equal(settings.key.clientEmail, KEY.client_email);
    assert.equal(
      JSON.stringify(settings).includes("not a real one"),
      false,
      "the private key can't be printed by accident",
    );
  });

  it("refuses a real key for a demo- project, and the emulators for a real one", async () => {
    const path = await keyFile({ ...KEY, project_id: "demo-cafemenu" });
    await assert.rejects(
      workerSettings({ GOOGLE_APPLICATION_CREDENTIALS: path }),
      /only exists on the emulators/,
    );
    await assert.rejects(
      workerSettings({
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8180",
        GCLOUD_PROJECT: "getcafemenu",
      }),
      /must be a demo- one/,
    );
    assert.deepEqual(
      await workerSettings({
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8180",
        GCLOUD_PROJECT: "demo-cafemenu",
      }),
      { emulated: true, projectId: "demo-cafemenu", key: null },
    );
  });

  it("only ever sends Google's calls to the fake on the emulators, for a demo- project", () => {
    const fake = { CAFEMENU_FAKE_GOOGLE: "http://127.0.0.1:8399" };
    assert.equal(
      fakeGoogleBase({
        ...fake,
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8180",
        GCLOUD_PROJECT: "demo-cafemenu",
      }),
      fake.CAFEMENU_FAKE_GOOGLE,
    );
    assert.equal(
      fakeGoogleBase({ ...fake, GCLOUD_PROJECT: "demo-cafemenu" }),
      null,
    );
    assert.equal(
      fakeGoogleBase({
        ...fake,
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8180",
        GCLOUD_PROJECT: "getcafemenu",
      }),
      null,
    );
  });
});
