import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { pruneLock } from "../../scripts/prune-lock.mjs";

const WS = "apps/app";
const staged = {
  name: "app",
  version: "1.0.0",
  dependencies: { a: "^1", "@cafemenu/shared": "file:vendor/packages/shared" },
};
const shared = {
  path: "vendor/packages/shared",
  manifest: { name: "@cafemenu/shared", version: "0.1.0" },
};
const vendored = { "@cafemenu/shared": shared };
const stagedWithC = {
  ...staged,
  dependencies: { ...staged.dependencies, c: "^1" },
};

const pkg = (version, extra = {}) => ({
  version,
  resolved: `https://registry.example/${version}.tgz`,
  integrity: `sha512-${version}`,
  ...extra,
});

/** Walks up from `at` as Node does. */
function find(packages, at, name) {
  for (let from = at; ;) {
    const key = from ? `${from}/node_modules/${name}` : `node_modules/${name}`;
    if (packages[key]) return key;
    if (!from) return null;
    const up = from.lastIndexOf("/node_modules/");
    from = up === -1 ? "" : from.slice(0, up);
  }
}

describe("a lockfile cut down to one workspace", () => {
  it("moves the workspace's own versions up, and keeps only what it needs", () => {
    const lock = {
      lockfileVersion: 3,
      packages: {
        "": { name: "root", workspaces: ["apps/*"] },
        [WS]: { name: "app", dependencies: { a: "^1" } },
        "apps/other": { name: "other", dependencies: { z: "^1" } },
        "node_modules/a": pkg("1.0.0", { dependencies: { b: "^1" } }),
        "node_modules/b": pkg("1.0.0"),
        "node_modules/z": pkg("9.0.0"),
        "node_modules/vitest": pkg("4.0.0", { dev: true }),
      },
    };
    const cut = pruneLock(lock, { workspace: WS, staged, vendored });
    assert.deepEqual(Object.keys(cut.packages), [
      "",
      "node_modules/@cafemenu/shared",
      "node_modules/a",
      "node_modules/b",
      "vendor/packages/shared",
    ]);
    assert.deepEqual(cut.packages["node_modules/@cafemenu/shared"], {
      resolved: "vendor/packages/shared",
      link: true,
    });
    assert.equal(cut.packages[""].dependencies, staged.dependencies);
  });

  it("keeps the workspace's version where it and the repository's differ, and nests the other for whoever needs it", () => {
    const lock = {
      lockfileVersion: 3,
      packages: {
        "": {},
        [WS]: { name: "app", dependencies: { a: "^1", c: "^1" } },
        // The app uses x 2 (its own copy); c, hoisted for everyone, uses x 1.
        [`${WS}/node_modules/x`]: pkg("2.0.0"),
        [`${WS}/node_modules/a`]: pkg("1.0.0", { dependencies: { x: "^2" } }),
        "node_modules/c": pkg("1.0.0", { dependencies: { x: "^1" } }),
        "node_modules/x": pkg("1.0.0"),
      },
    };
    const cut = pruneLock(lock, {
      workspace: WS,
      staged: stagedWithC,
      vendored,
    });
    assert.equal(cut.packages["node_modules/x"].version, "2.0.0");
    assert.equal(
      cut.packages["node_modules/c/node_modules/x"].version,
      "1.0.0",
    );
    assert.equal(find(cut.packages, "node_modules/a", "x"), "node_modules/x");
    assert.equal(
      find(cut.packages, "node_modules/c", "x"),
      "node_modules/c/node_modules/x",
    );
  });

  it("moves what is nested under a displaced package with it", () => {
    const lock = {
      lockfileVersion: 3,
      packages: {
        "": {},
        [WS]: { name: "app", dependencies: { a: "^1", c: "^1" } },
        [`${WS}/node_modules/g`]: pkg("2.0.0"),
        [`${WS}/node_modules/a`]: pkg("1.0.0", { dependencies: { g: "^2" } }),
        // c needs g 1, which brings its own h 1; the app's g 2 has no h.
        "node_modules/c": pkg("1.0.0", { dependencies: { g: "^1" } }),
        "node_modules/g": pkg("1.0.0", { dependencies: { h: "^1" } }),
        "node_modules/g/node_modules/h": pkg("1.0.0"),
        "node_modules/h": pkg("3.0.0"),
      },
    };
    const cut = pruneLock(lock, {
      workspace: WS,
      staged: stagedWithC,
      vendored,
    });
    assert.equal(cut.packages["node_modules/g"].version, "2.0.0");
    assert.equal(
      cut.packages["node_modules/c/node_modules/g"].version,
      "1.0.0",
    );
    assert.equal(
      cut.packages["node_modules/c/node_modules/g/node_modules/h"].version,
      "1.0.0",
    );
    assert.equal(cut.packages["node_modules/g/node_modules/h"], undefined);
    assert.equal(cut.packages["node_modules/h"], undefined, "h 3 is nobody's");
  });

  it("leaves out optional peers nobody installed, and with no development dependencies, 'dev or optional' is optional", () => {
    const lock = {
      lockfileVersion: 3,
      packages: {
        "": {},
        [WS]: { name: "app", dependencies: { a: "^1" } },
        "node_modules/a": pkg("1.0.0", {
          dependencies: { b: "^1" },
          peerDependencies: { graphql: "^16" },
          peerDependenciesMeta: { graphql: { optional: true } },
        }),
        "node_modules/b": pkg("1.0.0", { devOptional: true }),
        "node_modules/graphql": pkg("16.0.0"),
      },
    };
    const cut = pruneLock(lock, { workspace: WS, staged, vendored });
    assert.equal(cut.packages["node_modules/graphql"], undefined);
    assert.equal(cut.packages["node_modules/b"].optional, true);
    assert.equal(cut.packages["node_modules/b"].devOptional, undefined);
  });

  it("refuses what it can't cut: a package only used in development, or not in the lockfile", () => {
    const base = {
      lockfileVersion: 3,
      packages: {
        "": {},
        [WS]: {},
        "node_modules/a": pkg("1.0.0", { dev: true }),
      },
    };
    assert.throws(
      () => pruneLock(base, { workspace: WS, staged, vendored }),
      /only a development dependency/,
    );
    assert.throws(
      () =>
        pruneLock(
          { lockfileVersion: 3, packages: { "": {}, [WS]: {} } },
          { workspace: WS, staged, vendored },
        ),
      /a is not in the repository's package-lock.json/,
    );
    assert.throws(
      () =>
        pruneLock(
          { lockfileVersion: 2, packages: {} },
          { workspace: WS, staged, vendored },
        ),
      /lockfileVersion 3/,
    );
  });
});

