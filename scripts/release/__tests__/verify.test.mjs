import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFile, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { sha256 } from "../lib/files.mjs";
import { createTar, gzip } from "../lib/tar.mjs";
import { VerifyError, extractPackage, verifyPackage } from "../verify.mjs";
import {
  CREATED_AT,
  FIXTURE,
  makeFixture,
  packageFixture,
  readArchive,
  tamper,
  tempDir,
} from "./helpers.mjs";

const PACKAGE = fileURLToPath(new URL("../package.mjs", import.meta.url));
const VERIFY = fileURLToPath(new URL("../verify.mjs", import.meta.url));

/** Resolves to the VerifyError `promise` rejects with. */
async function failure(promise) {
  try {
    await promise;
  } catch (error) {
    assert.ok(
      error instanceof VerifyError,
      `expected a VerifyError, got ${error}`,
    );
    return error;
  }
  assert.fail("verification passed, but it should have failed");
}

const replace = (path, data) => (entries) => {
  entries.find((entry) => entry.path === path).data = Buffer.from(data);
};

test("a fresh package verifies", async () => {
  const { archivePath, manifest } = await packageFixture();
  const verified = await verifyPackage(archivePath, {
    version: "v0.2.0-beta.1",
  });
  assert.deepEqual(verified.manifest, manifest);
  assert.deepEqual(verified.checkedAgainst, ["SHA256SUMS"]);
  assert.equal(verified.sha256, sha256(await readFile(archivePath)));
  assert.equal(
    verified.files.get("site/index.html").toString(),
    FIXTURE["out/index.html"],
  );
});

test("a file changed inside the package is caught, even with SHA256SUMS rewritten to match", async () => {
  const { archivePath } = await packageFixture();
  const original = FIXTURE["out/index.html"];
  // Same length, so only the hash can tell.
  await tamper(
    archivePath,
    replace(
      "site/index.html",
      original.replace("Scan to order", "Pay here now!"),
    ),
  );
  const error = await failure(verifyPackage(archivePath));
  assert.deepEqual(error.problems, [
    "site/index.html: its SHA-256 does not match release.json",
  ]);

  await tamper(
    archivePath,
    replace("firestore.rules", "allow read, write: if true;"),
  );
  assert.match(
    (await failure(verifyPackage(archivePath))).message,
    /firestore\.rules: \d+ bytes, but release\.json says/,
  );
});

test("a corrupt download is caught by SHA256SUMS", async () => {
  const { archivePath } = await packageFixture();
  const bytes = await readFile(archivePath);
  bytes[bytes.length - 100] ^= 0xff;
  await writeFile(archivePath, bytes);
  assert.match(
    (await failure(verifyPackage(archivePath))).message,
    /SHA256SUMS says [0-9a-f]{64}: a corrupt or altered download/,
  );
});

test("an expected SHA-256 from somewhere trusted must match too", async () => {
  const { archivePath, sha256: digest } = await packageFixture();
  await failure(verifyPackage(archivePath, { sha256: "0".repeat(64) }));
  const verified = await verifyPackage(archivePath, {
    sha256: digest.toUpperCase(),
  });
  assert.deepEqual(verified.checkedAgainst, ["--sha256", "SHA256SUMS"]);
});

test("with no SHA256SUMS and no expected hash, nothing is trusted", async () => {
  const { archivePath, sumsPath, sha256: digest } = await packageFixture();
  await rm(sumsPath);
  assert.match(
    (await failure(verifyPackage(archivePath))).message,
    /nothing to check it against/,
  );
  assert.deepEqual(
    (await verifyPackage(archivePath, { sha256: digest })).checkedAgainst,
    ["--sha256"],
  );
  await assert.rejects(verifyPackage(archivePath, { sums: sumsPath }), {
    code: "ENOENT",
  });
});

test("files added to or missing from the archive are caught", async () => {
  const { archivePath } = await packageFixture();
  await tamper(archivePath, (entries) => {
    entries.push({
      path: "site/evil.js",
      type: "file",
      data: Buffer.from("steal()"),
    });
    return entries.filter((entry) => entry.path !== "site/404.html");
  });
  assert.deepEqual((await failure(verifyPackage(archivePath))).problems, [
    "site/404.html: listed in release.json, but not in the archive",
    "site/evil.js: in the archive, but not listed in release.json",
  ]);
});

test("paths that escape the folder, and anything but files and folders, are refused", async () => {
  for (const path of [
    "../outside.txt",
    "/etc/cron.d/x",
    "site/../../x",
    "site//x",
    "site\\x",
  ]) {
    const { archivePath } = await packageFixture();
    await tamper(archivePath, (entries) => [
      ...entries,
      { path, type: "file", data: Buffer.from("x") },
    ]);
    assert.match(
      (await failure(verifyPackage(archivePath))).message,
      /unsafe path/,
      path,
    );
  }

  // A symlink: written as a file, then retyped "2" with its checksum fixed up.
  const { archivePath } = await packageFixture();
  const entries = (await readArchive(archivePath)).map((e) =>
    e.type === "dir" ? { ...e, path: `${e.path}/` } : e,
  );
  const tar = createTar(
    [...entries, { path: "site/link", type: "file", data: Buffer.alloc(0) }],
    {
      mtime: Date.parse(CREATED_AT) / 1000,
    },
  );
  const at = tar.indexOf("site/link\0");
  tar[at + 156] = "2".charCodeAt(0);
  tar.fill(0x20, at + 148, at + 156);
  let sum = 0;
  for (let i = at; i < at + 512; i++) sum += tar[i];

  tar.write(`${sum.toString(8).padStart(6, "0")}\0 `, at + 148, "latin1");
  const archive = gzip(tar);
  await writeFile(archivePath, archive);
  await writeFile(
    join(archivePath, "..", "SHA256SUMS"),
    `${sha256(archive)}  cafemenu-cafe-0.2.0-beta.1.tar.gz\n`,
  );
  assert.match(
    (await failure(verifyPackage(archivePath))).message,
    /"site\/link" of tar type "2"/,
  );
});

