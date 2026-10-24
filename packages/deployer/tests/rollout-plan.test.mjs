import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  crossesThreshold,
  planRollout,
  skipReason,
} from "../src/rollout-plan.mjs";
import { cafe } from "./helpers/rollout.mjs";

const gets = (c, version) => skipReason(c, version) === null;

describe("which cafes get a version", () => {
  const stable = cafe("stable", { current: "1.4.2" });
  const beta = cafe("beta", { channel: "beta", current: "1.4.2" });
  const pinned = cafe("pinned", { pinned: "1.4", current: "1.4.2" });

  it("sends a beta to beta cafes only", () => {
    assert.equal(gets(beta, "1.5.0-beta.1"), true);
    assert.equal(gets(beta, "1.5.0-rc.1"), true);
    assert.match(skipReason(stable, "1.5.0-beta.1"), /stable channel/);
    assert.match(skipReason(pinned, "1.4.3-beta.1"), /pinned to 1\.4/);
    assert.match(skipReason(pinned, "1.5.0-beta.1"), /pinned to 1\.4/);
  });

  it("sends a stable minor to stable and beta cafes, not to pinned ones", () => {
    assert.equal(gets(stable, "1.5.0"), true);
    assert.equal(gets(beta, "1.5.0"), true);
    assert.match(skipReason(pinned, "1.5.0"), /pinned to 1\.4.*1\.5/);
  });

  it("sends a patch to the cafes pinned to its minor line as well", () => {
    assert.equal(gets(pinned, "1.4.3"), true);
    assert.equal(gets(stable, "1.4.3"), true);
    assert.equal(gets(beta, "1.4.3"), true);
    // Another line's patch is not theirs.
    assert.match(skipReason(pinned, "1.3.9"), /pinned to 1\.4/);
  });

  it("never moves a cafe down, or deploys what it already runs", () => {
    assert.match(skipReason(stable, "1.4.2"), /already runs 1\.4\.2/);
    assert.match(skipReason(stable, "1.4.1"), /never moves down/);
    assert.match(skipReason(stable, "1.3.9"), /never moves down/);
    assert.match(skipReason(pinned, "1.4.1"), /never moves down/);
    // Prereleases rank below their release, so a beta cafe moves up to it
    // but not back to a later beta of what it already has.
    const onBeta = cafe("on-beta", {
      channel: "beta",
      current: "1.5.0-beta.2",
    });
    assert.equal(gets(onBeta, "1.5.0-beta.3"), true);
    assert.equal(gets(onBeta, "1.5.0-rc.1"), true);
    assert.equal(gets(onBeta, "1.5.0"), true);
    assert.match(skipReason(onBeta, "1.5.0-beta.1"), /never moves down/);
    const onRelease = cafe("on-release", { channel: "beta", current: "1.5.0" });
    assert.match(skipReason(onRelease, "1.5.0-rc.2"), /never moves down/);
    assert.match(skipReason(onRelease, "1.4.9"), /never moves down/);
  });

  it("gives a cafe with no release yet any version its channel gets", () => {
    assert.equal(gets(cafe("new"), "1.5.0"), true);
    assert.equal(gets(cafe("new-pinned", { pinned: "1.4" }), "1.4.3"), true);
  });

  it("leaves out cafes that aren't live", () => {
    for (const status of ["draft", "provisioning", "failed", "suspended"])
      assert.match(
        skipReason(cafe("c", {}, { status }), "1.5.0"),
        new RegExp(`status is ${status}`),
      );
  });
});

describe("the waves", () => {
  const ids = (batches) => batches.map((batch) => batch.map((c) => c.id));
  const list = [
    cafe("s1"),
    cafe("b1", { channel: "beta" }),
    cafe("toe", { channel: "beta" }, { canary: true }),
    cafe("s2"),
    cafe("p1", { pinned: "1.5" }),
    cafe("b2", { channel: "beta" }),
    cafe("s3"),
    cafe("s4"),
  ];

  it("puts the canary first, then beta cafes, then stable ones in batches", () => {
    const { waves, skipped } = planRollout(list, "1.5.1", { batchSize: 2 });
    assert.deepEqual(
      waves.map((w) => w.name),
      ["canary", "beta", "stable"],
    );
    assert.deepEqual(ids(waves[0].batches), [["toe"]]);
    assert.deepEqual(ids(waves[1].batches), [["b1", "b2"]]);
    // Pinned cafes (to this line) ride with the stable ones, in list order.
    assert.deepEqual(ids(waves[2].batches), [
      ["s1", "s2"],
      ["p1", "s3"],
      ["s4"],
    ]);
    assert.deepEqual(skipped, []);
  });

  it("keeps the canary out of the other waves, and sends a beta only to beta cafes", () => {
    const { waves, skipped } = planRollout(list, "1.6.0-beta.1");
    assert.deepEqual(
      waves.map((w) => [w.name, ids(w.batches)]),
      [
        ["canary", [["toe"]]],
        ["beta", [["b1", "b2"]]],
      ],
    );
    assert.deepEqual(
      skipped.map((s) => s.cafe.id),
      ["s1", "s2", "p1", "s3", "s4"],
    );
  });

  it("leaves out waves nobody is in, and cafes an earlier run finished", () => {
    const plan = planRollout(list, "1.5.1", {
      leaveOut: new Set(["toe", "b1", "b2"]),
    });
    assert.deepEqual(
      plan.waves.map((w) => w.name),
      ["stable"],
    );
    assert.equal(plan.skipped.length, 0);
  });

  it("has no canary wave when the canary is skipped, and says why", () => {
    const withSkippedCanary = [
      cafe("toe", { current: "1.5.1" }, { canary: true }),
      cafe("s1"),
    ];
    const plan = planRollout(withSkippedCanary, "1.5.1");
    assert.deepEqual(
      plan.waves.map((w) => w.name),
      ["stable"],
    );
    assert.equal(plan.skipped[0].cafe.id, "toe");
    assert.match(plan.skipped[0].reason, /already runs/);
  });
});

describe("the pause threshold", () => {
  const pauses = (wave, failures, size, failurePercent) =>
    crossesThreshold(wave, { failures, size, failurePercent });

  it("pauses at any failure of the canary", () => {
    assert.equal(pauses("canary", 1, 1), true);
    assert.equal(pauses("canary", 0, 1), false);
    assert.equal(pauses("canary", 1, 3, 100), true);
  });

  it("pauses when more than 1 in 5 of a batch fails", () => {
    assert.equal(pauses("stable", 1, 5), false);
    assert.equal(pauses("stable", 2, 5), true);
    assert.equal(pauses("stable", 2, 10), false);
    assert.equal(pauses("stable", 3, 10), true);
    assert.equal(pauses("beta", 1, 4), true);
  });

  it("follows a threshold of the person's choosing", () => {
    assert.equal(pauses("stable", 2, 5, 50), false);
    assert.equal(pauses("stable", 3, 5, 50), true);
    assert.equal(pauses("stable", 5, 5, 100), false);
    assert.equal(pauses("stable", 1, 5, 0), true);
  });
});
