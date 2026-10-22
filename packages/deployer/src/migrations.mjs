/**
 * The cafe's data schema, and the hook that migrates it during a deploy.
 *
 * Each cafe's Firestore keeps its schema version at config/meta.schemaVersion
 * (migrations/README.md). Schema 1 is TOE's data as it is, so a cafe without
 * that document is at 1.
 */
import { decodeFields, getDocument } from "./apis/firestore.mjs";
import { ActionNeededError } from "./errors.mjs";

export const META_DOC = "config/meta";

/** The schema version of the cafe's data: config/meta.schemaVersion, or 1 without one. */
export async function readDataSchema(ctx) {
  const doc = await getDocument(ctx.api, ctx.project, META_DOC);
  const version = doc ? decodeFields(doc.fields).schemaVersion : undefined;
  if (version === undefined) {
    ctx.log.info(
      `data schema 1 (${META_DOC} has no schemaVersion: TOE's data as it is)`,
    );
    return 1;
  }
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new ActionNeededError(
      `${META_DOC}.schemaVersion is ${JSON.stringify(version)}, not a schema version.`,
      { hint: "Fix the document by hand before deploying." },
    );
  }
  ctx.log.info(`data schema ${version} (${META_DOC})`);
  return version;
}

/**
 * Brings the cafe's data from schema `from` to `manifest.schemaVersion` with
 * the package's migrations/NNNN-*.mjs, then records the new version in
 * config/meta. Runs before the rules and the site that need the new schema.
 *
 * TODO(#21): the runner. Until it exists this runs nothing: a package whose
 * schema is above the data's is refused rather than deployed onto data it
 * doesn't expect.
 */
export async function runMigrations(ctx, { manifest, from }) {
  ctx.log.step("Migrations");
  if (from >= manifest.schemaVersion) {
    ctx.log.same(
      `data is at schema ${from}; ${manifest.version} needs ${manifest.schemaVersion}, so nothing to migrate`,
    );
    return { ran: [] };
  }
  throw new ActionNeededError(
    `${manifest.version} needs data at schema ${manifest.schemaVersion}, but this cafe's is at ${from}, and the deployer can't run migrations yet.`,
    {
      hint: "Migrations come with #21; until then deploy a release at the cafe's schema.",
    },
  );
}
