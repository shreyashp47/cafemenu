#!/usr/bin/env node
/**
 * Checks a downloaded release package before anything in it is deployed.
 *
 *   node scripts/release/verify.mjs cafemenu-cafe-0.1.0-beta.1.tar.gz
 *   node scripts/release/verify.mjs <archive> --version 0.1.0-beta.1 --extract <empty dir>
 *
 * 1. The archive's SHA-256 matches its line in SHA256SUMS (next to it, or
 *    --sums), and --sha256 if given. One of the two must be there.
 * 2. It unpacks (to at most 512 MB) into nothing but files and folders, at
 *    safe relative paths.
 * 3. release.json is well formed, names this file's version and the right
 *    channel, and matches --version if given.
 * 4. The files in the archive are exactly the files release.json lists, each
 *    with its size and SHA-256.
 *
 * Every problem found is listed, and the exit code is 1. The deployer can also
 * import verifyPackage() and extractPackage() instead of running this.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

import { formatBytes, isMain, run, shortPath } from "./lib/cli.mjs";
import { sha256 } from "./lib/files.mjs";
import {
  FORMAT,
  MANIFEST,
  PACKAGE_NAME,
  REQUIRED,
  SUMS,
} from "./lib/layout.mjs";
import { gunzip, readTar } from "./lib/tar.mjs";
import { packageFileName, parseVersion } from "./lib/version.mjs";

export const MAX_UNPACKED = 512 * 1024 * 1024;

export class VerifyError extends Error {
  constructor(file, problems) {
    super(
      [`${file} failed verification:`, ...problems.map((p) => `  - ${p}`)].join(
        "\n",
      ),
    );
    this.problems = problems;
  }
}

/** SHA256SUMS → Map(file name → sha256). */
export function parseSums(text) {
  const sums = new Map();
  for (const line of text.split("\n")) {
    const match = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line.replace(/\r$/, ""));
    if (match) sums.set(match[2], match[1].toLowerCase());
  }
  return sums;
}

const isCount = (value, min) => Number.isSafeInteger(value) && value >= min;

/** Problems with release.json's own fields, as a list of sentences. */
function checkManifest(manifest, { fileName, version }) {
  const problems = [];
  if (manifest.name !== PACKAGE_NAME)
    problems.push(`${MANIFEST}: name is not "${PACKAGE_NAME}"`);

  let release = null;
  try {
    release = parseVersion(manifest.version);
    if (manifest.version !== release.version)
      throw new Error(`write "${release.version}"`);
  } catch (error) {
    problems.push(
      `${MANIFEST}: version ${JSON.stringify(manifest.version)}: ${error.message}`,
    );
  }
  if (release) {
    if (manifest.channel !== release.channel) {
      problems.push(
        `${MANIFEST}: channel is "${manifest.channel}", but ${release.version} is ${release.channel}`,
      );
    }
    if (fileName !== packageFileName(release.version)) {
      problems.push(
        `${fileName} holds ${release.version}; its name should be ${packageFileName(release.version)}`,
      );
    }
    if (
      version !== undefined &&
      release.version !== parseVersion(version).version
    ) {
      problems.push(
        `expected version ${parseVersion(version).version}, but this is ${release.version}`,
      );
    }
  }

  if (!isCount(manifest.schemaVersion, 1)) {
    problems.push(
      `${MANIFEST}: schemaVersion must be a whole number, 1 or more`,
    );
  } else if (
    !isCount(manifest.minSchemaVersion, 1) ||
    manifest.minSchemaVersion > manifest.schemaVersion
  ) {
    problems.push(
      `${MANIFEST}: minSchemaVersion must be a whole number from 1 to schemaVersion`,
    );
  }
  if (
    typeof manifest.gitSha !== "string" ||
    !/^[0-9a-f]{40}$/.test(manifest.gitSha)
  )
    problems.push(`${MANIFEST}: gitSha is not a full commit SHA`);

  if (
    typeof manifest.createdAt !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(manifest.createdAt) ||
    Number.isNaN(Date.parse(manifest.createdAt))
  ) {
    problems.push(
      `${MANIFEST}: createdAt is not a UTC time like 2026-10-20T07:17:07Z`,
    );
  }
  if (!Array.isArray(manifest.files))
    problems.push(`${MANIFEST}: files is not a list`);

  return problems;
}

/**
 * Verifies the package at `archivePath`. Options: `sums` (path to SHA256SUMS,
 * default next to the archive), `sha256` (the archive's expected hash, from
 * somewhere you trust more than the download), `version` (the version you
 * asked for).
 *
 * Returns {manifest, files, folders, sha256, checkedAgainst}: `files` maps each
 * path (release.json included) to its bytes. Throws VerifyError otherwise.
 */
