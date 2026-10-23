/**
 * `deployer migrate`: brings a cafe's data to a schema version outside a
 * deploy, with the migrations in the repository's migrations/ folder (so run
 * it from a checkout of the release you are about to deploy).
 *
 * `deploy --version` runs migrations itself, but only those the release live
 * during the upgrade can run alongside: a release whose minSchemaVersion is
 * above the data's is refused. A migration that changes data in place, as
 * 0002 turns rupees into paise, raises minSchemaVersion to its own number, so
 * it runs here, while the cafe is closed, and the deploy follows.
 */
import { fileURLToPath } from "node:url";

import { loadMigrations, migrateData, readDataSchema } from "../migrations.mjs";

export const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../../../migrations/", import.meta.url),
);

export async function migrate(ctx, { to, dir = MIGRATIONS_DIR, batchSize }) {
  const { log, project, dryRun } = ctx;
  log.title(`Migrating ${project}'s data to schema ${to}`);

  log.step("Data schema");
  const from = await readDataSchema(ctx);
  log.step("Migrations");
  if (from >= to) {
    log.same(
      from === to
        ? `already at schema ${to}: nothing to migrate`
        : `at schema ${from}, past ${to}: migrations only go forward`,
    );
    return { ran: [], changes: log.changes };
  }
  log.info(`from ${dir}`);
  const result = await migrateData(ctx, {
    migrations: await loadMigrations(dir),
    from,
    to,
    batchSize,
  });

  log.blank();
  log.say(
    dryRun
      ? `Dry run: ${log.changes.length} change(s) would be made.`
      : `Done: ${project}'s data is at schema ${to}.`,
  );
  return { ...result, changes: log.changes };
}
