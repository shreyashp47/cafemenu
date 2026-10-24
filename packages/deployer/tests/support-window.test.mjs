/**
 * The support window in `deployer rollout` (docs/releases.md): cafes pinned to
 * a line that is no longer supported are moved once their date has passed, the
 * reason is recorded, and their pin follows them.
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";

import { supportWindow } from "@cafemenu/shared/support-window";

import { EXIT, main } from "../src/cli.mjs";
import {
  fetchPublishedReleases,
  readReleasesFile,
  releasesFromGitHub,
} from "../src/release-list.mjs";
import { forcedMove, planRollout, skipReason } from "../src/rollout-plan.mjs";
import { cafe, cafeEntry, rolloutHarness } from "./helpers/rollout.mjs";
import { tempDir } from "./helpers/setup.mjs";

const at = (iso) => Date.parse(iso);
const release = (version, date) => ({
  version,
  channel: "stable",
  publishedAt: at(date),
  withdrawn: false,
});

/** 1.3 fell out of the window on 1 May, so its cafes were due on 31 May. */
const OVERDUE = [
  release("1.3.0", "2026-03-01"),
  release("1.4.0", "2026-04-01"),
  release("1.5.0", "2026-05-01"),
  release("1.5.1", "2026-09-01"),
];
/** 1.3 fell out on 10 October, so its cafes are due on 9 November. */
const NOTICE = [
  release("1.3.0", "2026-06-01"),
  release("1.4.0", "2026-08-01"),
  release("1.5.0", "2026-10-10"),
  release("1.5.1", "2026-10-20"),
];
const NOW = new Date("2026-10-24T10:00:00Z");

const supportOf = (releases) => ({ window: supportWindow(releases), now: NOW });

describe("which cafes are moved off a line", () => {
  const old = cafe("old", { pinned: "1.3", current: "1.3.2" });
  const recent = cafe("recent", { pinned: "1.4", current: "1.4.1" });

  it("moves a cafe pinned to an unsupported line, past its date, to a supported line's release", () => {
    const support = supportOf(OVERDUE);
    const forced = forcedMove(old, "1.5.1", support);
    assert.equal(forced.line, "1.3");
    assert.equal(forced.upgradeBy, at("2026-05-31"));
    assert.equal(skipReason(old, "1.5.1", support), null);
    // It can also be the older supported line's patch.
    assert.equal(skipReason(old, "1.4.2", support), null);
  });

  it("leaves it alone before its date, and says when", () => {
    const support = supportOf(NOTICE);
    assert.equal(forcedMove(old, "1.5.1", support), null);
    assert.match(
      skipReason(old, "1.5.1", support),
      /pinned to 1\.3, and 1\.5\.1 is a release of 1\.5; 1\.3 is no longer supported, so it moves from 2026-11-09/,
    );
  });

  it("is on the day itself, not the day before", () => {
    const support = (iso) => ({
      window: supportWindow(NOTICE),
      now: new Date(iso),
    });
    assert.equal(
      forcedMove(old, "1.5.1", support("2026-11-08T23:59:59Z")),
      null,
    );
    assert.ok(forcedMove(old, "1.5.1", support("2026-11-09T00:00:00Z")));
  });

  it("leaves a cafe on a supported line alone, as before", () => {
    const support = supportOf(OVERDUE);
    assert.equal(forcedMove(recent, "1.5.1", support), null);
    assert.match(skipReason(recent, "1.5.1", support), /pinned to 1\.4/);
    assert.doesNotMatch(skipReason(recent, "1.5.1", support), /no longer/);
  });

  it("moves nobody to a beta, or to a release of a line that is itself out", () => {
    const support = supportOf(OVERDUE);
    assert.match(skipReason(old, "1.5.2-beta.1", support), /only gets stable/);
    assert.equal(forcedMove(old, "1.2.9", support), null);
    // 1.3's own patch is not "a move".
    assert.equal(forcedMove(old, "1.3.3", support), null);
    assert.equal(skipReason(old, "1.3.3", support), null);
  });

  it("only moves live cafes, and never down", () => {
    const support = supportOf(OVERDUE);
    const stopped = cafe(
      "stopped",
      { pinned: "1.3", current: "1.3.2" },
      { status: "disconnected" },
    );
    assert.match(skipReason(stopped, "1.5.1", support), /not live/);
    const ahead = cafe("ahead", { pinned: "1.3", current: "1.6.0" });
    assert.match(skipReason(ahead, "1.5.1", support), /never moves down/);
  });

  it("forces nobody without a window", () => {
    assert.equal(forcedMove(old, "1.5.1", null), null);
    assert.match(skipReason(old, "1.5.1"), /pinned to 1\.3/);
  });

  it("puts the cafe in the stable wave, marked", () => {
    const plan = planRollout([old, recent], "1.5.1", {
      support: supportOf(OVERDUE),
    });
    assert.deepEqual(
      plan.waves.map((w) => [w.name, w.batches.flat().map((c) => c.id)]),
      [["stable", ["old"]]],
    );
    assert.equal(plan.waves[0].batches[0][0].forced.line, "1.3");
    assert.deepEqual(
      plan.skipped.map((s) => s.cafe.id),
      ["recent"],
    );
  });
});