export async function verifyPackage(archivePath, options = {}) {
  const {
    sums,
    sha256: expected,
    version,
    maxUnpacked = MAX_UNPACKED,
  } = options;
  const fileName = basename(archivePath);
  const fail = (...problems) => new VerifyError(fileName, problems);
  const bytes = await readFile(archivePath);
  const digest = sha256(bytes);
  const checkedAgainst = [];

  if (expected !== undefined) {
    if (digest !== String(expected).toLowerCase())
      throw fail(`its SHA-256 is ${digest}, not the expected ${expected}`);

    checkedAgainst.push("--sha256");
  }

  const sumsPath = sums ?? join(dirname(archivePath), SUMS);
  let sumsText = null;
  try {
    sumsText = await readFile(sumsPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT" || sums !== undefined) throw error;
  }
  if (sumsText !== null) {
    const listed = parseSums(sumsText).get(fileName);
    if (!listed) throw fail(`${sumsPath} has no line for ${fileName}`);

    if (listed !== digest) {
      throw fail(
        `its SHA-256 is ${digest}, but ${basename(sumsPath)} says ${listed}: a corrupt or altered download`,
      );
    }
    checkedAgainst.push(basename(sumsPath));
  }
  if (checkedAgainst.length === 0) {
    throw fail(
      `there is nothing to check it against: no ${SUMS} next to it, and no expected SHA-256 given`,
    );
  }

  let entries;
  try {
    entries = readTar(gunzip(bytes, maxUnpacked));
  } catch (error) {
    throw fail(`the archive ${error.message}`);
  }
  const files = new Map(
    entries.filter((e) => e.type === "file").map((e) => [e.path, e.data]),
  );
  const folders = entries.filter((e) => e.type === "dir").map((e) => e.path);

  if (!files.has(MANIFEST)) throw fail(`it has no ${MANIFEST}`);

  let manifest;
  try {
    manifest = JSON.parse(files.get(MANIFEST).toString("utf8"));
  } catch (error) {
    throw fail(`${MANIFEST} is not valid JSON (${error.message})`);
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
    throw fail(`${MANIFEST} is not a JSON object`);

  if (manifest.format !== FORMAT) {
    throw fail(
      `${MANIFEST} is format ${manifest.format}; this verify.mjs reads format ${FORMAT}`,
    );
  }

  const problems = checkManifest(manifest, { fileName, version });
  const listed = new Set();
  for (const file of Array.isArray(manifest.files) ? manifest.files : []) {
    const path = file?.path;
    if (typeof path !== "string" || path === MANIFEST || listed.has(path)) {
      problems.push(
        `${MANIFEST}: files has a bad or repeated entry: ${JSON.stringify(file)}`,
      );
      continue;
    }
    listed.add(path);
    const data = files.get(path);
    if (!data) {
      problems.push(`${path}: listed in ${MANIFEST}, but not in the archive`);
    } else if (data.length !== file.size) {
      problems.push(
        `${path}: ${data.length} bytes, but ${MANIFEST} says ${file.size}`,
      );
    } else if (sha256(data) !== file.sha256) {
      problems.push(`${path}: its SHA-256 does not match ${MANIFEST}`);
    }
  }
  for (const path of files.keys()) {
    if (path !== MANIFEST && !listed.has(path))
      problems.push(`${path}: in the archive, but not listed in ${MANIFEST}`);
  }
  if (Array.isArray(manifest.files)) {
    for (const path of REQUIRED)
      if (!files.has(path)) problems.push(`${path}: missing`);
  }

  if (problems.length) throw fail(...problems);

  return { manifest, files, folders, sha256: digest, checkedAgainst };
}

/**
 * Writes a verified package into `dir`, which must be empty or not exist yet.
 * Only ever call it with what verifyPackage() returned.
 */
export async function extractPackage({ files, folders }, dir) {
  const root = resolve(dir);
  await mkdir(root, { recursive: true });
  if ((await readdir(root)).length) throw new Error(`${dir} is not empty`);

  const inside = (path) => {
    const target = resolve(root, path);
    if (!target.startsWith(root + sep))
      throw new Error(`${path} would land outside ${dir}`);

    return target;
  };
  for (const path of folders) await mkdir(inside(path), { recursive: true });

  for (const [path, data] of files) {
    const target = inside(path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      sums: { type: "string" },
      sha256: { type: "string" },
      version: { type: "string" },
      extract: { type: "string" },
    },
  });
  if (positionals.length !== 1) {
    throw new Error(
      "usage: node scripts/release/verify.mjs <archive> [--sums SHA256SUMS] [--sha256 <hex>] " +
        "[--version x.y.z] [--extract <empty dir>]",
    );
  }

  const verified = await verifyPackage(positionals[0], values);
  const { manifest } = verified;
  const unpacked = manifest.files.reduce((sum, file) => sum + file.size, 0);
  console.log(`verified ${basename(positionals[0])}`);
  console.log(
    `  sha256    ${verified.sha256}  (matches ${verified.checkedAgainst.join(" and ")})`,
  );
  console.log(`  version   ${manifest.version} (${manifest.channel})`);
  console.log(
    `  schema    ${manifest.schemaVersion} (min ${manifest.minSchemaVersion})`,
  );
  console.log(`  commit    ${manifest.gitSha} at ${manifest.createdAt}`);
  console.log(
    `  files     ${manifest.files.length}, ${formatBytes(unpacked)} unpacked, all match ${MANIFEST}`,
  );
  if (values.extract) {
    await extractPackage(verified, values.extract);
    console.log(`  unpacked  into ${shortPath(resolve(values.extract))}`);
  }
}

if (isMain(import.meta.url)) run(main);
