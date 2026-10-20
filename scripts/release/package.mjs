#!/usr/bin/env node
/**
 * Builds the release package for one version of the cafe app.
 *
 *   npm run build -w @cafemenu/cafe
 *   node scripts/release/package.mjs --version 0.1.0-beta.1
 *
 * writes dist/cafemenu-cafe-0.1.0-beta.1.tar.gz and dist/SHA256SUMS.
 * docs/releases.md says what is in the package and how the deployer uses it.
 *
 * The archive is reproducible: the same inputs give the same bytes. Entries
 * are sorted, every one has the commit's time as its mtime and root as its
 * owner, and the gzip header has no timestamp. createdAt is the commit's time
 * too (or SOURCE_DATE_EPOCH), never the time this happens to run.
 *
 * Options (paths are relative to the current folder; defaults to the repo's):
 *   --version     x.y.z, x.y.z-beta.N or x.y.z-rc.N, with or without a "v"
 *   --out         where the archive and SHA256SUMS go (dist)
 *   --site        the static export (apps/cafe/out)
 *   --rules       apps/cafe/firestore.rules
 *   --indexes     apps/cafe/firestore.indexes.json
 *   --hosting     apps/cafe/firebase.json, for Hosting's headers
 *   --migrations  migrations, with its schema.json
 *   --changelog   CHANGELOG.md, for the release notes
 *   --sha         the commit (git rev-parse HEAD)
 *   --created-at  ISO time or Unix seconds (the commit's time)
 */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { changelogSection } from "./lib/changelog.mjs";
import { formatBytes, isMain, run, shortPath } from "./lib/cli.mjs";
import { byPath, listFiles, sha256 } from "./lib/files.mjs";
import { FORMAT, MANIFEST, NOTES, PACKAGE_NAME, SUMS } from "./lib/layout.mjs";
import { createTar, gzip } from "./lib/tar.mjs";
import { packageFileName, parseVersion } from "./lib/version.mjs";

export const REPO = fileURLToPath(new URL("../../", import.meta.url));

export const DEFAULTS = {
  out: "dist",
  site: "apps/cafe/out",
  rules: "apps/cafe/firestore.rules",
  indexes: "apps/cafe/firestore.indexes.json",
  hosting: "apps/cafe/firebase.json",
  migrations: "migrations",
  changelog: "CHANGELOG.md",
};

// migrations/0002-prices-to-paise.mjs: the number is the schemaVersion that
// migration brings a cafe's data to. Schema 1 is TOE's data as it is.
const MIGRATION_NAME = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.(?:mjs|js|json)$/;
// In migrations/ but not shipped: release.json carries the schema numbers.
const NOT_SHIPPED = new Set(["schema.json", "README.md"]);

const isDotfile = (name) => name.startsWith(".");

/** migrations/schema.json: {schemaVersion, minSchemaVersion}. */
export async function readSchema(migrationsDir) {
  const file = join(migrationsDir, "schema.json");
  const { schemaVersion, minSchemaVersion } = JSON.parse(
    await readFile(file, "utf8"),
  );
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1)
    throw new Error(`${file}: schemaVersion must be a whole number, 1 or more`);

  if (
    !Number.isSafeInteger(minSchemaVersion) ||
    minSchemaVersion < 1 ||
    minSchemaVersion > schemaVersion
  ) {
    throw new Error(
      `${file}: minSchemaVersion must be a whole number from 1 to schemaVersion`,
    );
  }
  return { schemaVersion, minSchemaVersion };
}

/**
 * The files in migrations/ that ship, checked against schemaVersion: one
 * migration for each schema from 2 up to it, none past it. Subfolders (shared
 * code for migrations) ship as they are.
 */
