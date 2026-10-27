import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { gunzipSync } from "node:zlib";

import { cafeFiles, readCafeInput } from "../src/cafe-files.mjs";
import { deployRelease, syncBranding } from "../src/commands/release.mjs";
import { rollback } from "../src/commands/rollback.mjs";
import { ActionNeededError } from "../src/errors.mjs";
import { decodeFields, encodeFields } from "../src/apis/firestore.mjs";
import { migrate } from "../src/commands/migrate.mjs";
import {
  PROJECT,
  createFakeGoogle,
  freshState,
  isWrite,
} from "./helpers/fake-google.mjs";
import {
  DEMO_FILES,
  PNG,
  SETTINGS,
  SITE,
  fakeShared,
  publish,
  releaseContext,
  releasePackage,
  rulesFor,
  writeSettings,
} from "./helpers/release.mjs";
import { cli, tempDir } from "./helpers/setup.mjs";

const CAFE_PATHS = [
  "/apple-touch-icon.png",
  "/favicon.ico",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/icon.svg",
  "/manifest.webmanifest",
  "/site.json",
];

/** A provisioned cafe on the fake Google, with v1.0.0 and v1.1.0 published. */
async function cafe({ v1 = {}, v2 = {} } = {}) {
  const state = freshState();
  state.services.set("firebasehosting.googleapis.com", "ENABLED");
  state.services.set("firestore.googleapis.com", "ENABLED");
  const google = createFakeGoogle({ state });
  const dir = await tempDir();
  const packages = {
    "1.0.0": await releasePackage("1.0.0", v1),
    "1.1.0": await releasePackage("1.1.0", v2),
  };
  for (const pkg of Object.values(packages)) await publish(google, pkg);
  const logPath = join(dir, "deploys.json");
  const settings = await writeSettings(dir);
  return {
    google,
    dir,
    logPath,
    settings,
    packages,
    ctx: (options = {}) => releaseContext(google, { logPath, ...options }),
    deploy: async (version, options = {}) =>
      deployRelease(await releaseContext(google, { logPath }), {
        site: SITE,
        version,
        settings,
        ...options,
      }),
    log: async () => JSON.parse(await readFile(logPath, "utf8")),
    setDataSchema: (n) =>
      state.docs.set("config/meta", encodeFields({ schemaVersion: n })),
  };
}

const liveVersion = (google) => google.state.releases[0]?.version.name;
const liveFiles = (google) =>
  google.state.versions.get(liveVersion(google)).files;
const liveRuleset = (google) =>
  google.state.rulesets.get(google.state.rulesRelease.rulesetName).source
    .files[0].content;
const writes = (google, from = 0) => google.calls.slice(from).filter(isWrite);

/** The bytes Hosting serves at `path` on the live version. */
function served(google, path) {
  const hash = liveFiles(google).get(path);
  const upload = google.calls.find((c) => c.raw && c.url.endsWith(`/${hash}`));
  return gunzipSync(upload.raw).toString("utf8");
}

