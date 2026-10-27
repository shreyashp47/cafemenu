#!/usr/bin/env node
/**
 * The backend, run once: `npm run worker -w @cafemenu/platform-functions`.
 * What .github/workflows/backend.yml runs every 5 minutes (see README.md,
 * "The backend on GitHub Actions").
 *
 *   --jobs           run the email and support-window jobs now, even if they
 *                    ran less than an hour ago
 *   --loop <secs>    keep going, a run every <secs> seconds: for working
 *                    against the emulators on your own machine
 *   --max <n>        answer at most n requests in a run (default 25)
 *   --verbose        print everything, deployer output and emails included.
 *                    Never in the workflow: its log is public.
 *
 * Needs GOOGLE_APPLICATION_CREDENTIALS (the platform service account's key
 * file), or FIRESTORE_EMULATOR_HOST and a demo- project for the emulators.
 * Exits 1 when the run couldn't start, or a request or deployment failed in
 * a way nobody planned for, so the workflow goes red and the maintainer
 * hears of it; a request refused for a reason the owner can read is not that.
 */
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import { workerEnv } from "./env.mjs";
import { createPublicLog, summaryLines } from "./log.mjs";
import { MAX_REQUESTS_PER_RUN, hadUnexpected, runWorker } from "./worker.mjs";

const { values } = parseArgs({
  options: {
    jobs: { type: "boolean", default: false },
    loop: { type: "string" },
    max: { type: "string" },
    verbose: { type: "boolean", default: false },
  },
});

const positive = (text, name) => {
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1) {
    console.error(`--${name} takes a whole number above 0, not "${text}".`);
    process.exit(2);
  }
  return n;
};
const loopSeconds = values.loop ? positive(values.loop, "loop") : null;
const maxRequests = values.max
  ? positive(values.max, "max")
  : MAX_REQUESTS_PER_RUN;

const write = (text) => console.log(text);
const { log } = createPublicLog({ write, verbose: values.verbose });

let env;
try {
  env = await workerEnv({ log });
} catch (error) {
  // Its own words only: what is missing, never the key's contents.
  console.error(`The backend couldn't start: ${error.message}`);
  process.exit(1);
}

const runId = [
  "worker",
  process.env.GITHUB_RUN_ID ?? "local",
  process.env.GITHUB_RUN_ATTEMPT ?? "0",
  randomUUID().slice(0, 8),
].join("-");

let failed = false;
for (let jobs = values.jobs; ; jobs = false) {
  try {
    const summary = await runWorker(env, { runId, maxRequests, jobs });
    for (const text of summaryLines(summary)) write(text);
    failed ||= hadUnexpected(summary);
  } catch (error) {
    // Firestore unreachable, a permission the service account lacks: the
    // class and code of it, which carry no data of anyone's.
    console.error(
      `The run failed: ${error.name}${error.code ? ` (${error.code})` : ""}`,
    );
    if (values.verbose) console.error(error);
    failed = true;
  }
  if (!loopSeconds) break;
  await new Promise((resolve) => setTimeout(resolve, loopSeconds * 1000));
}
process.exit(failed ? 1 : 0);
