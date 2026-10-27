/**
 * `deployer rollout`: one release to every cafe that should get it, in waves
 * (src/rollout-plan.mjs says who and in what order).
 *
 * Each cafe is a `deploy --version` of its own through `ctx.deployCafe`, which
 * smoke-tests the cafe and rolls it back by itself when the test fails. This
 * adds what no single deploy can see: a failure is counted against its wave,
 * and when too many fail the rollout pauses, before the next cafe, with what
 * is done saved in the RolloutStore. `--resume <id>` runs it again from there:
 * cafes that are done stay done, and the ones that failed or weren't reached
 * are tried again, in the plan's order.
 *
 * ctx: {log, dryRun, now, directory (CafeDirectory), store (RolloutStore),
 *       listReleases() → Promise<[{version, channel, publishedAt, withdrawn}]>
 *       (optional), deployCafe(cafe, {version, write}) → Promise}. `deployCafe` throws
 * when the cafe's deploy fails; a SmokeTestError with `rolledBackTo` means
 * the cafe was put back to that release, anything else that it wasn't.
 *
 * The support window (docs/releases.md): only the latest two minor lines are
 * supported. A stable rollout of a supported line also moves the cafes pinned
 * to an older line whose "upgrade by" date has passed, and moves their pin to
 * the new line; the plan marks them, and the state, the log and the summary
 * say why. The window comes from `ctx.listReleases()`, the published
 * releases; without it, or when it fails, nobody is forced and the rollout
 * says so.
 *
 * A dry run prints the plan and calls nothing: no Google, no store.
 */
import { supportWindow } from "@cafemenu/shared/support-window";

import { UsageError } from "../errors.mjs";
import { parseVersion } from "../release-package.mjs";
import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_FAILURE_PERCENT,
  crossesThreshold,
  forcedReason,
  planRollout,
} from "../rollout-plan.mjs";
import { SmokeTestError } from "../smoke-test.mjs";

const oneLine = (text) => String(text).replace(/\s+/g, " ").trim();

function rolloutId(version, now, taken) {
  const stamp = now
    .toISOString()
    .replace(/\.\d+Z$/, "Z")
    .replace(/[-:]/g, "");
  let id = `${version}-${stamp}`;
  for (let n = 2; taken(id); n += 1) id = `${version}-${stamp}-${n}`;
  return id;
}

/** The plan as the log shows it. */
function printPlan(ctx, { version, plan, state, batchSize, failurePercent }) {
  const { log } = ctx;
  const count = plan.waves.reduce(
    (sum, wave) => sum + wave.batches.flat().length,
    0,
  );
  log.title(
    `Rolling out CafeMenu ${version}: ${count} cafe${count === 1 ? "" : "s"} to deploy, ${plan.skipped.length} skipped`,
  );
  for (const [i, wave] of plan.waves.entries()) {
    log.step(
      `Wave ${i + 1} of ${plan.waves.length}: ${wave.name}${wave.name === "canary" ? "" : `, in batches of ${batchSize}`}`,
    );
    for (const [b, batch] of wave.batches.entries()) {
      const names = batch.map((cafe) => cafe.name).join(", ");
      log.info(wave.name === "canary" ? names : `batch ${b + 1}: ${names}`);
    }
  }
  const forced = plan.waves
    .flatMap((wave) => wave.batches.flat())
    .filter((cafe) => cafe.forced);
  if (forced.length) {
    log.step("Moved off a line that is no longer supported");
    for (const cafe of forced)
      log.info(`${cafe.name}: ${forcedReason(cafe.forced, version)}`);
  }
  const resumed = Object.values(state?.cafes ?? {});
  const hasCanary =
    plan.waves.some((wave) => wave.name === "canary") ||
    resumed.some((entry) => entry.wave === "canary");
  if (!hasCanary) {
    const canary = plan.skipped.find(({ cafe }) => cafe.canary);
    log.warn(
      canary
        ? `no canary in this rollout: ${canary.cafe.name} ${canary.reason}`
        : "no cafe is marked as the canary, so the first cafes to get it are not tried alone",
    );
  }
  const finished = resumed.filter((entry) => entry.status === "done").length;
  if (finished)
    log.info(`${finished} already done by an earlier run of ${state.id}`);
  log.info(
    `pauses when failures in a batch pass ${failurePercent}%, or at any failure of the canary`,
  );
  if (plan.skipped.length) {
    log.step("Skipped");
    for (const { cafe, reason } of plan.skipped)
      log.info(`${cafe.name}: ${reason}`);
  }
}

