/**
 * The smoke test inside `deploy --version`: it runs against what the deploy
 * put live (the fake Google serves <site>.web.app from the live Hosting
 * release, tests/helpers/fake-site.mjs), and when it fails the release is
 * rolled back and both are in the deploy log.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";

import { encodeFields } from "../src/apis/firestore.mjs";
import { deployRelease } from "../src/commands/release.mjs";
import { SmokeTestError } from "../src/smoke-test.mjs";
import {
  PROJECT,
  createFakeGoogle,
  freshState,
  isWrite,
} from "./helpers/fake-google.mjs";
import {
  SITE,
  fakeShared,
  publish,
  releaseContext,
  releasePackage,
  rulesFor,
  writeSettings,
} from "./helpers/release.mjs";
import { cli, tempDir } from "./helpers/setup.mjs";

/** A provisioned cafe on the fake Google with 1.0.0 and 1.1.0 published. */
async function cafe({ v1 = {}, v2 = {} } = {}) {
  const state = freshState();
  state.services.set("firebasehosting.googleapis.com", "ENABLED");
  state.services.set("firestore.googleapis.com", "ENABLED");
  const google = createFakeGoogle({ state });
  const dir = await tempDir();
  for (const [version, options] of [
    ["1.0.0", v1],
    ["1.1.0", v2],
  ]) {
    await publish(google, await releasePackage(version, options));
  }
  const logPath = join(dir, "deploys.json");
  const settings = await writeSettings(dir);
  const sleeps = [];
  const outputs = [];
  return {
    google,
    state,
    sleeps,
    outputs,
    deploy: async (version, options = {}) => {
      const ctx = await releaseContext(google, { logPath });
      ctx.sleep = async (ms) => sleeps.push(ms);
      outputs.push(ctx);
      return deployRelease(ctx, { site: SITE, version, settings, ...options });
    },
    log: async () => JSON.parse(await readFile(logPath, "utf8")),
    setDataSchema: (n) =>
      state.docs.set("config/meta", encodeFields({ schemaVersion: n })),
    output: () => outputs.at(-1).output(),
    live: () => state.releases[0]?.version.name,
    liveRules: () =>
      state.rulesets.get(state.rulesRelease.rulesetName).source.files[0]
        .content,
  };
}

/** Makes `path` answer `status` from now on. */
const breakPath = (state, path, status = 500) => {
  state.siteHook = (url) =>
    url.pathname === path
      ? new Response("Internal error", { status })
      : undefined;
};