describe("the repository's own lockfile, cut down to the functions", () => {
  it("has every dependency of everything it holds, at the version the workspace has", async () => {
    const root = new URL("../../../../", import.meta.url);
    const lock = JSON.parse(
      await readFile(new URL("package-lock.json", root), "utf8"),
    );
    const app = JSON.parse(
      await readFile(
        new URL("apps/platform-functions/package.json", root),
        "utf8",
      ),
    );
    const manifest = (name) => ({ name, version: "0.1.0", license: "MIT" });
    const cut = pruneLock(lock, {
      workspace: "apps/platform-functions",
      staged: {
        ...app,
        dependencies: {
          ...app.dependencies,
          "@cafemenu/deployer": "file:vendor/packages/deployer",
          "@cafemenu/shared": "file:vendor/packages/shared",
        },
      },
      vendored: {
        "@cafemenu/deployer": {
          path: "vendor/packages/deployer",
          manifest: manifest("@cafemenu/deployer"),
        },
        "@cafemenu/shared": {
          path: "vendor/packages/shared",
          manifest: manifest("@cafemenu/shared"),
        },
      },
    });

    // The versions the tests ran on.
    for (const name of ["firebase-admin", "firebase-functions"]) {
      const had =
        lock.packages[`apps/platform-functions/node_modules/${name}`] ??
        lock.packages[`node_modules/${name}`];
      assert.equal(cut.packages[`node_modules/${name}`].version, had.version);
    }
    // Nothing is missing, and nothing is there for development only.
    for (const [key, entry] of Object.entries(cut.packages)) {
      if (!key || key.startsWith("vendor/") || entry.link) continue;
      assert.equal(entry.dev, undefined, key);
      assert.equal(entry.devOptional, undefined, key);
      const optionalPeers = entry.peerDependenciesMeta ?? {};
      const needs = [
        ...Object.keys(entry.dependencies ?? {}),
        ...Object.keys(entry.peerDependencies ?? {}).filter(
          (n) => !optionalPeers[n]?.optional,
        ),
      ];
      for (const name of needs) {
        assert.ok(find(cut.packages, key, name), `${key} needs ${name}`);
      }
    }
    assert.equal(cut.packages["node_modules/vitest"], undefined);
    assert.ok(
      Object.keys(cut.packages).length < Object.keys(lock.packages).length / 3,
    );
  });
});
