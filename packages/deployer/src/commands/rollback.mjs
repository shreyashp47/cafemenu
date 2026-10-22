/**
 * `deployer rollback`: go back to the release before the current one.
 *
 * With a release recorded in the deploy log (by `deployer deploy --version`),
 * that is the previous release's rules and its Hosting files, refused if the
 * cafe's data has been migrated past what that release can read. The cafe's
 * own files (site.json, manifest, logo, icons) stay the ones live now, so a
 * rollback never brings back old branding: when they differ from the old
 * version's, a new version of the old files with today's branding goes live;
 * otherwise the old version itself is released again. Rolling back clears
 * "previous", so a second rollback refuses instead of going forward again.
 *
 * Without a recorded release, or with --to, only Hosting rolls back, to the
 * version it served before the current one. "Before the current one" means
 * before the live version *first* went live, so rolling back twice steps
 * back twice instead of flipping between two versions. To retry one specific
 * rollback safely, pass --to <version>: if that version is already live,
 * nothing happens.
 */
import {
  createRelease,
  getLiveRelease,
  getVersion,
  listLiveReleases,
  listVersionFiles,
} from "../apis/hosting.mjs";
import {
  FIRESTORE_RELEASE,
  getRelease,
  getRuleset,
  updateRelease,
} from "../apis/rules.mjs";
import { stepTracker } from "../deploy-log.mjs";
import { ActionNeededError } from "../errors.mjs";
import { readDataSchema } from "../migrations.mjs";
import { act, shortName } from "./act.mjs";
import { deployHostingFiles } from "./deploy.mjs";
import { cafeRecord } from "./release.mjs";

export async function rollback(ctx, { site, to }) {
  const record = ctx.deployLog ? await cafeRecord(ctx, site) : null;
  if (record?.current && !to) return rollbackRelease(ctx, site, record);
  let note = null;
  if (record?.current) {
    note = `--to rolls back Hosting only; the deploy log keeps ${record.current.version} as current`;
  } else if (ctx.deployLog) {
    note = `no release is recorded for ${ctx.project} in ${ctx.deployLog.path ?? "the deploy log"}, so only Hosting rolls back`;
  }
  return rollbackHosting(ctx, { site, to, note });
}

async function rollbackHosting(ctx, { site, to, note }) {
  const { api, log } = ctx;
  log.title(`Rolling back ${site}.web.app`);
  if (note) log.warn(note);
  log.step("Hosting releases");

  const releases = (await listLiveReleases(api, site)).filter(
    (r) => r.version?.name && r.type !== "SITE_DISABLE",
  );
  if (releases.length === 0) {
    throw new ActionNeededError(
      `${site} has no releases, so there is nothing to roll back.`,
    );
  }
  const liveVersion = releases[0].version.name;
  log.info(
    `live: version ${shortName(liveVersion)}, released ${releases[0].releaseTime ?? "(time unknown)"}`,
  );

  let target;
  if (to) {
    const wanted = to.includes("/") ? to : `sites/${site}/versions/${to}`;
    if (wanted === liveVersion) {
      log.same(`version ${shortName(wanted)} is already live`);
      return { changed: false, versionName: wanted };
    }
    target = releases.find((r) => r.version.name === wanted);
    if (!target) {
      throw new ActionNeededError(
        `Version ${to} isn't among the ${releases.length} releases Hosting has kept for ${site}.`,
        { hint: "Run without --to to go back one release." },
      );
    }
  } else {
    // releases is newest first, so the live version's first release is the
    // last one that names it; the target is the next older, different one.
    const firstLive = releases.findLastIndex(
      (r) => r.version.name === liveVersion,
    );
    target = releases
      .slice(firstLive + 1)
      .find((r) => r.version.name !== liveVersion);
    if (!target) {
      throw new ActionNeededError(
        `Nothing to roll back to: ${site} has only ever served version ${shortName(liveVersion)} (of the releases Hosting keeps).`,
      );
    }
  }

  const targetId = shortName(target.version.name);
  if (target.version.status && target.version.status !== "FINALIZED") {
    throw new ActionNeededError(
      `Version ${targetId} is ${target.version.status} and can't be released again.`,
    );
  }
  await act(
    ctx,
    {
      would: `would make version ${targetId} live again (released ${target.releaseTime ?? "earlier"})`,
      done: `version ${targetId} is live again`,
    },
    () =>
      createRelease(
        api,
        site,
        target.version.name,
        `Rollback to ${targetId} by the CafeMenu deployer`,
      ),
  );
  log.info(`To repeat exactly this rollback safely: --to ${targetId}`);
  return {
    changed: !ctx.dryRun,
    versionName: target.version.name,
    from: liveVersion,
  };
}

// --- A recorded release ------------------------------------------------------

