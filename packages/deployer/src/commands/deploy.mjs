/**
 * `deployer deploy`: Firestore rules, then composite indexes, then the
 * Hosting site, in the order PLAN.md gives (rules and indexes before the
 * bundle that needs them). Any subset can be deployed. Each part compares
 * with what is live first and skips itself when nothing would change.
 */
import { readFile as fsReadFile } from "node:fs/promises";
import { basename } from "node:path";

import { createIndex, listIndexes } from "../apis/firestore.mjs";
import {
  createRelease as createHostingRelease,
  createVersion,
  finalizeVersion,
  getLiveRelease,
  listVersionFiles,
  populateFiles,
  uploadFile,
} from "../apis/hosting.mjs";
import {
  FIRESTORE_RELEASE,
  createRelease,
  createRuleset,
  getRelease,
  getRuleset,
  updateRelease,
} from "../apis/rules.mjs";
import { UsageError } from "../errors.mjs";
import {
  DEFAULT_IGNORE,
  collectFiles,
  readHostingConfig,
  stripComments,
} from "../hosting-files.mjs";
import { act, isAlreadyExists, shortName } from "./act.mjs";

export const PARTS = ["rules", "indexes", "hosting"];
const POPULATE_BATCH = 1000;
const UPLOAD_CONCURRENCY = 6;

async function readText(path, read = fsReadFile) {
  try {
    return await read(path, "utf8");
  } catch (error) {
    throw new UsageError(
      `Can't read ${path} (${error.code ?? error.message}).`,
    );
  }
}

// --- Rules -----------------------------------------------------------------

export async function deployRules(ctx, rulesPath) {
  const content = await readText(rulesPath, ctx.readFile);
  return deployRulesSource(ctx, basename(rulesPath), content);
}

/** Makes `content` the live Firestore rules, unless it already is. */
export async function deployRulesSource(ctx, fileName, content) {
  const { api, log, project } = ctx;
  log.step("Firestore rules");

  const release = await getRelease(api, project, FIRESTORE_RELEASE);
  if (release) {
    const live = await getRuleset(api, release.rulesetName);
    const files = live.source?.files ?? [];
    if (files.length === 1 && files[0].content === content) {
      log.same(
        `live rules already match ${fileName} (ruleset ${shortName(release.rulesetName)})`,
      );
      return { changed: false, rulesetName: release.rulesetName };
    }
  }

  const ruleset = await act(
    ctx,
    {
      would: `would upload ${fileName} as a new ruleset and make it live`,
      done: (r) => `made ${fileName} live (ruleset ${shortName(r.name)})`,
    },
    async () => {
      const created = await createRuleset(api, project, [
        { name: fileName, content },
      ]);
      if (release) {
        await updateRelease(api, project, FIRESTORE_RELEASE, created.name);
      } else {
        try {
          await createRelease(api, project, FIRESTORE_RELEASE, created.name);
        } catch (error) {
          // Released by someone else since we looked: point it at ours.
          if (!isAlreadyExists(error)) throw error;
          await updateRelease(api, project, FIRESTORE_RELEASE, created.name);
        }
      }
      return created;
    },
  );
  return { changed: true, rulesetName: ruleset?.name ?? null };
}

// --- Indexes ---------------------------------------------------------------

/** The part of a field that matters for matching: its order, array or vector mode. */
function fieldMode(field) {
  if (field.order) return field.order;
  if (field.arrayConfig) return `array:${field.arrayConfig}`;
  if (field.vectorConfig) return `vector:${JSON.stringify(field.vectorConfig)}`;
  return "";
}

/**
 * A comparable key for an index. Google appends `__name__` to every
 * composite index, in the direction of the last field (ASCENDING if that
 * field has no direction), so an implied `__name__` is dropped from both
 * sides before comparing.
 */
export function indexKey(collectionGroup, index) {
  let fields = (index.fields ?? []).map((f) => [f.fieldPath, fieldMode(f)]);
  const last = fields.at(-1);
  if (last?.[0] === "__name__") {
    const before = fields.at(-2)?.[1];
    const implied =
      before === "ASCENDING" || before === "DESCENDING" ? before : "ASCENDING";
    if (last[1] === implied) fields = fields.slice(0, -1);
  }
  return JSON.stringify([
    collectionGroup,
    index.queryScope ?? "COLLECTION",
    index.apiScope ?? "ANY_API",
    fields,
  ]);
}