export async function listMigrations(migrationsDir, schemaVersion) {
  const files = (await listFiles(migrationsDir, { skip: isDotfile })).filter(
    (path) => !NOT_SHIPPED.has(path),
  );
  const byTarget = new Map();
  for (const path of files) {
    if (path.includes("/")) continue;

    const match = MIGRATION_NAME.exec(path);
    if (!match) {
      throw new Error(
        `migrations/${path}: name a migration NNNN-what-it-does.mjs, where NNNN is the ` +
          "schemaVersion it brings a cafe to; shared code goes in a subfolder",
      );
    }
    const target = Number(match[1]);
    if (byTarget.has(target)) {
      throw new Error(
        `migrations/${byTarget.get(target)} and migrations/${path} both go to schema ${target}`,
      );
    }
    if (target < 2 || target > schemaVersion) {
      throw new Error(
        `migrations/${path} goes to schema ${target}, but schema.json has schemaVersion ` +
          `${schemaVersion} (schema 1 is the starting point, so the first migration is 0002)`,
      );
    }
    byTarget.set(target, path);
  }
  for (let target = 2; target <= schemaVersion; target++) {
    if (!byTarget.has(target)) {
      throw new Error(
        `schema.json has schemaVersion ${schemaVersion}, but nothing in migrations/ goes to ` +
          `schema ${target} (migrations/${String(target).padStart(4, "0")}-….mjs)`,
      );
    }
  }
  return files;
}

/**
 * firebase.json with Hosting's "public" pointed at site/, so an unpacked
 * package is also a folder `firebase deploy` works from. The deployer reads
 * the headers from it.
 */
function hostingConfig(source, file) {
  const config = JSON.parse(source);
  if (!config.hosting) throw new Error(`${file} has no "hosting" section`);

  for (const entry of [config.hosting].flat()) entry.public = "site";

  return Buffer.from(`${JSON.stringify(config, null, 2)}\n`);
}

