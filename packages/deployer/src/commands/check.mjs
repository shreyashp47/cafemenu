/**
 * `deployer check`: which of the permissions the other commands need does
 * the service account hold on this project? Changes nothing, so it behaves
 * the same with or without --dry-run.
 */
import { testPermissions } from "../apis/resourcemanager.mjs";
import { ActionNeededError, ApiError } from "../errors.mjs";
import {
  COMMANDS_WITH_PERMISSIONS,
  PERMISSIONS,
  permissionsFor,
} from "../permissions.mjs";

/**
 * Returns {ok, missing: {command: [{permission, why}]}}. Throws
 * ActionNeededError when the service account can't see the project at all.
 */
export async function check(
  ctx,
  { commands = COMMANDS_WITH_PERMISSIONS } = {},
) {
  const { api, log, project, clientEmail } = ctx;
  log.title(`Checking what ${clientEmail} may do in project ${project}`);

  let held;
  try {
    held = new Set(
      await testPermissions(api, project, permissionsFor(commands)),
    );
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.status === 403 || error.status === 404)
    ) {
      throw new ActionNeededError(
        `${clientEmail} has no access to project ${project}, or the project doesn't exist.`,
        {
          hint: `In the Firebase console for ${project}: Project settings → Users and permissions → Add member → ${clientEmail}.`,
        },
      );
    }
    if (error instanceof ApiError && error.status === 400) {
      // e.g. "Permission x.y.z is not valid": the list in permissions.mjs
      // names something Google doesn't know, which is a deployer bug.
      error.message +=
        " (A permission in src/permissions.mjs may be misspelt or retired.)";
    }
    throw error;
  }

  const missing = {};
  for (const command of commands) {
    log.step(command);
    const needed = PERMISSIONS[command];
    const gaps = needed
      .filter(([permission]) => !held.has(permission))
      .map(([permission, why]) => ({ permission, why }));
    if (gaps.length === 0) {
      log.same(`all ${needed.length} permissions`);
      continue;
    }
    missing[command] = gaps;
    for (const { permission, why } of gaps)
      log.warn(`missing ${permission} (to ${why})`);
  }

  const count = new Set(
    Object.values(missing).flatMap((gaps) => gaps.map((g) => g.permission)),
  ).size;
  log.blank();
  log.say(
    count === 0
      ? "Everything the deployer needs is granted."
      : `${count} permission${count === 1 ? " is" : "s are"} missing. Grant a role that includes ${count === 1 ? "it" : "them"} and re-run.`,
  );
  return { ok: count === 0, missing };
}