describe("deploy --version", () => {
  it("deploys a release end to end and records it", async () => {
    const c = await cafe();
    const result = await c.deploy("1.0.0");

    // The package came from GitHub, without Google's token.
    const github = c.google.calls.filter((call) =>
      call.url.startsWith("https://github.com/"),
    );
    assert.deepEqual(
      github.map((call) => call.url.split("/").pop()),
      ["cafemenu-cafe-1.0.0.tar.gz", "SHA256SUMS"],
    );
    assert.ok(github.every((call) => !call.headers.authorization));

    // Rules, indexes, config/site, Hosting.
    assert.equal(liveRuleset(c.google), rulesFor("1.0.0"));
    assert.equal(c.google.state.indexes.length, 1);
    assert.equal(
      c.google.state.docs.get("config/site").name.stringValue,
      "Lantern Cafe",
    );
    const files = liveFiles(c.google);
    assert.deepEqual(
      [...files.keys()].sort(),
      [
        ...CAFE_PATHS,
        "/404.html",
        "/_next/static/app.js",
        "/_next/static/shared.js",
        "/admin.html",
        "/index.html",
        "/offline.html",
        "/order.html",
        "/staff.html",
        "/sw.js",
      ].sort(),
    );
    assert.deepEqual(JSON.parse(served(c.google, "/site.json")), SETTINGS);
    assert.equal(
      served(c.google, "/icon-192.png"),
      "/icon-192.png for Lantern Cafe, from its monogram",
    );
    // firebase.json's headers came along.
    assert.equal(
      c.google.state.versions.get(liveVersion(c.google)).config.headers[0]
        .headers["X-Content-Type-Options"],
      "nosniff",
    );

    const log = await c.log();
    assert.deepEqual(log.cafes[PROJECT], {
      site: SITE,
      current: result.release,
      previous: null,
      schemaFloor: 1,
    });
    assert.equal(result.release.hostingVersion, liveVersion(c.google));
    assert.equal(
      result.release.rulesetName,
      c.google.state.rulesRelease.rulesetName,
    );
    assert.equal(result.release.sha256, c.packages["1.0.0"].sha256);
    assert.equal(log.deployments.at(-1).status, "succeeded");
    assert.ok(log.deployments.at(-1).steps.every((s) => s.status === "done"));
  });

  it("is safe to re-run: the second run changes nothing in Google", async () => {
    const c = await cafe();
    await c.deploy("1.0.0");
    const before = c.google.calls.length;
    const ctx = await c.ctx();
    await deployRelease(ctx, {
      site: SITE,
      version: "1.0.0",
      settings: c.settings,
    });
    assert.deepEqual(writes(c.google, before), []);
    assert.doesNotMatch(ctx.output(), /^ {2}\+ (?!recorded)/m);
    assert.equal((await c.log()).cafes[PROJECT].previous, null);
  });

  it("makes the release it replaces the previous one", async () => {
    const c = await cafe();
    await c.deploy("1.0.0");
    await c.deploy("1.1.0");
    const record = (await c.log()).cafes[PROJECT];
    assert.equal(record.current.version, "1.1.0");
    assert.equal(record.previous.version, "1.0.0");
    assert.equal(liveRuleset(c.google), rulesFor("1.1.0"));
  });

  it("takes a local package with SHA256SUMS next to it", async () => {
    const c = await cafe();
    c.google.state.github.clear();
    await c.deploy("1.0.0", { package: c.packages["1.0.0"].archivePath });
    assert.equal((await c.log()).cafes[PROJECT].current.version, "1.0.0");
  });

  it("refuses a tampered package before touching the project", async () => {
    const c = await cafe();
    const path = c.packages["1.0.0"].archivePath;
    const bytes = await readFile(path);
    bytes[bytes.length - 20] ^= 0xff;
    await writeFile(path, bytes);
    await publish(c.google, c.packages["1.0.0"]); // the altered archive, the old SHA256SUMS

    await assert.rejects(c.deploy("1.0.0"), (error) => {
      assert.ok(error instanceof ActionNeededError);
      assert.match(error.message, /a corrupt or altered download/);
      return true;
    });
    assert.deepEqual(writes(c.google), []);
    const log = await c.log();
    assert.equal(log.cafes[PROJECT], undefined);
    assert.equal(log.deployments[0].status, "failed");
    assert.equal(log.deployments[0].steps[0].status, "failed");
  });

  it("refuses an expected --sha256 the archive doesn't have", async () => {
    const c = await cafe();
    await assert.rejects(
      c.deploy("1.0.0", { sha256: "0".repeat(64) }),
      /not the expected/,
    );
    assert.deepEqual(writes(c.google), []);
  });

  it("refuses a version that isn't published", async () => {
    const c = await cafe();
    await assert.rejects(c.deploy("9.9.9"), /doesn't exist/);
  });

  it("puts the logo and icons made from it in place of the demo's", async () => {
    const c = await cafe();
    const logo = join(c.dir, "logo.png");
    await writeFile(logo, PNG);
    const settings = await writeSettings(
      c.dir,
      { ...SETTINGS, logo: "/logo.png" },
      "with-logo.json",
    );
    await c.deploy("1.0.0", { settings, logo });
    assert.equal(served(c.google, "/logo.png"), PNG.toString("utf8"));
    assert.match(served(c.google, "/favicon.ico"), /from its logo/);
  });

  it("refuses settings that don't validate, or a /logo.png with no --logo", async () => {
    const c = await cafe();
    const bad = await writeSettings(
      c.dir,
      { ...SETTINGS, colour: "red" },
      "bad.json",
    );
    await assert.rejects(
      c.deploy("1.0.0", { settings: bad }),
      /colour: not a setting/,
    );
    const noLogo = await writeSettings(
      c.dir,
      { ...SETTINGS, logo: "/logo.png" },
      "no-logo.json",
    );
    await assert.rejects(c.deploy("1.0.0", { settings: noLogo }), /--logo/);
    assert.deepEqual(writes(c.google), []);
  });
});

describe("schema versions", () => {
  it("refuses a package whose minSchemaVersion is above the data's", async () => {
    const c = await cafe({ v1: { schemaVersion: 3, minSchemaVersion: 2 } });
    c.setDataSchema(1);
    await assert.rejects(c.deploy("1.0.0"), (error) => {
      assert.ok(error instanceof ActionNeededError);
      assert.match(
        error.message,
        /schema 2 or later, but this cafe's data is at schema 1/,
      );
      return true;
    });
    assert.deepEqual(writes(c.google), []);
  });

  it("runs the package's migrations, before the rules", async () => {
    const c = await cafe({
      v1: {
        schemaVersion: 2,
        minSchemaVersion: 1,
        migrations: {
          2: `export const from = 1;
export const to = 2;
export const describe = "paise beside the rupees";
export async function up(db) {
  await db.each("menu", "menu", (item) => ({ pricePaise: item.price * 100 }));
}
`,
        },
      },
    });
    c.google.state.docs.set("menu/latte", encodeFields({ price: 180 }));
    const ctx = await c.ctx();
    const { release } = await deployRelease(ctx, {
      site: SITE,
      version: "1.0.0",
      settings: c.settings,
    });

    assert.deepEqual(decodeFields(c.google.state.docs.get("menu/latte")), {
      price: 180,
      pricePaise: 18000,
    });
    assert.deepEqual(decodeFields(c.google.state.docs.get("config/meta")), {
      schemaVersion: 2,
    });
    const sent = writes(c.google).map((call) => call.url);
    const lastCommit = sent.findLastIndex((url) => url.endsWith(":commit"));
    const firstRules = sent.findIndex((url) => url.includes("/rulesets"));
    assert.ok(lastCommit >= 0 && lastCommit < firstRules);
    assert.match(
      ctx.output(),
      /0002-step\.mjs, schema 1 → 2: paise beside the rupees/,
    );
    assert.equal(release.schemaVersion, 2);
  });

  it("refuses a release that changes the data under the live one, and says how to migrate it", async () => {
    const c = await cafe({ v1: { schemaVersion: 2, minSchemaVersion: 2 } });
    await assert.rejects(c.deploy("1.0.0"), (error) => {
      assert.ok(error instanceof ActionNeededError);
      assert.match(
        error.hint,
        /with the cafe closed, migrate it from a checkout of 1\.0\.0 \(`deployer migrate --project test-cafe --to 2`\)/,
      );
      return true;
    });
    assert.deepEqual(writes(c.google), []);
  });

  it("deploys onto data already at the package's schema", async () => {
    const c = await cafe({ v1: { schemaVersion: 2, minSchemaVersion: 2 } });
    c.setDataSchema(2);
    await c.deploy("1.0.0");
    assert.equal((await c.log()).cafes[PROJECT].schemaFloor, 2);
  });

  it("won't roll back to a release older than the data's floor", async () => {
    const c = await cafe({ v2: { schemaVersion: 2, minSchemaVersion: 2 } });
    await c.deploy("1.0.0");
    c.setDataSchema(2); // what #21's migration will have done
    await c.deploy("1.1.0");
    const before = c.google.calls.length;
    await assert.rejects(rollback(await c.ctx(), { site: SITE }), (error) => {
      assert.ok(error instanceof ActionNeededError);
      assert.match(
        error.message,
        /1\.0\.0 runs on schema 1, but this cafe's data \(schema 2\)/,
      );
      return true;
    });
    assert.deepEqual(writes(c.google, before), []);
    assert.equal((await c.log()).cafes[PROJECT].current.version, "1.1.0");
  });

  it("rolls back over an expand migration, which keeps the floor", async () => {
    const c = await cafe({ v2: { schemaVersion: 2, minSchemaVersion: 1 } });
    await c.deploy("1.0.0");
    c.setDataSchema(2);
    await c.deploy("1.1.0");
    await rollback(await c.ctx(), { site: SITE });
    assert.equal((await c.log()).cafes[PROJECT].current.version, "1.0.0");
  });
});

describe("the money unit", () => {
  const TOE = {
    ...SETTINGS,
    name: "TOE Cafe",
    moneyUnit: "major",
    maxOrderTotal: 10000,
  };
  const site = (c) => decodeFields(c.google.state.docs.get("config/site"));

  it("stays the data's after 0002, whatever the settings say", async () => {
    const c = await cafe({ v2: { schemaVersion: 2, minSchemaVersion: 2 } });
    const toe = await writeSettings(c.dir, TOE, "toe.json");
    await c.deploy("1.0.0", { settings: toe });
    assert.equal(site(c).moneyUnit, "major");

    await migrate(await c.ctx(), { to: 2 });
    assert.equal(site(c).moneyUnit, "minor");

    // The settings file still says rupees; config/site and site.json don't.
    const ctx = await c.ctx();
    await deployRelease(ctx, { site: SITE, version: "1.1.0", settings: toe });
    assert.match(
      ctx.output(),
      /! the settings say "moneyUnit": "major", but this cafe's data counts minor units \(config\/site\), which only a migration changes: using "minor" and "maxOrderTotal": 1000000/,
    );
    assert.equal(site(c).moneyUnit, "minor");
    assert.equal(site(c).maxOrderTotal, 1000000);
    const siteJson = JSON.parse(served(c.google, "/site.json"));
    assert.equal(siteJson.moneyUnit, "minor");
    assert.equal(siteJson.maxOrderTotal, 1000000);

    await syncBranding(await c.ctx(), { site: SITE, settings: toe });
    assert.equal(site(c).moneyUnit, "minor");
  });

  it("can't be switched to minor by the settings alone", async () => {
    const c = await cafe();
    const toe = await writeSettings(c.dir, TOE, "toe.json");
    await c.deploy("1.0.0", { settings: toe });
    await c.deploy("1.1.0");
    assert.equal(site(c).moneyUnit, "major");
    assert.equal(site(c).maxOrderTotal, 10000);
  });
});

describe("rollback of a release", () => {
  it("brings back the previous release's rules and Hosting version", async () => {
    const c = await cafe();
    const first = (await c.deploy("1.0.0")).release;
    await c.deploy("1.1.0");
    const ctx = await c.ctx();
    await rollback(ctx, { site: SITE });

    assert.equal(liveRuleset(c.google), rulesFor("1.0.0"));
    assert.equal(c.google.state.rulesRelease.rulesetName, first.rulesetName);
    assert.equal(liveVersion(c.google), first.hostingVersion);
    assert.match(ctx.output(), /version \S+ \(1\.0\.0\) is live again/);

    const log = await c.log();
    assert.equal(log.cafes[PROJECT].current.version, "1.0.0");
    assert.equal(log.cafes[PROJECT].current.rolledBackFrom, "1.1.0");
    assert.equal(log.cafes[PROJECT].previous, null);
    assert.equal(log.deployments.at(-1).kind, "rollback");
  });

  it("refuses a second rollback instead of going forward again", async () => {
    const c = await cafe();
    await c.deploy("1.0.0");
    await c.deploy("1.1.0");
    await rollback(await c.ctx(), { site: SITE });
    await assert.rejects(rollback(await c.ctx(), { site: SITE }), (error) => {
      assert.match(error.message, /no release before 1\.0\.0 is recorded/);
      assert.match(error.hint, /already a rollback \(from 1\.1\.0\)/);
      return true;
    });
  });

  it("keeps the branding synced since the previous release went live", async () => {
    const c = await cafe();
    await c.deploy("1.0.0");
    await c.deploy("1.1.0");
    const renamed = await writeSettings(
      c.dir,
      { ...SETTINGS, name: "Lantern Tea House" },
      "renamed.json",
    );
    await syncBranding(await c.ctx(), { site: SITE, settings: renamed });
    const uploads = c.google.calls.filter((call) => call.raw).length;

    await rollback(await c.ctx(), { site: SITE });
    assert.equal(c.google.calls.filter((call) => call.raw).length, uploads);
    assert.equal(
      JSON.parse(served(c.google, "/site.json")).name,
      "Lantern Tea House",
    );
    assert.match(served(c.google, "/index.html"), /1\.0\.0/);
    assert.equal(liveRuleset(c.google), rulesFor("1.0.0"));
  });

  it("is Hosting-only with no release recorded, and says so", async () => {
    const c = await cafe();
    const ctx = await c.ctx();
    await assert.rejects(rollback(ctx, { site: SITE }), /no releases/);
    assert.match(ctx.output(), /no release is recorded for test-cafe/);
  });
});

describe("sync-branding", () => {
  it("replaces only the cafe's own files, and keeps the release", async () => {
    const c = await cafe();
    const { release } = await c.deploy("1.0.0");
    const before = new Map(liveFiles(c.google));
    const logo = join(c.dir, "logo.png");
    await writeFile(logo, PNG);
    const settings = await writeSettings(
      c.dir,
      { ...SETTINGS, name: "Lantern Tea House", logo: "/logo.png" },
      "branded.json",
    );
    const from = c.google.calls.length;
    await syncBranding(await c.ctx(), { site: SITE, settings, logo });

    const after = liveFiles(c.google);
    for (const [path, hash] of before) {
      if (!CAFE_PATHS.includes(path)) assert.equal(after.get(path), hash, path);
    }
    const changed = [...after].filter(
      ([path, hash]) => before.get(path) !== hash,
    );
    assert.deepEqual(
      changed.map(([path]) => path).sort(),
      [...CAFE_PATHS, "/logo.png"].sort(),
    );
    // Only the cafe's files were uploaded; the rules and indexes weren't touched.
    const sent = writes(c.google, from);
    assert.ok(
      sent.every(
        (call) =>
          call.url.includes("firebasehosting") ||
          call.url.includes("/documents/config/site"),
      ),
      sent.map((call) => call.url).join("\n"),
    );
    assert.equal(
      c.google.state.docs.get("config/site").name.stringValue,
      "Lantern Tea House",
    );

    const record = (await c.log()).cafes[PROJECT];
    assert.equal(record.current.version, "1.0.0");
    assert.equal(record.current.rulesetName, release.rulesetName);
    assert.equal(record.current.hostingVersion, liveVersion(c.google));

    // Again: nothing left to change.
    const again = c.google.calls.length;
    const ctx = await c.ctx();
    await syncBranding(ctx, { site: SITE, settings, logo });
    assert.deepEqual(writes(c.google, again), []);
    assert.match(ctx.output(), /Nothing to change/);
  });

  it("drops /logo.png when the cafe no longer has a logo", async () => {
    const c = await cafe();
    const logo = join(c.dir, "logo.png");
    await writeFile(logo, PNG);
    const withLogo = await writeSettings(
      c.dir,
      { ...SETTINGS, logo: "/logo.png" },
      "l.json",
    );
    await c.deploy("1.0.0", { settings: withLogo, logo });
    assert.ok(liveFiles(c.google).has("/logo.png"));
    await syncBranding(await c.ctx(), { site: SITE, settings: c.settings });
    assert.ok(!liveFiles(c.google).has("/logo.png"));
  });

  it("needs something live to brand", async () => {
    const c = await cafe();
    await assert.rejects(
      syncBranding(await c.ctx(), { site: SITE, settings: c.settings }),
      /nothing live to brand/,
    );
  });
});

describe("--dry-run", () => {
  it("makes no writes for deploy, sync-branding or rollback", async () => {
    const c = await cafe();
    await c.deploy("1.0.0");
    const before = c.google.calls.length;
    const logBefore = await readFile(c.logPath, "utf8");

    const deployCtx = await c.ctx({ dryRun: true });
    await deployRelease(deployCtx, {
      site: SITE,
      version: "1.1.0",
      settings: c.settings,
    });
    assert.match(
      deployCtx.output(),
      /~ would upload firestore\.rules as a new ruleset/,
    );
    assert.match(
      deployCtx.output(),
      /~ would record 1\.1\.0 as current \(previous: 1\.0\.0\)/,
    );

    const renamed = await writeSettings(
      c.dir,
      { ...SETTINGS, name: "Other" },
      "o.json",
    );
    const syncCtx = await c.ctx({ dryRun: true });
    await syncBranding(syncCtx, { site: SITE, settings: renamed });
    assert.match(syncCtx.output(), /~ would update name/);

    assert.deepEqual(writes(c.google, before), []);
    assert.equal(await readFile(c.logPath, "utf8"), logBefore);
  });

  it("dry-runs a rollback without writing", async () => {
    const c = await cafe();
    await c.deploy("1.0.0");
    await c.deploy("1.1.0");
    const before = c.google.calls.length;
    const logBefore = await readFile(c.logPath, "utf8");
    const ctx = await c.ctx({ dryRun: true });
    await rollback(ctx, { site: SITE });
    assert.match(ctx.output(), /~ would make 1\.0\.0's rules/);
    assert.deepEqual(writes(c.google, before), []);
    assert.equal(await readFile(c.logPath, "utf8"), logBefore);
  });
});

describe("from the command line", () => {
  async function cafeCli() {
    const state = freshState();
    state.services.set("firebasehosting.googleapis.com", "ENABLED");
    state.services.set("firestore.googleapis.com", "ENABLED");
    const { google, run, dir } = await cli({
      state,
      deps: { loadShared: async () => fakeShared },
    });
    const pkg = await releasePackage("1.0.0");
    const settings = await writeSettings(dir);
    const log = join(dir, "deploys.json");
    const release = ["--site", SITE, "--settings", settings, "--log", log];
    return { google, run, pkg, settings, log, release };
  }

  it("deploys, syncs branding and rolls back, exiting 0", async () => {
    const c = await cafeCli();
    const deployed = await c.run(
      "deploy",
      "--version",
      "v1.0.0",
      "--package",
      c.pkg.archivePath,
      ...c.release,
    );
    assert.equal(deployed.code, 0, deployed.err);
    assert.match(
      deployed.out,
      /Done: lantern-cafe\.web\.app runs CafeMenu 1\.0\.0/,
    );
    const synced = await c.run("sync-branding", ...c.release);
    assert.equal(synced.code, 0, synced.err);
    assert.match(synced.out, /Nothing to change/);
    const rolled = await c.run("rollback", "--site", SITE, "--log", c.log);
    assert.equal(rolled.code, 3);
    assert.match(rolled.err, /Nothing to roll back to/);
  });

  it("writes nothing, not even the log, with --dry-run", async () => {
    const c = await cafeCli();
    const result = await c.run(
      "deploy",
      "--version",
      "1.0.0",
      "--package",
      c.pkg.archivePath,
      "--dry-run",
      ...c.release,
    );
    assert.equal(result.code, 0, result.err);
    assert.match(result.out, /Dry run: \d+ change\(s\) would be made/);
    assert.deepEqual(c.google.apiCalls().filter(isWrite), []);
    await assert.rejects(readFile(c.log), { code: "ENOENT" });
  });

  it("exits 3 on a tampered package and 2 on mixed options", async () => {
    const c = await cafeCli();
    const bytes = await readFile(c.pkg.archivePath);
    bytes[100] ^= 0xff;
    await writeFile(c.pkg.archivePath, bytes);
    const tampered = await c.run(
      "deploy",
      "--version",
      "1.0.0",
      "--package",
      c.pkg.archivePath,
      ...c.release,
    );
    assert.equal(tampered.code, 3);
    assert.match(tampered.err, /failed verification/);

    const mixed = await c.run(
      "deploy",
      "--version",
      "1.0.0",
      "--dir",
      "out",
      ...c.release,
    );
    assert.equal(mixed.code, 2);
    assert.match(mixed.err, /--dir can't be used with --version/);
    const stray = await c.run(
      "deploy",
      "--rules",
      "x.rules",
      "--settings",
      c.settings,
    );
    assert.equal(stray.code, 2);
    assert.match(stray.err, /--settings goes with --version/);
    const badVersion = await c.run("deploy", "--version", "1.0", ...c.release);
    assert.equal(badVersion.code, 2);
  });
});

describe("the cafe's files", () => {
  // @cafemenu/shared is TypeScript; only a Node that strips types can load it.
  it(
    "come from the real @cafemenu/shared",
    {
      skip: !process.features.typescript && "this Node can't import TypeScript",
    },
    async () => {
      const { loadShared } = await import("../src/cafe-files.mjs");
      const shared = await loadShared();
      const dir = await tempDir();
      const input = await readCafeInput(shared, {
        settingsPath: await writeSettings(dir),
      });
      const files = cafeFiles(shared, input);
      assert.deepEqual(files.map((f) => f.path).sort(), CAFE_PATHS);
      const manifest = JSON.parse(
        files.find((f) => f.path === "/manifest.webmanifest").bytes,
      );
      assert.equal(manifest.short_name, "Lantern Cafe");
      assert.ok(
        shared.isPng(files.find((f) => f.path === "/icon-192.png").bytes),
      );
    },
  );

  it("are the demo's paths that a build ships, plus site.json", () => {
    const paths = new Set([
      ...Object.keys(DEMO_FILES).map((p) => `/${p}`),
      "/site.json",
    ]);
    assert.deepEqual([...paths].sort(), CAFE_PATHS);
    assert.equal(fakeShared.validateCafeSettings(SETTINGS).ok, true);
  });
});
