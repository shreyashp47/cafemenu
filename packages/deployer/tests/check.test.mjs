import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { check } from "../src/commands/check.mjs";
import { ActionNeededError } from "../src/errors.mjs";
import { PERMISSIONS, permissionsFor } from "../src/permissions.mjs";
import { createFakeGoogle, freshState } from "./helpers/fake-google.mjs";
import { cli, context } from "./helpers/setup.mjs";

describe("check", () => {
  it("asks testIamPermissions about every permission the commands need", async () => {
    const google = createFakeGoogle();
    const result = await check(context(google));
    assert.equal(result.ok, true);
    const [call] = google.apiCalls();
    assert.equal(call.method, "POST");
    assert.equal(
      call.url,
      "https://cloudresourcemanager.googleapis.com/v3/projects/test-cafe:testIamPermissions",
    );
    assert.deepEqual(call.body.permissions, permissionsFor());
  });

  it("names each missing permission, under every command that needs it", async () => {
    const state = freshState();
    state.permissions = new Set(
      permissionsFor().filter(
        (p) =>
          p !== "firebaseauth.users.sendEmail" &&
          p !== "firebasehosting.sites.update",
      ),
    );
    const ctx = context(createFakeGoogle({ state }));
    const result = await check(ctx);

    assert.equal(result.ok, false);
    assert.deepEqual(Object.keys(result.missing).sort(), [
      "deploy",
      "owner",
      "provision",
      "rollback",
    ]);
    assert.deepEqual(result.missing.owner, [
      {
        permission: "firebaseauth.users.sendEmail",
        why: "send the set-password email",
      },
    ]);
    assert.deepEqual(
      result.missing.rollback.map((m) => m.permission),
      ["firebasehosting.sites.update"],
    );
    assert.match(
      ctx.output(),
      /! missing firebaseauth\.users\.sendEmail \(to send the set-password email\)/,
    );
    assert.match(ctx.output(), /2 permissions are missing/);
  });

  it("can be limited to some commands", async () => {
    const google = createFakeGoogle();
    await check(context(google), { commands: ["rollback"] });
    assert.deepEqual(
      google.apiCalls()[0].body.permissions,
      PERMISSIONS.rollback.map(([p]) => p),
    );
  });

  it("says plainly when the service account can't see the project at all", async () => {
    const ctx = { ...context(createFakeGoogle()), project: "someone-elses" };
    await assert.rejects(check(ctx), (error) => {
      assert.ok(error instanceof ActionNeededError);
      assert.match(error.message, /has no access to project someone-elses/);
      assert.match(error.hint, /Users and permissions → Add member/);
      return true;
    });
  });

  it("exits 3 from the CLI when something is missing, and 0 when nothing is", async () => {
    const state = freshState();
    state.permissions = new Set(["firebase.projects.get"]);
    const missing = await cli({ state });
    const result = await missing.run("check", "--for", "owner");
    assert.equal(result.code, 3);
    assert.match(result.out, /missing datastore\.entities\.create/);

    const granted = await cli();
    assert.equal((await granted.run("check")).code, 0);
  });
});

describe("check, when Google rejects a permission name", () => {
  it("points at the permission list instead of the project", async () => {
    const google = createFakeGoogle();
    const fetchImpl = async (url, init) =>
      String(url).includes(":testIamPermissions")
        ? new Response(
            JSON.stringify({
              error: {
                code: 400,
                message:
                  "Permission serviceusage.operations.get is not valid for this resource.",
                status: "INVALID_ARGUMENT",
              },
            }),
            { status: 400 },
          )
        : google.fetchImpl(url, init);
    const ctx = context({ ...google, fetchImpl });
    await assert.rejects(
      check(ctx),
      /is not valid .*src\/permissions\.mjs may be misspelt/,
    );
  });
});
