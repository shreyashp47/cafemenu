/**
 * The smoke test as a command (`bin/smoke.mjs`): checks one cafe's address and
 * says so in the exit code and in JSON, for a script or a person.
 *
 *   exit 0   every check passed (a skipped one is not a failure)
 *   exit 1   a check failed: the site is not the working release it should be
 *   exit 2   it could not run: the arguments or a file they name are wrong
 *
 * stdout is the JSON result, and nothing else; the one-line-per-check summary
 * goes to stderr. The deployer does not run this command: it calls the same
 * checks (`smokeCheck`) directly, from `smoke-test.mjs`.
 */
import { spawn } from "node:child_process";
import { readFile as fsReadFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { loadShared as defaultLoadShared } from "./cafe-files.mjs";
import { UsageError } from "./errors.mjs";
import { readHostingConfig } from "./hosting-files.mjs";
import {
  RETRY,
  UNSTAMPED,
  securityHeaders,
  smokeCheck,
  swVersionIn,
} from "./smoke-check.mjs";

export const EXIT = { ok: 0, failed: 1, usage: 2 };

const ENTRY_SCRIPT = fileURLToPath(
  new URL("../../../apps/cafe/scripts/entry.mjs", import.meta.url),
);

export const USAGE = `Usage: smoke <url> [options]

Checks that a cafe's site answers and is the release it should be. Read-only:
GET requests only, no orders, no sign-ins. JSON result on stdout; exit 0 if
every check passed, 1 if one failed, 2 if it could not run.

  <url>                    The site, e.g. https://lantern-cafe.web.app
  --cafe <name>            site.json must be valid settings that name this cafe
                           (reading it needs Node 22.18 or later)
  --project <id>           /__/firebase/init.json must be this Firebase project's
  --sw-version <version>   /sw.js must carry this cache version
  --build <dir>            ...or the one in <dir>/sw.js (e.g. apps/cafe/out)
  --firebase-json <file>   its security headers (the "**" rule) must be on every page
  --target <name>          which hosting entry of that file, if it has several
  --table <n>              a table the cafe has (default 1)
  --demo                   allow a preview: site.json may say "demo": true
  --attempts <n>           tries before giving up (default ${RETRY.attempts})
  --wait <seconds>         wait after the first try, one more of them after each
                           later one (default ${RETRY.waitMs / 1000})
  --browser                afterwards, walk every way in with a real browser
                           (apps/cafe/scripts/entry.mjs: needs Playwright)
  --help                   Show this

Without --cafe, --project, --sw-version/--build and --firebase-json, the checks
that need them look at the file if it is there and skip it if it is not.`;

const positive = (text, flag, max = Infinity) => {
  const n = Number(text);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) {
    throw new UsageError(`${flag} takes a whole number from 1 to ${max}.`);
  }
  return n;
};

/** `--wait`'s seconds as milliseconds. */
function seconds(text) {
  const n = Number(text);
  if (text.trim() === "" || !Number.isFinite(n) || n < 0) {
    throw new UsageError("--wait takes a number of seconds.");
  }
  return n * 1000;
}

