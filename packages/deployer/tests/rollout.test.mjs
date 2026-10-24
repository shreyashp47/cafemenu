/**
 * `deployer rollout`: the waves, the pause and the resume, with a scripted
 * deploy per cafe (tests/helpers/rollout.mjs), then once through the real
 * `deploy --version` on the fake Google.
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";

import { EXIT, main, parseCommandLine } from "../src/cli.mjs";
import { UsageError } from "../src/errors.mjs";
import { parseCafeList } from "../src/cafe-directory.mjs";
import {
  PROJECT,
  createFakeGoogle,
  freshState,
} from "./helpers/fake-google.mjs";
import {
  SITE,
  fakeShared,
  publish,
  releasePackage,
  writeSettings,
} from "./helpers/release.mjs";
import { cafeEntry, rolloutHarness } from "./helpers/rollout.mjs";
import { PUBLIC_KEY_PEM, tempDir, writeKeyFile } from "./helpers/setup.mjs";

const beta = { channel: "beta" };

/** TOE (canary), two beta cafes, six stable cafes and one pinned to 1.4. */
const fleet = () => [
  cafeEntry("s1", { current: "1.4.2" }),
  cafeEntry("b1", { ...beta, current: "1.4.2" }),
  cafeEntry("toe", { ...beta, current: "1.4.2" }, { canary: true }),
  cafeEntry("s2", { current: "1.4.2" }),
  cafeEntry("pin", { pinned: "1.4", current: "1.4.2" }),
  cafeEntry("s3", { current: "1.4.2" }),
  cafeEntry("b2", { ...beta, current: "1.4.2" }),
  cafeEntry("s4", { current: "1.4.2" }),
  cafeEntry("s5", { current: "1.4.2" }),
  cafeEntry("s6", { current: "1.4.2" }),
];

describe("a rollout", () => {
  it("goes canary, then beta cafes, then stable ones in batches, and records each", async () => {
    const h = await rolloutHarness(fleet());
    const result = await h.run({ version: "1.5.0", batchSize: 3 });

    assert.equal(result.ok, true);
    // The pinned cafe is on another line: 1.5.0 is not its patch.
    assert.deepEqual(h.deployed, [
      "toe",
      "b1",
      "b2",
      "s1",
      "s2",
      "s3",
      "s4",
      "s5",
      "s6",
    ]);
    const cafes = await h.cafes();
    assert.deepEqual(cafes.toe, {
      channel: "beta",
      pinned: null,
      current: "1.5.0",
      previous: "1.4.2",
    });
    assert.equal(cafes.s6.current, "1.5.0");
    assert.equal(cafes.pin.current, "1.4.2");

    const state = await h.store.get(result.rollout.id);
    assert.equal(state.status, "completed");
    assert.equal(state.version, "1.5.0");
    assert.deepEqual(
      Object.entries(state.cafes)
        .filter(([, c]) => c.status === "done")
        .map(([id, c]) => [id, c.wave]),
      [
        ["toe", "canary"],
        ["b1", "beta"],
        ["b2", "beta"],
        ["s1", "stable"],
        ["s2", "stable"],
        ["s3", "stable"],
        ["s4", "stable"],
        ["s5", "stable"],
        ["s6", "stable"],
      ],
    );
    assert.match(
      h.output(),
      /Skipped\n\s+pin: pinned to 1\.4, and 1\.5\.0 is a release of 1\.5/,
    );
    assert.match(
      h.output(),
      /Rollout 1\.5\.0-20261024T\d+Z: CafeMenu 1\.5\.0 completed/,
    );
    assert.match(h.output(), /Done \(9\): toe, b1, b2, s1/);
  });

  it("sends a patch to the cafe pinned to its line, and a beta to beta cafes only", async () => {
    const patch = await rolloutHarness(fleet());
    await patch.run({ version: "1.4.3" });
    assert.equal(patch.deployed.length, 10);
    assert.ok(patch.deployed.includes("pin"));

    const preview = await rolloutHarness(fleet());
    await preview.run({ version: "1.5.0-beta.1" });
    assert.deepEqual(preview.deployed, ["toe", "b1", "b2"]);
    assert.match(preview.output(), /s1: on the stable channel/);
  });

  it("never moves a cafe down, and skips the ones already there", async () => {
    const h = await rolloutHarness([
      cafeEntry("toe", { ...beta, current: "1.4.2" }, { canary: true }),
      cafeEntry("ahead", { current: "1.5.0" }),
      cafeEntry("same", { current: "1.4.3" }),
      cafeEntry("behind", { current: "1.4.2" }),
    ]);
    const result = await h.run({ version: "1.4.3" });
    assert.deepEqual(h.deployed, ["toe", "behind"]);
    assert.equal(result.ok, true);
    assert.match(h.output(), /ahead: runs 1\.5\.0, which is newer/);
    assert.match(h.output(), /same: already runs 1\.4\.3/);
    assert.equal((await h.cafes()).ahead.current, "1.5.0");
  });

  it("does nothing, and says so, when no cafe needs the version", async () => {
    const h = await rolloutHarness([cafeEntry("ok", { current: "1.6.0" })]);
    const result = await h.run({ version: "1.5.0" });
    assert.equal(result.ok, true);
    assert.deepEqual(h.deployed, []);
    assert.match(h.output(), /Nothing to roll out/);
  });
});