/** Parses firestore.indexes.json (comment keys allowed, as in TOE's). */
export function parseIndexesFile(text, path = "indexes file") {
  let json;
  try {
    json = stripComments(JSON.parse(text));
  } catch (error) {
    throw new UsageError(`${path} isn't valid JSON (${error.message}).`);
  }
  const indexes = json.indexes ?? [];
  if (!Array.isArray(indexes))
    throw new UsageError(`${path}: "indexes" must be a list.`);
  indexes.forEach((index, i) => {
    if (
      typeof index.collectionGroup !== "string" ||
      !Array.isArray(index.fields)
    ) {
      throw new UsageError(
        `${path}: indexes[${i}] needs a collectionGroup and fields.`,
      );
    }
  });
  return { indexes, fieldOverrides: json.fieldOverrides ?? [] };
}

export async function deployIndexes(ctx, indexesPath) {
  return deployIndexesText(
    ctx,
    await readText(indexesPath, ctx.readFile),
    indexesPath,
  );
}

/** Builds every index in firestore.indexes.json's `text` that doesn't exist yet. */
export async function deployIndexesText(ctx, text, label) {
  const { api, log, project } = ctx;
  log.step("Firestore indexes");
  const spec = parseIndexesFile(text, label);
  if (spec.fieldOverrides.length) {
    log.warn(
      `${spec.fieldOverrides.length} fieldOverrides skipped: this draft doesn't deploy them yet`,
    );
  }

  const existing = await listIndexes(api, project);
  const groupOf = (name) => name.split("/collectionGroups/")[1]?.split("/")[0];
  const live = new Set(
    existing.map((index) => indexKey(groupOf(index.name), index)),
  );
  const wanted = new Set(
    spec.indexes.map((index) => indexKey(index.collectionGroup, index)),
  );
  const missing = spec.indexes.filter(
    (index) => !live.has(indexKey(index.collectionGroup, index)),
  );
  const extra = [...live].filter((key) => !wanted.has(key)).length;

  if (missing.length === 0)
    log.same(`all ${spec.indexes.length} indexes exist`);
  for (const index of missing) {
    const label = `${index.collectionGroup} (${index.fields
      .map((f) => `${f.fieldPath} ${fieldMode(f)}`.trim())
      .join(", ")})`;
    const body = {
      queryScope: index.queryScope ?? "COLLECTION",
      fields: index.fields,
    };
    if (index.density) body.density = index.density;
    if (index.apiScope) body.apiScope = index.apiScope;
    await act(
      ctx,
      {
        would: `would build index ${label}`,
        done: `started building index ${label}`,
      },
      async () => {
        try {
          await createIndex(api, project, index.collectionGroup, body);
        } catch (error) {
          if (!isAlreadyExists(error)) throw error;
        }
      },
    );
  }
  if (missing.length && !ctx.dryRun) {
    log.info(
      "Index builds take a few minutes; queries that need them fail until they finish.",
    );
  }
  if (extra)
    log.info(
      `${extra} index(es) in the project aren't in the file; left in place`,
    );
  return {
    created: ctx.dryRun ? 0 : missing.length,
    missing: missing.length,
    extra,
  };
}

// --- Hosting ---------------------------------------------------------------

export const canonical = (value) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );

async function liveMatches(api, live, files, config) {
  if (!live?.version?.name) return false;
  if (canonical(live.version.config ?? {}) !== canonical(config)) return false;
  const liveFiles = await listVersionFiles(api, live.version.name);
  if (liveFiles.length !== files.length) return false;
  const byPath = new Map(liveFiles.map((f) => [f.path, f.hash]));
  return files.every((f) => byPath.get(f.path) === f.hash);
}

async function forEachLimit(items, limit, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await fn(item);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
}

const kilobytes = (bytes) => `${Math.round(bytes / 1024)} kB`;

