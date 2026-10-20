import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { REQUIRED_APIS, provision } from "../src/commands/provision.mjs";
import { ActionNeededError, SiteNameTakenError } from "../src/errors.mjs";
import {
  PROJECT,
  PROJECT_NUMBER,
  createFakeGoogle,
  freshState,
  isWrite,
} from "./helpers/fake-google.mjs";
import { cli, context } from "./helpers/setup.mjs";

const OPTIONS = { region: "eur3", site: "lantern-cafe" };

/** A project someone already set up by hand, the way provision would have. */
function alreadySetUp() {
  const state = freshState();
  for (const id of REQUIRED_APIS) state.services.set(id, "ENABLED");
  state.database = {
    name: `projects/${PROJECT}/databases/(default)`,
    locationId: "eur3",
    type: "FIRESTORE_NATIVE",
  };
  state.authConfig = {
    signIn: {
      email: { enabled: true, passwordRequired: true },
      anonymous: { enabled: true },
    },
  };
  const appId = `1:${PROJECT_NUMBER}:web:existing`;
  state.webApps.push({
    name: `projects/${PROJECT}/webApps/${appId}`,
    appId,
    displayName: "CafeMenu",
    state: "ACTIVE",
  });
  state.sites.set("lantern-cafe", {
    name: `projects/${PROJECT_NUMBER}/sites/lantern-cafe`,
    defaultUrl: "https://lantern-cafe.web.app",
    appId,
    type: "USER_SITE",
  });
  return state;
}