describe("the canary", () => {
  it("stops everything when it fails", async () => {
    const h = await rolloutHarness(fleet(), { fails: { toe: "smoke" } });
    const result = await h.run({ version: "1.5.0" });

    assert.deepEqual(h.deployed, ["toe"]);
    assert.equal(result.ok, false);
    assert.equal(result.rollout.status, "paused");
    assert.match(result.rollout.pausedBecause, /canary toe failed/);
    assert.equal(result.rollout.cafes.toe.status, "rolled-back");
    assert.equal(result.rollout.cafes.toe.rolledBackTo, "1.4.2");
    assert.equal(result.rollout.cafes.b1.status, "pending");
    assert.equal((await h.cafes()).toe.current, "1.4.2");

    const out = h.output();
    assert.match(
      out,
      /Rolled back \(1\):\n\s+toe: The smoke test failed on toe\./,
    );
    assert.match(out, /Not reached \(8\): b1, b2, s1/);
    assert.match(out, /The rollout is paused: the canary toe failed/);
    assert.match(
      out,
      new RegExp(
        `deployer rollout --resume ${result.rollout.id} --cafes cafes.json`,
      ),
    );
  });

  it("counts a deploy that errored, not only a smoke test, and tells the two apart", async () => {
    const h = await rolloutHarness(fleet(), { fails: { toe: "error" } });
    const result = await h.run({ version: "1.5.0" });
    assert.deepEqual(h.deployed, ["toe"]);
    assert.equal(result.rollout.cafes.toe.status, "failed");
    assert.match(result.rollout.cafes.toe.reason, /the rules were refused/);

    const stuck = await rolloutHarness(fleet(), { fails: { toe: "stuck" } });
    const second = await stuck.run({ version: "1.5.0" });
    // Its rollback failed too: it is "failed", not "rolled back".
    assert.equal(second.rollout.cafes.toe.status, "failed");
    assert.equal(second.rollout.status, "paused");
  });

  it("goes on without one, with a warning, when none is marked", async () => {
    const h = await rolloutHarness([cafeEntry("s1"), cafeEntry("s2")]);
    const result = await h.run({ version: "1.5.0" });
    assert.equal(result.ok, true);
    assert.match(h.output(), /no cafe is marked as the canary/);
  });
});

