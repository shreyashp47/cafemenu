import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { maintenanceRecord } from "@cafemenu/shared/maintenance";

import { decodeFields } from "../src/apis/firestore.mjs";
import { maintenance } from "../src/commands/maintenance.mjs";
import { deployRelease } from "../src/commands/release.mjs";
import { ActionNeededError } from "../src/errors.mjs";
import {
  createFakeGoogle,
  freshState,
  isWrite,
} from "./helpers/fake-google.mjs";
import {
  SITE,
  publish,
  releaseContext,
  releasePackage,
  writeSettings,
} from "./helpers/release.mjs";
import { cli, context, tempDir } from "./helpers/setup.mjs";

const NOW = Date.parse("2026-11-01T10:00:00Z");
const HOUR = 3_600_000;
const ON = maintenanceRecord(
  {
    by: "admin",
    message: "Back after a short update.",
    until: NOW + 2 * HOUR,
    startsAt: NOW + HOUR,
    endsAt: NOW + 2 * HOUR,
  },
  NOW,
);

/** A cafe with 1.0.0 deployed, so config/site exists. */
async function deployedCafe() {
  const state = freshState();
  state.services.set("firebasehosting.googleapis.com", "ENABLED");
  state.services.set("firestore.googleapis.com", "ENABLED");
  const google = createFakeGoogle({ state });
  const dir = await tempDir();
  await publish(google, await releasePackage("1.0.0"));
  await publish(google, await releasePackage("1.1.0"));
  const settings = await writeSettings(dir);
  const logPath = join(dir, "deploys.json");
  const deploy = async (version) =>
    deployRelease(await releaseContext(google, { logPath }), {
      site: SITE,
      version,
      settings,
    });
  await deploy("1.0.0");
  return {
    google,
    deploy,
    site: () => decodeFields(state.docs.get("config/site")),
  };
}

describe("maintenance", () => {
  it("writes config/site's maintenance and nothing else", async () => {
    const t = await deployedCafe();
    const before = t.site();
    const writes = t.google.apiCalls().filter(isWrite).length;
    assert.deepEqual(
      await maintenance(context(t.google), { maintenance: ON }),
      { changed: true },
    );
    const [write] = t.google.apiCalls().filter(isWrite).slice(writes);
    assert.match(
      write.url,
      /config\/site\?updateMask\.fieldPaths=maintenance$/,
    );
    const after = t.site();
    assert.deepEqual(after.maintenance, {
      on: true,
      by: "admin",
      message: "Back after a short update.",
      until: new Date(NOW + 2 * HOUR),
      startsAt: new Date(NOW + HOUR),
      endsAt: new Date(NOW + 2 * HOUR),
    });
    const { maintenance: _, ...settings } = after;
    assert.deepEqual(settings, before);
  });

  it("leaves it alone when it is already as asked, and turns it off", async () => {
    const t = await deployedCafe();
    await maintenance(context(t.google), { maintenance: ON });
    const writes = t.google.apiCalls().filter(isWrite).length;
    assert.deepEqual(
      await maintenance(context(t.google), { maintenance: ON }),
      { changed: false },
    );
    assert.equal(t.google.apiCalls().filter(isWrite).length, writes);
    await maintenance(context(t.google), { maintenance: null });
    assert.equal(t.site().maintenance, null);
    assert.deepEqual(
      await maintenance(context(t.google), { maintenance: null }),
      { changed: false },
    );
  });

  it("survives a deploy: an update keeps it as it is", async () => {
    const t = await deployedCafe();
    await maintenance(context(t.google), { maintenance: ON });
    await t.deploy("1.1.0");
    assert.equal(t.site().maintenance.message, "Back after a short update.");
  });

  it("needs a cafe CafeMenu has deployed to", async () => {
    const state = freshState();
    state.services.set("firestore.googleapis.com", "ENABLED");
    const google = createFakeGoogle({ state });
    await assert.rejects(
      maintenance(context(google), { maintenance: ON }),
      ActionNeededError,
    );
  });

  it("from the command line", async () => {
    const t = await deployedCafe();
    const { run } = await cli({ state: t.google.state });
    const on = await run(
      "maintenance",
      "--on",
      "--message",
      "Closed for the holiday.",
      "--until",
      "2099-01-02T09:00+05:30",
    );
    assert.equal(on.code, 0, on.err);
    assert.equal(t.site().maintenance.message, "Closed for the holiday.");
    assert.deepEqual(
      t.site().maintenance.until,
      new Date("2099-01-02T03:30:00Z"),
    );
    const off = await run("maintenance", "--off");
    assert.equal(off.code, 0, off.err);
    assert.equal(t.site().maintenance, null);

    for (const args of [
      ["--on", "--off"],
      [],
      ["--off", "--message", "x"],
      ["--on", "--starts", "tomorrow"],
      ["--on", "--ends", "2020-01-01T00:00Z"],
    ]) {
      const bad = await run("maintenance", ...args);
      assert.equal(bad.code, 2, `${args.join(" ")}: ${bad.err}`);
    }
  });
});
