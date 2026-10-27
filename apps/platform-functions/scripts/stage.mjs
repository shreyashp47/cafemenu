/**
 * Makes `.deploy/`, the copy of the functions that `firebase deploy` uploads.
 *
 * Firebase deploys one folder, and the functions import @cafemenu/deployer,
 * which imports @cafemenu/shared (TypeScript) and, from outside its own
 * package, scripts/release/. In the repository npm workspaces link them; in
 * Cloud Build there is no repository. So the staged folder is a package of its
 * own with the pieces beside it, laid out the way the deployer expects them:
 *
 *   .deploy/package.json            the functions' dependencies, with
 *                                   @cafemenu/deployer and @cafemenu/shared
 *                                   as file: dependencies on vendor/
 *   .deploy/package-lock.json       the repository's lockfile cut down to
 *                                   them (prune-lock.mjs), so Cloud Build
 *                                   runs `npm ci`
 *   .deploy/src/                    this app's src/
 *   .deploy/.env, .env.<project>    the maintainer's settings, if there are any
 *   .deploy/vendor/packages/deployer
 *   .deploy/vendor/packages/shared
 *   .deploy/vendor/scripts/release  (the deployer imports it as ../../../scripts/release)
 *
 * Run by `firebase deploy` itself (firebase.json, predeploy); also by hand
 * with `npm run stage`.
 */
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { pruneLock } from "./prune-lock.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const APP = join(here, "..");
const ROOT = join(APP, "../..");

/** Test folders and build output don't belong in what is deployed. */
const wanted = (src) =>
  !/[\\/](__tests__|tests|node_modules)([\\/]|$)/.test(src);

export async function stage({
  app = APP,
  root = ROOT,
  out = join(app, ".deploy"),
} = {}) {
  await rm(out, { recursive: true, force: true });
  const copy = async (from, to) => {
    await mkdir(dirname(join(out, to)), { recursive: true });
    await cp(join(from), join(out, to), { recursive: true, filter: wanted });
  };

  await copy(join(app, "src"), "src");
  // The maintainer's settings (`.env`, `.env.<project>`: the mail provider and
  // the links in emails, see README.md). Firebase reads them from the folder
  // it uploads. Not the emulator's, which is for the emulators alone, and
  // not `.env.example`.
  for (const name of await readdir(app)) {
    if (/^\.env(\.(?!demo-|example$).+)?$/.test(name)) {
      await copy(join(app, name), name);
    }
  }
  await copy(
    join(root, "packages/deployer/src"),
    "vendor/packages/deployer/src",
  );
  await copy(join(root, "packages/shared/src"), "vendor/packages/shared/src");
  await copy(join(root, "scripts/release"), "vendor/scripts/release");

  // Their manifests, without the scripts and development dependencies (vitest
  // among them) that npm would otherwise try to resolve for a linked package,
  // which is what crashes it (CONTRIBUTING.md).
  const vendored = {};
  for (const name of ["deployer", "shared"]) {
    const manifest = JSON.parse(
      await readFile(join(root, `packages/${name}/package.json`), "utf8"),
    );
    const { version, license, type, exports, engines, dependencies } = manifest;
    const path = `vendor/packages/${name}`;
    const trimmed = {
      name: manifest.name,
      version,
      license,
      type,
      exports,
      engines,
      dependencies,
    };
    await writeFile(
      join(out, path, "package.json"),
      `${JSON.stringify(trimmed, null, 2)}\n`,
    );
    vendored[manifest.name] = { path, manifest: trimmed };
  }

  const pkg = JSON.parse(await readFile(join(app, "package.json"), "utf8"));
  const staged = {
    name: pkg.name,
    version: pkg.version,
    private: true,
    license: pkg.license,
    type: pkg.type,
    main: pkg.main,
    engines: pkg.engines,
    dependencies: {
      ...pkg.dependencies,
      "@cafemenu/deployer": "file:vendor/packages/deployer",
      "@cafemenu/shared": "file:vendor/packages/shared",
    },
  };
  await writeFile(
    join(out, "package.json"),
    `${JSON.stringify(staged, null, 2)}\n`,
  );

  // The versions the repository's own lockfile holds, so that what is
  // deployed is what was tested, and `npm ci` installs it.
  const lock = JSON.parse(
    await readFile(join(root, "package-lock.json"), "utf8"),
  );
  const workspace = relative(root, app).split(sep).join("/");
  await writeFile(
    join(out, "package-lock.json"),
    `${JSON.stringify(pruneLock(lock, { workspace, staged, vendored }), null, 2)}\n`,
  );
  return { out, package: staged };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { out } = await stage();
  console.log(`Staged the functions in ${out}`);
}