describe("pausing on failures", () => {
  const stable = (n) =>
    Array.from({ length: n }, (_, i) =>
      cafeEntry(`s${i + 1}`, { current: "1.4.2" }),
    );

  it("pauses when more than 1 in 5 of a batch fails, before the rest of it", async () => {
    const h = await rolloutHarness(stable(10), {
      fails: { s2: "smoke", s3: "error" },
    });
    const result = await h.run({ version: "1.5.0", batchSize: 5 });

    // s1 ok, s2 and s3 fail (2 of 5 is more than 1 in 5): s4, s5 and the second batch wait.
    assert.deepEqual(h.deployed, ["s1", "s2", "s3"]);
    assert.equal(result.rollout.status, "paused");
    assert.match(
      result.rollout.pausedBecause,
      /2 of 5 cafes in stable batch 1 failed, which is more than 20%/,
    );
    assert.equal(result.ok, false);
    assert.equal(result.rollout.cafes.s4.status, "pending");
    assert.equal(result.rollout.cafes.s10.status, "pending");
    assert.match(h.output(), /Not reached \(7\): s4, s5, s6/);
  });

  it("goes on past one failure in a batch of five", async () => {
    const h = await rolloutHarness(stable(10), { fails: { s2: "smoke" } });
    const result = await h.run({ version: "1.5.0", batchSize: 5 });
    assert.equal(h.deployed.length, 10);
    // Not paused, but a cafe is rolled back, so someone still has to look.
    assert.equal(result.rollout.status, "completed");
    assert.equal(result.ok, false);
    assert.equal(result.rollout.cafes.s2.status, "rolled-back");
    assert.match(h.output(), /Rolled back \(1\)/);
  });

  it("counts failures per batch, not across the whole wave", async () => {
    const h = await rolloutHarness(stable(10), {
      fails: { s5: "error", s6: "error" },
    });
    const result = await h.run({ version: "1.5.0", batchSize: 5 });
    assert.equal(result.rollout.status, "completed");
    assert.equal(h.deployed.length, 10);
  });

  it("follows --failure-threshold", async () => {
    const h = await rolloutHarness(stable(10), {
      fails: { s1: "error", s2: "error" },
    });
    const strict = await h.run({ version: "1.5.0", batchSize: 5 });
    assert.equal(strict.rollout.status, "paused");

    const lax = await rolloutHarness(stable(10), {
      fails: { s1: "error", s2: "error" },
    });
    const result = await lax.run({
      version: "1.5.0",
      batchSize: 5,
      failurePercent: 50,
    });
    assert.equal(result.rollout.status, "completed");
    assert.equal(lax.deployed.length, 10);
  });

  it("doesn't call a failure in the last batch a pause, since nothing is held back", async () => {
    const h = await rolloutHarness(stable(2), { fails: { s2: "error" } });
    const result = await h.run({ version: "1.5.0" });
    assert.equal(result.rollout.status, "completed");
    assert.equal(result.ok, false);
    assert.match(
      h.output(),
      /1 of 2 cafes in stable batch 1 failed.*last cafe/,
    );
  });
});

