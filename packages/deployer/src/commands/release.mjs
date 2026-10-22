/**
 * `deployer deploy --version` and `deployer sync-branding`: a CafeMenu
 * release, or just the cafe's own files, onto one cafe's project.
 *
 * deploy, in the order PLAN.md gives:
 *
 *   package     download (or take) the release package and verify it
 *   migrations  check the data's schema, then migrate it (#21)
 *   rules       the package's firestore.rules
 *   indexes     the package's firestore.indexes.json
 *   settings    config/site: the cafe's settings, which the rules read and
 *               which win over site.json in the app, so they must agree
 *   hosting     the package's site/ with the cafe's site.json, manifest,
 *               logo and icons laid over it, and its firebase.json headers
 *   smoke       the smoke test (#22)
 *   record      current/previous in the deploy log
 *
 * Every step compares with what is live and skips itself when nothing would
 * change, so a run that failed part way is finished by running it again.
 */
import { listVersionFiles, getLiveRelease } from "../apis/hosting.mjs";
import {
  decodeFields,
  encodeFields,
  getDocument,
  patchDocument,
} from "../apis/firestore.mjs";
import {
  cafeFiles,
  cafePaths,
  loadShared,
  readCafeInput,
} from "../cafe-files.mjs";
import { stepTracker } from "../deploy-log.mjs";
import { ActionNeededError, UsageError } from "../errors.mjs";
import {
  hostingFile,
  isIgnored,
  readHostingConfig,
} from "../hosting-files.mjs";
import { readDataSchema, runMigrations } from "../migrations.mjs";
import { VerifyError, getPackage, packageText } from "../release-package.mjs";
import { smokeTest } from "../smoke-test.mjs";
import { act, shortName } from "./act.mjs";
import {
  canonical,
  deployHostingFiles,
  deployIndexesText,
  deployRulesSource,
} from "./deploy.mjs";

export const SETTINGS_DOC = "config/site";

const byPath = (a, b) => (a.path < b.path ? -1 : 1);
const nowIso = (ctx) => (ctx.now?.() ?? new Date()).toISOString();

/** The project's record in the deploy log, after checking it is for this site. */
export async function cafeRecord(ctx, site) {
  const record = await ctx.deployLog.get(ctx.project);
  if (record && record.site !== site) {
    throw new UsageError(
      `${ctx.project}'s releases went to the site ${record.site}, not ${site}.`,
    );
  }
  return record;
}

/**
 * Appends the run's Deployment (and the new CafeRecord, if any) to the log;
 * in a dry run, only says what it would record.
 */
async function record(ctx, { deployment, cafe, would, done }) {
  if (ctx.dryRun) {
    ctx.log.step("Deploy log");
    ctx.log.change(would);
    return;
  }
  await ctx.deployLog.record({ deployment, cafe });
  if (done) {
    ctx.log.step("Deploy log");
    ctx.log.change(done);
  }
}

/**
 * Records a failed run without hiding why it failed: a log that can't be
 * written is a warning here, not the error.
 */
async function recordFailure(ctx, args) {
  if (ctx.dryRun) return;
  try {
    await ctx.deployLog.record(args);
  } catch (error) {
    ctx.log.warn(
      `couldn't record the failure in the deploy log: ${error.message}`,
    );
  }
}

// --- config/site -------------------------------------------------------------

/** Makes config/site hold exactly `settings`' fields, unless it already does. */
export async function writeCafeSettings(ctx, shared, settings) {
  const { api, log, project } = ctx;
  log.step(`Cafe settings (${SETTINGS_DOC})`);
  const keys = [...shared.SETTINGS_KEYS];
  const doc = await getDocument(api, project, SETTINGS_DOC);
  const live = doc ? decodeFields(doc.fields) : null;
  if (live) {
    const changed = keys.filter(
      (key) => canonical(live[key]) !== canonical(settings[key]),
    );
    if (changed.length === 0) {
      log.same(`already holds these settings ("${settings.name}")`);
      return { changed: false };
    }
    await act(
      ctx,
      {
        would: `would update ${changed.join(", ")}`,
        done: `updated ${changed.join(", ")}`,
      },
      () =>
        patchDocument(api, project, SETTINGS_DOC, encodeFields(settings), keys),
    );
  } else {
    await act(
      ctx,
      {
        would: `would write the settings ("${settings.name}")`,
        done: `wrote the settings ("${settings.name}")`,
      },
      () =>
        patchDocument(api, project, SETTINGS_DOC, encodeFields(settings), keys),
    );
  }
  return { changed: true };
}

// --- Hosting -----------------------------------------------------------------

/** `files` without the cafe's paths, plus the cafe's own files, sorted. */
function withCafeFiles(files, paths, own) {
  return [
    ...files.filter((f) => !paths.has(f.path)),
    ...own.map((f) => hostingFile(f.path, f.bytes)),
  ].sort(byPath);
}

