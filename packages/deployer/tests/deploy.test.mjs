import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, it } from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";

import { deploy, indexKey } from "../src/commands/deploy.mjs";
import {
  PROJECT,
  createFakeGoogle,
  freshState,
  isWrite,
} from "./helpers/fake-google.mjs";
import { cli, context, tempDir, writeTree } from "./helpers/setup.mjs";

const RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if false; }
  }
}
`;

// Shaped like TOE's firestore.indexes.json, "//" comments included.
const INDEXES = JSON.stringify({
  indexes: [
    {
      "//": "Staff board: status != completed, oldest first.",
      collectionGroup: "orders",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "status", order: "ASCENDING" },
        { fieldPath: "createdAt", order: "ASCENDING" },
      ],
    },
    {
      collectionGroup: "orders",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "status", order: "DESCENDING" },
        { fieldPath: "createdAt", order: "ASCENDING" },
      ],
    },
  ],
  "//": "A comment at the top level.",
  fieldOverrides: [],
});

const FIREBASE_JSON = JSON.stringify({
  hosting: [
    {
      target: "app",
      public: "out",
      ignore: ["firebase.json", "**/.*", "**/node_modules/**"],
      cleanUrls: true,
      trailingSlash: false,
      headers: [
        {
          "//": "Hashed chunks are kept forever.",
          source: "/_next/static/**",
          headers: [
            {
              key: "Cache-Control",
              value: "public, max-age=31536000, immutable",
            },
          ],
        },
        {
          regex: "^/[^.]*$",
          headers: [{ key: "Cache-Control", value: "no-cache" }],
        },
      ],
    },
    { target: "legacy", public: "hosting/legacy" },
  ],
});

const BUILD = {
  "index.html": "<h1>Menu</h1>",
  "staff.html": "<h1>Staff</h1>",
  "_next/static/app.js": "console.log('app')",
  "_next/static/same-as-app.js": "console.log('app')", // same content, same hash
  "logo.svg": "<svg/>",
  ".DS_Store": "junk",
  "node_modules/x/index.js": "junk",
};

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

async function project() {
  const dir = await tempDir();
  await writeTree(dir, {
    "firestore.rules": RULES,
    "firestore.indexes.json": INDEXES,
    "firebase.json": FIREBASE_JSON,
  });
  await writeTree(join(dir, "out"), BUILD);
  return {
    dir,
    options: {
      parts: ["rules", "indexes", "hosting"],
      rules: join(dir, "firestore.rules"),
      indexes: join(dir, "firestore.indexes.json"),
      site: "lantern-cafe",
      dir: join(dir, "out"),
      config: join(dir, "firebase.json"),
      target: "app",
    },
  };
}

function hostingState() {
  const state = freshState();
  state.services.set("firebasehosting.googleapis.com", "ENABLED");
  state.services.set("firestore.googleapis.com", "ENABLED");
  return state;
}

describe("deploy: hosting", () => {
  it("uploads only the files Hosting asks for, gzipped, keyed by the gzip's SHA-256", async () => {
    const { options } = await project();
    const state = hostingState();
    // Hosting already has logo.svg from an earlier deploy.
    state.uploaded.add(sha256(gzipSync(Buffer.from("<svg/>"), { level: 9 })));
    const google = createFakeGoogle({ state });
    await deploy(context(google), { ...options, parts: ["hosting"] });

    const populate = google
      .apiCalls()
      .find((c) => c.url.endsWith(":populateFiles"));
    assert.deepEqual(Object.keys(populate.body.files), [
      "/_next/static/app.js",
      "/_next/static/same-as-app.js",
      "/index.html",
      "/logo.svg",
      "/staff.html",
    ]);

    const uploads = google.calls.filter((c) =>
      c.url.startsWith("https://upload-firebasehosting"),
    );
    const uploadedHashes = uploads.map((c) => c.url.split("/").pop()).sort();
    const expected = ["console.log('app')", "<h1>Menu</h1>", "<h1>Staff</h1>"]
      .map((text) => sha256(gzipSync(Buffer.from(text), { level: 9 })))
      .sort();
    assert.deepEqual(
      uploadedHashes,
      expected,
      "not the logo, and app.js only once",
    );
    for (const call of uploads) {
      assert.equal(call.headers["content-type"], "application/octet-stream");
      assert.equal(sha256(call.raw), call.url.split("/").pop());
      assert.ok(gunzipSync(call.raw).length > 0);
    }
  });

  it("creates, finalizes and releases the version, with firebase.json's config translated", async () => {
    const { options } = await project();
    const google = createFakeGoogle({ state: hostingState() });
    const result = await deploy(context(google), {
      ...options,
      parts: ["hosting"],
      message: "v1.0.0",
    });

    const calls = google
      .apiCalls()
      .filter(isWrite)
      .map((c) => `${c.method} ${c.url.split("?")[0]}`);
    const versions =
      "https://firebasehosting.googleapis.com/v1beta1/sites/lantern-cafe/versions";
    assert.equal(calls[0], `POST ${versions}`);
    assert.match(calls[1], /:populateFiles$/);
    assert.match(calls.at(-2), /^PATCH .*\/versions\/ver\d+$/);
    assert.equal(
      calls.at(-1),
      "POST https://firebasehosting.googleapis.com/v1beta1/sites/lantern-cafe/releases",
    );

    const create = google
      .apiCalls()
      .find((c) => c.method === "POST" && c.url === versions);
    assert.deepEqual(create.body.config, {
      cleanUrls: true,
      trailingSlashBehavior: "REMOVE",
      headers: [
        {
          glob: "/_next/static/**",
          headers: { "Cache-Control": "public, max-age=31536000, immutable" },
        },
        { regex: "^/[^.]*$", headers: { "Cache-Control": "no-cache" } },
      ],
    });
    const finalize = google.apiCalls().find((c) => c.method === "PATCH");
    assert.deepEqual(finalize.body, { status: "FINALIZED" });
    assert.equal(
      new URL(finalize.url).searchParams.get("updateMask"),
      "status",
    );
    const release = google.apiCalls().at(-1);
    assert.equal(
      new URL(release.url).searchParams.get("versionName"),
      result.hosting.versionName,
    );
    assert.deepEqual(release.body, { message: "v1.0.0" });
    assert.equal(
      google.state.releases[0].version.name,
      result.hosting.versionName,
    );
  });

  it("does nothing when the live version already serves the same files and config", async () => {
    const { options } = await project();
    const google = createFakeGoogle({ state: hostingState() });
    await deploy(context(google), { ...options, parts: ["hosting"] });
    const before = google.calls.length;
    const ctx = context(google);
    const result = await deploy(ctx, { ...options, parts: ["hosting"] });
    assert.deepEqual(google.calls.slice(before).filter(isWrite), []);
    assert.equal(result.hosting.changed, false);
    assert.match(ctx.output(), /already serves exactly these files and config/);
  });

  it("deploys again when a file changed, uploading only that file", async () => {
    const { options } = await project();
    const google = createFakeGoogle({ state: hostingState() });
    await deploy(context(google), { ...options, parts: ["hosting"] });
    await writeTree(options.dir, { "index.html": "<h1>New menu</h1>" });
    const before = google.calls.length;
    await deploy(context(google), { ...options, parts: ["hosting"] });
    const uploads = google.calls
      .slice(before)
      .filter((c) => c.url.startsWith("https://upload-"));
    assert.equal(uploads.length, 1);
    assert.equal(gunzipSync(uploads[0].raw).toString(), "<h1>New menu</h1>");
  });
});

describe("deploy: rules", () => {
  it("uploads a ruleset and creates the cloud.firestore release the first time", async () => {
    const { options } = await project();
    const google = createFakeGoogle();
    await deploy(context(google), { ...options, parts: ["rules"] });
    const [ruleset, release] = google.apiCalls().filter(isWrite);
    assert.equal(
      ruleset.url,
      `https://firebaserules.googleapis.com/v1/projects/${PROJECT}/rulesets`,
    );
    assert.deepEqual(ruleset.body, {
      source: { files: [{ name: "firestore.rules", content: RULES }] },
    });
    assert.equal(
      release.url,
      `https://firebaserules.googleapis.com/v1/projects/${PROJECT}/releases`,
    );
    assert.deepEqual(release.body, {
      name: `projects/${PROJECT}/releases/cloud.firestore`,
      rulesetName: `projects/${PROJECT}/rulesets/rs1`,
    });
  });

  it("skips when the live rules are the same, and patches the release when they differ", async () => {
    const { options } = await project();
    const google = createFakeGoogle();
    await deploy(context(google), { ...options, parts: ["rules"] });

    let before = google.calls.length;
    await deploy(context(google), { ...options, parts: ["rules"] });
    assert.deepEqual(google.calls.slice(before).filter(isWrite), []);

    await writeTree(join(options.rules, ".."), {
      "firestore.rules": `${RULES}// changed\n`,
    });
    before = google.calls.length;
    await deploy(context(google), { ...options, parts: ["rules"] });
    const writes = google.calls.slice(before).filter(isWrite);
    assert.deepEqual(
      writes.map((c) => c.method),
      ["POST", "PATCH"],
    );
    assert.equal(
      writes[1].url,
      `https://firebaserules.googleapis.com/v1/projects/${PROJECT}/releases/cloud.firestore`,
    );
    assert.deepEqual(writes[1].body, {
      release: {
        name: `projects/${PROJECT}/releases/cloud.firestore`,
        rulesetName: google.state.rulesRelease.rulesetName,
      },
    });
  });
});