describe("resuming", () => {
  it("carries on where it stopped, without redoing the cafes that are done", async () => {
    const h = await rolloutHarness(fleet(), { fails: { b2: "error" } });
    const first = await h.run({ version: "1.5.0", batchSize: 3 });
    // The canary and b1 are done; b2 failed, and a batch of 2 pauses on one failure.
    assert.deepEqual(h.deployed, ["toe", "b1", "b2"]);
    assert.equal(first.rollout.status, "paused");

    // What went wrong is fixed; the same rollout goes on.
    h.fails = {};
    const second = await h.run({ resume: first.rollout.id });
    assert.deepEqual(h.deployed, ["b2", "s1", "s2", "s3", "s4", "s5", "s6"]);
    assert.equal(second.rollout.id, first.rollout.id);
    assert.equal(second.rollout.status, "completed");
    assert.equal(second.rollout.batchSize, 3);
    assert.equal(second.ok, true);
    assert.equal(second.rollout.cafes.b2.attempts, 2);
    assert.equal(second.rollout.cafes.toe.attempts, 1);
    assert.match(h.output(), /2 already done by an earlier run of /);
    assert.match(h.output(), /Done \(9\)/);
    // Both runs are one rollout in the file.
    assert.equal((await h.store.list()).length, 1);
  });

  it("tries a canary that failed again before anything else", async () => {
    const h = await rolloutHarness(fleet(), { fails: { toe: "smoke" } });
    const first = await h.run({ version: "1.5.0" });
    assert.equal(first.rollout.status, "paused");

    const again = await h.run({ resume: first.rollout.id });
    assert.equal(again.rollout.status, "paused");
    assert.deepEqual(h.deployed, ["toe"]);
    assert.equal(again.rollout.cafes.toe.attempts, 2);

    h.fails = {};
    const third = await h.run({ resume: first.rollout.id });
    assert.equal(third.rollout.status, "completed");
    assert.equal(h.deployed[0], "toe");
    assert.equal(h.deployed.length, 9);
  });

  it("takes a new threshold, and re-reads the list: a cafe that has since pinned is skipped", async () => {
    const h = await rolloutHarness(fleet(), {
      fails: { s1: "error", s2: "error" },
    });
    const first = await h.run({ version: "1.5.0", batchSize: 5 });
    assert.equal(first.rollout.status, "paused");

    // The owner of s3 chose "Stay on 1.4" in the meantime.
    const data = await h.read();
    data.cafes.find((c) => c.id === "s3").release.pinned = "1.4";
    await writeFile(h.cafesPath, JSON.stringify(data));

    const second = await h.run({
      resume: first.rollout.id,
      version: "1.5.0",
      failurePercent: 50,
    });
    assert.equal(second.rollout.status, "completed");
    assert.equal(second.rollout.failurePercent, 50);
    assert.ok(!h.deployed.includes("s3"));
    assert.equal(second.rollout.cafes.s3.status, "skipped");
    assert.match(second.rollout.cafes.s3.reason, /pinned to 1\.4/);
  });

  it("refuses a rollout it doesn't know, or one for another version", async () => {
    const h = await rolloutHarness(fleet());
    await assert.rejects(
      h.run({ resume: "1.5.0-nope" }),
      (e) =>
        e instanceof UsageError && /No rollout 1\.5\.0-nope/.test(e.message),
    );
    const first = await h.run({ version: "1.5.0" });
    await assert.rejects(
      h.run({ resume: first.rollout.id, version: "1.6.0" }),
      (e) =>
        e instanceof UsageError &&
        /is for 1\.5\.0, not 1\.6\.0/.test(e.message),
    );
  });

  it("warns when starting a version whose rollout didn't finish", async () => {
    const h = await rolloutHarness(fleet(), { fails: { toe: "error" } });
    const first = await h.run({ version: "1.5.0" });
    await h.run({ version: "1.5.0" });
    assert.match(
      h.output(),
      new RegExp(
        `rollout ${first.rollout.id} of 1\\.5\\.0 didn't finish \\(paused\\)`,
      ),
    );
    assert.equal((await h.store.list()).length, 2);
  });
});

describe("a dry run", () => {
  it("prints the plan and deploys, saves and changes nothing", async () => {
    const h = await rolloutHarness(fleet());
    const before = await readFile(h.cafesPath, "utf8");
    const result = await h.run(
      { version: "1.5.0", batchSize: 4 },
      { dryRun: true },
    );

    assert.equal(result.ok, true);
    assert.deepEqual(h.deployed, []);
    assert.deepEqual(await h.store.list(), []);
    assert.equal(await readFile(h.cafesPath, "utf8"), before);
    const out = h.output();
    assert.match(
      out,
      /Rolling out CafeMenu 1\.5\.0: 9 cafes to deploy, 1 skipped \(dry run: nothing will be changed\)/,
    );
    assert.match(out, /Wave 1 of 3: canary\n\s+toe\n/);
    assert.match(
      out,
      /Wave 2 of 3: beta, in batches of 4\n\s+batch 1: b1, b2\n/,
    );
    assert.match(out, /batch 1: s1, s2, s3, s4\n\s+batch 2: s5, s6/);
    assert.match(out, /pin: pinned to 1\.4/);
    assert.match(out, /Dry run: nothing was deployed/);
  });
});