/** The closing summary: done, rolled back, failed, skipped and not reached, with why. */
function printSummary(ctx, state, names, resumeCommand) {
  const { log } = ctx;
  const group = (status) =>
    Object.entries(state.cafes).filter(([, entry]) => entry.status === status);
  const label = {
    completed: "completed",
    paused: "PAUSED",
    running: "stopped",
  };
  log.blank();
  log.say(
    `Rollout ${state.id}: CafeMenu ${state.version} ${label[state.status]}`,
  );

  const done = group("done");
  log.say(
    `  Done (${done.length})${done.length ? `: ${done.map(([id]) => names(id)).join(", ")}` : ""}`,
  );
  const moved = done.filter(([, entry]) => entry.forced);
  if (moved.length) {
    log.say(`  Moved off an unsupported line (${moved.length}):`);
    for (const [id, entry] of moved)
      log.say(`    ${names(id)}: ${entry.forced.reason}`);
  }
  for (const [status, title] of [
    ["rolled-back", "Rolled back"],
    ["failed", "Failed"],
  ]) {
    const entries = group(status);
    if (entries.length === 0) continue;
    log.say(`  ${title} (${entries.length}):`);
    for (const [id, entry] of entries)
      log.say(`    ${names(id)}: ${entry.reason}`);
  }
  const skipped = group("skipped");
  if (skipped.length) {
    log.say(`  Skipped (${skipped.length}):`);
    const byReason = new Map();
    for (const [id, entry] of skipped)
      byReason.set(entry.reason, [
        ...(byReason.get(entry.reason) ?? []),
        names(id),
      ]);
    for (const [reason, cafes] of byReason)
      log.say(`    ${cafes.join(", ")}: ${reason}`);
  }
  const pending = group("pending").concat(group("running"));
  if (pending.length)
    log.say(
      `  Not reached (${pending.length}): ${pending.map(([id]) => names(id)).join(", ")}`,
    );

  if (state.status === "paused") {
    log.blank();
    log.warn(`The rollout is paused: ${state.pausedBecause}.`);
    log.warn(
      "Look at why those cafes failed, then continue with the cafes that are left:",
    );
    log.say(`  ${resumeCommand}`);
  } else if (state.pausedBecause) {
    log.blank();
    log.warn(
      `${state.pausedBecause}, but it was the last cafe, so nothing was held back.`,
    );
  }
}

/**
 * The support window for this rollout, as planRollout takes it, or null.
 * Only asked for when some pinned cafe could be moved (a stable release, a
 * live cafe pinned to another line); a failure to ask is a warning, never a
 * stop: the rollout goes ahead and moves nobody off a line.
 */
async function supportFor(ctx, cafes, version, now) {
  const wanted = parseVersion(version);
  const relevant = cafes.some(
    (cafe) =>
      cafe.status === "live" &&
      cafe.release.pinned &&
      cafe.release.pinned !== wanted.line,
  );
  if (wanted.channel !== "stable" || !relevant) return null;
  if (!ctx.listReleases) {
    ctx.log.warn(
      "the published releases weren't given, so no cafe is moved off a line that is no longer supported",
    );
    return null;
  }
  try {
    return { window: supportWindow(await ctx.listReleases()), now: now() };
  } catch (error) {
    ctx.log.warn(
      `couldn't read the published releases (${oneLine(error.message)}), so no cafe is moved off a line that is no longer supported`,
    );
    return null;
  }
}

