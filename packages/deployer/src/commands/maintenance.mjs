/**
 * `deployer maintenance`: the admin's maintenance mode for a cafe's site
 * (#78, docs/super-admin-requirements.md section 3.4). It writes one field,
 * `maintenance` in the cafe's config/site, which:
 *
 *   - the cafe's site reads live, so customers see the "back soon" page
 *     within seconds, with no redeploy;
 *   - the cafe's firestore.rules read on every new order, refusing it while
 *     maintenance is in effect (between `startsAt` and `endsAt`, by the
 *     server's clock);
 *   - no browser may write, the owner included, so an owner can't clear an
 *     admin's maintenance (theirs is config/ownerMaintenance);
 *   - deploys, branding syncs and rollbacks leave alone: they write only the
 *     settings' own fields of config/site, so maintenance survives updates.
 *
 * `maintenance` is the record from @cafemenu/shared/maintenance
 * (maintenanceRecord, with Dates), or null to turn it off. Safe to repeat:
 * a record already there is left as it is.
 */
import { readMaintenance } from "@cafemenu/shared/maintenance";

import {
  decodeFields,
  encodeFields,
  getDocument,
  patchDocument,
} from "../apis/firestore.mjs";
import { ActionNeededError } from "../errors.mjs";
import { act } from "./act.mjs";

const SITE_DOC = "config/site";

/** The same maintenance, for "already as asked": what customers and the rules see. */
const sameMaintenance = (a, b) =>
  JSON.stringify(readMaintenance(a)) === JSON.stringify(readMaintenance(b));

export async function maintenance(ctx, { maintenance: record }) {
  const { api, log, project } = ctx;
  const on = record !== null;
  log.title(`Maintenance ${on ? "on" : "off"} for ${project}`);
  log.step("Maintenance");

  const doc = await getDocument(api, project, SITE_DOC);
  if (!doc) {
    throw new ActionNeededError(
      `${project} has no config/site: CafeMenu hasn't been deployed to it.`,
      { hint: "Deploy a release to the cafe first." },
    );
  }
  const live = decodeFields(doc.fields).maintenance ?? null;
  if (sameMaintenance(live, record)) {
    log.same(on ? "already on, as asked" : "already off");
    return { changed: false };
  }
  await act(
    ctx,
    {
      would: on ? "would turn maintenance on" : "would turn maintenance off",
      done: on ? "turned maintenance on" : "turned maintenance off",
    },
    () =>
      patchDocument(
        api,
        project,
        SITE_DOC,
        encodeFields({ maintenance: record }),
        ["maintenance"],
      ),
  );
  return { changed: true };
}