export async function deployHosting(
  ctx,
  { site, dir, configPath, target, message },
) {
  ctx.log.step(`Hosting ${site}.web.app`);
  const { config, ignore } = configPath
    ? await readHostingConfig(configPath, target, { read: ctx.readFile })
    : { config: {}, ignore: DEFAULT_IGNORE };
  const files = await collectFiles(dir, { ignore });
  const bytes = files.reduce((sum, f) => sum + f.gzipped.length, 0);
  ctx.log.info(`${files.length} files in ${dir}, ${kilobytes(bytes)} gzipped`);
  return deployHostingFiles(ctx, { site, files, config, message });
}

/**
 * Makes a version of exactly `files` ([{path, hash, gzipped}], sorted by
 * path) with `config` live, unless the live version already is that. A file
 * may leave out `gzipped` when its content is already on Hosting (it comes
 * from a version Hosting has); if Hosting asks for it anyway, this fails
 * before anything goes live.
 */
export async function deployHostingFiles(ctx, { site, files, config, message }) {
  const { api, log, dryRun } = ctx;
  const live = await getLiveRelease(api, site);
  if (await liveMatches(api, live, files, config)) {
    log.same(
      `live version ${shortName(live.version.name)} already serves exactly these files and config`,
    );
    return { changed: false, versionName: live.version.name };
  }
  if (dryRun) {
    log.change(
      `would create a version with ${files.length} files and make it live`,
    );
    return { changed: true, versionName: null };
  }

  const version = await createVersion(api, site, config);
  const id = shortName(version.name);
  try {
    let uploadUrl;
    const required = new Set();
    for (let i = 0; i < files.length; i += POPULATE_BATCH) {
      const batch = files.slice(i, i + POPULATE_BATCH);
      const res = await populateFiles(
        api,
        version.name,
        Object.fromEntries(batch.map((f) => [f.path, f.hash])),
      );
      uploadUrl = res.uploadUrl ?? uploadUrl;
      for (const hash of res.uploadRequiredHashes ?? []) required.add(hash);
    }

    // Several paths can share one hash; each content is uploaded once.
    const byHash = new Map(
      files.filter((f) => f.gzipped).map((f) => [f.hash, f]),
    );
    const unknown = [...required].filter((hash) => !byHash.has(hash));
    if (unknown.length)
      throw new Error(
        `Hosting asked for ${unknown.length} file(s) that aren't in this build.`,
      );
    if (required.size && !uploadUrl)
      throw new Error("Hosting asked for files but sent no upload URL.");
    await forEachLimit([...required], UPLOAD_CONCURRENCY, (hash) =>
      uploadFile(api, uploadUrl, hash, byHash.get(hash).gzipped),
    );
    log.info(
      `uploaded ${required.size} file(s); Hosting already had the other ${new Set(files.map((f) => f.hash)).size - required.size}`,
    );

    await finalizeVersion(api, version.name);
    await createHostingRelease(api, site, version.name, message);
  } catch (error) {
    error.message += ` (Version ${id} was left unfinished; Hosting discards it after 12 hours. Re-running is safe.)`;
    throw error;
  }
  log.change(`version ${id} is live`);
  return { changed: true, versionName: version.name };
}

// --- All of it -------------------------------------------------------------

export async function deploy(ctx, options) {
  const { parts } = options;
  ctx.log.title(`Deploying ${parts.join(", ")} to ${ctx.project}`);
  const result = {};
  if (parts.includes("rules"))
    result.rules = await deployRules(ctx, options.rules);
  if (parts.includes("indexes"))
    result.indexes = await deployIndexes(ctx, options.indexes);
  if (parts.includes("hosting")) {
    result.hosting = await deployHosting(ctx, {
      site: options.site,
      dir: options.dir,
      configPath: options.config,
      target: options.target,
      message: options.message,
    });
  }
  ctx.log.blank();
  ctx.log.say(
    ctx.log.changes.length === 0
      ? "Nothing to change: everything is already live."
      : ctx.dryRun
        ? `Dry run: ${ctx.log.changes.length} change(s) would be made.`
        : "Done.",
  );
  return { ...result, changes: ctx.log.changes };
}
