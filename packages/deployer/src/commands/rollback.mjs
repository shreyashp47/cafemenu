/**
 * `deployer rollback`: make the site serve the version it served before the
 * current one. Hosting keeps old versions, so this is one release call and
 * takes effect at once. Rules are not rolled back here: in Phase 2 that
 * comes from the previous release package.
 *
 * "Before the current one" means before the live version *first* went live,
 * so rolling back twice steps back twice instead of flipping between two
 * versions. To retry one specific rollback safely, pass --to <version>: if
 * that version is already live, nothing happens.
 */
import { createRelease, listLiveReleases } from "../apis/hosting.mjs";
import { ActionNeededError } from "../errors.mjs";
import { act, shortName } from "./act.mjs";

export async function rollback(ctx, { site, to }) {
  const { api, log } = ctx;
  log.title(`Rolling back ${site}.web.app`);
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
