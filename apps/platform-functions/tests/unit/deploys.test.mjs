import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decodeFields } from "../../../../packages/deployer/src/apis/firestore.mjs";
import {
  requestRollback,
  requestSyncBranding,
  requestUpgrade,
  startProvisioning,
} from "../../src/callables.mjs";
import { runDeployment } from "../../src/jobs.mjs";
import {
  CAFE_ID,
  MENU,
  PNG,
  SETTINGS,
  SITE,
  call,
  draftCafe,
  testEnv,
} from "../helpers/env.mjs";

/** A live cafe on 1.0.0, with 1.1.0 and 1.2.0 published. */
async function liveCafe(cafe = {}) {
  const t = await testEnv({ releases: ["1.0.0", "1.1.0", "1.2.0"] });
  t.store.addCafe(draftCafe(cafe));
  t.store.data.menus.set(CAFE_ID, MENU);
  // Setting it up puts the newest release on it; start from 1.0.0 instead.
  t.store.data.releases.get("1.1.0").withdrawn = true;
  t.store.data.releases.get("1.2.0").withdrawn = true;
  const { deploymentId } = await startProvisioning(
    t.env,
    call({ cafeId: CAFE_ID }),
  );
  await runDeployment(t.env, deploymentId, { by: "setup" });
  assert.equal((await t.store.getCafe(CAFE_ID)).status, "live");
  t.store.data.releases.get("1.1.0").withdrawn = false;
  t.store.data.releases.get("1.2.0").withdrawn = false;

  const ask = async (handler, data = {}, who, claims) => {
    const { deploymentId: id } = await handler(
      t.env,
      call({ cafeId: CAFE_ID, ...data }, who, claims),
    );
    return {
      id,
      run: (by = `event-${id}`) => runDeployment(t.env, id, { by }),
      deployment: () => t.store.getDeployment(id),
    };
  };
  return {
    ...t,
    ask,
    cafeNow: () => t.store.getCafe(CAFE_ID),
    liveVersion: () => t.state.releases[0]?.version.name,
  };
}

