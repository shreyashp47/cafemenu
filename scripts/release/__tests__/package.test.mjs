import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, utimes } from "node:fs/promises";
import { basename, join } from "node:path";
import { test } from "node:test";

import { REPO, buildPackage, listMigrations, readSchema } from "../package.mjs";
import { byPath, sha256 } from "../lib/files.mjs";
import { gunzip } from "../lib/tar.mjs";
import {
  CREATED_AT,
  FIXTURE,
  PAX_PATH,
  PREFIX_PATH,
  SHA,
  makeFixture,
  packageFixture,
  readArchive,
  tempDir,
} from "./helpers.mjs";

const fileOf = (entries, path) =>
  entries.find((entry) => entry.path === path)?.data;

test("release.json comes first and lists every other file with its size and SHA-256", async () => {
  const { archivePath, manifest } = await packageFixture("v0.2.0-beta.1");
  assert.equal(basename(archivePath), "cafemenu-cafe-0.2.0-beta.1.tar.gz");

  const entries = await readArchive(archivePath);
  assert.equal(entries[0].path, "release.json");
  assert.deepEqual(JSON.parse(entries[0].data), manifest);

  assert.deepEqual(Object.keys(manifest), [
    "format",
    "name",
    "version",
    "channel",
    "schemaVersion",
    "minSchemaVersion",
    "gitSha",
    "createdAt",
    "files",
  ]);
  assert.equal(manifest.format, 1);
  assert.equal(manifest.name, "cafemenu-cafe");
  assert.equal(manifest.version, "0.2.0-beta.1");
  assert.equal(manifest.channel, "beta");
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.minSchemaVersion, 1);
  assert.equal(manifest.gitSha, SHA);
  assert.equal(manifest.createdAt, CREATED_AT);

  // Sorted by bytes; no .DS_Store, and no schema.json or README from migrations/.
  assert.deepEqual(
    manifest.files.map((file) => file.path),
    [
      "NOTES.md",
      "firebase.json",
      "firestore.indexes.json",
      "firestore.rules",
      "site/404.html",
      `site/${PREFIX_PATH}`,
      `site/${PAX_PATH}`,
      "site/index.html",
      "site/order.txt",
      "site/sw.js",
    ],
  );
  const archived = entries.filter(
    (entry) => entry.type === "file" && entry.path !== "release.json",
  );
  assert.deepEqual(
    archived.map((entry) => entry.path),
    manifest.files.map((file) => file.path),
  );
  for (const file of manifest.files) {
    const data = fileOf(entries, file.path);
    assert.equal(file.size, data.length, file.path);
    assert.equal(file.sha256, sha256(data), file.path);
  }
  // migrations/ is there even with no migrations in it.
  assert.ok(
    entries.some(
      (entry) => entry.type === "dir" && entry.path === "migrations",
    ),
  );
});

test("files are copied as built; firebase.json points Hosting at site/; notes come from the changelog", async () => {
  const { archivePath } = await packageFixture("0.2.0-beta.1");
  const entries = await readArchive(archivePath);

  for (const path of ["index.html", "sw.js", PREFIX_PATH, PAX_PATH]) {
    assert.equal(
      fileOf(entries, `site/${path}`).toString(),
      FIXTURE[`out/${path}`],
    );
  }
  assert.equal(
    fileOf(entries, "firestore.rules").toString(),
    FIXTURE["firestore.rules"],
  );
  assert.equal(
    fileOf(entries, "firestore.indexes.json").toString(),
    FIXTURE["firestore.indexes.json"],
  );

  const hosting = JSON.parse(fileOf(entries, "firebase.json"));
  const source = JSON.parse(FIXTURE["firebase.json"]);
  assert.equal(hosting.hosting.public, "site");
  assert.deepEqual(hosting.hosting.headers, source.hosting.headers);
  assert.deepEqual(hosting.firestore, source.firestore);

  assert.equal(
    fileOf(entries, "NOTES.md").toString(),
    "### Added\n\n- Staff invites, for beta cafes.\n",
  );
});

test("a plain x.y.z is stable, and a version with no changelog section has no NOTES.md", async () => {
  const { manifest } = await packageFixture("1.0.0");
  assert.equal(manifest.channel, "stable");
  assert.ok(!manifest.files.some((file) => file.path === "NOTES.md"));
});

test("packaging twice gives byte-identical archives", async () => {
  const first = await packageFixture("0.2.0");

  // The same inputs in another folder, with other timestamps on disk.
  const second = await makeFixture();
  const longAgo = new Date("2001-02-03T04:05:06Z");
  for (const path of Object.keys(FIXTURE))
    await utimes(join(second.root, path), longAgo, longAgo);

  const again = await buildPackage({ ...second, version: "v0.2.0" });

  assert.ok(
    (await readFile(first.archivePath)).equals(
      await readFile(again.archivePath),
    ),
  );
  assert.equal(again.sha256, first.sha256);
  assert.equal(
    await readFile(again.sumsPath, "utf8"),
    await readFile(first.sumsPath, "utf8"),
  );
  assert.equal(
    await readFile(first.sumsPath, "utf8"),
    `${first.sha256}  cafemenu-cafe-0.2.0.tar.gz\n`,
  );
});

