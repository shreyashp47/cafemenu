import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { owner } from "../src/commands/owner.mjs";
import {
  PROJECT,
  createFakeGoogle,
  freshState,
  isWrite,
} from "./helpers/fake-google.mjs";
import { cli, context } from "./helpers/setup.mjs";

const OWNER = { email: "asha@lantern.cafe", name: "Asha" };

function withDatabase() {
  const state = freshState();
  state.services.set("firestore.googleapis.com", "ENABLED");
  return state;
}

describe("owner", () => {
  it("creates the account without a password, writes /staff/{uid}, and sends the email", async () => {
    const google = createFakeGoogle({ state: withDatabase() });
    const result = await owner(context(google), OWNER);

    const [create, staff, email] = google.apiCalls().filter(isWrite);
    assert.equal(
      create.url,
      `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts`,
    );
    assert.deepEqual(create.body, {
      email: OWNER.email,
      displayName: "Asha",
      emailVerified: false,
    });

    assert.equal(staff.method, "PATCH");
    assert.equal(
      staff.url,
      `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/staff/${result.uid}?updateMask.fieldPaths=name&updateMask.fieldPaths=role`,
    );
    assert.deepEqual(staff.body, {
      fields: { name: { stringValue: "Asha" }, role: { stringValue: "owner" } },
    });

    assert.equal(
      email.url,
      `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:sendOobCode`,
    );
    assert.deepEqual(email.body, {
      requestType: "PASSWORD_RESET",
      email: OWNER.email,
    });
    assert.equal(result.emailed, true);
  });

  it("reuses an existing account and leaves an up-to-date staff record alone", async () => {
    const state = withDatabase();
    state.users.push({
      localId: "uid-asha",
      email: OWNER.email,
      passwordUpdatedAt: 1_700_000_000_000,
    });
    state.docs.set("staff/uid-asha", {
      name: { stringValue: "Asha" },
      role: { stringValue: "owner" },
      extra: { stringValue: "kept" },
    });
    const google = createFakeGoogle({ state });
    const ctx = context(google);
    const result = await owner(ctx, OWNER);
    assert.deepEqual(google.apiCalls().filter(isWrite), []);
    assert.equal(result.uid, "uid-asha");
    assert.match(ctx.output(), /has already set a password; no email sent/);
    assert.match(ctx.output(), /Nothing to change/);
  });

  it("promotes an existing staff member, touching only name and role", async () => {
    const state = withDatabase();
    state.users.push({ localId: "uid-asha", email: OWNER.email });
    state.docs.set("staff/uid-asha", {
      name: { stringValue: "asha" },
      role: { stringValue: "staff" },
      extra: { stringValue: "kept" },
    });
    const google = createFakeGoogle({ state });
    const ctx = context(google);
    await owner(ctx, OWNER);
    assert.deepEqual(state.docs.get("staff/uid-asha"), {
      name: { stringValue: "Asha" },
      role: { stringValue: "owner" },
      extra: { stringValue: "kept" },
    });
    assert.match(
      ctx.output(),
      /\+ updated \/staff\/uid-asha: role staff → owner, name "Asha"/,
    );
  });

  it("re-sends the email only while no password has been set", async () => {
    const google = createFakeGoogle({ state: withDatabase() });
    await owner(context(google), OWNER);
    await owner(context(google), OWNER);
    assert.equal(google.state.emails.length, 2, "owner lost the first email");
    google.state.users[0].passwordUpdatedAt = Date.now();
    await owner(context(google), OWNER);
    assert.equal(google.state.emails.length, 2);
    await owner(context(google), { ...OWNER, sendEmail: false });
    assert.equal(google.state.emails.length, 2);
  });

  it("passes --continue-url through and checks the email from the CLI", async () => {
    const { google, run } = await cli({ state: withDatabase() });
    const result = await run(
      "owner",
      "--email",
      "Asha@Lantern.Cafe",
      "--name",
      "Asha",
      "--continue-url",
      "https://lantern-cafe.web.app/staff",
    );
    assert.equal(result.code, 0, result.err);
    assert.deepEqual(google.state.emails[0], {
      requestType: "PASSWORD_RESET",
      email: "asha@lantern.cafe",
      continueUrl: "https://lantern-cafe.web.app/staff",
    });

    const bad = await run("owner", "--email", "not-an-email", "--name", "Asha");
    assert.equal(bad.code, 2);
    assert.match(bad.err, /Not an email/);
  });
});
