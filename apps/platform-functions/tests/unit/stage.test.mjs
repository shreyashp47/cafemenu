import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    assert.deepEqual(
      Object.keys(pkg.dependencies).sort(),
      ["@cafemenu/deployer", "@cafemenu/shared", "firebase-admin", "firebase-functions"],
    );
    assert.equal(pkg.dependencies["@cafemenu/deployer"], "file:vendor/packages/deployer");
    assert.equal(JSON.parse(await readFile(join(out, "package.json"), "utf8")).private, true);

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
    // Tests and the other apps stay behind.
    assert.equal(await exists(join(out, "vendor/packages/deployer/tests")), false);
    assert.equal(await exists(join(out, "vendor/scripts/release/__tests__")), false);
    assert.deepEqual((await readdir(join(out, "vendor"))).sort(), ["packages", "scripts"]);
  });
});
