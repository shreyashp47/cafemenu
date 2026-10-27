/**
 * Who is emailed what, and when. Two triggers feed it (index.mjs):
 *
 *   a `releases/{version}` write      → release-available, upgrade-required
 *   a `deployments/{id}` update       → deploy-failed
 *
 * The email kinds and what is in them are in templates.mjs. Three rules:
 *
 *   - Essential emails (a failed deploy, an upgrade that is required) always
 *     go. The others go only to a cafe whose owner hasn't unsubscribed
 *     (`cafes/{id}.emails.releaseNotices === false`), and only when there is
 *     an unsubscribe link to put in them.
 *   - An email is sent once per cafe per thing it is about: `claimMail`
 *     records a key such as `deploy-failed:<deployment id>` before sending,
 *     so Cloud Functions delivering an event twice, or a later release write
 *     re-checking the same cafes, sends nothing twice. A send that fails
 *     gives its key back, so the next write tries again.
 *   - One cafe's trouble (no email address, the provider refusing) never
 *     stops the others: every outcome is returned, and logged.
 */
import { compareVersions } from "@cafemenu/deployer";
import {
  compareLines,
  lineSupport,
  stableLineOf,
  supportWindow,
} from "@cafemenu/shared/support-window";

import { EMAIL_KINDS, renderEmail } from "./templates.mjs";
import { eligibleReleases } from "../versions.mjs";

/** A published, stable release: the kind that gets announced. */
const isAnnounced = (release) =>
  Boolean(release) &&
  release.withdrawn !== true &&
  release.channel === "stable" &&
  stableLineOf(release.version) !== null;

const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

export const FAILED_STATUSES = ["failed", "rolled-back"];

const newResult = () => ({ sent: [], skipped: [], failed: [] });

/**
 * Sends one email to a cafe's owner, once. `data` is what the template needs,
 * apart from the cafe's name and the links, which are added here.
 */
async function deliver(env, cafe, { kind, key, data }, result) {
  const { log } = env;
  const about = { cafe: cafe.id, kind, key };
  try {
    const why = await send(env, cafe, { kind, key, data }, about);
    if (why) {
      log("info", `Email not sent: ${why}`, about);
      result.skipped.push({ cafe: cafe.id, kind, why });
    } else {
      result.sent.push({ cafe: cafe.id, kind });
    }
  } catch (error) {
    log("error", `Email failed: ${error.message}`, about);
    result.failed.push({ cafe: cafe.id, kind, error: error.message });
  }
}

/** Sends it; returns why it wasn't sent, or null when it was. Throws when the send fails. */
async function send(env, cafe, { kind, key, data }, about) {
  const { store, mail, log } = env;
  const { essential } = EMAIL_KINDS[kind];

  if (!essential && cafe.emails?.releaseNotices === false) {
    return "the owner unsubscribed";
  }
  if (!essential && !mail.unsubscribeUrl) {
    return "UNSUBSCRIBE_URL isn't set, and these emails need the link";
  }
  const to = await store.getOwnerEmail(cafe.ownerUid, cafe.ownerEmail);
  if (!to) return "the owner has no email address";

  let unsubscribeUrl = null;
  let headers;
  if (!essential) {
    const token = await store.ensureMailToken(cafe.id);
    unsubscribeUrl = `${mail.unsubscribeUrl}?c=${encodeURIComponent(cafe.id)}&t=${encodeURIComponent(token)}`;
    headers = {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    };
  }
  const email = renderEmail(kind, {
    ...data,
    cafeName: cafe.settings?.name || cafe.site,
    updatesUrl: mail.consoleUrl ? `${mail.consoleUrl}/cafe/#updates` : null,
    unsubscribeUrl,
  });

  if (!(await store.claimMail(cafe.id, key, env.now()))) {
    return "already sent";
  }
  try {
    const { id } = await mail.sender.send({ to, ...email, headers });
    log("info", `Email sent: ${email.subject}`, { ...about, id });
    return null;
  } catch (error) {
    // Give the claim back, so the next write tries again.
    await store.unclaimMail(cafe.id, key);
    throw error;
  }
}

/**
 * A `releases/{version}` was written (`before`/`after` are the document's
 * data, null when it didn't exist). Looks at every live cafe that stays on a
 * minor line:
 *
 *   - on a line the support window has dropped, and its date not yet come:
 *     upgrade-required, once per line and date;
 *   - on a supported line, when this release has just been announced (newly
 *     stable, not withdrawn) and is on a newer line: release-available.
 *     A patch of its own line isn't announced: it is applied by itself.
 */
export async function notifyRelease(env, { before, after }) {
  const result = newResult();
  if (!after) return result;
  const releases = await env.store.listReleases();
  const window = supportWindow(releases);
  const now = env.now();
  const newest = eligibleReleases(releases, "stable")[0]?.version ?? null;
  const announce = isAnnounced(after) && !isAnnounced(before);
  const line = stableLineOf(after.version);

  for (const cafe of await env.store.listPinnedCafes()) {
    const pinned = cafe.release.pinned;
    const standing = lineSupport(window, pinned, now);
    if (!standing.supported) {
      if (standing.upgradeBy !== null && !standing.due) {
        await deliver(
          env,
          cafe,
          {
            kind: "upgrade-required",
            key: `upgrade-required:${pinned}:${dayKey(standing.upgradeBy)}`,
            data: {
              line: pinned,
              supported: window.supported,
              newestVersion: newest,
              upgradeBy: standing.upgradeBy,
              daysLeft: standing.daysLeft,
            },
          },
          result,
        );
      }
      continue;
    }
    const newer =
      announce &&
      compareLines(line, pinned) > 0 &&
      (!cafe.release.current ||
        compareVersions(after.version, cafe.release.current) > 0);
    if (newer) {
      await deliver(
        env,
        cafe,
        {
          kind: "release-available",
          key: `release-available:${after.version}`,
          data: { version: after.version, line, pinnedLine: pinned },
        },
        result,
      );
    }
  }
  return result;
}

/**
 * A `deployments/{id}` was updated. When it has just ended as failed or
 * rolled back, its cafe's owner is told. The worker writes a deployment many
 * times as it goes, so everything but that one change is ignored.
 */
export async function notifyDeployment(env, { id, before, after }) {
  const result = newResult();
  if (!after || !FAILED_STATUSES.includes(after.status)) return result;
  if (before && before.status === after.status) return result;
  const cafe = await env.store.getCafe(after.cafeId);
  if (!cafe) return result;
  await deliver(
    env,
    cafe,
    {
      kind: "deploy-failed",
      key: `deploy-failed:${id}`,
      data: {
        kind: after.kind,
        version: after.version ?? null,
        fromVersion: after.fromVersion ?? null,
        status: after.status,
        error: after.error ?? null,
      },
    },
    result,
  );
  return result;
}