export async function rollout(ctx, options) {
  const { log, dryRun, directory, store } = ctx;
  const now = () => ctx.now?.() ?? new Date();

  let stored = null;
  if (options.resume) {
    stored = await store.get(options.resume);
    if (!stored)
      throw new UsageError(`No rollout ${options.resume} in ${store.path}.`);
    if (options.version && options.version !== stored.version)
      throw new UsageError(
        `Rollout ${stored.id} is for ${stored.version}, not ${options.version}.`,
      );
  }
  const version = stored?.version ?? options.version;
  const batchSize =
    options.batchSize ?? stored?.batchSize ?? DEFAULT_BATCH_SIZE;
  const failurePercent =
    options.failurePercent ?? stored?.failurePercent ?? DEFAULT_FAILURE_PERCENT;

  const cafes = await directory.list();
  const names = (id) => cafes.find((cafe) => cafe.id === id)?.name ?? id;
  const done = new Set(
    Object.entries(stored?.cafes ?? {})
      .filter(([, entry]) => entry.status === "done")
      .map(([id]) => id),
  );
  const support = await supportFor(ctx, cafes, version, now);
  const plan = planRollout(cafes, version, {
    batchSize,
    leaveOut: done,
    support,
  });
  const planned = plan.waves.flatMap((wave) => wave.batches.flat());

  const existing = await store.list();
  if (!stored) {
    const unfinished = existing.find(
      (r) => r.version === version && r.status !== "completed",
    );
    if (unfinished)
      log.warn(
        `rollout ${unfinished.id} of ${version} didn't finish (${unfinished.status}); this starts another. To carry on with that one instead: deployer rollout --resume ${unfinished.id} ${options.flags ?? ""}`.trim(),
      );
  }

  printPlan(ctx, { version, plan, state: stored, batchSize, failurePercent });
  if (dryRun) {
    log.blank();
    log.say("Dry run: nothing was deployed, and nothing was saved.");
    return { ok: true, plan };
  }
  if (planned.length === 0) {
    log.blank();
    log.say(`Nothing to roll out: no cafe needs ${version}.`);
  }

  // The state: finished cafes as they were, everything else as the plan has it.
  const started = now().toISOString();
  const taken = new Set(existing.map((r) => r.id));
  const state = {
    id: stored?.id ?? rolloutId(version, now(), (id) => taken.has(id)),
    version,
    status: "running",
    pausedBecause: null,
    batchSize,
    failurePercent,
    startedAt: stored?.startedAt ?? started,
    updatedAt: started,
    finishedAt: null,
    cafes: {},
  };
  for (const id of done) state.cafes[id] = stored.cafes[id];
  for (const wave of plan.waves)
    for (const cafe of wave.batches.flat())
      state.cafes[cafe.id] = {
        wave: wave.name,
        status: "pending",
        reason: null,
        attempts: stored?.cafes[cafe.id]?.attempts ?? 0,
        ...(cafe.forced && {
          forced: {
            from: cafe.forced.line,
            upgradeBy: new Date(cafe.forced.upgradeBy).toISOString(),
            reason: forcedReason(cafe.forced, version),
          },
        }),
      };
  for (const { cafe, reason } of plan.skipped)
    state.cafes[cafe.id] = { wave: null, status: "skipped", reason };

  const save = async () => {
    state.updatedAt = now().toISOString();
    await store.save(state);
  };
  await save();

  let ordinal = 0;
  let crossed = null;
  waves: for (const wave of plan.waves) {
    for (const [b, batch] of wave.batches.entries()) {
      log.step(
        wave.name === "canary"
          ? "Canary"
          : `${wave.name === "beta" ? "Beta" : "Stable"} cafes, batch ${b + 1} of ${wave.batches.length}`,
      );
      let failures = 0;
      for (const cafe of batch) {
        ordinal += 1;
        const entry = state.cafes[cafe.id];
        entry.status = "running";
        entry.attempts += 1;
        entry.startedAt = now().toISOString();
        await save();
        log.info(
          `${ordinal} of ${planned.length}: ${cafe.name} (${cafe.projectId}), ${cafe.release.current ?? "no release yet"} to ${version}`,
        );
        try {
          await ctx.deployCafe(cafe, {
            version,
            write: (line) => log.say(`      ${line}`),
          });
          entry.status = "done";
          entry.reason = null;
          log.change(`${cafe.name} runs ${version}`);
          if (cafe.forced)
            log.change(
              `${cafe.name} no longer stays on ${cafe.forced.line}: ${forcedReason(cafe.forced, version)}`,
            );
          try {
            await directory.recordRelease(cafe.id, {
              current: version,
              previous:
                cafe.release.current === version
                  ? cafe.release.previous
                  : cafe.release.current,
              // Staying on the old line would leave it without the new
              // line's patches.
              ...(cafe.forced && { pinned: parseVersion(version).line }),
            });
          } catch (error) {
            log.warn(
              `${cafe.name} is deployed, but the cafe list couldn't be updated (${error.message}); set its release.current to ${version}`,
            );
          }
        } catch (error) {
          failures += 1;
          const back =
            error instanceof SmokeTestError ? error.rolledBackTo : undefined;
          entry.status = back ? "rolled-back" : "failed";
          entry.reason = oneLine(error.message);
          if (back) entry.rolledBackTo = back;
          log.warn(
            back
              ? `${cafe.name} failed its smoke test and was rolled back to ${back}`
              : `${cafe.name} failed: ${entry.reason}`,
          );
        }
        entry.finishedAt = now().toISOString();
        await save();

        if (
          crossesThreshold(wave.name, {
            failures,
            size: batch.length,
            failurePercent,
          })
        ) {
          crossed =
            wave.name === "canary"
              ? `the canary ${cafe.name} failed`
              : `${failures} of ${batch.length} cafes in ${wave.name} batch ${b + 1} failed, which is more than ${failurePercent}%`;
          break waves;
        }
      }
    }
  }

  const left = Object.values(state.cafes).some((e) => e.status === "pending");
  state.pausedBecause = crossed;
  state.status = crossed && left ? "paused" : "completed";
  state.finishedAt = now().toISOString();
  await save();

  const flags = options.flags ?? "";
  printSummary(
    ctx,
    state,
    names,
    `deployer rollout --resume ${state.id} ${flags}`.trim(),
  );
  const bad = Object.values(state.cafes).some(
    (e) => e.status === "failed" || e.status === "rolled-back",
  );
  return { ok: state.status === "completed" && !bad, rollout: state };
}