describe("provision", () => {
  it("sets up a brand-new project", async () => {
    const google = createFakeGoogle();
    const ctx = context(google);
    const result = await provision(ctx, OPTIONS);
    const { state } = google;

    for (const id of REQUIRED_APIS)
      assert.equal(state.services.get(id), "ENABLED", id);
    assert.deepEqual(
      { locationId: state.database.locationId, type: state.database.type },
      { locationId: "eur3", type: "FIRESTORE_NATIVE" },
    );
    assert.deepEqual(state.authConfig.signIn, {
      email: { enabled: true, passwordRequired: true },
      anonymous: { enabled: true },
    });
    assert.equal(state.webApps.length, 1);
    assert.equal(state.webApps[0].displayName, "CafeMenu");
    assert.equal(state.sites.get("lantern-cafe").appId, state.webApps[0].appId);
    assert.equal(result.siteUrl, "https://lantern-cafe.web.app");
    assert.equal(result.webConfig.projectId, PROJECT);
    assert.equal(result.changes.length, 5);
    assert.deepEqual(google.unhandled, []);
  });

  it("sends the documented request shapes", async () => {
    const google = createFakeGoogle();
    await provision(context(google), OPTIONS);
    const find = (method, re) =>
      google.apiCalls().find((c) => c.method === method && re.test(c.url));

    const enable = find("POST", /services:batchEnable$/);
    assert.equal(
      enable.url,
      `https://serviceusage.googleapis.com/v1/projects/${PROJECT_NUMBER}/services:batchEnable`,
    );
    assert.ok(enable.body.serviceIds.includes("firestore.googleapis.com"));
    assert.ok(
      !enable.body.serviceIds.includes("firebase.googleapis.com"),
      "already on",
    );

    const createDb = find("POST", /\/databases\?/);
    assert.equal(
      createDb.url,
      `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases?databaseId=%28default%29`,
    );
    assert.deepEqual(createDb.body, {
      locationId: "eur3",
      type: "FIRESTORE_NATIVE",
    });

    const auth = find("PATCH", /\/v2\/projects\/test-cafe\/config/);
    assert.equal(
      new URL(auth.url).searchParams.get("updateMask"),
      "signIn.email.enabled,signIn.email.passwordRequired,signIn.anonymous.enabled",
    );

    const site = find("POST", /\/sites\?/);
    assert.equal(
      site.url,
      `https://firebasehosting.googleapis.com/v1beta1/projects/${PROJECT}/sites?siteId=lantern-cafe`,
    );
    assert.match(site.body.appId, /^1:/);
  });

  it("changes nothing when run a second time", async () => {
    const google = createFakeGoogle();
    await provision(context(google), OPTIONS);
    const before = google.calls.length;

    const ctx = context(google);
    const result = await provision(ctx, OPTIONS);
    const second = google.calls.slice(before);
    assert.deepEqual(second.filter(isWrite), []);
    assert.deepEqual(result.changes, []);
    assert.match(
      ctx.output(),
      /Nothing to change: test-cafe is already set up/,
    );
  });

  it("skips each part that already exists: database, sign-in, web app, site", async () => {
    const google = createFakeGoogle({ state: alreadySetUp() });
    const ctx = context(google);
    const result = await provision(ctx, OPTIONS);
    assert.deepEqual(google.apiCalls().filter(isWrite), []);
    assert.equal(result.appId, `1:${PROJECT_NUMBER}:web:existing`);
    const out = ctx.output();
    assert.match(out, /= already on: firebase\.googleapis\.com/);
    assert.match(out, /= \(default\) exists in eur3/);
    assert.match(out, /= Email\/Password and Anonymous are on/);
    assert.match(out, /= registered \(1:123456789012:web:existing\)/);
    assert.match(
      out,
      /= exists in this project: https:\/\/lantern-cafe\.web\.app/,
    );
  });

  it("turns on only the sign-in settings that are off", async () => {
    const state = alreadySetUp();
    state.authConfig.signIn.anonymous.enabled = false;
    const google = createFakeGoogle({ state });
    await provision(context(google), OPTIONS);
    const writes = google.apiCalls().filter(isWrite);
    assert.equal(writes.length, 1);
    assert.equal(
      new URL(writes[0].url).searchParams.get("updateMask"),
      "signIn.anonymous.enabled",
    );
  });

  it("links an existing site to the web app when it isn't linked", async () => {
    const state = alreadySetUp();
    state.sites.get("lantern-cafe").appId = undefined;
    const google = createFakeGoogle({ state });
    await provision(context(google), OPTIONS);
    const [write] = google.apiCalls().filter(isWrite);
    assert.equal(write.method, "PATCH");
    assert.match(write.url, /\/sites\/lantern-cafe\?updateMask=appId$/);
    assert.equal(
      state.sites.get("lantern-cafe").appId,
      `1:${PROJECT_NUMBER}:web:existing`,
    );
  });

  it("keeps a database that is already in another region, with a warning", async () => {
    const state = alreadySetUp();
    state.database.locationId = "nam5";
    const ctx = context(createFakeGoogle({ state }));
    await provision(ctx, OPTIONS);
    assert.match(ctx.output(), /! already exists in nam5, not eur3/);
  });

  it("reports a taken site name with free alternatives, after doing everything else", async () => {
    const google = createFakeGoogle();
    const error = await provision(context(google), {
      ...OPTIONS,
      site: "taken-name",
    }).catch((e) => e);
    assert.ok(error instanceof SiteNameTakenError, error);
    assert.equal(error.site, "taken-name");
    assert.deepEqual(error.suggestions, ["taken-name-cafe", "taken-name-menu"]);
    assert.match(error.hint, /taken-name-cafe, taken-name-menu/);
    // The rest of the project was still set up, and no site was made.
    assert.ok(google.state.database);
    assert.equal(google.state.webApps.length, 1);
    assert.equal(google.state.sites.size, 0);
  });

  it("asks for the console click when Authentication was never set up", async () => {
    const state = freshState();
    state.authConfig = null;
    const google = createFakeGoogle({ state });
    const error = await provision(context(google), OPTIONS).catch((e) => e);
    assert.ok(error instanceof ActionNeededError);
    assert.match(error.message, /Authentication isn't set up/);
    assert.match(error.hint, /Authentication → Get started/);
    assert.ok(google.state.sites.has("lantern-cafe"), "later steps still ran");
  });

  it("collects several manual steps into one message", async () => {
    const state = freshState();
    state.authConfig = null;
    const error = await provision(context(createFakeGoogle({ state })), {
      ...OPTIONS,
      site: "taken-name",
    }).catch((e) => e);
    assert.ok(error instanceof ActionNeededError);
    assert.match(error.message, /2 things need doing/);
    assert.equal(error.details.length, 2);
  });

  it("exits 3 from the CLI for a taken name, and says what to do", async () => {
    const { run } = await cli();
    const result = await run(
      "provision",
      "--region",
      "eur3",
      "--site",
      "taken-name",
    );
    assert.equal(result.code, 3);
    assert.match(
      result.err,
      /"taken-name" is taken by another Firebase project/,
    );
    assert.match(result.err, /Re-run with --site/);
  });
});