function git(args) {
  return execFileSync("git", args, {
    cwd: REPO,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** "2026-10-20T07:17:07Z" from an ISO time or Unix seconds. */
function isoSeconds(value) {
  const ms = /^\d+$/.test(String(value))
    ? Number(value) * 1000
    : Date.parse(value);
  if (!Number.isFinite(ms))
    throw new Error(`createdAt: cannot read "${value}" as a time`);

  return new Date(Math.floor(ms / 1000) * 1000)
    .toISOString()
    .replace(".000Z", "Z");
}

/** Every directory above `paths`, plus `always`, as "a/b". */
function folders(paths, always) {
  const found = new Set(always);
  for (const path of paths) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++)
      found.add(parts.slice(0, i).join("/"));
  }
  return [...found];
}

/**
 * Builds the package. Every option is a path except `version`, `gitSha` and
 * `createdAt`; paths default to DEFAULTS in the repository.
 * Returns {archivePath, sumsPath, sha256, size, manifest}.
 */
export async function buildPackage(options) {
  const o = {
    ...Object.fromEntries(
      Object.entries(DEFAULTS).map(([k, v]) => [k, join(REPO, v)]),
    ),
  };
  for (const [key, value] of Object.entries(options))
    if (value !== undefined) o[key] = value;

  const release = parseVersion(o.version);
  const gitSha = o.gitSha ?? git(["rev-parse", "HEAD"]);
  if (!/^[0-9a-f]{40}$/.test(gitSha))
    throw new Error(`"${gitSha}" is not a full git commit SHA`);

  const createdAt = isoSeconds(
    o.createdAt ??
      process.env.SOURCE_DATE_EPOCH ??
      git(["show", "-s", "--format=%ct", gitSha]),
  );

  const { schemaVersion, minSchemaVersion } = await readSchema(o.migrations);
  const migrations = await listMigrations(o.migrations, schemaVersion);

  // Dotfiles (a stray .DS_Store) are left out, as Hosting's "**/.*" ignore
  // would leave them out anyway, and so they cannot change the archive.
  const site = await listFiles(o.site, { skip: isDotfile });
  if (!site.includes("index.html")) {
    throw new Error(
      `${o.site} has no index.html: build the cafe app first (npm run build -w @cafemenu/cafe)`,
    );
  }

  const files = new Map();
  for (const path of site)
    files.set(`site/${path}`, await readFile(join(o.site, path)));

  // Each release must be a new service worker (issue #29): refuse an unstamped one.
  if (files.get("site/sw.js")?.includes("__SW_VERSION__")) {
    throw new Error(
      `${join(o.site, "sw.js")} still has its __SW_VERSION__ placeholder: build with ` +
        "`npm run build -w @cafemenu/cafe`, which stamps it",
    );
  }
  files.set("firestore.rules", await readFile(o.rules));
  const indexes = await readFile(o.indexes);
  try {
    JSON.parse(indexes.toString("utf8"));
  } catch (error) {
    throw new Error(`${o.indexes} is not valid JSON (${error.message})`);
  }
  files.set("firestore.indexes.json", indexes);
  files.set(
    "firebase.json",
    hostingConfig(await readFile(o.hosting, "utf8"), o.hosting),
  );
  for (const path of migrations)
    files.set(`migrations/${path}`, await readFile(join(o.migrations, path)));

  const notes = changelogSection(
    await readFile(o.changelog, "utf8"),
    release.version,
  );
  if (notes) files.set(NOTES, Buffer.from(notes));

  const paths = [...files.keys()].sort(byPath);
  const manifest = {
    format: FORMAT,
    name: PACKAGE_NAME,
    version: release.version,
    channel: release.channel,
    schemaVersion,
    minSchemaVersion,
    gitSha,
    createdAt,
    files: paths.map((path) => ({
      path,
      size: files.get(path).length,
      sha256: sha256(files.get(path)),
    })),
  };

  // release.json first, so a reader meets the manifest before anything else.
  const entries = [
    ...folders(paths, ["site", "migrations"]).map((path) => ({
      path: `${path}/`,
      type: "dir",
    })),
    ...paths.map((path) => ({ path, type: "file", data: files.get(path) })),
  ].sort((a, b) => byPath(a.path, b.path));
  entries.unshift({
    path: MANIFEST,
    type: "file",
    data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
  });
  const archive = gzip(
    createTar(entries, { mtime: Date.parse(createdAt) / 1000 }),
  );

  const name = packageFileName(release.version);
  const digest = sha256(archive);
  await mkdir(o.out, { recursive: true });
  const archivePath = join(o.out, name);
  const sumsPath = join(o.out, SUMS);
  await writeFile(archivePath, archive);
  // sha256sum's format, so `sha256sum -c SHA256SUMS` checks it too.
  await writeFile(sumsPath, `${digest}  ${name}\n`);
  return {
    archivePath,
    sumsPath,
    sha256: digest,
    size: archive.length,
    manifest,
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      version: { type: "string" },
      out: { type: "string" },
      site: { type: "string" },
      rules: { type: "string" },
      indexes: { type: "string" },
      hosting: { type: "string" },
      migrations: { type: "string" },
      changelog: { type: "string" },
      sha: { type: "string" },
      "created-at": { type: "string" },
    },
  });
  if (!values.version) {
    throw new Error(
      "usage: node scripts/release/package.mjs --version x.y.z [--out dist]",
    );
  }

  const paths = Object.fromEntries(
    Object.keys(DEFAULTS)
      .filter((key) => values[key] !== undefined)
      .map((key) => [key, resolve(values[key])]),
  );
  const result = await buildPackage({
    ...paths,
    version: values.version,
    gitSha: values.sha,
    createdAt: values["created-at"],
  });

  const { manifest } = result;
  const unpacked = manifest.files.reduce((sum, file) => sum + file.size, 0);
  console.log(
    `${shortPath(result.archivePath)}  ${formatBytes(result.size)} (${result.size} bytes)`,
  );
  console.log(`  version   ${manifest.version} (${manifest.channel})`);
  console.log(
    `  schema    ${manifest.schemaVersion} (min ${manifest.minSchemaVersion})`,
  );
  console.log(`  commit    ${manifest.gitSha} at ${manifest.createdAt}`);
  console.log(
    `  files     ${manifest.files.length}, ${formatBytes(unpacked)} unpacked`,
  );
  console.log(
    `  notes     ${manifest.files.some((f) => f.path === NOTES) ? NOTES : "none in CHANGELOG.md"}`,
  );
  console.log(`  sha256    ${result.sha256}  (${shortPath(result.sumsPath)})`);
}

if (isMain(import.meta.url)) run(main);