test("every header has the same mtime and owner, and gzip has no timestamp", async () => {
  const { archivePath } = await packageFixture();
  const bytes = await readFile(archivePath);
  assert.deepEqual([...bytes.subarray(0, 4)], [0x1f, 0x8b, 8, 0]); // deflate, no name or extras
  assert.equal(bytes.readUInt32LE(4), 0); // MTIME
  assert.equal(bytes[9], 3); // OS: Unix, whichever machine packaged it

  const tar = gunzip(bytes, 1024 * 1024 * 1024);
  const mtime = (Date.parse(CREATED_AT) / 1000).toString(8).padStart(11, "0");
  let headers = 0;
  for (let offset = 0; tar[offset] !== 0; headers++) {
    const field = (start, length) =>
      tar.toString("latin1", offset + start, offset + start + length);
    const type = field(156, 1);
    assert.equal(field(100, 8), type === "5" ? "0000755\0" : "0000644\0");
    assert.equal(field(108, 16), "0000000\u00000000000\0"); // uid, gid
    assert.equal(field(136, 12), `${mtime}\0`);
    assert.equal(field(265, 64), "\0".repeat(64)); // uname, gname
    offset += 512 + Math.ceil(parseInt(field(124, 11), 8) / 512) * 512;
  }
  assert.ok(headers > 10);
  assert.equal(tar.length % 10240, 0);
});

test("system tar reads it: same files, same bytes, long paths intact", async () => {
  const { archivePath, manifest } = await packageFixture();
  const dir = await tempDir("untar");
  execFileSync("tar", ["-xzf", archivePath, "-C", dir]);
  for (const file of manifest.files) {
    assert.equal(
      sha256(await readFile(join(dir, file.path))),
      file.sha256,
      file.path,
    );
  }

  const listing = execFileSync("tar", ["-tzf", archivePath], {
    encoding: "utf8",
  })
    .trim()
    .split("\n");
  assert.equal(listing[0], "release.json");
  // Everything after the manifest, folders included, in byte order.
  assert.deepEqual(listing.slice(1), [...listing.slice(1)].sort(byPath));
  assert.ok(listing.includes("migrations/"));
  assert.ok(listing.includes(`site/${PAX_PATH}`));
});

test("migrations ship, numbered by the schema they bring a cafe to", async () => {
  const { manifest } = await packageFixture("0.3.0", {
    "migrations/schema.json": '{ "schemaVersion": 3, "minSchemaVersion": 2 }\n',
    "migrations/0002-prices-to-paise.mjs": "export default {};\n",
    "migrations/0003-staff-invites.mjs": "export default {};\n",
    "migrations/lib/batch.mjs": "export {};\n",
  });
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(manifest.minSchemaVersion, 2);
  assert.deepEqual(
    manifest.files
      .map((file) => file.path)
      .filter((path) => path.startsWith("migrations/")),
    [
      "migrations/0002-prices-to-paise.mjs",
      "migrations/0003-staff-invites.mjs",
      "migrations/lib/batch.mjs",
    ],
  );
});

test("migrations that do not add up to schema.json are refused", async () => {
  const schema = (schemaVersion, minSchemaVersion = 1) =>
    JSON.stringify({ schemaVersion, minSchemaVersion });
  const cases = [
    [
      { "migrations/schema.json": schema(3), "migrations/0002-a.mjs": "" },
      /nothing in migrations\/ goes to schema 3/,
    ],
    [
      { "migrations/0002-a.mjs": "" },
      /goes to schema 2, but schema.json has schemaVersion 1/,
    ],
    [{ "migrations/0001-a.mjs": "" }, /the first migration is 0002/],
    [{ "migrations/prices.mjs": "" }, /NNNN-what-it-does/],
    [
      {
        "migrations/schema.json": schema(2),
        "migrations/0002-a.mjs": "",
        "migrations/0002-b.mjs": "",
      },
      /both go to schema 2/,
    ],
    [{ "migrations/schema.json": schema(1, 2) }, /minSchemaVersion must be/],
    [{ "migrations/schema.json": schema(0) }, /schemaVersion must be/],
  ];
  for (const [extra, error] of cases) {
    await assert.rejects(
      packageFixture("0.2.0", extra),
      error,
      JSON.stringify(extra),
    );
  }
});

test("a build that is missing or unstamped is refused", async () => {
  await assert.rejects(
    packageFixture("0.2.0", { "out/index.html": null }),
    /has no index.html/,
  );
  await assert.rejects(
    packageFixture("0.2.0", {
      "out/sw.js": 'const VERSION = "__SW_VERSION__";\n',
    }),
    /__SW_VERSION__ placeholder/,
  );
});

test("a bad version, commit or time is refused", async () => {
  await assert.rejects(packageFixture("1.0"), /not a release version/);
  const options = await makeFixture();
  await assert.rejects(
    buildPackage({ ...options, version: "1.0.0", gitSha: "abc123" }),
    /full git commit SHA/,
  );
  await assert.rejects(
    buildPackage({ ...options, version: "1.0.0", createdAt: "soon" }),
    /cannot read "soon"/,
  );
});

test("createdAt can be Unix seconds, and is kept to whole seconds in UTC", async () => {
  const options = await makeFixture();
  const { manifest } = await buildPackage({
    ...options,
    version: "1.0.0",
    createdAt: "1792480627",
  });
  assert.equal(manifest.createdAt, "2026-10-20T07:17:07Z");
  const again = await buildPackage({
    ...options,
    version: "1.0.0",
    createdAt: "2026-10-20T12:47:07.900+05:30",
  });
  assert.equal(again.manifest.createdAt, "2026-10-20T07:17:07Z");
});

test("the repository's own migrations folder is valid", async () => {
  const dir = join(REPO, "migrations");
  const { schemaVersion } = await readSchema(dir);
  await listMigrations(dir, schemaVersion);
});