describe("a rollout past the date", () => {
  const fleet = () => [
    cafeEntry("toe", { current: "1.5.0" }, { canary: true }),
    cafeEntry("old", { pinned: "1.3", current: "1.3.2" }),
    cafeEntry("recent", { pinned: "1.4", current: "1.4.1" }),
    cafeEntry("free", { current: "1.5.0" }),
  ];

  it("moves the cafe, moves its pin, and records why", async () => {
    const h = await rolloutHarness(fleet(), { releases: OVERDUE });
    const result = await h.run({ version: "1.5.1", batchSize: 5 });

    assert.equal(result.ok, true);
    assert.deepEqual(h.deployed, ["toe", "old", "free"]);
    const cafes = await h.cafes();
    assert.deepEqual(cafes.old, {
      channel: "stable",
      pinned: "1.5",
      current: "1.5.1",
      previous: "1.3.2",
    });
    // The cafe on a supported line keeps its pin and its version.
    assert.equal(cafes.recent.pinned, "1.4");
    assert.equal(cafes.recent.current, "1.4.1");
    // Nobody else's pin changed.
    assert.equal(cafes.free.pinned, null);

    const entry = result.rollout.cafes.old;
    assert.equal(entry.status, "done");
    assert.equal(entry.forced.from, "1.3");
    assert.equal(entry.forced.upgradeBy, "2026-05-31T00:00:00.000Z");
    assert.match(entry.forced.reason, /stopped being supported on 2026-05-01/);
    assert.match(
      entry.forced.reason,
      /upgrade-by date, 2026-05-31, has passed/,
    );
    assert.equal(result.rollout.cafes.free.forced, undefined);
    assert.deepEqual(
      await h.store.get(result.rollout.id),
      result.rollout,
      "the reason is in the saved state",
    );

    const text = h.output();
    assert.match(text, /Moved off a line that is no longer supported/);
    assert.match(text, /old no longer stays on 1\.3: pinned to 1\.3/);
    assert.match(text, /Moved off an unsupported line \(1\):/);
    assert.match(
      text,
      /recent: pinned to 1\.4, and 1\.5\.1 is a release of 1\.5/,
    );
  });

  it("shows it in a dry run, and changes nothing", async () => {
    const h = await rolloutHarness(fleet(), { releases: OVERDUE });
    await h.run({ version: "1.5.1" }, { dryRun: true });
    assert.match(h.output(), /Moved off a line that is no longer supported/);
    assert.deepEqual(h.deployed, []);
    assert.equal((await h.cafes()).old.pinned, "1.3");
  });

  it("leaves the cafe pinned if its deploy failed, and tries it again on resume", async () => {
    const h = await rolloutHarness(fleet(), {
      releases: OVERDUE,
      fails: { old: "smoke" },
    });
    const first = await h.run({ version: "1.5.1" });
    assert.equal(first.rollout.cafes.old.status, "rolled-back");
    assert.equal((await h.cafes()).old.pinned, "1.3");
    assert.equal((await h.cafes()).old.current, "1.3.2");
    assert.ok(first.rollout.cafes.old.forced, "still says why it was tried");

    h.fails.old = undefined;
    const again = await h.run({ resume: first.rollout.id });
    assert.equal(again.rollout.cafes.old.status, "done");
    assert.equal((await h.cafes()).old.pinned, "1.5");
  });

  it("sends the next patch to a cafe that was moved", async () => {
    const h = await rolloutHarness(fleet(), { releases: OVERDUE });
    await h.run({ version: "1.5.1" });
    await h.run({ version: "1.5.2" });
    assert.ok(h.deployed.includes("old"), "its pin is now 1.5");
  });
});