describe("the cafe list", () => {
  const parse = (cafes) =>
    parseCafeList({ cafes }, { source: "cafes.json", base: "/x" });

  it("fills in the defaults and resolves paths from the file", () => {
    const [c] = parse([
      {
        id: "toe",
        projectId: "toe-cafe",
        site: "toe-cafe",
        settingsFile: "toe/s.json",
        logoFile: "toe/l.png",
      },
    ]);
    assert.deepEqual(c, {
      id: "toe",
      name: "toe",
      projectId: "toe-cafe",
      site: "toe-cafe",
      settingsFile: "/x/toe/s.json",
      logoFile: "/x/toe/l.png",
      canary: false,
      status: "live",
      release: {
        channel: "stable",
        pinned: null,
        current: null,
        previous: null,
      },
    });
  });

  it("says which cafe and field is wrong", () => {
    const ok = cafeEntry("ok");
    const bad = [
      [{ ...ok, projectId: "Not A Project" }, /cafe 1 \(ok\): "projectId"/],
      [{ ...ok, release: { channel: "gamma" } }, /"release.channel"/],
      [
        { ...ok, release: { pinned: "1.4.2" } },
        /"release.pinned" is a minor line/,
      ],
      [
        { ...ok, release: { current: "latest" } },
        /"release.current" isn't a release version/,
      ],
      [{ ...ok, status: "sleeping" }, /"status" is one of/],
      [{ ...ok, canary: "yes" }, /"canary"/],
      [{ ...ok, settingsFile: "" }, /"settingsFile" is required/],
    ];
    for (const [entry, message] of bad)
      assert.throws(
        () => parse([entry]),
        (e) => e instanceof UsageError && message.test(e.message),
      );
    assert.throws(() => parse([ok, ok]), /lists the cafe "ok" twice/);
    assert.throws(
      () => parseCafeList({}, { source: "cafes.json" }),
      /needs a "cafes" list/,
    );
  });
});