describe("an upgrade", () => {
  it("deploys the version, shows the deployer's steps and moves the cafe", async () => {
    const t = await liveCafe();
    const up = await t.ask(requestUpgrade, { version: "1.1.0" });
    const queued = await up.deployment();
    assert.deepEqual(
      [queued.kind, queued.status, queued.version, queued.fromVersion],
      ["deploy", "queued", "1.1.0", "1.0.0"],
    );
    assert.equal(queued.steps.length, 7);

    assert.deepEqual(await up.run(), { outcome: "succeeded" });

    const d = await up.deployment();
    assert.equal(d.status, "succeeded");
    assert.deepEqual(
      d.steps.map((s) => s.id),
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
    assert.ok(d.steps.every((s) => s.status === "done"));
    const cafe = await t.cafeNow();
    assert.equal(cafe.release.current, "1.1.0");
    assert.equal(cafe.release.previous, "1.0.0");
    assert.equal(cafe.status, "live");
    assert.equal((await t.store.getRecord(CAFE_ID)).current.version, "1.1.0");
  });

  it("moves a pinned cafe to the new minor line, so the next patch of the old one cannot undo it", async () => {
    const t = await liveCafe();
    t.store.data.cafes.get(CAFE_ID).release.pinned = "1.0";
    const up = await t.ask(requestUpgrade, { version: "1.1.0" });
    await up.run();
    assert.equal((await t.cafeNow()).release.pinned, "1.1");
  });

  it("leaves the pin alone inside the same line", async () => {
    const t = await liveCafe();
    t.store.data.cafes.get(CAFE_ID).release.pinned = "1.0";
    t.store.addRelease({
      version: "1.0.1",
      channel: "stable",
      withdrawn: false,
    });
    // 1.0.1 isn't published on the fake GitHub, so only its request is checked.
    const up = await t.ask(requestUpgrade, { version: "1.0.1" });
    assert.equal((await up.deployment()).version, "1.0.1");
    assert.equal((await t.cafeNow()).release.pinned, "1.0");
  });

  it("is rolled back when the new version fails its smoke test", async () => {
    const t = await liveCafe();
    t.state.siteHook = (url) =>
      url.pathname === "/staff"
        ? new Response("boom", { status: 500 })
        : undefined;
    const up = await t.ask(requestUpgrade, { version: "1.1.0" });
    assert.deepEqual(await up.run(), { outcome: "rolled-back" });

    const d = await up.deployment();
    assert.equal(d.status, "rolled-back");
    assert.equal(d.errorCode, "smoke-test-failed");
    assert.match(d.error, /nothing is needed from you/);
    assert.match(d.error, /1\.1\.0 was rolled back/);
    assert.match(d.error, /runs CafeMenu 1\.0\.0 again/);
    const smoke = d.steps.find((s) => s.id === "smoke");
    assert.equal(smoke.status, "failed");
    const cafe = await t.cafeNow();
    assert.equal(cafe.release.current, "1.0.0");
    assert.equal(cafe.status, "live", "the cafe stays up on the old version");
  });
});

describe("a rollback", () => {
  it("goes back one version, and cannot be pressed twice", async () => {
    const t = await liveCafe();
    await (await t.ask(requestUpgrade, { version: "1.1.0" })).run();

    const back = await t.ask(requestRollback);
    const queued = await back.deployment();
    assert.deepEqual(
      [queued.kind, queued.version, queued.fromVersion],
      ["rollback", "1.0.0", "1.1.0"],
    );
    assert.deepEqual(await back.run(), { outcome: "succeeded" });

    const cafe = await t.cafeNow();
    assert.equal(cafe.release.current, "1.0.0");
    assert.equal(cafe.release.previous, null);
    const d = await back.deployment();
    assert.deepEqual(
      d.steps.map((s) => s.id),
      ["schema", "rules", "hosting"],
    );
    await assert.rejects(t.ask(requestRollback), {
      code: "failed-precondition",
      message: /nothing to roll back to/,
    });
  });

  it("is refused with no previous version", async () => {
    const t = await liveCafe();
    await assert.rejects(t.ask(requestRollback), {
      code: "failed-precondition",
    });
  });
});

describe("a branding sync", () => {
  it("puts the saved settings and logo on the site without changing the release", async () => {
    const t = await liveCafe();
    t.store.data.cafes.get(CAFE_ID).settings = {
      ...SETTINGS,
      name: "Lantern Tea House",
      logo: "/logo.png",
    };
    t.store.data.logos.set(CAFE_ID, PNG);

    const sync = await t.ask(requestSyncBranding);
    const queued = await sync.deployment();
    assert.deepEqual([queued.kind, queued.version], ["branding", "1.0.0"]);
    assert.deepEqual(await sync.run(), { outcome: "succeeded" });

    assert.equal(
      decodeFields(t.state.docs.get("config/site")).name,
      "Lantern Tea House",
    );
    const d = await sync.deployment();
    assert.deepEqual(
      d.steps.map((s) => [s.id, s.status]),
      [
        ["settings", "done"],
        ["hosting", "done"],
      ],
    );
    assert.equal((await t.cafeNow()).release.current, "1.0.0");
  });

  it("says plainly when the settings point at a logo that is gone", async () => {
    const t = await liveCafe();
    t.store.data.cafes.get(CAFE_ID).settings = {
      ...SETTINGS,
      logo: "/logo.png",
    };
    const sync = await t.ask(requestSyncBranding);
    assert.deepEqual(await sync.run(), { outcome: "failed" });
    const d = await sync.deployment();
    assert.equal(d.errorCode, "invalid-details");
    assert.match(d.error, /saved details can't be used/);
    assert.equal((await t.cafeNow()).status, "live");
  });
});

describe("requests that are refused before anything is queued", () => {
  it("only for a live cafe, one at a time, and a release the cafe may have", async () => {
    const t = await liveCafe();
    const queuedBefore = t.store.data.deployments.size;

    await assert.rejects(t.ask(requestUpgrade, { version: "9.9.9" }), {
      code: "invalid-argument",
      message: /No such release/,
    });
    await assert.rejects(t.ask(requestUpgrade, { version: "v1.1.0" }), {
      code: "invalid-argument",
    });
    t.store.addRelease({
      version: "1.3.0-beta.1",
      channel: "beta",
      withdrawn: false,
    });
    await assert.rejects(t.ask(requestUpgrade, { version: "1.3.0-beta.1" }), {
      code: "invalid-argument",
      message: /beta release/,
    });
    t.store.data.releases.get("1.2.0").withdrawn = true;
    await assert.rejects(t.ask(requestUpgrade, { version: "1.2.0" }), {
      code: "invalid-argument",
    });
    assert.equal(t.store.data.deployments.size, queuedBefore);

    // One at a time.
    await t.ask(requestUpgrade, { version: "1.1.0" });
    await assert.rejects(t.ask(requestSyncBranding), {
      code: "failed-precondition",
      message: /queued or running/,
    });
  });

  it("lets a beta cafe have a beta", async () => {
    const t = await liveCafe();
    t.store.data.cafes.get(CAFE_ID).release.channel = "beta";
    t.store.addRelease({
      version: "1.3.0-beta.1",
      channel: "beta",
      withdrawn: false,
    });
    const up = await t.ask(requestUpgrade, { version: "1.3.0-beta.1" });
    assert.equal((await up.deployment()).version, "1.3.0-beta.1");
  });

  it("not while the cafe isn't live", async () => {
    const t = await liveCafe();
    t.store.data.cafes.get(CAFE_ID).status = "suspended";
    for (const [handler, data] of [
      [requestUpgrade, { version: "1.1.0" }],
      [requestRollback, {}],
      [requestSyncBranding, {}],
    ]) {
      await assert.rejects(t.ask(handler, data), {
        code: "failed-precondition",
        message: /not live/,
      });
    }
  });

  it("a deployment that never finished stops blocking the cafe after two hours", async () => {
    const t = await liveCafe();
    const stuck = await t.ask(requestSyncBranding);
    await assert.rejects(t.ask(requestSyncBranding), {
      code: "failed-precondition",
    });
    t.advance(3 * 60 * 60_000);
    const again = await t.ask(requestSyncBranding);
    assert.notEqual(again.id, stuck.id);
    const old = await stuck.deployment();
    assert.equal(old.status, "failed");
    assert.match(old.error, /never finished/);
  });

  it("by an admin on any cafe, recorded as the admin's", async () => {
    const t = await liveCafe();
    const sync = await t.ask(
      requestSyncBranding,
      {},
      { uid: "admin1", email: "admin@cafemenu.example" },
      { admin: true },
    );
    assert.equal((await sync.deployment()).trigger, "admin");
  });
});
