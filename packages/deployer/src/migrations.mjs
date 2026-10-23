/**
 * The cafe's data schema, and the runner that migrates it.
 *
 * Each cafe's Firestore keeps its schema version at config/meta.schemaVersion
 * (migrations/README.md). Schema 1 is TOE's data as it is, so a cafe without
 * that document is at 1.
 *
 * A migration is migrations/NNNN-what-it-does.mjs, NNNN being the schema it
 * brings the data to, exporting:
 *
 *   from       the schema it starts from; the runner refuses it on data at
 *              any other
 *   to         NNNN
 *   describe   one line on what it does
 *   up(db)     the migration itself, through src/migration-db.mjs
 *
 * The runner takes the data from its schema up to a target one migration at
 * a time, each recorded in config/meta when it finishes, so a stopped run
 * starts again at the migration it stopped in, and inside it where it
 * stopped.
 */
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { decodeFields, getDocument } from "./apis/firestore.mjs";
import { ActionNeededError } from "./errors.mjs";
import { META_DOC, openMigrationDb } from "./migration-db.mjs";

export { META_DOC };

const MIGRATION_FILE = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.mjs$/;

/** The schema version of the cafe's data: config/meta.schemaVersion, or 1 without one. */
export async function readDataSchema(ctx) {
  const doc = await getDocument(ctx.api, ctx.project, META_DOC);
  const meta = doc ? decodeFields(doc.fields) : {};
  const version = meta.schemaVersion;
  if (meta.migration) {
    ctx.log.warn(
      `a migration to schema ${meta.migration.to} stopped part way (started ${meta.migration.startedAt ?? "at an unknown time"}); it carries on from there`,
    );
  }
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

function checkMigration(name, module) {
  const m = module.default ?? module;
  const number = Number(MIGRATION_FILE.exec(name)[1]);
  const problems = [];
  if (!Number.isSafeInteger(m.from) || m.from < 1)
    problems.push("`from` must be the schema version it migrates from");
  if (m.to !== number)
    problems.push(`\`to\` must be ${number}, the number in its name`);
  if (typeof m.describe !== "string" || !m.describe.trim())
    problems.push("`describe` must say what it does");
  if (typeof m.up !== "function") problems.push("`up(db)` must be a function");
  if (problems.length)
    throw new Error(`migrations/${name}: ${problems.join("; ")}.`);
  return { name, from: m.from, to: m.to, describe: m.describe, up: m.up };
}

/** The migrations in a folder, in schema order: [{name, from, to, describe, up}]. */
export async function loadMigrations(dir) {
  const names = (await readdir(dir)).filter((n) => MIGRATION_FILE.test(n));
  const migrations = [];
  for (const name of names.sort()) {
    const module = await import(pathToFileURL(join(dir, name)).href);
    migrations.push(checkMigration(name, module));
  }
  return migrations;
}

/**
 * The migrations that take data at schema `from` to `to`, in order. Each
 * must start where the one before it ends: a migration written for data in
 * another shape (a "contract" whose "expand" hasn't run, say) is refused
 * before anything runs.
 */
export function planMigrations(migrations, { from, to }) {
  const plan = migrations
    .filter((m) => m.to > from && m.to <= to)
    .sort((a, b) => a.to - b.to);
  let at = from;
  for (const m of plan) {
    if (m.from !== at) {
      throw new ActionNeededError(
        `${m.name} migrates data at schema ${m.from}, but the cafe's ${at === from ? "is" : "would be"} at schema ${at} when it ran.`,
        {
          hint: "Nothing was migrated. The release's migrations don't line up: its `from` and `to` must chain from one schema to the next.",
        },
      );
    }
    at = m.to;
  }
  if (at !== to) {
    throw new ActionNeededError(
      `Nothing migrates the data from schema ${at} to ${to}.`,
      { hint: "Nothing was migrated. Check the migrations folder." },
    );
  }
  return plan;
}

/**
 * Runs the migrations from schema `from` to `to`, each to the end and then
 * recorded in config/meta. Returns {ran: [name]}.
 */
export async function migrateData(ctx, { migrations, from, to, batchSize }) {
  const { log, dryRun } = ctx;
  const plan = planMigrations(migrations, { from, to });
  for (const migration of plan) {
    log.info(
      `${migration.name}, schema ${migration.from} → ${migration.to}: ${migration.describe}`,
    );
    const db = await openMigrationDb(ctx, migration, { batchSize });
    await migration.up(db);
    await db.finish();
    log.change(
      dryRun
        ? `would record schema ${migration.to} in ${META_DOC}`
        : `data at schema ${migration.to} (${META_DOC})`,
    );
  }
  return { ran: plan.map((m) => m.name) };
}

/** Writes the package's migrations/ (with any shared code beside them) into `dir`. */
async function unpackMigrations(verified, dir) {
  for (const [path, bytes] of verified.files) {
    if (!path.startsWith("migrations/")) continue;
    const target = join(dir, path.slice("migrations/".length));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}

/**
 * The deploy's hook: brings the cafe's data from schema `from` to the
 * package's with the package's own migrations, before the rules and the site
 * that need them.
 */
export async function runMigrations(ctx, { manifest, from, verified }) {
  ctx.log.step("Migrations");
  if (from >= manifest.schemaVersion) {
    ctx.log.same(
      `data is at schema ${from}; ${manifest.version} needs ${manifest.schemaVersion}, so nothing to migrate`,
    );
    return { ran: [] };
  }
  const dir = await mkdtemp(join(tmpdir(), "cafemenu-migrations-"));
  try {
    await unpackMigrations(verified, dir);
    return await migrateData(ctx, {
      migrations: await loadMigrations(dir),
      from,
      to: manifest.schemaVersion,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