test("the wrong version, a lying channel or a renamed file is caught", async () => {
  const { archivePath, options } = await packageFixture();
  assert.match(
    (await failure(verifyPackage(archivePath, { version: "0.2.0" }))).message,
    /expected version 0\.2\.0, but this is 0\.2\.0-beta\.1/,
  );

  const renamed = join(options.root, "cafemenu-cafe-9.9.9.tar.gz");
  await copyFile(archivePath, renamed);
  await writeFile(
    join(options.root, "SHA256SUMS"),
    `${sha256(await readFile(renamed))}  cafemenu-cafe-9.9.9.tar.gz\n`,
  );
  assert.match(
    (await failure(verifyPackage(renamed))).message,
    /its name should be cafemenu-cafe-0\.2\.0-beta\.1\.tar\.gz/,
  );

  await tamper(archivePath, (entries) => {
    const manifest = JSON.parse(entries[0].data);
    entries[0].data = Buffer.from(
      JSON.stringify({ ...manifest, channel: "stable", minSchemaVersion: 5 }),
    );
  });
  assert.deepEqual((await failure(verifyPackage(archivePath))).problems, [
    'release.json: channel is "stable", but 0.2.0-beta.1 is beta',
    "release.json: minSchemaVersion must be a whole number from 1 to schemaVersion",
  ]);
});

test("something that is not a package at all is refused", async () => {
  const dir = await tempDir("junk");
  const junk = join(dir, "cafemenu-cafe-1.0.0.tar.gz");
  await writeFile(junk, "<html>404 Not Found</html>");
  await writeFile(
    join(dir, "SHA256SUMS"),
    `${sha256(await readFile(junk))}  cafemenu-cafe-1.0.0.tar.gz\n`,
  );
  assert.match((await failure(verifyPackage(junk))).message, /not valid gzip/);
});

test("a release.json that is not an object, or of an unknown format, is refused", async () => {
  const manifestAs = (json) => (entries) => {
    entries[0].data = Buffer.from(json);
  };
  for (const [json, error] of [
    ["null", /release\.json is not a JSON object/],
    ["[1, 2]", /release\.json is not a JSON object/],
    ['"0.2.0"', /release\.json is not a JSON object/],
    ["{ not json", /release\.json is not valid JSON/],
    [
      '{ "format": 2 }',
      /release\.json is format 2; this verify\.mjs reads format 1/,
    ],
  ]) {
    const { archivePath } = await packageFixture();
    await tamper(archivePath, manifestAs(json));
    assert.match(
      (await failure(verifyPackage(archivePath))).message,
      error,
      json,
    );
  }
});

test("extractPackage writes exactly what was verified, into an empty folder only", async () => {
  const { archivePath, manifest } = await packageFixture();
  const verified = await verifyPackage(archivePath);
  const dir = await tempDir("extract");
  await extractPackage(verified, dir);
  for (const file of manifest.files) {
    assert.equal(
      sha256(await readFile(join(dir, file.path))),
      file.sha256,
      file.path,
    );
  }
  assert.deepEqual(
    JSON.parse(await readFile(join(dir, "release.json"))),
    manifest,
  );
  assert.deepEqual(await readdir(join(dir, "migrations")), []);
  await assert.rejects(extractPackage(verified, dir), /is not empty/);
});

test("the CLIs: package, verify, and exit 1 on a tampered package", async () => {
  const o = await makeFixture();
  const args = [
    "--version",
    "v0.2.0-beta.1",
    "--out",
    o.out,
    "--site",
    o.site,
    "--rules",
    o.rules,
  ];
  args.push(
    "--indexes",
    o.indexes,
    "--hosting",
    o.hosting,
    "--migrations",
    o.migrations,
  );
  args.push(
    "--changelog",
    o.changelog,
    "--sha",
    o.gitSha,
    "--created-at",
    o.createdAt,
  );
  const packaged = execFileSync(process.execPath, [PACKAGE, ...args], {
    encoding: "utf8",
  });
  assert.match(packaged, /version {3}0\.2\.0-beta\.1 \(beta\)/);

  const archive = join(o.out, "cafemenu-cafe-0.2.0-beta.1.tar.gz");
  const dir = join(o.root, "unpacked");
  const verified = execFileSync(
    process.execPath,
    [VERIFY, archive, "--version", "0.2.0-beta.1", "--extract", dir],
    {
      encoding: "utf8",
    },
  );
  assert.match(verified, /^verified cafemenu-cafe-0\.2\.0-beta\.1\.tar\.gz\n/);
  assert.equal(
    await readFile(join(dir, "site", "index.html"), "utf8"),
    FIXTURE["out/index.html"],
  );

  await tamper(
    archive,
    replace("site/sw.js", "self.skipWaiting = () => steal();\n"),
  );
  const failed = spawnSync(process.execPath, [VERIFY, archive], {
    encoding: "utf8",
  });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /failed verification:\n {2}- site\/sw\.js: /);
});