describe("deploy: indexes", () => {
  it("creates only the missing indexes, without the file's comments", async () => {
    const { options } = await project();
    const state = hostingState();
    // The ASCENDING one exists already, with the __name__ Google appends.
    state.indexes.push({
      name: `projects/${PROJECT}/databases/(default)/collectionGroups/orders/indexes/CICAgOi`,
      queryScope: "COLLECTION",
      apiScope: "ANY_API",
      state: "READY",
      fields: [
        { fieldPath: "status", order: "ASCENDING" },
        { fieldPath: "createdAt", order: "ASCENDING" },
        { fieldPath: "__name__", order: "ASCENDING" },
      ],
    });
    const google = createFakeGoogle({ state });
    const result = await deploy(context(google), {
      ...options,
      parts: ["indexes"],
    });
    const writes = google.apiCalls().filter(isWrite);
    assert.equal(writes.length, 1);
    assert.equal(
      writes[0].url,
      `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/collectionGroups/orders/indexes`,
    );
    assert.deepEqual(writes[0].body, {
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "status", order: "DESCENDING" },
        { fieldPath: "createdAt", order: "ASCENDING" },
      ],
    });
    assert.equal(result.indexes.created, 1);

    // And a second run finds both.
    const before = google.calls.length;
    await deploy(context(google), { ...options, parts: ["indexes"] });
    assert.deepEqual(google.calls.slice(before).filter(isWrite), []);
  });

  it("treats an implied __name__ field as the same index", () => {
    const fields = [
      { fieldPath: "status", order: "DESCENDING" },
      { fieldPath: "createdAt", order: "DESCENDING" },
    ];
    const fromFile = indexKey("orders", { queryScope: "COLLECTION", fields });
    const fromApi = indexKey("orders", {
      queryScope: "COLLECTION",
      apiScope: "ANY_API",
      fields: [...fields, { fieldPath: "__name__", order: "DESCENDING" }],
    });
    const different = indexKey("orders", {
      queryScope: "COLLECTION",
      fields: [...fields, { fieldPath: "__name__", order: "ASCENDING" }],
    });
    assert.equal(fromFile, fromApi);
    assert.notEqual(fromFile, different);
  });
});