async function rollbackRelease(ctx, site, record) {
  const { api, log, project, dryRun } = ctx;
  const { current, previous } = record;
  if (!previous) {
    throw new ActionNeededError(
      `Nothing to roll back to: no release before ${current.version} is recorded for ${project}.`,
      {
        hint: current.rolledBackFrom
          ? `${current.version} is already a rollback (from ${current.rolledBackFrom}); a rollback can't be rolled back. Deploy a version instead: deployer deploy --version <x.y.z>.`
          : "Deploy a version instead: deployer deploy --version <x.y.z>.",
      },
    );
  }
  log.title(
    `Rolling back ${site}.web.app (${project}) from ${current.version} to ${previous.version}`,
  );
  const steps = stepTracker([
    ["schema", "Check the data's schema"],
    ["rules", "Firestore rules"],
    ["hosting", "Hosting"],
  ]);
  const deployment = {
    project,
    site,
    kind: "rollback",
    version: previous.version,
    fromVersion: current.version,
    steps: steps.steps,
    createdAt: (ctx.now?.() ?? new Date()).toISOString(),
  };

  let hosting;
  try {
    await steps.run("schema", async () => {
      log.step("Data schema");
      const data = await readDataSchema(ctx);
      const floor = Math.max(record.schemaFloor ?? 1, current.minSchemaVersion);
      if (previous.schemaVersion < floor) {
        throw new ActionNeededError(
          `${previous.version} runs on schema ${previous.schemaVersion}, but this cafe's data (schema ${data}) has been migrated past it: its releases need schema ${floor} or later.`,
          {
            hint: "Rolling back would break the cafe. Deploy a fixed release instead.",
          },
        );
      }
      log.same(
        `${previous.version} (schema ${previous.schemaVersion}) still runs on data at schema ${data} (oldest schema that does: ${floor})`,
      );
    });

    await steps.run("rules", async () => {
      log.step("Firestore rules");
      const live = await getRelease(api, project, FIRESTORE_RELEASE);
      const id = shortName(previous.rulesetName);
      if (live?.rulesetName === previous.rulesetName) {
        log.same(`${previous.version}'s rules (ruleset ${id}) are live`);
        return;
      }
      const ruleset = await getRuleset(api, previous.rulesetName, {
        notFound: null,
      });
      if (!ruleset) {
        throw new ActionNeededError(
          `${previous.version}'s rules (ruleset ${id}) no longer exist in ${project}.`,
          {
            hint: `Deploy it instead: deployer deploy --version ${previous.version}.`,
          },
        );
      }
      await act(
        ctx,
        {
          would: `would make ${previous.version}'s rules (ruleset ${id}) live again`,
          done: `${previous.version}'s rules (ruleset ${id}) are live again`,
        },
        () =>
          updateRelease(api, project, FIRESTORE_RELEASE, previous.rulesetName),
      );
    });

    hosting = await steps.run("hosting", () =>
      rollbackHostingFiles(ctx, site, record),
    );
  } catch (error) {
    if (!dryRun) {
      try {
        await ctx.deployLog.record({
          deployment: { ...deployment, status: "failed", error: error.message },
        });
      } catch (logError) {
        log.warn(
          `couldn't record the failure in the deploy log: ${logError.message}`,
        );
      }
    }
    throw error;
  }

  const cafe = {
    ...record,
    current: {
      ...previous,
      hostingVersion: hosting.versionName,
      rolledBackFrom: current.version,
    },
    previous: null,
  };
  log.step("Deploy log");
  await act(
    ctx,
    {
      would: `would record ${previous.version} as current, with no previous`,
      done: `recorded ${previous.version} as current, with no previous`,
    },
    () =>
      ctx.deployLog.record({
        deployment: { ...deployment, status: "succeeded", error: null },
        cafe,
      }),
  );
  log.blank();
  log.say(
    dryRun
      ? `Dry run: ${log.changes.length} change(s) would be made.`
      : `Done: ${site}.web.app runs CafeMenu ${previous.version} again.`,
  );
  return { changed: !dryRun, version: previous.version, from: current.version };
}

/**
 * The previous release's files with the cafe's own files as they are live
 * now. Releases the previous version again when that is what it already
 * serves; otherwise makes a version of them (no uploads: Hosting has every
 * file already).
 */
async function rollbackHostingFiles(ctx, site, { current, previous }) {
  const { api, log } = ctx;
  log.step(`Hosting ${site}.web.app`);
  const target = previous.hostingVersion;
  const live = await getLiveRelease(api, site);
  const liveName = live?.version?.name;
  const own = new Set([
    ...(current.cafePaths ?? []),
    ...(previous.cafePaths ?? []),
  ]);
  const files = (list) => list.map(({ path, hash }) => ({ path, hash }));
  const old = files(await listVersionFiles(api, target));
  const liveFiles = liveName
    ? files(await listVersionFiles(api, liveName))
    : [];
  const wanted = [
    ...old.filter((f) => !own.has(f.path)),
    ...liveFiles.filter((f) => own.has(f.path)),
  ].sort((a, b) => (a.path < b.path ? -1 : 1));
  const sameAsOld =
    wanted.length === old.length &&
    wanted.every((f, i) => f.path === old[i].path && f.hash === old[i].hash);

  if (!sameAsOld) {
    log.info(
      `the cafe's own files changed since ${previous.version} went live; keeping today's with ${previous.version}'s files`,
    );
    const { config } = await getVersion(api, target);
    return deployHostingFiles(ctx, {
      site,
      files: wanted,
      config: config ?? {},
      message: `Rollback to CafeMenu ${previous.version}`,
    });
  }
  const id = shortName(target);
  if (liveName === target) {
    log.same(`version ${id} (${previous.version}) is live`);
    return { changed: false, versionName: target };
  }
  await act(
    ctx,
    {
      would: `would make version ${id} (${previous.version}) live again`,
      done: `version ${id} (${previous.version}) is live again`,
    },
    () =>
      createRelease(
        api,
        site,
        target,
        `Rollback to CafeMenu ${previous.version}`,
      ),
  );
  return { changed: true, versionName: target };
}