describe("from the command line", () => {
  const base = ["rollout", "--version", "v1.5.0", "--cafes", "cafes.json"];

  it("parses the options, and builds what --resume is given again", () => {
    const parsed = parseCommandLine([
      ...base,
      "--batch-size",
      "8",
      "--failure-threshold",
      "12.5",
      "--rollouts",
      "my rollouts.json",
      "--key",
      "key.json",
      "--dry-run",
    ]);
    assert.equal(parsed.command, "rollout");
    assert.equal(parsed.project, undefined);
    assert.equal(parsed.dryRun, true);
    assert.deepEqual(parsed.options, {
      version: "1.5.0",
      resume: undefined,
      cafes: "cafes.json",
      batchSize: 8,
      failurePercent: 12.5,
      rollouts: "my rollouts.json",
      log: "cafemenu-deploys.json",
      releases: undefined,
      package: undefined,
      sha256: undefined,
      flags: "--cafes cafes.json --rollouts 'my rollouts.json' --key key.json",
    });
  });

  it("takes --resume instead of --version, and refuses what makes no sense", () => {
    const resumed = parseCommandLine([
      "rollout",
      "--resume",
      "r1",
      "--cafes",
      "c.json",
    ]);
    assert.equal(resumed.options.resume, "r1");
    assert.equal(resumed.options.version, undefined);

    const bad = [
      [["rollout", "--cafes", "c.json"], /--version is required/],
      [["rollout", "--version", "1.5.0"], /--cafes is required/],
      [
        [...base, "--project", "some-cafe"],
        /--project doesn't go with rollout/,
      ],
      [[...base, "--version", "next"], /not a release version/],
      [[...base, "--batch-size", "0"], /--batch-size/],
      [[...base, "--failure-threshold", "120"], /--failure-threshold/],
      [[...base, "--sha256", "abc"], /--sha256 takes 64 hex digits/],
    ];
    for (const [argv, message] of bad)
      assert.throws(
        () => parseCommandLine(argv),
        (e) => e instanceof UsageError && message.test(e.message),
      );
  });

  /** A provisioned cafe on the fake Google with 1.0.0 published, and its cafes.json. */
  async function cafe(entries = {}) {
    const state = freshState();
    state.services.set("firebasehosting.googleapis.com", "ENABLED");
    state.services.set("firestore.googleapis.com", "ENABLED");
    const google = createFakeGoogle({ publicKeyPem: PUBLIC_KEY_PEM, state });
    const dir = await tempDir();
    const keyPath = await writeKeyFile(dir);
    const pkg = await releasePackage("1.0.0");
    await publish(google, pkg);
    await writeSettings(dir, undefined, "lantern.settings.json");
    const list = join(dir, "cafes.json");
    await writeFile(
      list,
      JSON.stringify({
        cafes: [
          {
            id: "lantern",
            projectId: PROJECT,
            site: SITE,
            settingsFile: "lantern.settings.json",
            canary: true,
            release: { channel: "stable", pinned: null, current: null },
            ...entries,
          },
        ],
      }),
    );
    const run = async (...args) => {
      const out = [];
      const err = [];
      const code = await main(
        [
          "rollout",
          "--cafes",
          list,
          "--rollouts",
          join(dir, "rollouts.json"),
          "--log",
          join(dir, "deploys.json"),
          "--package",
          pkg.archivePath,
          ...args,
        ],
        {
          env: { GOOGLE_APPLICATION_CREDENTIALS: keyPath },
          fetchImpl: google.fetchImpl,
          loadShared: async () => fakeShared,
          out: (l) => out.push(l),
          err: (l) => err.push(l),
          sleep: async () => {},
        },
      );
      return { code, out: out.join("\n"), err: err.join("\n") };
    };
    return { google, dir, list, run, rollouts: join(dir, "rollouts.json") };
  }

  it("runs the real deploy for a cafe and updates the list, exiting 0", async () => {
    const c = await cafe();
    const result = await c.run("--version", "1.0.0");
    assert.equal(result.code, EXIT.ok, result.err);
    assert.match(
      result.out,
      /Done: lantern-cafe\.web\.app runs CafeMenu 1\.0\.0/,
    );
    assert.match(result.out, /Done \(1\): lantern/);
    const list = JSON.parse(await readFile(c.list, "utf8"));
    assert.deepEqual(list.cafes[0].release, {
      channel: "stable",
      pinned: null,
      current: "1.0.0",
      previous: null,
    });
    const rollouts = JSON.parse(await readFile(c.rollouts, "utf8"));
    assert.equal(Object.values(rollouts.rollouts)[0].status, "completed");
    const log = JSON.parse(await readFile(join(c.dir, "deploys.json"), "utf8"));
    assert.equal(log.cafes[PROJECT].current.version, "1.0.0");

    // A second rollout of the same version has nothing to do.
    const again = await c.run("--version", "1.0.0");
    assert.equal(again.code, EXIT.ok, again.err);
    assert.match(again.out, /lantern: already runs 1\.0\.0/);
  });

  it("exits 3 and says how to resume when a cafe fails", async () => {
    const c = await cafe();
    // 9.9.9 isn't published: the package can't be fetched.
    const result = await c.run("--version", "9.9.9");
    assert.equal(result.code, EXIT.actionNeeded, result.err);
    assert.match(result.out, /Failed \(1\):\n\s+lantern:/);
    assert.match(
      result.out,
      /Rollout 9\.9\.9-\d+T\d+Z: CafeMenu 9\.9\.9 completed/,
    );
  });

  it("with --dry-run needs no key and calls nothing", async () => {
    const c = await cafe();
    const calls = c.google.calls.length;
    const out = [];
    const err = [];
    const code = await main(
      [
        "rollout",
        "--version",
        "1.0.0",
        "--cafes",
        c.list,
        "--dry-run",
        "--rollouts",
        c.rollouts,
      ],
      {
        env: {},
        fetchImpl: c.google.fetchImpl,
        out: (l) => out.push(l),
        err: (l) => err.push(l),
      },
    );
    assert.equal(code, EXIT.ok, err.join("\n"));
    assert.match(out.join("\n"), /Dry run: nothing was deployed/);
    assert.equal(c.google.calls.length, calls);
    await assert.rejects(readFile(c.rollouts), { code: "ENOENT" });
  });
});
