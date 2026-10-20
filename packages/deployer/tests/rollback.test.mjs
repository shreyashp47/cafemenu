import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { rollback } from "../src/commands/rollback.mjs";
import { ActionNeededError } from "../src/errors.mjs";
import {
  createFakeGoogle,
  freshState,
  isWrite,
} from "./helpers/fake-google.mjs";
import { cli, context } from "./helpers/setup.mjs";

const SITE = "lantern-cafe";

/** A site that has had versions v1, v2, v3 deployed, in that order. */
function threeDeploys() {
  const state = freshState();
  state.services.set("firebasehosting.googleapis.com", "ENABLED");
  for (const [i, id] of ["v1", "v2", "v3"].entries()) {
    const name = `sites/${SITE}/versions/${id}`;
    state.versions.set(name, {
      name,
      status: "FINALIZED",
      config: {},
      files: new Map(),
    });
    state.releases.unshift({
      name: `sites/${SITE}/channels/live/releases/r${i + 1}`,
      version: { name, status: "FINALIZED" },
      type: "DEPLOY",
      releaseTime: `2026-09-0${i + 1}T10:00:00Z`, // before the fake's clock
    });
  }
  return state;
}

const live = (google) => google.state.releases[0].version.name.split("/").pop();

describe("rollback", () => {
  it("releases the previous version again", async () => {
    const google = createFakeGoogle({ state: threeDeploys() });
    const result = await rollback(context(google), { site: SITE });
    assert.equal(live(google), "v2");
    assert.equal(result.from, `sites/${SITE}/versions/v3`);
    const [write] = google.apiCalls().filter(isWrite);
    assert.equal(
      write.url,
      `https://firebasehosting.googleapis.com/v1beta1/sites/${SITE}/releases?versionName=sites%2F${SITE}%2Fversions%2Fv2`,
    );
  });

  it("steps back again on a second rollback instead of flipping back", async () => {
    const google = createFakeGoogle({ state: threeDeploys() });
    await rollback(context(google), { site: SITE });
    await rollback(context(google), { site: SITE });
    assert.equal(live(google), "v1");
  });

  it("with --to, does nothing if that version is already live", async () => {
    const google = createFakeGoogle({ state: threeDeploys() });
    await rollback(context(google), { site: SITE, to: "v1" });
    assert.equal(live(google), "v1");
    const before = google.calls.length;
    const ctx = context(google);
    const result = await rollback(ctx, { site: SITE, to: "v1" });
    assert.equal(result.changed, false);
    assert.deepEqual(google.calls.slice(before).filter(isWrite), []);
    assert.match(ctx.output(), /= version v1 is already live/);
  });

  it("refuses when there is nothing earlier, or the version isn't kept", async () => {
    const state = threeDeploys();
    state.releases = state.releases.slice(2); // only v1
    const google = createFakeGoogle({ state });
    await assert.rejects(
      rollback(context(google), { site: SITE }),
      ActionNeededError,
    );
    await assert.rejects(
      rollback(context(google), { site: SITE, to: "v9" }),
      /isn't among the 1 releases/,
    );
  });

  it("works from the CLI and says how to repeat it", async () => {
    const { google, run } = await cli({ state: threeDeploys() });
    const result = await run("rollback", "--site", SITE);
    assert.equal(result.code, 0, result.err);
    assert.equal(live(google), "v2");
    assert.match(result.out, /\+ version v2 is live again/);
    assert.match(result.out, /--to v2/);
  });
});
