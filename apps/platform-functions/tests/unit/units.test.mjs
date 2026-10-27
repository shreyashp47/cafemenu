import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ActionNeededError,
  ApiError,
  OperationError,
  SiteNameTakenError,
  UsageError,
} from "@cafemenu/deployer";

import { LEASE_MS, decideClaim, isDead } from "../../src/claim.mjs";
import { MissingAccessError } from "../../src/errors.mjs";
import { errorText, explain } from "../../src/explain.mjs";
import { PLANS, newSteps, stepForTitle } from "../../src/plans.mjs";
import { createProgress } from "../../src/progress.mjs";
import { ownerName } from "../../src/provision-job.mjs";
import { isTransient, withRetry } from "../../src/retry.mjs";
import {
  eligibleReleases,
  minorLine,
  pickRelease,
} from "../../src/versions.mjs";

const api = (status) =>
  new ApiError({ method: "GET", url: "https://x", status, reason: "no" });

describe("which release a cafe gets", () => {
  const releases = [
    { version: "1.0.0", channel: "stable" },
    { version: "1.1.0", channel: "stable" },
    { version: "1.1.1", channel: "stable", withdrawn: true },
    { version: "1.2.0-beta.1", channel: "beta" },
    { version: "1.2.0-rc.1", channel: "beta" },
    { version: "not-a-version", channel: "stable" },
  ];

  it("takes the newest stable release for a stable cafe, skipping withdrawn and odd ones", () => {
    assert.equal(
      pickRelease(releases, { channel: "stable", pinned: null }).version,
      "1.1.0",
    );
  });

  it("takes the newest of either channel for a beta cafe, a release candidate after its betas", () => {
    assert.equal(
      pickRelease(releases, { channel: "beta", pinned: null }).version,
      "1.2.0-rc.1",
    );
  });

  it("stays on the pinned minor line, and is null when it has nothing", () => {
    assert.equal(
      pickRelease(releases, { channel: "stable", pinned: "1.0" }).version,
      "1.0.0",
    );
    assert.equal(
      pickRelease(releases, { channel: "stable", pinned: "3.0" }),
      null,
    );
    assert.equal(pickRelease([], { channel: "stable", pinned: null }), null);
  });

  it("knows a version's minor line", () => {
    assert.equal(minorLine("1.4.2"), "1.4");
    assert.equal(minorLine("1.5.0-beta.1"), "1.5");
    assert.equal(minorLine("nope"), null);
    assert.equal(eligibleReleases(releases, "stable").length, 2);
  });
});

describe("transient failures", () => {
  it("are Google being busy or silent, not a refusal", () => {
    for (const status of [429, 500, 503, 504])
      assert.equal(isTransient(api(status)), true, String(status));
    for (const status of [400, 401, 403, 404, 409])
      assert.equal(isTransient(api(status)), false, String(status));
    assert.equal(
      isTransient(new Error("GET https://x did not get an answer: reset")),
      true,
    );
    assert.equal(
      isTransient(new Error("Timed out waiting for Creating the database")),
      true,
    );
    assert.equal(isTransient(new OperationError("x", { code: 14 })), true);
    assert.equal(isTransient(new OperationError("x", { code: 7 })), false);
    assert.equal(isTransient(new ActionNeededError("needs a person")), false);
  });

  it("are retried after growing waits, and the last error is thrown", async () => {
    const waits = [];
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw api(503);
        return "ok";
      },
      { sleep: async (ms) => waits.push(ms) },
    );
    assert.deepEqual([result, calls, waits], ["ok", 3, [2000, 10000]]);

    calls = 0;
    await assert.rejects(
      withRetry(
        async () => {
          calls += 1;
          throw api(503);
        },
        { sleep: async () => {} },
      ),
      { status: 503 },
    );
    assert.equal(calls, 3);
  });

  it("is not retried when it is not transient", async () => {
    let calls = 0;
    await assert.rejects(
      withRetry(
        async () => {
          calls += 1;
          throw api(403);
        },
        { sleep: async () => {} },
      ),
    );
    assert.equal(calls, 1);
  });
});

describe("who works on a deployment", () => {
  const now = 1_000_000;
  const queued = { status: "queued", attempts: 0 };

  it("claims a queued one with a lease, and counts the attempt", () => {
    const d = decideClaim(queued, { by: "e1", now });
    assert.equal(d.outcome, "claimed");
    assert.deepEqual(d.patch, {
      status: "running",
      attempts: 1,
      lease: { by: "e1", until: now + LEASE_MS },
    });
  });

  it("leaves a finished one alone, and waits for a live lease", () => {
    for (const status of ["succeeded", "failed", "rolled-back"])
      assert.equal(
        decideClaim({ status }, { by: "e1", now }).outcome,
        "finished",
      );
    const held = { status: "running", lease: { by: "e1", until: now + 1 } };
    assert.equal(decideClaim(held, { by: "e2", now }).outcome, "busy");
    assert.equal(decideClaim(held, { by: "e1", now }).outcome, "busy");
  });

  it("takes over a run whose lease ran out, until the attempts do", () => {
    const stale = {
      status: "running",
      attempts: 1,
      lease: { by: "e1", until: now - 1 },
    };
    assert.equal(decideClaim(stale, { by: "e2", now }).patch.attempts, 2);
    assert.equal(
      decideClaim({ ...stale, attempts: 4 }, { by: "e2", now }).outcome,
      "exhausted",
    );
    assert.equal(decideClaim(null, { by: "e1", now }).outcome, "missing");
  });

  it("calls a deployment dead only long after its last sign of life", () => {
    const hour = 60 * 60_000;
    assert.equal(isDead({ createdAt: now }, now + hour), false);
    assert.equal(isDead({ createdAt: now }, now + 3 * hour), true);
    assert.equal(
      isDead(
        { createdAt: now, lease: { until: now + 2 * hour } },
        now + 3 * hour,
      ),
      false,
    );
  });
});