/** The package's site/ as Hosting files, honouring its firebase.json's ignore list. */
async function packageSite(verified) {
  const { config, ignore } = await readHostingConfig(
    "firebase.json",
    undefined,
    {
      read: async () => packageText(verified, "firebase.json"),
    },
  );
  const files = [];
  for (const [path, bytes] of verified.files) {
    if (!path.startsWith("site/")) continue;
    const rel = path.slice("site/".length);
    if (!isIgnored(rel, ignore)) files.push(hostingFile(`/${rel}`, bytes));
  }
  return { config, files };
}

// --- deploy ------------------------------------------------------------------

const DEPLOY_STEPS = [
  ["package", "Fetch and verify the release package"],
  ["migrations", "Migrate the cafe's data"],
  ["rules", "Firestore rules"],
  ["indexes", "Firestore indexes"],
  ["settings", "Cafe settings"],
  ["hosting", "Hosting"],
  ["smoke", "Smoke test"],
];

export async function deployRelease(ctx, options) {
  const { log, project, dryRun } = ctx;
  const { site, version } = options;
  log.title(`Deploying CafeMenu ${version} to ${site}.web.app (${project})`);

  const shared = await (ctx.loadShared ?? loadShared)();
  const input = await readCafeInput(
    shared,
    { settingsPath: options.settings, logoPath: options.logo },
    ctx.readFile,
  );
  const before = await cafeRecord(ctx, site);
  const fromVersion = before?.current?.version ?? null;
  log.info(
    fromVersion
      ? `current release: ${fromVersion}${before.previous ? `, previous ${before.previous.version}` : ""}`
      : "no release recorded for this cafe yet",
  );

  const steps = stepTracker(DEPLOY_STEPS);
  const deployment = {
    project,
    site,
    kind: "deploy",
    version,
    fromVersion,
    steps: steps.steps,
    createdAt: nowIso(ctx),
  };
  const paths = cafePaths(shared);
  const floor = before?.schemaFloor ?? 1;
  let release = null;

  try {
    const verified = await steps.run("package", async () => {
      try {
        return await getPackage(ctx, {
          version,
          packagePath: options.package,
          sha256: options.sha256,
        });
      } catch (error) {
        if (!(error instanceof VerifyError)) throw error;
        throw new ActionNeededError(error.message, {
          hint: "Nothing was deployed. Don't use this package: download it again, or check the release on GitHub.",
        });
      }
    });
    const { manifest } = verified;

    await steps.run("migrations", async () => {
      log.step("Data schema");
      const data = await readDataSchema(ctx);
      if (manifest.minSchemaVersion > data) {
        throw new ActionNeededError(
          `${version} needs the release live during its upgrade to run on schema ${manifest.minSchemaVersion} or later, but this cafe's data is at schema ${data}.`,
          {
            hint: "Deploy a release in between first, so the data reaches that schema.",
          },
        );
      }
      if (manifest.schemaVersion < floor) {
        throw new ActionNeededError(
          `${version} runs on schema ${manifest.schemaVersion}, but this cafe's data has been migrated past what it can read (its releases need schema ${floor} or later).`,
          { hint: "Deploy a newer release." },
        );
      }
      log.same(
        `${version} (schema ${manifest.schemaVersion}, min ${manifest.minSchemaVersion}) can deploy onto data at schema ${data}`,
      );
      return runMigrations(ctx, { manifest, from: data });
    });

    const rules = await steps.run("rules", () =>
      deployRulesSource(
        ctx,
        "firestore.rules",
        packageText(verified, "firestore.rules"),
      ),
    );
    await steps.run("indexes", () =>
      deployIndexesText(
        ctx,
        packageText(verified, "firestore.indexes.json"),
        "firestore.indexes.json",
      ),
    );
    await steps.run("settings", () =>
      writeCafeSettings(ctx, shared, input.settings),
    );

    const hosting = await steps.run("hosting", async () => {
      log.step(`Hosting ${site}.web.app`);
      const { config, files: built } = await packageSite(verified);
      const own = cafeFiles(shared, input);
      const files = withCafeFiles(built, paths, own);
      log.info(
        `${files.length - own.length} files from the package, ${own.length} of the cafe's own (${own.map((f) => f.path).join(", ")})`,
      );
      return deployHostingFiles(ctx, {
        site,
        files,
        config,
        message: `CafeMenu ${version}`,
      });
    });
    if (!dryRun) {
      release = {
        version,
        schemaVersion: manifest.schemaVersion,
        minSchemaVersion: manifest.minSchemaVersion,
        sha256: verified.sha256,
        hostingVersion: hosting.versionName,
        rulesetName: rules.rulesetName,
        cafePaths: [...paths].sort(),
        deployedAt: nowIso(ctx),
      };
    }

    await steps.run("smoke", () => smokeTest(ctx, { site, version }));
  } catch (error) {
    // Once the site is live it runs this release, finished or not, so it is
    // recorded as current: `deployer rollback` then goes back to the one before.
    await recordFailure(ctx, {
      deployment: { ...deployment, status: "failed", error: error.message },
      cafe: release ? nextRecord(before, site, release) : undefined,
    });
    if (release) {
      error.message += ` (${version} is live and recorded as current; \`deployer rollback\` goes back to ${fromVersion ?? "nothing: there was no release before it"}.)`;
    }
    throw error;
  }

  const previous =
    fromVersion === version ? before?.previous?.version : fromVersion;
  await record(ctx, {
    deployment: { ...deployment, status: "succeeded", error: null },
    cafe: release ? nextRecord(before, site, release) : undefined,
    would: `would record ${version} as current (previous: ${previous ?? "none"})`,
    done: `recorded ${version} as current (previous: ${previous ?? "none"}) in ${ctx.deployLog.path ?? "the deploy log"}`,
  });
  log.blank();
  log.say(
    dryRun
      ? `Dry run: ${log.changes.length} change(s) would be made.`
      : `Done: ${site}.web.app runs CafeMenu ${version}.`,
  );
  return { release, changes: log.changes };
}

