import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  compareVersions,
  packageFileName,
  parseVersion,
} from "../lib/version.mjs";
import { newestStable } from "../version.mjs";

const SCRIPT = fileURLToPath(new URL("../version.mjs", import.meta.url));

test("a plain x.y.z is stable", () => {
  assert.deepEqual(parseVersion("v1.4.2"), {
    version: "1.4.2",
    tag: "v1.4.2",
    major: 1,
    minor: 4,
    patch: 2,
    prerelease: null,
    channel: "stable",
    line: "1.4",
  });
  assert.equal(parseVersion("0.1.0").channel, "stable");
  assert.equal(parseVersion("10.20.30").line, "10.20");
});

test("-beta.N and -rc.N are beta", () => {
  const beta = parseVersion("v0.1.0-beta.1");
  assert.equal(beta.version, "0.1.0-beta.1");
  assert.equal(beta.channel, "beta");
  assert.deepEqual(beta.prerelease, { label: "beta", number: 1 });
  assert.equal(beta.line, "0.1");

  const rc = parseVersion("2.0.0-rc.12");
  assert.equal(rc.channel, "beta");
  assert.deepEqual(rc.prerelease, { label: "rc", number: 12 });
});

test("anything that is not a release version is refused", () => {
  for (const bad of [
    "",
    "1.2",
    "v1.2.3.4",
    "V1.2.3",
    "vv1.2.3",
    " 1.2.3",
    "1.2.3\n",
    "01.2.3",
    "1.02.3",
    "1.2.3-alpha.1",
    "1.2.3-beta",
    "1.2.3-beta.01",
    "1.2.3-RC.1",
    "1.2.3-beta.1.2",
    "1.2.3+build.5",
    "1.2.3-beta.1+sha.abc",
    "release-1.2.3",
    "99999999999999999999.0.0",
  ]) {
    assert.throws(
      () => parseVersion(bad),
      /is not a release version/,
      JSON.stringify(bad),
    );
  }
});

test("versions sort by semver precedence", () => {
  const sorted = [
    "1.0.0",
    "0.10.0",
    "1.0.0-rc.1",
    "1.0.0-beta.10",
    "0.9.0",
    "1.0.0-beta.2",
    "1.0.1",
  ].sort(compareVersions);
  assert.deepEqual(sorted, [
    "0.9.0",
    "0.10.0",
    "1.0.0-beta.2",
    "1.0.0-beta.10",
    "1.0.0-rc.1",
    "1.0.0",
    "1.0.1",
  ]);
  assert.equal(compareVersions("v1.2.3", "1.2.3"), 0);
});

test("the package file name carries the version without its v", () => {
  assert.equal(
    packageFileName("v0.1.0-beta.1"),
    "cafemenu-cafe-0.1.0-beta.1.tar.gz",
  );
});

test("the newest stable tag skips prereleases and anything that is not a release", () => {
  assert.equal(
    newestStable(["v1.5.0", "v1.4.3", "v2.0.0-beta.1", "nightly", "v1.10.0"]),
    "v1.10.0",
  );
  // A patch on an older line is not the newest.
  assert.equal(newestStable(["v1.5.0", "v1.4.4"]), "v1.5.0");
  assert.equal(newestStable(["v2.0.0-rc.1"]), null);
});

test("the CLI prints GITHUB_OUTPUT lines and exits 1 on a bad tag", () => {
  const out = execFileSync(process.execPath, [SCRIPT, "v0.1.0-rc.2"], {
    encoding: "utf8",
  });
  assert.equal(
    out,
    "version=0.1.0-rc.2\nchannel=beta\nprerelease=true\nline=0.1\n",
  );

  assert.throws(
    () => execFileSync(process.execPath, [SCRIPT, "v0.1"], { stdio: "pipe" }),
    (error) => {
      assert.equal(error.status, 1);
      assert.match(error.stderr.toString(), /not a release version/);
      return true;
    },
  );

  const newest = execFileSync(process.execPath, [SCRIPT, "--newest"], {
    input: "v1.4.3\nv1.5.0\nv1.6.0-beta.1\n",
    encoding: "utf8",
  });
  assert.equal(newest, "v1.5.0\n");
});
