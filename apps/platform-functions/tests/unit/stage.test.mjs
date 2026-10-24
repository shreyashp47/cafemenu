import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { stage } from "../../scripts/stage.mjs";

const exists = (path) =>
  stat(path).then(
    () => true,
    () => false,
  );

describe("the staged copy that firebase deploy uploads", () => {
  it("holds the functions, the deployer and what the deployer imports, laid out as it expects", async () => {
    const out = join(await mkdtemp(join(tmpdir(), "stage-")), ".deploy");
    const { package: pkg } = await stage({ out });

    assert.equal(pkg.name, "@cafemenu/platform-functions");
    assert.equal(pkg.main, "src/index.mjs");
    assert.equal(pkg.engines.node, "22");
    assert.deepEqual(Object.keys(pkg.dependencies).sort(), [
      "@cafemenu/deployer",
      "@cafemenu/shared",
      "firebase-admin",
      "firebase-functions",
    ]);
    assert.equal(
      pkg.dependencies["@cafemenu/deployer"],
      "file:vendor/packages/deployer",
    );
    assert.equal(
      JSON.parse(await readFile(join(out, "package.json"), "utf8")).private,
      true,
    );

    for (const path of [
      "src/index.mjs",
      "vendor/packages/deployer/package.json",
      "vendor/packages/deployer/src/index.mjs",
      "vendor/packages/shared/src/index.ts",
      "vendor/packages/shared/src/icons/index.ts",
      // The deployer imports ../../../scripts/release/ from its src/.
      "vendor/scripts/release/verify.mjs",
      "vendor/scripts/release/lib/version.mjs",
    ]) {
      assert.ok(await exists(join(out, path)), `${path} is staged`);
    }
    // A lockfile cut from the repository's, so Cloud Build runs `npm ci`, and
    // manifests for the linked packages without the development dependencies
    // that crash npm's resolver.
    const lock = JSON.parse(
      await readFile(join(out, "package-lock.json"), "utf8"),
    );
    assert.equal(lock.lockfileVersion, 3);
    assert.deepEqual(lock.packages[""].dependencies, pkg.dependencies);
    assert.equal(
      lock.packages["node_modules/firebase-functions"].version.split(".")[0],
      "7",
    );
    assert.deepEqual(lock.packages["node_modules/@cafemenu/shared"], {
      resolved: "vendor/packages/shared",
      link: true,
    });
    for (const name of ["deployer", "shared"]) {
      const vendored = JSON.parse(
        await readFile(
          join(out, `vendor/packages/${name}/package.json`),
          "utf8",
        ),
      );
      assert.equal(vendored.devDependencies, undefined);
      assert.equal(vendored.scripts, undefined);
    }
    // Tests and the other apps stay behind.
    assert.equal(
      await exists(join(out, "vendor/packages/deployer/tests")),
      false,
    );
    assert.equal(
      await exists(join(out, "vendor/scripts/release/__tests__")),
      false,
    );
    assert.deepEqual((await readdir(join(out, "vendor"))).sort(), [
      "packages",
      "scripts",
    ]);
  });

  it("carries the maintainer's settings along, and not the emulator's", async () => {
    const app = join(dirname(fileURLToPath(import.meta.url)), "../..");
    const mine = join(app, ".env.stage-test");
    await writeFile(mine, "MAIL_PROVIDER=log\n");
    try {
      const out = join(await mkdtemp(join(tmpdir(), "stage-")), ".deploy");
      await stage({ out });
      assert.equal(
        await readFile(join(out, ".env.stage-test"), "utf8"),
        "MAIL_PROVIDER=log\n",
      );
      assert.equal(await exists(join(out, ".env.demo-cafemenu")), false);
      assert.equal(await exists(join(out, ".env.example")), false);
    } finally {
      await rm(mine, { force: true });
    }
  });
});