describe("what the owner is told", () => {
  const where = {
    project: "lantern-cafe-1a2b",
    clientEmail: "deploy@p.iam.gserviceaccount.com",
  };

  it("explains each failure with what to do next, and a draft only when the owner can fix it", () => {
    const cases = [
      [
        new SiteNameTakenError("lantern", ["lantern-cafe"]),
        "site-name-taken",
        true,
        /lantern\.web\.app is already used.*lantern-cafe\.web\.app/,
      ],
      [
        new SiteNameTakenError("lantern"),
        "site-name-taken",
        true,
        /Choose another web address/,
      ],
      [
        new MissingAccessError({
          provision: [{ permission: "a", why: "create the database" }],
        }),
        "missing-permissions",
        undefined,
        /isn't allowed to create the database/,
      ],
      [
        new ActionNeededError("x has no access to project lantern-cafe-1a2b"),
        "no-access",
        undefined,
        /add deploy@p\.iam/,
      ],
      [
        new ActionNeededError(
          "Authentication isn't set up in this project yet.",
        ),
        "auth-not-started",
        undefined,
        /Get started/,
      ],
      [
        new UsageError("settings.json isn't valid"),
        "invalid-details",
        undefined,
        /saved details/,
      ],
      [api(403), "no-access", undefined, /can't get into lantern-cafe-1a2b/],
      [api(503), "google-slow", undefined, /Press Try again in a few minutes/],
      [new Error("boom"), "unexpected", undefined, /Something unexpected/],
    ];
    for (const [error, code, draft, message] of cases) {
      const e = explain(error, where);
      assert.equal(e.code, code);
      assert.equal(e.draft, draft);
      assert.match(errorText(e), message);
      assert.ok(e.hint, "every failure says what to do");
    }
  });

  it("puts several things that need doing in one message, each once", () => {
    const e = explain(
      new ActionNeededError("2 things need doing before setup can finish:", {
        details: [
          new SiteNameTakenError("lantern", []),
          new ActionNeededError(
            "Authentication isn't set up in this project yet.",
          ),
        ],
      }),
      where,
    );
    assert.equal(e.draft, true);
    assert.match(e.message, /already used by someone else/);
    assert.match(e.message, /Sign-in isn't switched on/);
  });

  it("never repeats the technical message to the owner", () => {
    const e = explain(new TypeError("secret internals at line 42"), where);
    assert.doesNotMatch(errorText(e), /secret|line 42/);
  });
});

describe("progress", () => {
  it("maps the deployer's step titles onto the steps being shown", () => {
    const deploy = newSteps("deploy");
    const rollback = newSteps("rollback");
    const provision = newSteps("provision");
    assert.equal(stepForTitle("Release package 1.1.0", deploy), "package");
    assert.equal(stepForTitle("Data schema", deploy), "migrations");
    assert.equal(stepForTitle("Data schema", rollback), "schema");
    assert.equal(
      stepForTitle("Cafe settings (config/site)", deploy),
      "settings",
    );
    assert.equal(stepForTitle("Hosting lantern.web.app", deploy), "hosting");
    assert.equal(stepForTitle("Smoke test", deploy), "smoke");
    assert.equal(stepForTitle("Smoke test", rollback), null);
    assert.equal(stepForTitle("Hosting x.web.app", provision), null);
    assert.equal(stepForTitle("Something new", deploy), null);
    assert.ok(Object.keys(PLANS).length === 4);
  });

  it("marks the steps before a `> title` line done, and that one running", () => {
    const writes = [];
    const env = {
      now: () => new Date(0),
      progressGapMs: 0,
      log: () => {},
      store: { updateDeployment: async (_, patch) => writes.push(patch) },
    };
    const progress = createProgress({
      env,
      id: "d",
      by: "e",
      steps: newSteps("deploy"),
    });
    progress.line("  + something indented");
    progress.line("> Firestore rules");
    assert.deepEqual(
      progress.steps.map((s) => s.status),
      ["done", "done", "running", "pending", "pending", "pending", "pending"],
    );
    progress.line("> Hosting lantern.web.app");
    assert.equal(progress.steps[5].status, "running");
    assert.equal(progress.steps[2].status, "done");
  });
});

describe("the owner's name on the staff board", () => {
  it("is their account's name, else the first part of their email, at most 80 characters", () => {
    assert.equal(ownerName("Asha Rao", "a@example.com"), "Asha Rao");
    assert.equal(ownerName(null, "asha.rao@example.com"), "asha.rao");
    assert.equal(ownerName("  ", "@example.com"), "Owner");
    assert.equal(ownerName("x".repeat(100), "a@b.co").length, 80);
  });
});