describe("the smoke test of a deploy", () => {
  it("checks what the deploy put live, with nothing but GETs, and passes", async () => {
    const c = await cafe();
    await c.deploy("1.0.0");

    assert.ok(c.state.siteRequests.length >= 9);
    assert.ok(c.state.siteRequests.every((r) => r.startsWith("GET ")));
    assert.deepEqual(
      [...new Set(c.state.siteRequests)].sort(),
      [
        "GET /",
        "GET /__/firebase/init.json",
        "GET /admin",
        "GET /offline",
        "GET /order?table=1",
        "GET /site.json",
        "GET /smoke-test-no-such-page",
        "GET /staff",
        "GET /sw.js",
      ].sort(),
    );
    const out = c.output();
    assert.match(out, /> Smoke test/);
    assert.match(
      out,
      /https:\/\/lantern-cafe\.web\.app should serve Lantern Cafe \(project test-cafe\), cache version 1\.0\.0/,
    );
    assert.match(out, /= The service worker: cache version 1\.0\.0/);
    assert.match(
      out,
      /= The security headers: X-Content-Type-Options, X-Frame-Options on 5 pages/,
    );
    assert.match(out, /all 10 checks passed/);

    const log = await c.log();
    assert.equal(log.deployments.at(-1).status, "succeeded");
    assert.equal(
      log.deployments.at(-1).steps.find((s) => s.id === "smoke").status,
      "done",
    );
  });

  it("waits for a release that reaches the edge late", async () => {
    const c = await cafe();
    let asked = 0;
    c.state.siteHook = (url) =>
      url.pathname === "/staff" && (asked += 1) <= 2
        ? new Response("Site Not Found", { status: 404 })
        : undefined;
    await c.deploy("1.0.0");

    assert.deepEqual(c.sleeps, [5_000, 10_000]);
    const out = c.output();
    assert.match(out, /try 1 of 6: staff failed; Hosting can take a minute/);
    assert.match(out, /try 2 of 6: staff failed/);
    assert.match(out, /all 10 checks passed \(try 3: Hosting had been slow/);
    assert.equal((await c.log()).cafes[PROJECT].current.version, "1.0.0");
  });

  it("rolls back to the release before it when the smoke test fails", async () => {
    const c = await cafe();
    const first = (await c.deploy("1.0.0")).release;
    c.sleeps.length = 0;
    breakPath(c.state, "/staff");

    await assert.rejects(c.deploy("1.1.0"), (error) => {
      assert.ok(error instanceof SmokeTestError);
      assert.match(
        error.message,
        /^The smoke test failed on https:\/\/lantern-cafe\.web\.app after 6 tries\. The staff board: \/staff answered 500\./,
      );
      assert.match(
        error.message,
        /1\.1\.0 was rolled back: lantern-cafe\.web\.app runs CafeMenu 1\.0\.0 again\.$/,
      );
      assert.equal(error.rolledBackTo, "1.0.0");
      assert.equal(error.result.ok, false);
      assert.deepEqual(error.result.failed, ["staff"]);
      return true;
    });
    assert.deepEqual(c.sleeps, [5_000, 10_000, 15_000, 20_000, 25_000]);

    // Hosting and the rules are 1.0.0's again.
    assert.equal(c.live(), first.hostingVersion);
    assert.equal(c.liveRules(), rulesFor("1.0.0"));
    assert.match(
      c.output(),
      /1\.1\.0 failed its smoke test: rolling lantern-cafe\.web\.app back/,
    );

    // The log has the failed deploy, then the rollback, and 1.0.0 is current.
    const log = await c.log();
    const [failed, rollback] = log.deployments.slice(-2);
    assert.equal(failed.kind, "deploy");
    assert.equal(failed.version, "1.1.0");
    assert.equal(failed.fromVersion, "1.0.0");
    assert.equal(failed.status, "failed");
    assert.match(
      failed.error,
      /^The smoke test failed .* \/staff answered 500/,
    );
    assert.equal(failed.steps.find((s) => s.id === "smoke").status, "failed");
    assert.equal(failed.steps.find((s) => s.id === "hosting").status, "done");
    assert.equal(rollback.kind, "rollback");
    assert.equal(rollback.version, "1.0.0");
    assert.equal(rollback.fromVersion, "1.1.0");
    assert.equal(rollback.status, "succeeded");
    const record = log.cafes[PROJECT];
    assert.equal(record.current.version, "1.0.0");
    assert.equal(record.current.rolledBackFrom, "1.1.0");
    assert.equal(record.previous, null);
  });

  it("says so when there is nothing earlier to go back to", async () => {
    const c = await cafe();
    breakPath(c.state, "/admin", 503);

    await assert.rejects(c.deploy("1.0.0"), (error) => {
      assert.ok(error instanceof SmokeTestError);
      assert.match(error.message, /\/admin answered 503/);
      assert.match(
        error.message,
        /Rolling back failed too \(Nothing to roll back to: no release before 1\.0\.0 is recorded for test-cafe\. .*\), so lantern-cafe\.web\.app still runs 1\.0\.0\.$/,
      );
      assert.equal(error.rolledBackTo, undefined);
      return true;
    });
    // It is live, so it is recorded as current (failed), and nothing else.
    const log = await c.log();
    assert.equal(log.deployments.length, 1);
    assert.equal(log.deployments[0].status, "failed");
    assert.equal(log.cafes[PROJECT].current.version, "1.0.0");
  });

  it("leaves the release live when rolling back would break the cafe", async () => {
    const c = await cafe({ v2: { schemaVersion: 2, minSchemaVersion: 2 } });
    await c.deploy("1.0.0");
    c.setDataSchema(2);
    const second = c.live();
    breakPath(c.state, "/sw.js", 404);

    await assert.rejects(c.deploy("1.1.0"), (error) => {
      assert.match(error.message, /\/sw.js answered 404/);
      assert.match(
        error.message,
        /Rolling back failed too \(1\.0\.0 runs on schema 1, but this cafe's data \(schema 2\) has been migrated past it.*\), so lantern-cafe\.web\.app still runs 1\.1\.0\.$/,
      );
      return true;
    });
    assert.notEqual(c.live(), second, "1.1.0 is the live version");
    const log = await c.log();
    assert.equal(log.cafes[PROJECT].current.version, "1.1.0");
    assert.equal(log.cafes[PROJECT].previous.version, "1.0.0");
    assert.deepEqual(
      log.deployments.map((d) => [d.kind, d.version, d.status]),
      [
        ["deploy", "1.0.0", "succeeded"],
        ["deploy", "1.1.0", "failed"],
        ["rollback", "1.0.0", "failed"],
      ],
    );
  });

  it("calls a site of another project a failure", async () => {
    const c = await cafe();
    await c.deploy("1.0.0");
    c.state.webAppConfig = {
      projectId: "someone-elses-cafe",
      appId: "1:1:web:a",
      apiKey: "key",
    };
    await assert.rejects(c.deploy("1.1.0"), (error) => {
      assert.match(
        error.message,
        /Firebase project \(init\.json\): is project "someone-elses-cafe", expected "test-cafe"/,
      );
      assert.match(error.message, /1\.1\.0 was rolled back/);
      return true;
    });
  });

  it("calls a site that serves another build a failure", async () => {
    const c = await cafe();
    await c.deploy("1.0.0");
    // The edge still holds 1.0.0's service worker.
    c.state.siteHook = (url) =>
      url.pathname === "/sw.js"
        ? new Response('const VERSION = "1.0.0";', {
            headers: { "content-type": "text/javascript" },
          })
        : undefined;
    await assert.rejects(c.deploy("1.1.0"), (error) => {
      assert.match(
        error.message,
        /cache version 1\.0\.0, expected 1\.1\.0: another build is being served/,
      );
      return true;
    });
  });

  it("fails closed when the package can't say what its service worker should be", async () => {
    // (The packager refuses an unstamped sw.js; this is one that has no version at all.)
    const c = await cafe({
      v2: { site: { "sw.js": "self.skipWaiting();" } },
    });
    await c.deploy("1.0.0");
    await assert.rejects(c.deploy("1.1.0"), (error) => {
      assert.ok(error instanceof SmokeTestError);
      assert.match(
        error.message,
        /^The smoke test couldn't start: the package's site\/sw\.js has no stamped cache version to look for\./,
      );
      assert.match(error.message, /1\.1\.0 was rolled back/);
      assert.equal(error.result, null);
      return true;
    });
    assert.equal((await c.log()).cafes[PROJECT].current.version, "1.0.0");
  });

  it("doesn't look at the site in a dry run", async () => {
    const c = await cafe();
    const ctx = await releaseContext(c.google, { dryRun: true });
    await deployRelease(ctx, {
      site: SITE,
      version: "1.0.0",
      settings: await writeSettings(await tempDir()),
    });
    assert.equal(c.state.siteRequests, undefined);
    assert.match(
      ctx.output(),
      /dry run: would check https:\/\/lantern-cafe\.web\.app once 1\.0\.0 is live/,
    );
    assert.deepEqual(c.google.apiCalls().filter(isWrite), []);
  });

  it("is told what it needs by the deploy: the cafe's table, project and headers", async () => {
    const c = await cafe();
    await c.deploy("1.0.0");
    assert.ok(c.state.siteRequests.includes("GET /order?table=1"));
    assert.match(c.output(), /X-Frame-Options/);
  });
});

describe("from the command line", () => {
  async function cafeCli() {
    const state = freshState();
    state.services.set("firebasehosting.googleapis.com", "ENABLED");
    state.services.set("firestore.googleapis.com", "ENABLED");
    const { google, run, dir } = await cli({
      state,
      deps: { loadShared: async () => fakeShared },
    });
    const settings = await writeSettings(dir);
    const log = join(dir, "deploys.json");
    const deploy = async (version) => {
      const pkg = await releasePackage(version);
      return run(
        "deploy",
        "--version",
        version,
        "--package",
        pkg.archivePath,
        "--site",
        SITE,
        "--settings",
        settings,
        "--log",
        log,
      );
    };
    return { google, state, deploy };
  }

  it("deploys with exit 0 when the smoke test passes", async () => {
    const c = await cafeCli();
    const result = await c.deploy("1.0.0");
    assert.equal(result.code, 0, result.err);
    assert.match(result.out, /all 10 checks passed/);
    assert.match(
      result.out,
      /Done: lantern-cafe\.web\.app runs CafeMenu 1\.0\.0/,
    );
  });

  it("exits 1 and rolls back when it fails", async () => {
    const c = await cafeCli();
    assert.equal((await c.deploy("1.0.0")).code, 0);
    breakPath(c.state, "/offline", 500);
    const result = await c.deploy("1.1.0");
    assert.equal(result.code, 1);
    assert.match(
      result.err,
      /The smoke test failed on https:\/\/lantern-cafe\.web\.app after 6 tries/,
    );
    assert.match(result.err, /1\.1\.0 was rolled back/);
    assert.match(result.out, /Rolling back lantern-cafe\.web\.app/);
    assert.match(result.out, /1\.0\.0 as current, with no previous/);
    assert.doesNotMatch(
      result.out,
      /Done: lantern-cafe\.web\.app runs CafeMenu 1\.1\.0/,
    );
  });
});