/** Parses argv. Throws UsageError. */
export function parseSmokeArgs(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: true,
      options: {
        cafe: { type: "string" },
        project: { type: "string" },
        "sw-version": { type: "string" },
        build: { type: "string" },
        "firebase-json": { type: "string" },
        target: { type: "string" },
        table: { type: "string" },
        demo: { type: "boolean", default: false },
        attempts: { type: "string" },
        wait: { type: "string" },
        browser: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (error) {
    throw new UsageError(error.message);
  }
  const { values, positionals } = parsed;
  if (values.help) return { help: true };
  if (positionals.length !== 1) {
    throw new UsageError("Give the site's address: smoke <url>.");
  }
  let url;
  try {
    url = new URL(positionals[0]);
  } catch {
    throw new UsageError(`Not an address: ${positionals[0]}`);
  }
  if (!/^https?:$/.test(url.protocol) || url.pathname !== "/" || url.search) {
    throw new UsageError(
      `Give the site's address without a path: ${url.origin}`,
    );
  }
  if (values["sw-version"] !== undefined && values.build !== undefined) {
    throw new UsageError("Use --sw-version or --build, not both.");
  }
  if (values.target !== undefined && values["firebase-json"] === undefined) {
    throw new UsageError("--target needs --firebase-json <file>.");
  }
  return {
    url: url.origin,
    cafe: values.cafe,
    projectId: values.project,
    swVersion: values["sw-version"],
    build: values.build,
    firebaseJson: values["firebase-json"],
    target: values.target,
    table:
      values.table === undefined
        ? undefined
        : positive(values.table, "--table", 50),
    demo: values.demo,
    attempts:
      values.attempts === undefined
        ? RETRY.attempts
        : positive(values.attempts, "--attempts", 20),
    waitMs: values.wait === undefined ? RETRY.waitMs : seconds(values.wait),
    browser: values.browser,
  };
}

/** The cache version of a build folder's sw.js. Throws UsageError. */
async function buildVersion(dir, read) {
  let source;
  try {
    source = await read(`${dir.replace(/\/+$/, "")}/sw.js`, "utf8");
  } catch (error) {
    throw new UsageError(
      `Can't read ${dir}/sw.js (${error.code ?? error.message}). Run npm run build first.`,
    );
  }
  const version = swVersionIn(source);
  if (version === null || version === UNSTAMPED) {
    throw new UsageError(
      `${dir}/sw.js has no stamped cache version. Run npm run build, which stamps it.`,
    );
  }
  return version;
}

/** Runs apps/cafe/scripts/entry.mjs against `url`: {code, output}. */
export function spawnEntry({ args }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [ENTRY_SCRIPT, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", (error) => resolve({ code: 1, output: error.message }));
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

/** The browser walk as one more check of the result. */
async function browserCheck(options, result, swVersion, run) {
  const id = "browser";
  const label = "Every way in, in a real browser";
  if (!result.ok) {
    return {
      id,
      label,
      status: "skip",
      detail: "not run: a plain check failed",
    };
  }
  const args = ["--url", options.url, "--table", String(options.table ?? 1)];
  if (swVersion) args.push("--sw-version", swVersion);
  const { code, output } = await run({ args });
  if (code === 0) {
    return {
      id,
      label,
      status: "pass",
      detail: "entry.mjs: all checks passed",
    };
  }
  const tail = output.trim().split("\n").slice(-6).join(" | ");
  return {
    id,
    label,
    status: "fail",
    detail: `entry.mjs exited ${code}: ${tail}`,
  };
}

const MARK = { pass: "ok  ", fail: "FAIL", skip: "skip" };

/**
 * Runs the command and returns the exit code. `deps` replaces the outside
 * world: {fetchImpl, readFile, loadShared, sleep, out, err, spawnEntry}.
 */
export async function main(argv, deps = {}) {
  const out = deps.out ?? ((line) => process.stdout.write(`${line}\n`));
  const err = deps.err ?? ((line) => process.stderr.write(`${line}\n`));
  const read = deps.readFile ?? fsReadFile;

  try {
    const options = parseSmokeArgs(argv);
    if (options.help) {
      out(USAGE);
      return EXIT.ok;
    }
    const swVersion =
      options.swVersion ??
      (options.build ? await buildVersion(options.build, read) : undefined);
    const headers = options.firebaseJson
      ? securityHeaders(
          (
            await readHostingConfig(options.firebaseJson, options.target, {
              read,
            })
          ).config,
        )
      : undefined;

    err(`Smoke test of ${options.url}`);
    const result = await smokeCheck({
      url: options.url,
      expect: {
        cafe: options.cafe,
        projectId: options.projectId,
        swVersion,
        headers,
        table: options.table,
        demo: options.demo,
      },
      loadShared: deps.loadShared ?? defaultLoadShared,
      fetchImpl: deps.fetchImpl,
      attempts: options.attempts,
      waitMs: options.waitMs,
      sleep: deps.sleep,
      onRetry: ({ attempt, attempts, waitMs, result: last }) =>
        err(
          `  attempt ${attempt}/${attempts} failed (${last.failed.join(", ")}); trying again in ${waitMs / 1000}s`,
        ),
    });

    if (options.browser) {
      const check = await browserCheck(
        options,
        result,
        swVersion,
        deps.spawnEntry ?? spawnEntry,
      );
      result.checks.push(check);
      if (check.status === "fail") {
        result.ok = false;
        result.failed.push(check.id);
      }
    }

    for (const check of result.checks) {
      err(`  ${MARK[check.status]} ${check.label}: ${check.detail}`);
    }
    err(
      result.ok
        ? `All checks passed${result.attempts > 1 ? ` (on attempt ${result.attempts})` : ""}.`
        : `Failed: ${result.failed.join(", ")}.`,
    );
    out(JSON.stringify(result, null, 2));
    return result.ok ? EXIT.ok : EXIT.failed;
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    err(`${error.message}\n\n${USAGE}`);
    return EXIT.usage;
  }
}
