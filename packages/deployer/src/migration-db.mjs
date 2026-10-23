/**
 * What a migration's `up(db)` works with: the cafe's Firestore as the
 * service account (so firestore.rules don't apply), a page at a time, with
 * the migration's progress kept in config/meta so a run cut off part way
 * carries on where it stopped.
 *
 * Each page of changes goes in one commit together with the progress that
 * records it, and each document's write requires the document to be
 * unchanged since it was read. So a page is applied exactly once: a run that
 * stops before the commit wrote none of it, one that stops after it has the
 * progress past it, and anything that wrote in between (a second run, a
 * staff tablet) fails the whole commit, to be read again by the next run.
 *
 *   db.get(path)                     a document's data, or null
 *   db.each(step, collection, change)
 *                                    every document of a top-level
 *                                    collection, in ID order: `change(data,
 *                                    doc)` returns the fields to set, or null
 *                                    to leave it. Returns the step's counts
 *                                    {seen, changed, late}
 *   db.update(step, path, change)    one document, the same way
 *   db.startedAt                     when the migration first started
 *                                    (Firestore's clock), or null in a dry run
 *   db.dryRun, db.log
 *
 * A document created after the migration started is left as it is and
 * counted as `late`: it may already be in the new shape, and only a person
 * can tell. In a dry run, nothing is written and the counts say what would
 * change.
 */
import {
  commit,
  decodeFields,
  documentName,
  encodeFields,
  getDocument,
  queryCollection,
} from "./apis/firestore.mjs";
import { ActionNeededError, ApiError } from "./errors.mjs";

export const META_DOC = "config/meta";

/** Documents per commit. Firestore takes 500 writes in one; one is config/meta's. */
export const BATCH_SIZE = 300;

const isConflict = (error) =>
  error instanceof ApiError &&
  (error.code === "FAILED_PRECONDITION" || error.code === "ABORTED");

/**
 * The migration's db, resuming the progress config/meta holds for it.
 * `finish()` (for the runner, not the migration) records the new schema
 * version and clears the progress.
 */
export async function openMigrationDb(
  ctx,
  migration,
  { batchSize = BATCH_SIZE } = {},
) {
  const { api, project, log, dryRun } = ctx;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 499)
    throw new Error(`batchSize must be 1 to 499, not ${batchSize}`);

  const meta = await getDocument(api, project, META_DOC);
  let metaTime = meta?.updateTime ?? null;
  const saved = meta ? decodeFields(meta.fields).migration : undefined;
  if (saved && saved.to !== migration.to) {
    throw new ActionNeededError(
      `${META_DOC} holds the progress of a migration to schema ${saved.to}, but the next one to run is ${migration.name} (to ${migration.to}).`,
      {
        hint: `Finish it with the release that has it, or remove ${META_DOC}.migration by hand once you know the data is whole.`,
      },
    );
  }
  const progress = saved ?? {
    to: migration.to,
    name: migration.name,
    startedAt: null,
    steps: {},
  };

  /** Commits `writes` together with the progress, as one. */
  async function save(writes) {
    try {
      const res = await commit(api, project, [
        ...writes,
        {
          update: {
            name: documentName(project, META_DOC),
            fields: encodeFields({ migration: progress }),
          },
          updateMask: { fieldPaths: ["migration"] },
          currentDocument: metaTime
            ? { updateTime: metaTime }
            : { exists: false },
        },
      ]);
      metaTime = res.writeResults.at(-1).updateTime;
      return res;
    } catch (error) {
      if (!isConflict(error)) throw error;
      throw new Error(
        `Something else wrote to the cafe's data while ${migration.name} ran (another run, or the cafe is open), so nothing of this batch was written. ${error.message}`,
      );
    }
  }

  if (saved) {
    const done = Object.keys(saved.steps ?? {});
    log.info(
      `resuming: it started at ${saved.startedAt ?? "an unknown time"}${done.length ? `, and got as far as ${done.join(", ")}` : ""}`,
    );
  }
  if (!dryRun && !progress.startedAt) {
    // Firestore's clock, not this machine's: it is what createTime counts in.
    progress.startedAt = (await save([])).commitTime;
    await save([]);
  }
  const started = progress.startedAt ? Date.parse(progress.startedAt) : null;
  const isLate = (doc) =>
    started !== null && Date.parse(doc.createTime) > started;

  const write = (name, fields, currentDocument) => ({
    update: { name, fields: encodeFields(fields) },
    updateMask: { fieldPaths: Object.keys(fields) },
    currentDocument,
  });

  async function each(step, collection, change) {
    const state = (progress.steps[step] ??= {
      after: null,
      seen: 0,
      changed: 0,
      late: 0,
      done: false,
    });
    while (!state.done) {
      const docs = await queryCollection(api, project, collection, {
        after: state.after,
        limit: batchSize,
      });
      const writes = [];
      for (const doc of docs) {
        state.seen += 1;
        if (isLate(doc)) {
          state.late += 1;
          continue;
        }
        const id = doc.name.split("/").pop();
        const fields = change(decodeFields(doc.fields), {
          id,
          path: `${collection}/${id}`,
          createTime: doc.createTime,
        });
        if (!fields) continue;
        state.changed += 1;
        writes.push(write(doc.name, fields, { updateTime: doc.updateTime }));
      }
      if (docs.length) state.after = docs.at(-1).name;
      state.done = docs.length < batchSize;
      if (!dryRun) await save(writes);
    }
    return state;
  }

  async function update(step, path, change) {
    const state = (progress.steps[step] ??= { changed: 0, done: false });
    if (state.done) return state;
    const doc = await getDocument(api, project, path);
    const fields = change(doc ? decodeFields(doc.fields) : null);
    state.done = true;
    if (fields) state.changed = 1;
    if (!dryRun) {
      await save(
        fields
          ? [
              write(
                documentName(project, path),
                fields,
                doc ? { updateTime: doc.updateTime } : { exists: false },
              ),
            ]
          : [],
      );
    }
    return state;
  }

  async function finish() {
    if (dryRun) return;
    // `migration` is in the mask but not the fields, so it is removed.
    await commit(api, project, [
      {
        update: {
          name: documentName(project, META_DOC),
          fields: encodeFields({ schemaVersion: migration.to }),
        },
        updateMask: { fieldPaths: ["schemaVersion", "migration"] },
        currentDocument: metaTime
          ? { updateTime: metaTime }
          : { exists: false },
      },
    ]);
  }

  return {
    dryRun,
    log,
    startedAt: progress.startedAt,
    get: async (path) => {
      const doc = await getDocument(api, project, path);
      return doc ? decodeFields(doc.fields) : null;
    },
    each,
    update,
    finish,
  };
}
