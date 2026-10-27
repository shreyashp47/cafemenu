/**
 * The check that a freshly deployed cafe works, run after Hosting and before
 * the deploy is recorded as current: smoke-check.mjs's checks, against
 * https://<site>.web.app, expecting what the release and the cafe's settings
 * say it should serve. Read-only: it never places an order.
 *
 * A failure throws SmokeTestError. The site is live by then, so deployRelease
 * records the deploy as failed with the release as current, then calls
 * `rollBackAfterSmokeTest`, which is `deployer rollback`: the release before
 * it comes back (rules and Hosting), and the log gets a rollback of its own.
 * A first release has nothing to go back to; the error says so.
 */
import { ActionNeededError } from "./errors.mjs";
import { readHostingConfig } from "./hosting-files.mjs";
import { packageText } from "./release-package.mjs";
import {
  UNSTAMPED,
  failures,
  securityHeaders,
  smokeCheck,
  swVersionIn,
} from "./smoke-check.mjs";

/** The cafe's site did not pass; `result` is the last run of the checks (null if they never ran). */
export class SmokeTestError extends Error {
  name = "SmokeTestError";

  constructor(message, result = null) {
    super(message);
    this.result = result;
  }
}

/** What the release and the cafe say the site must serve. Throws Error. */
async function expectations(ctx, { verified, settings }) {
  const sw = verified.files.get("site/sw.js");
  const swVersion = sw && swVersionIn(sw.toString("utf8"));
  if (!swVersion || swVersion === UNSTAMPED) {
    throw new Error(
      "the package's site/sw.js has no stamped cache version to look for",
    );
  }
  const { config } = await readHostingConfig("firebase.json", undefined, {
    read: async () => packageText(verified, "firebase.json"),
  });
  return {
    cafe: settings.name,
    projectId: ctx.project,
    swVersion,
    headers: securityHeaders(config),
    table: settings.tables?.[0],
  };
}

export async function smokeTest(
  ctx,
  { site, version, verified, settings, shared },
) {
  const { log } = ctx;
  const url = `https://${site}.web.app`;
  log.step("Smoke test");
  if (ctx.dryRun) {
    log.info(`dry run: would check ${url} once ${version} is live`);
    return { skipped: true };
  }

  let expect;
  try {
    expect = await expectations(ctx, { verified, settings });
  } catch (error) {
    // Nothing to compare the live site with: it can't be called good.
    throw new SmokeTestError(
      `The smoke test couldn't start: ${error.message}.`,
    );
  }
  log.info(
    `${url} should serve ${expect.cafe} (project ${expect.projectId}), cache version ${expect.swVersion}`,
  );

  const result = await smokeCheck({
    url,
    expect,
    loadShared: async () => shared,
    fetchImpl: ctx.fetchImpl,
    sleep: ctx.sleep,
    onRetry: ({ attempt, attempts, waitMs, result: last }) =>
      log.warn(
        `try ${attempt} of ${attempts}: ${last.failed.join(", ")} failed; Hosting can take a minute to serve a new release, trying again in ${waitMs / 1000}s`,
      ),
  });
  for (const check of result.checks) {
    const text = `${check.label}: ${check.detail}`;
    if (check.status === "pass") log.same(text);
    else if (check.status === "fail") log.warn(text);
    else log.info(`${text} (skipped)`);
  }
  if (!result.ok) {
    throw new SmokeTestError(
      `The smoke test failed on ${url}${result.attempts > 1 ? ` after ${result.attempts} tries` : ""}. ${failures(result).join("; ")}.`,
      result,
    );
  }
  log.same(
    `all ${result.checks.filter((c) => c.status === "pass").length} checks passed${result.attempts > 1 ? ` (try ${result.attempts}: Hosting had been slow to serve it)` : ""}`,
  );
  return result;
}

/**
 * Goes back to the release before `version` after its smoke test failed, with
 * `deployer rollback`, which reads the deploy log: the caller has recorded
 * `release` as current by now. Ends the error's message with what happened;
 * never throws, so the smoke failure is what the person reads.
 */
export async function rollBackAfterSmokeTest(
  ctx,
  { site, version, release, error },
) {
  const { log } = ctx;
  log.blank();
  log.warn(
    `${version} failed its smoke test: rolling ${site}.web.app back to the release before it`,
  );
  try {
    const record = await ctx.deployLog.get(ctx.project);
    // Rollback goes back from whatever the log says is current, which must be
    // this release, or it would undo the wrong one.
    if (record?.current?.hostingVersion !== release.hostingVersion) {
      throw new ActionNeededError(
        `the deploy log doesn't record ${version} as current`,
      );
    }
    // Not imported at the top: rollback.mjs imports release.mjs, which imports this.
    const { rollback } = await import("./commands/rollback.mjs");
    const back = await rollback(ctx, { site });
    error.rolledBackTo = back.version;
    error.message += ` ${version} was rolled back: ${site}.web.app runs CafeMenu ${back.version} again.`;
  } catch (rollbackError) {
    error.rollbackError = rollbackError;
    log.warn(`rolling back failed: ${rollbackError.message}`);
    error.message += ` Rolling back failed too (${rollbackError.message}${rollbackError.hint ? ` ${rollbackError.hint}` : ""}), so ${site}.web.app still runs ${version}.`;
  }
}