/** The cafe's record once `release` is live. Redeploying the current version keeps its previous. */
function nextRecord(before, site, release) {
  const same = before?.current?.version === release.version;
  return {
    site,
    current: release,
    previous: same ? (before?.previous ?? null) : (before?.current ?? null),
    schemaFloor: Math.max(before?.schemaFloor ?? 1, release.minSchemaVersion),
  };
}

// --- sync-branding -----------------------------------------------------------

/**
 * `deployer sync-branding`: the cafe's settings into config/site, and its
 * own files (site.json, manifest, logo, icons) on top of the files the live
 * Hosting version already serves. The release doesn't change.
 */
export async function syncBranding(ctx, options) {
  const { api, log, project, dryRun } = ctx;
  const { site } = options;
  log.title(`Syncing the cafe's branding to ${site}.web.app (${project})`);

  const shared = await (ctx.loadShared ?? loadShared)();
  const input = await readCafeInput(
    shared,
    { settingsPath: options.settings, logoPath: options.logo },
    ctx.readFile,
  );
  const before = await cafeRecord(ctx, site);
  const version = before?.current?.version ?? null;
  const steps = stepTracker([
    ["settings", "Cafe settings"],
    ["hosting", "Hosting"],
  ]);
  const deployment = {
    project,
    site,
    kind: "branding",
    version,
    fromVersion: version,
    steps: steps.steps,
    createdAt: nowIso(ctx),
  };

  let hosting;
  try {
    await steps.run("settings", () =>
      writeCafeSettings(ctx, shared, input.settings),
    );
    hosting = await steps.run("hosting", async () => {
      log.step(`Hosting ${site}.web.app`);
      const live = await getLiveRelease(api, site);
      if (!live?.version?.name) {
        throw new ActionNeededError(`${site} has nothing live to brand yet.`, {
          hint: "Deploy a release first: deployer deploy --version <x.y.z>.",
        });
      }
      const liveId = shortName(live.version.name);
      if (
        before?.current &&
        before.current.hostingVersion !== live.version.name
      ) {
        log.warn(
          `live version ${liveId} isn't the one recorded for ${version} (${shortName(before.current.hostingVersion)}); branding the live one`,
        );
      }
      const liveFiles = (await listVersionFiles(api, live.version.name)).map(
        ({ path, hash }) => ({ path, hash }),
      );
      const own = cafeFiles(shared, input);
      const paths = cafePaths(shared);
      const files = withCafeFiles(liveFiles, paths, own);
      log.info(
        `keeping ${files.length - own.length} files of version ${liveId}, with ${own.length} of the cafe's own`,
      );
      return deployHostingFiles(ctx, {
        site,
        files,
        config: live.version.config ?? {},
        message: `Branding${version ? ` on CafeMenu ${version}` : ""}`,
      });
    });
  } catch (error) {
    await recordFailure(ctx, {
      deployment: { ...deployment, status: "failed", error: error.message },
    });
    throw error;
  }

  const changed = log.changes.length;
  const cafe =
    before?.current && hosting.versionName && !dryRun
      ? {
          ...before,
          current: { ...before.current, hostingVersion: hosting.versionName },
        }
      : undefined;
  await record(ctx, {
    deployment: { ...deployment, status: "succeeded", error: null },
    cafe,
    would: "would record the branding sync",
    done: version
      ? `recorded the branding sync on ${version}`
      : "recorded the branding sync",
  });
  log.blank();
  log.say(
    changed === 0
      ? "Nothing to change: the branding is already live."
      : dryRun
        ? `Dry run: ${log.changes.length} change(s) would be made.`
        : `Done: ${site}.web.app has the cafe's current branding.`,
  );
  return { hosting, changes: log.changes };
}
