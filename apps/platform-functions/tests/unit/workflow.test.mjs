/**
 * The workflow that runs the worker (.github/workflows/backend.yml) holds the
 * platform service account's key, in a public repository. These keep it from
 * being changed into something that leaks it: a trigger that runs a pull
 * request's code, a wider token, the key handed to every step. It is read as
 * text: this package has no YAML parser, and the shape checked is simple.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const path = fileURLToPath(
  new URL("../../../../.github/workflows/backend.yml", import.meta.url),
);
const text = readFileSync(path, "utf8");
// What the YAML says, without the comments that explain it.
const code = text
  .split("\n")
  .filter((line) => !line.trim().startsWith("#"))
  .join("\n");

/** The workflow's top-level `on:` block. */
const triggers = /^on:\n((?: {2}.*\n|\n)+)/m.exec(code)?.[1] ?? "";

describe("the backend workflow", () => {
  it("runs on a schedule and by hand, and on nothing a stranger can start", () => {
    assert.match(triggers, /^ {2}schedule:/m);
    assert.match(triggers, /- cron: "\*\/5 \* \* \* \*"/);
    assert.match(triggers, /^ {2}workflow_dispatch:/m);
    const names = [...triggers.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]);
    assert.deepEqual(names.sort(), ["schedule", "workflow_dispatch"]);
    assert.doesNotMatch(code, /pull_request|push:|workflow_run|issue_comment/);
  });

  it("runs only on main, in this repository", () => {
    assert.match(code, /if: github\.repository == 'shreyashp47\/cafemenu'/);
    assert.match(code, /github\.ref == 'refs\/heads\/main'/);
  });

  it("never runs two at once, and never cancels one halfway", () => {
    assert.match(
      code,
      /concurrency:\n {2}group: backend\n {2}cancel-in-progress: false/,
    );
  });

  it("can only read the repository, and stops in good time", () => {
    assert.match(code, /^permissions:\n {2}contents: read\n/m);
    assert.equal(code.match(/permissions:/g).length, 1, "no job widens it");
    const minutes = Number(/timeout-minutes: (\d+)/.exec(code)?.[1]);
    assert.ok(minutes > 0 && minutes <= 30, `timeout-minutes is ${minutes}`);
  });

  it("takes the key from the production environment", () => {
    assert.match(code, /^ {4}environment: production$/m);
  });

  it("hands the key only to the steps that need it, not to the job or the install", () => {
    // Not as job- or workflow-level environment.
    assert.doesNotMatch(code, /^(env|\s{4}env):\n\s+PLATFORM_SERVICE_ACCOUNT/m);
    const steps = code.split(/^ {6}- /m).slice(1);
    const withKey = steps.filter((s) =>
      s.includes("secrets.PLATFORM_SERVICE_ACCOUNT"),
    );
    assert.equal(withKey.length, 2, "the presence check and the worker");
    for (const step of withKey) {
      assert.doesNotMatch(step, /npm ci|npm install|actions\//);
    }
    assert.match(withKey[1], /npm run worker -w @cafemenu\/platform-functions/);
    // Written to a file in the runner's temp folder, readable by this user only, and removed.
    assert.match(withKey[1], /\$RUNNER_TEMP\/platform-key\.json/);
    assert.match(withKey[1], /umask 077/);
    assert.match(withKey[1], /trap 'rm -f "\$key"' EXIT/);
  });

  it("does not echo the key or print the environment", () => {
    assert.doesNotMatch(code, /echo[^\n]*\$PLATFORM_SERVICE_ACCOUNT/);
    assert.doesNotMatch(code, /\bprintenv\b|\benv\s*$|set -x/m);
  });

  it("does nothing, with a warning, until the key is set", () => {
    assert.match(code, /::warning title=Backend not set up::/);
    assert.match(code, /steps\.key\.outputs\.present == 'true'/);
  });
});