describe("a rollout before the date", () => {
  it("skips the cafe, and says when it will be moved", async () => {
    const h = await rolloutHarness(
      [
        cafeEntry("toe", { current: "1.5.0" }, { canary: true }),
        cafeEntry("old", { pinned: "1.3", current: "1.3.2" }),
      ],
      { releases: NOTICE },
    );
    const result = await h.run({ version: "1.5.1" });
    assert.deepEqual(h.deployed, ["toe"]);
    assert.equal(result.rollout.cafes.old.status, "skipped");
    assert.match(result.rollout.cafes.old.reason, /moves from 2026-11-09/);
  });
});

describe("when the window can't be read", () => {
  const entries = () => [
    cafeEntry("toe", { current: "1.5.0" }, { canary: true }),
    cafeEntry("old", { pinned: "1.3", current: "1.3.2" }),
  ];

  it("warns and moves nobody, but rolls the release out", async () => {
    const h = await rolloutHarness(entries(), {
      releases: new Error("GitHub said 503"),
    });
    const result = await h.run({ version: "1.5.1" });
    assert.equal(result.ok, true);
    assert.deepEqual(h.deployed, ["toe"]);
    assert.match(
      h.output(),
      /couldn't read the published releases \(GitHub said 503\), so no cafe is moved/,
    );
  });

  it("warns when no releases were given at all", async () => {
    const h = await rolloutHarness(entries());
    await h.run({ version: "1.5.1" });
    assert.deepEqual(h.deployed, ["toe"]);
    assert.match(h.output(), /published releases weren't given/);
  });

  it("doesn't ask for them when nobody could be moved", async () => {
    let asked = 0;
    const h = await rolloutHarness([
      cafeEntry("toe", { current: "1.5.0" }, { canary: true }),
      cafeEntry("pin", { pinned: "1.5", current: "1.5.0" }),
    ]);
    const result = await rolloutOnly(h, "1.5.1", () => (asked += 1));
    assert.equal(result.ok, true);
    assert.equal(asked, 0);
  });

  it("doesn't ask for them for a beta", async () => {
    let asked = 0;
    const h = await rolloutHarness(entries());
    const result = await rolloutOnly(h, "1.6.0-beta.1", () => (asked += 1));
    assert.equal(result.ok, true);
    assert.equal(asked, 0);
  });
});

/** The harness's rollout, counting how often the releases are asked for. */
async function rolloutOnly(h, version, onAsk) {
  const { rollout } = await import("../src/commands/rollout.mjs");
  const { createLogger } = await import("../src/log.mjs");
  return rollout(
    {
      log: createLogger({ write: (l) => h.lines.push(l) }),
      dryRun: false,
      now: () => new Date(Date.UTC(2026, 9, 24, 10)),
      directory: h.directory,
      store: h.store,
      deployCafe: h.deployCafe,
      listReleases: async () => {
        onAsk();
        return [];
      },
    },
    { version, flags: "" },
  );
}

describe("the published releases", () => {
  it("come from GitHub's list, without drafts or tags that aren't versions", () => {
    assert.deepEqual(
      releasesFromGitHub([
        {
          tag_name: "v1.5.0",
          prerelease: false,
          published_at: "2026-10-10T08:00:00Z",
        },
        {
          tag_name: "v1.6.0-beta.1",
          prerelease: true,
          published_at: "2026-10-20T08:00:00Z",
        },
        { tag_name: "v1.7.0", draft: true, published_at: null },
        { tag_name: "nightly", published_at: "2026-10-21T00:00:00Z" },
      ]),
      [
        {
          version: "1.5.0",
          channel: "stable",
          publishedAt: at("2026-10-10T08:00:00Z"),
          withdrawn: false,
        },
        {
          version: "1.6.0-beta.1",
          channel: "beta",
          publishedAt: at("2026-10-20T08:00:00Z"),
          withdrawn: false,
        },
      ],
    );
  });

  it("are fetched page by page, with no token", async () => {
    const seen = [];
    const page = (n) =>
      Array.from({ length: n }, (_, i) => ({
        tag_name: `v1.${i}.0`,
        published_at: "2026-01-01T00:00:00Z",
      }));
    const fetchImpl = async (url, init) => {
      seen.push([url, init.headers]);
      const body = seen.length === 1 ? page(100) : page(3);
      return { ok: true, json: async () => body };
    };
    const releases = await fetchPublishedReleases(fetchImpl);
    assert.equal(releases.length, 103);
    assert.equal(seen.length, 2);
    assert.match(seen[1][0], /per_page=100&page=2$/);
    assert.equal(seen[0][1].Authorization, undefined);
    await assert.rejects(
      fetchPublishedReleases(async () => ({ ok: false, status: 403 })),
      /failed \(403\)/,
    );
  });

  it("can be read from a file, as a list or under a key", async () => {
    const dir = await tempDir();
    await writeFile(
      join(dir, "a.json"),
      JSON.stringify([release("1.0.0", "2026-01-01")]),
    );
    await writeFile(
      join(dir, "b.json"),
      JSON.stringify({ releases: [release("1.0.0", "2026-01-01")] }),
    );
    await writeFile(join(dir, "c.json"), "{}");
    assert.equal((await readReleasesFile(join(dir, "a.json"))).length, 1);
    assert.equal((await readReleasesFile(join(dir, "b.json"))).length, 1);
    await assert.rejects(readReleasesFile(join(dir, "c.json")), /needs a list/);
    await assert.rejects(
      readReleasesFile(join(dir, "missing.json")),
      /Can't read/,
    );
  });
});

describe("from the command line", () => {
  it("reads --releases and moves the cafe it should", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "releases.json"), JSON.stringify(OVERDUE));
    await writeFile(
      join(dir, "cafes.json"),
      JSON.stringify({
        cafes: [
          {
            ...cafeEntry("old", { pinned: "1.3", current: "1.3.2" }),
            settingsFile: "s.json",
          },
        ],
      }),
    );
    const out = [];
    const code = await main(
      [
        "rollout",
        "--version",
        "1.5.1",
        "--cafes",
        join(dir, "cafes.json"),
        "--releases",
        join(dir, "releases.json"),
        "--dry-run",
      ],
      {
        env: {},
        now: () => NOW.getTime(),
        out: (l) => out.push(l),
        err: (l) => out.push(l),
      },
    );
    assert.equal(code, EXIT.ok, out.join("\n"));
    assert.match(
      out.join("\n"),
      /old: pinned to 1\.3, which stopped being supported on 2026-05-01/,
    );
    // Nothing in the list was changed by a dry run.
    const list = JSON.parse(await readFile(join(dir, "cafes.json"), "utf8"));
    assert.equal(list.cafes[0].release.pinned, "1.3");
  });
});
