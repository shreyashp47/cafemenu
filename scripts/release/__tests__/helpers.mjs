/**
 * A tiny stand-in for a cafe build: just enough of apps/cafe/out, the rules,
 * the indexes, firebase.json, migrations/ and a changelog to package.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { after } from "node:test";

import { buildPackage } from "../package.mjs";
import { createTar, gunzip, gzip, readTar } from "../lib/tar.mjs";
import { sha256 } from "../lib/files.mjs";

export const SHA = "0123456789abcdef0123456789abcdef01234567";
export const CREATED_AT = "2026-10-20T07:17:07Z";

// Longer than ustar's 100-byte name field, so it needs the prefix field.
export const PREFIX_PATH = `_next/static/chunks/app/${"order-confirmation-".repeat(5)}/page-0f1e2d3c4b5a6978.js`;
// Longer than name and prefix together, so it needs a pax header.
export const PAX_PATH = `_next/static/media/${"a-very-long-folder-name/".repeat(12)}font.woff2`;

export const FIXTURE = {
  "out/index.html": "<!doctype html><title>Cafe</title><p>Scan to order</p>\n",
  "out/404.html": "<!doctype html><title>Not found</title>\n",
  "out/order.txt": '1:HL["/_next/static/css/app.css"]\n',
  "out/sw.js": 'const VERSION = "0123456789ab";\n',
  [`out/${PREFIX_PATH}`]: "export default function Page() {}\n",
  [`out/${PAX_PATH}`]: "wOF2 not really\n",
  "out/.DS_Store": "Finder was here\n",
  "firestore.rules":
    "rules_version = '2';\nservice cloud.firestore {\n  match /databases/{db}/documents {}\n}\n",
  "firestore.indexes.json": '{\n  "indexes": [],\n  "fieldOverrides": []\n}\n',
  "firebase.json": `${JSON.stringify(
    {
      hosting: {
        public: "out",
        headers: [
          {
            source: "**",
            headers: [{ key: "X-Content-Type-Options", value: "nosniff" }],
          },
        ],
      },
      firestore: {
        rules: "firestore.rules",
        indexes: "firestore.indexes.json",
      },
    },
    null,
    2,
  )}\n`,
  "migrations/schema.json":
    '{\n  "schemaVersion": 1,\n  "minSchemaVersion": 1\n}\n',
  "migrations/README.md": "# Migrations\n",
  "CHANGELOG.md": [
    "# Changelog",
    "",
    "## [Unreleased]",
    "",
    "## [0.2.0] - 2026-11-01",
    "",
    "### Added",
    "",
    "- Staff invites.",
    "",
    "## [0.2.0-beta.1] - 2026-10-21",
    "",
    "### Added",
    "",
    "- Staff invites, for beta cafes.",
    "",
    "[0.2.0]: https://github.com/shreyashp47/cafemenu/releases/tag/v0.2.0",
    "[0.2.0-beta.1]: https://github.com/shreyashp47/cafemenu/releases/tag/v0.2.0-beta.1",
    "",
  ].join("\n"),
};

/** A fresh temporary folder, removed when the test file finishes. */
export async function tempDir(label = "release") {
  const dir = await mkdtemp(join(tmpdir(), `cafemenu-${label}-`));
  after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** Writes the fixture (plus `extra` files, minus null ones) and returns package options. */
export async function makeFixture(extra = {}) {
  const root = await tempDir("fixture");
  for (const [path, content] of Object.entries({ ...FIXTURE, ...extra })) {
    if (content === null) continue;

    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return {
    root,
    site: join(root, "out"),
    rules: join(root, "firestore.rules"),
    indexes: join(root, "firestore.indexes.json"),
    hosting: join(root, "firebase.json"),
    migrations: join(root, "migrations"),
    changelog: join(root, "CHANGELOG.md"),
    out: join(root, "dist"),
    gitSha: SHA,
    createdAt: CREATED_AT,
  };
}

/** Packages the fixture as `version`. */
export async function packageFixture(version = "0.2.0-beta.1", extra = {}) {
  const options = await makeFixture(extra);
  const result = await buildPackage({ ...options, version });
  return { ...result, options };
}

/** The entries of a .tar.gz on disk. */
export async function readArchive(path) {
  return readTar(gunzip(await readFile(path), 1024 * 1024 * 1024));
}

/**
 * Rewrites a package's archive through `change(entries)` and, unless
 * `keepSums`, writes a matching SHA256SUMS: what someone who can replace both
 * release assets could do.
 */
export async function tamper(archivePath, change, { keepSums = false } = {}) {
  const entries = (await readArchive(archivePath)).map((entry) =>
    entry.type === "dir" ? { ...entry, path: `${entry.path}/` } : entry,
  );
  const archive = gzip(
    createTar(change(entries) ?? entries, {
      mtime: Date.parse(CREATED_AT) / 1000,
    }),
  );
  await writeFile(archivePath, archive);
  if (!keepSums) {
    const sums = `${sha256(archive)}  ${basename(archivePath)}\n`;
    await writeFile(join(dirname(archivePath), "SHA256SUMS"), sums);
  }
}