describe("deploy: choosing parts", () => {
  it("deploys only the parts whose files are given", async () => {
    const { dir } = await project();
    const { google, run } = await cli({ state: hostingState() });
    const result = await run("deploy", "--rules", join(dir, "firestore.rules"));
    assert.equal(result.code, 0, result.err);
    assert.ok(
      google
        .apiCalls()
        .every((c) => c.url.startsWith("https://firebaserules.")),
    );
  });

  it("--only picks parts, and each part needs its file", async () => {
    const { dir } = await project();
    const { google, run } = await cli({ state: hostingState() });
    const args = [
      "--rules",
      join(dir, "firestore.rules"),
      "--indexes",
      join(dir, "firestore.indexes.json"),
    ];
    const result = await run("deploy", ...args, "--only", "indexes");
    assert.equal(result.code, 0, result.err);
    assert.ok(
      google.apiCalls().every((c) => c.url.startsWith("https://firestore.")),
    );

    const missing = await run(
      "deploy",
      "--only",
      "hosting",
      "--site",
      "lantern-cafe",
    );
    assert.equal(missing.code, 2);
    assert.match(missing.err, /Deploying hosting needs --dir/);
  });

  it("deploys rules, then indexes, then hosting from the CLI", async () => {
    const { dir } = await project();
    const { google, run } = await cli({ state: hostingState() });
    const result = await run(
      "deploy",
      "--rules",
      join(dir, "firestore.rules"),
      "--indexes",
      join(dir, "firestore.indexes.json"),
      "--site",
      "lantern-cafe",
      "--dir",
      join(dir, "out"),
      "--config",
      join(dir, "firebase.json"),
      "--target",
      "app",
    );
    assert.equal(result.code, 0, result.err);
    const hosts = [
      ...new Set(
        google
          .apiCalls()
          .filter(isWrite)
          .map((c) => new URL(c.url).hostname),
      ),
    ];
    assert.deepEqual(hosts, [
      "firebaserules.googleapis.com",
      "firestore.googleapis.com",
      "firebasehosting.googleapis.com",
      "upload-firebasehosting.googleapis.com",
    ]);
    assert.match(
      result.out,
      /> Firestore rules\n {2}\+ made firestore\.rules live/,
    );
    assert.match(result.out, /> Hosting lantern-cafe\.web\.app/);
  });
});
