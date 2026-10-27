/**
 * The worker (#77): one run over the queue and the periodic jobs, and the
 * program around it (what it logs, when it refuses to start).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fakeGoogleBase } from "../../src/runtime.mjs";
import { HOUR_MS, runWorker } from "../../src/worker.mjs";
import {
  createLog,
  describe as describeRun,
  main,
  quietMail,
  refusal,
  serviceAccountEmail,
} from "../../src/worker-main.mjs";
import {
  CAFE_ID,
  MENU,
  OWNER,
  PROJECT,
  SETTINGS,
  draftCafe,
  testEnv,
} from "../helpers/env.mjs";

const BY = "worker:1";

const request = (id, kind, extra = {}) => ({
  id,
  cafeId: CAFE_ID,
  ownerUid: OWNER.uid,
  by: OWNER.uid,
  kind,
  params: kind === "check" ? { projectId: PROJECT } : {},
  status: "queued",
  createdAt: Date.UTC(2026, 9, 1),
  ...extra,
});

async function platform() {
  const t = await testEnv({ releases: ["1.0.0"] });
  t.store.addAccount(OWNER.uid, { emailVerified: true });
  t.store.addCafe(draftCafe());
  t.store.data.menus.set(CAFE_ID, MENU);
  return t;
}

describe("a run of the worker", () => {
  it("does nothing, quietly, when there is nothing to do", async () => {
    const t = await platform();
    const summary = await runWorker(t.env, { by: BY });
    assert.deepEqual(summary.requests, []);
    assert.deepEqual(summary.errors, []);
  });

  it("takes the requests oldest first, and finishes each", async () => {
    const t = await platform();
    t.store.addRequest(request("late", "check", { createdAt: 2000 }));
    t.store.addRequest(request("early", "check", { createdAt: 1000 }));
    t.store.addRequest(
      request("done-already", "check", { status: "done", createdAt: 500 }),
    );
    const summary = await runWorker(t.env, { by: BY });
    assert.deepEqual(
      summary.requests.map((r) => [r.id, r.outcome]),
      [
        ["early", "done"],
        ["late", "done"],
      ],
    );
    assert.equal((await t.store.getRequest("late")).status, "done");
  });

  it("leaves the rest for the next run beyond its limit", async () => {
    const t = await platform();
    for (let i = 1; i <= 3; i += 1) {
      t.store.addRequest(request(`r${i}`, "check", { createdAt: i }));
    }
    const summary = await runWorker(t.env, { by: BY, maxRequests: 2 });
    assert.equal(summary.requests.length, 2);
    assert.equal((await t.store.getRequest("r3")).status, "queued");
    const next = await runWorker(t.env, { by: "worker:2" });
    assert.deepEqual(
      next.requests.map((r) => r.id),
      ["r3"],
    );
  });

  it("starts no new request once its time is up", async () => {
    const t = await platform();
    t.store.addRequest(request("slow", "check", { createdAt: 1 }));
    t.store.addRequest(request("waits", "check", { createdAt: 2 }));
    const transact = t.store.transactRequest;
    t.store.transactRequest = async (id, fn) => {
      const claim = await transact(id, fn);
      t.advance(11 * 60_000); // the first one took a very long time
      return claim;
    };
    const summary = await runWorker(t.env, { by: BY });
    assert.deepEqual(
      summary.requests.map((r) => r.id),
      ["slow"],
    );
    assert.equal((await t.store.getRequest("waits")).status, "queued");
    assert.ok(t.logs.some((l) => /Out of time/.test(l.message)));

    t.store.transactRequest = transact;
    const next = await runWorker(t.env, { by: "worker:2" });
    assert.deepEqual(
      next.requests.map((r) => r.id),
      ["waits"],
    );
  });

  it("goes on to the next request when one fails, whatever the reason", async () => {
    const t = await platform();
    t.store.addRequest(
      request("not-yours", "check", { by: "stranger", createdAt: 1 }),
    );
    t.store.addAccount("stranger", { emailVerified: true });
    t.store.addRequest(request("broken", "check", { createdAt: 2 }));
    t.store.addRequest(request("fine", "check", { createdAt: 3 }));
    const getRequest = t.store.getRequest;
    const transact = t.store.transactRequest;
    // The platform fails to claim one request, as when Firestore is down.
    t.store.transactRequest = async (id, fn) => {
      if (id === "broken") throw new Error("Firestore is unavailable");
      return transact(id, fn);
    };
    const summary = await runWorker(t.env, { by: BY });
    assert.deepEqual(
      summary.requests.map((r) => [r.id, r.outcome]),
      [
        ["not-yours", "failed"],
        ["fine", "done"],
      ],
    );
    assert.deepEqual(summary.errors, [
      { request: "broken", error: "Firestore is unavailable" },
    ]);
    assert.equal(
      (await getRequest("not-yours")).errorCode,
      "permission-denied",
    );
  });
});

describe("the emails of a run", () => {
  const HISTORY = [
    ["1.3.0", "2026-06-01"],
    ["1.4.0", "2026-08-01"],
    ["1.5.0", "2026-10-10"],
  ];

  async function withReleases() {
    const t = await testEnv({ releases: [] });
    t.advance(Date.parse("2026-10-24T09:00:00Z") - t.env.now().getTime());
    for (const [version, date] of HISTORY) {
      t.store.addRelease({
        version,
        channel: "stable",
        withdrawn: false,
        publishedAt: Date.parse(date),
      });
    }
    const addCafe = (n, release) =>
      t.store.addCafe(
        draftCafe({
          id: `cafe${n}`,
          ownerUid: `owner${n}`,
          ownerEmail: `owner${n}@example.com`,
          status: "live",
          settings: { ...SETTINGS, name: `Cafe ${n}` },
          release: { channel: "stable", previous: null, ...release },
        }),
      );
    return { ...t, addCafe };
  }

  it("tell a cafe on a dropped line to upgrade, and one on an older line about the new release", async () => {
    const t = await withReleases();
    t.addCafe(1, { pinned: "1.3", current: "1.3.0" });
    t.addCafe(2, { pinned: "1.4", current: "1.4.0" });
    const summary = await runWorker(t.env, { by: BY });
    assert.deepEqual(summary.mail.failed, []);
    assert.deepEqual(
      summary.mail.sent.map((s) => [s.cafe, s.kind]).sort(),
      [
        ["cafe1", "upgrade-required"],
        ["cafe2", "release-available"],
      ].sort(),
    );
    assert.equal(t.outbox.length, 2);
  });

  it("run at most once an hour, and send nothing twice", async () => {
    const t = await withReleases();
    t.addCafe(1, { pinned: "1.4", current: "1.4.0" });
    await runWorker(t.env, { by: BY });
    assert.equal(t.outbox.length, 1);

    t.advance(5 * 60_000);
    const soon = await runWorker(t.env, { by: BY });
    assert.equal(soon.mail, null, "not due again so soon");

    t.advance(HOUR_MS);
    const later = await runWorker(t.env, { by: BY });
    assert.deepEqual(later.mail.sent, [], "due, but nobody is told again");
    assert.equal(t.outbox.length, 1);
  });

  it("don't stop the requests, and are reported when they fail", async () => {
    const t = await withReleases();
    t.store.addAccount(OWNER.uid, { emailVerified: true });
    t.store.addCafe(draftCafe({ id: "mine" }));
    t.store.addRequest(request("mine-check", "check", { cafeId: "mine" }));
    t.store.listReleases = async () => {
      throw new Error("Firestore is unavailable");
    };
    const summary = await runWorker(t.env, { by: BY });
    assert.deepEqual(
      summary.requests.map((r) => r.outcome),
      ["done"],
    );
    assert.deepEqual(summary.errors, [
      { job: "mail", error: "Firestore is unavailable" },
    ]);
  });
});

describe("the program", () => {
  it("logs the message and the ids it is about, never the rest", () => {
    const lines = [];
    const log = createLog((line) => lines.push(line));
    log("info", "> Hosting", { deployment: "d1", cafe: "c1" });
    log("warn", "Email failed", {
      cafe: "c1",
      mail: { to: "owner@example.com", text: "set-password link" },
      error: "connect ECONNRESET owner@example.com",
    });
    log("info", "Plain");
    assert.deepEqual(lines, [
      "[info] > Hosting (deployment=d1 cafe=c1)",
      "[warn] Email failed (cafe=c1)",
      "[info] Plain",
    ]);
  });

  it("says that an email was not sent, without saying to whom", async () => {
    const lines = [];
    const log = createLog((line) => lines.push(line));
    const mail = quietMail(
      {
        sender: { name: "log", send: async () => assert.fail("not this one") },
        consoleUrl: "https://c.example",
      },
      log,
    );
    const answer = await mail.sender.send({
      to: "owner@example.com",
      subject: "Please upgrade Cafe 1",
      text: "A link",
    });
    assert.deepEqual(answer, { id: null });
    assert.equal(mail.consoleUrl, "https://c.example");
    assert.equal(lines.length, 1);
    assert.match(lines[0], /Please upgrade Cafe 1/);
    assert.doesNotMatch(lines.join(), /owner@example\.com|A link/);

    const resend = { sender: { name: "resend" } };
    assert.equal(
      quietMail(resend, log),
      resend,
      "a real provider is left alone",
    );
  });

  it("refuses to run for a pull request, or without the platform's key", () => {
    assert.match(
      refusal({
        GITHUB_EVENT_NAME: "pull_request",
        GOOGLE_APPLICATION_CREDENTIALS: "k",
      }),
      /never runs for a pull request/,
    );
    assert.match(
      refusal({
        GITHUB_EVENT_NAME: "pull_request_target",
        GOOGLE_APPLICATION_CREDENTIALS: "k",
      }),
      /never runs for a pull request/,
    );
    assert.match(refusal({}), /GOOGLE_APPLICATION_CREDENTIALS isn't set/);
    assert.equal(
      refusal({
        GITHUB_EVENT_NAME: "schedule",
        GOOGLE_APPLICATION_CREDENTIALS: "k",
      }),
      null,
    );
    assert.equal(refusal({ FIRESTORE_EMULATOR_HOST: "127.0.0.1:8180" }), null);
  });

  it("stops with an error line and exit code 1 when it must not run", async () => {
    const lines = [];
    const code = await main({ GITHUB_EVENT_NAME: "pull_request" }, (l) =>
      lines.push(l),
    );
    assert.equal(code, 1);
    assert.match(lines[0], /^\[error\] /);
  });

  it("reads the service account's address from its key file", async () => {
    const read = async (path) => {
      assert.equal(path, "/tmp/key.json");
      return JSON.stringify({
        client_email: "platform@getcafemenu.iam.gserviceaccount.com",
        private_key: "never read",
      });
    };
    assert.equal(
      await serviceAccountEmail(
        { GOOGLE_APPLICATION_CREDENTIALS: "/tmp/key.json" },
        read,
      ),
      "platform@getcafemenu.iam.gserviceaccount.com",
    );
    const fallback = "CafeMenu's deploy account";
    assert.equal(await serviceAccountEmail({}, read), fallback);
    assert.equal(
      await serviceAccountEmail(
        { GOOGLE_APPLICATION_CREDENTIALS: "/tmp/key.json" },
        async () => {
          throw new Error("no such file");
        },
      ),
      fallback,
    );
  });

  it("describes a run without naming anyone", () => {
    assert.equal(
      describeRun({
        requests: [
          { outcome: "done" },
          { outcome: "done" },
          { outcome: "failed" },
        ],
        mail: { sent: [1], failed: [] },
        errors: [],
      }),
      "Requests: 2 done, 1 failed. emails: 1 sent, 0 failed.",
    );
    assert.equal(
      describeRun({ requests: [], mail: null, errors: [] }),
      "Requests: none. emails: not due.",
    );
  });

  it("takes the fake Google only under an emulator and a demo project", () => {
    const base = "http://127.0.0.1:8399";
    const fake = {
      CAFEMENU_FAKE_GOOGLE: base,
      GCLOUD_PROJECT: "demo-cafemenu",
    };
    assert.equal(
      fakeGoogleBase({ ...fake, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8180" }),
      base,
    );
    assert.equal(fakeGoogleBase({ ...fake, FUNCTIONS_EMULATOR: "true" }), base);
    assert.equal(fakeGoogleBase(fake), null, "no emulator");
    assert.equal(
      fakeGoogleBase({
        CAFEMENU_FAKE_GOOGLE: base,
        GCLOUD_PROJECT: "getcafemenu",
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8180",
      }),
      null,
      "a real project",
    );
  });
});
