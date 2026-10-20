import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { DryRunWriteError } from "../src/errors.mjs";
import { createGoogleClient } from "../src/http.mjs";
import {
  createFakeGoogle,
  freshState,
  isWrite,
} from "./helpers/fake-google.mjs";
import { cli, tempDir, writeTree } from "./helpers/setup.mjs";

const RULES = "service cloud.firestore { match /databases/{d}/documents { } }";
const INDEXES = JSON.stringify({
  indexes: [
    {
      collectionGroup: "orders",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "status", order: "ASCENDING" },
        { fieldPath: "createdAt", order: "ASCENDING" },
      ],
    },
  ],
});

function deployedOnce() {
  const state = freshState();
  state.services.set("firebasehosting.googleapis.com", "ENABLED");
  state.services.set("firestore.googleapis.com", "ENABLED");
  for (const id of ["v1", "v2"]) {
    const name = `sites/lantern-cafe/versions/${id}`;
    state.versions.set(name, {
      name,
      status: "FINALIZED",
      config: {},
      files: new Map(),
    });
    state.releases.unshift({
      name: `sites/lantern-cafe/channels/live/releases/${id}`,
      version: { name, status: "FINALIZED" },
      releaseTime: `2026-09-0${id[1]}T00:00:00Z`,
    });
  }
  return state;
}

/** Runs the CLI with --dry-run and asserts that nothing written was sent. */
async function dryRun(state, ...args) {
  const { google, run } = await cli({ state });
  const result = await run(...args, "--dry-run");
  assert.equal(result.code, 0, result.err);
  assert.deepEqual(google.apiCalls().filter(isWrite), [], "no write calls");
  assert.deepEqual(google.unhandled, []);
  assert.match(result.out, /\(dry run: nothing will be changed\)/);
  return { result, google };
}

describe("--dry-run", () => {
  it("provision on a brand-new project says what it would do, and writes nothing", async () => {
    const { result } = await dryRun(
      undefined,
      "provision",
      "--region",
      "eur3",
      "--site",
      "lantern-cafe",
    );
    assert.match(result.out, /~ would turn on: .*firestore\.googleapis\.com/);
    assert.match(result.out, /~ would create the \(default\) database in eur3/);
    assert.match(
      result.out,
      /~ would turn on Email\/Password and Anonymous sign-in/,
    );
    assert.match(result.out, /~ would register web app "CafeMenu"/);
    assert.match(result.out, /~ would create https:\/\/lantern-cafe\.web\.app/);
    assert.match(result.out, /Dry run: 5 change\(s\) would be made/);
  });

  it("provision checks the site name with a validate-only create", async () => {
    const state = freshState();
    state.services.set("firebasehosting.googleapis.com", "ENABLED");
    const { google, result } = await dryRun(
      state,
      "provision",
      "--region",
      "eur3",
      "--site",
      "lantern-cafe",
    );
    const validate = google.apiCalls().find((c) => c.url.includes("/sites?"));
    assert.match(validate.url, /siteId=lantern-cafe&validateOnly=true$/);
    assert.match(
      result.out,
      /would create https:\/\/lantern-cafe\.web\.app \(the name is free\)/,
    );
    assert.equal(google.state.sites.size, 0);
  });

  it("deploy reads the live state and uploads nothing", async () => {
    const dir = await tempDir();
    await writeTree(dir, {
      "firestore.rules": RULES,
      "firestore.indexes.json": INDEXES,
      "out/index.html": "<h1>hi</h1>",
    });
    const { result } = await dryRun(
      deployedOnce(),
      "deploy",
      "--rules",
      join(dir, "firestore.rules"),
      "--indexes",
      join(dir, "firestore.indexes.json"),
      "--site",
      "lantern-cafe",
      "--dir",
      join(dir, "out"),
    );
    assert.match(
      result.out,
      /~ would upload firestore\.rules as a new ruleset/,
    );
    assert.match(
      result.out,
      /~ would build index orders \(status ASCENDING, createdAt ASCENDING\)/,
    );
    assert.match(result.out, /~ would create a version with 1 files/);
  });

  it("rollback and owner write nothing either", async () => {
    const { result } = await dryRun(
      deployedOnce(),
      "rollback",
      "--site",
      "lantern-cafe",
    );
    assert.match(result.out, /~ would make version v1 live again/);
    const owner = await dryRun(
      deployedOnce(),
      "owner",
      "--email",
      "asha@lantern.cafe",
      "--name",
      "Asha",
    );
    assert.match(owner.result.out, /~ would create an Email\/Password account/);
    assert.match(owner.result.out, /~ would create \/staff\/<new uid>/);
    assert.match(owner.result.out, /~ would send a password-reset email/);
  });

  it("is enforced by the HTTP client too: a write in a dry run throws before it is sent", async () => {
    const google = createFakeGoogle();
    const api = createGoogleClient({
      fetchImpl: google.fetchImpl,
      getToken: async () => "fake-token-1",
      dryRun: true,
    });
    await assert.rejects(
      api.post("https://firestore.googleapis.com/v1/projects/x/databases", {}),
      DryRunWriteError,
    );
    await assert.rejects(
      api.patch("https://firestore.googleapis.com/v1/x", {}),
      DryRunWriteError,
    );
    assert.equal(google.calls.length, 0);
    // Reads, and POSTs marked as reads, still go through.
    await api.post(
      "https://cloudresourcemanager.googleapis.com/v3/projects/test-cafe:testIamPermissions",
      { permissions: [] },
      { write: false },
    );
    assert.equal(google.calls.length, 1);
  });
});
