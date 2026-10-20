/**
 * What a Hosting deploy needs from disk: every file in the build folder,
 * gzipped and hashed the way Hosting wants (SHA-256 of the gzipped bytes),
 * and the site's serving config translated from firebase.json's "hosting"
 * section into the REST API's ServingConfig.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { gzipSync } from "node:zlib";

import { UsageError } from "./errors.mjs";

/** firebase-tools' default "ignore" list, used when firebase.json gives none. */
export const DEFAULT_IGNORE = ["firebase.json", "**/.*", "**/node_modules/**"];

/**
 * A small glob matcher for "ignore" patterns: `**` crosses folders, `*` and
 * `?` don't. Patterns match the path relative to the build folder.
 */
export function globToRegExp(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      // "**/" matches zero or more folders; a trailing "**" matches anything.
      if (glob[i + 2] === "/") {
        out += "(?:.*/)?";
        i += 2;
      } else {
        out += ".*";
        i += 1;
      }
    } else if (c === "*") {
      out += "[^/]*";
    } else if (c === "?") {
      out += "[^/]";
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

/** Matches like firebase-tools: a pattern also ignores everything under a matching folder. */
export function isIgnored(path, patterns) {
  const parts = path.split("/");
  const prefixes = parts.map((_, i) => parts.slice(0, i + 1).join("/"));
  return patterns.some((pattern) => {
    const re = globToRegExp(pattern);
    return prefixes.some((prefix) => re.test(prefix));
  });
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

/**
 * Every file under `dir` that isn't ignored, sorted by path:
 * [{path: "/index.html", hash, gzipped}]. Gzip output is deterministic for
 * the same input and level, so the same build always hashes the same.
 */
export async function collectFiles(dir, { ignore = DEFAULT_IGNORE } = {}) {
  let paths;
  try {
    paths = await walk(dir);
  } catch (error) {
    throw new UsageError(
      `Can't read the build folder ${dir} (${error.code ?? error.message}).`,
    );
  }
  const files = [];
  for (const full of paths) {
    const rel = relative(dir, full).split(sep).join("/");
    if (isIgnored(rel, ignore)) continue;
    const gzipped = gzipSync(await readFile(full), { level: 9 });
    files.push({
      path: `/${rel}`,
      hash: createHash("sha256").update(gzipped).digest("hex"),
      gzipped,
    });
  }
  if (files.length === 0) {
    throw new UsageError(`The build folder ${dir} has no files to deploy.`);
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/** Drops firebase.json's "//" comment keys, at any depth. */
export function stripComments(value) {
  if (Array.isArray(value)) return value.map(stripComments);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !key.startsWith("//"))
        .map(([key, item]) => [key, stripComments(item)]),
    );
  }
  return value;
}

/** firebase.json `source`/`regex` → ServingConfig `glob`/`regex`. */
function pattern(rule, where) {
  if (typeof rule.source === "string") return { glob: rule.source };
  if (typeof rule.glob === "string") return { glob: rule.glob };
  if (typeof rule.regex === "string") return { regex: rule.regex };
  throw new UsageError(`${where} needs a "source" or "regex".`);
}

/**
 * Translates one firebase.json "hosting" entry into the REST API's
 * ServingConfig, as firebase-tools does before it creates a version:
 * https://firebase.google.com/docs/reference/hosting/rest/v1beta1/sites.versions#servingconfig
 *
 *   headers   [{source, headers: [{key, value}]}] → [{glob, headers: {key: value}}]
 *   redirects [{source, destination, type}]      → [{glob, location, statusCode}]
 *   rewrites  [{source, destination}]             → [{glob, path}]
 *   trailingSlash true / false                    → trailingSlashBehavior ADD / REMOVE
 *
 * Rewrites to functions or Cloud Run aren't supported: a cafe site is static.
 */
export function toServingConfig(hosting = {}) {
  const config = {};
  if (hosting.cleanUrls !== undefined)
    config.cleanUrls = Boolean(hosting.cleanUrls);
  if (hosting.trailingSlash === true) config.trailingSlashBehavior = "ADD";
  if (hosting.trailingSlash === false) config.trailingSlashBehavior = "REMOVE";
  if (hosting.appAssociation) config.appAssociation = hosting.appAssociation;
  if (hosting.i18n) config.i18n = hosting.i18n;

  if (hosting.headers?.length) {
    config.headers = hosting.headers.map((rule, i) => ({
      ...pattern(rule, `hosting.headers[${i}]`),
      headers: Object.fromEntries(
        (rule.headers ?? []).map(({ key, value }) => [key, value]),
      ),
    }));
  }
  if (hosting.redirects?.length) {
    config.redirects = hosting.redirects.map((rule, i) => ({
      ...pattern(rule, `hosting.redirects[${i}]`),
      location: rule.destination,
      statusCode: rule.type ?? 301,
    }));
  }
  if (hosting.rewrites?.length) {
    config.rewrites = hosting.rewrites.map((rule, i) => {
      if (typeof rule.destination !== "string") {
        throw new UsageError(
          `hosting.rewrites[${i}]: only rewrites to a "destination" path are supported.`,
        );
      }
      return {
        ...pattern(rule, `hosting.rewrites[${i}]`),
        path: rule.destination,
      };
    });
  }
  return config;
}

/**
 * Reads firebase.json and picks its hosting entry: the one whose "target"
 * (or "site") is `target`, or the only one. Returns {config, ignore}.
 */
export async function readHostingConfig(
  path,
  target,
  { read = readFile } = {},
) {
  let json;
  try {
    json = stripComments(JSON.parse(await read(path, "utf8")));
  } catch (error) {
    throw new UsageError(
      `Can't read ${path} as JSON (${error.code ?? error.message}).`,
    );
  }
  const entries = [json.hosting ?? []].flat();
  let entry;
  if (target) {
    entry = entries.find((e) => e.target === target || e.site === target);
    if (!entry)
      throw new UsageError(
        `${path} has no hosting entry with target "${target}".`,
      );
  } else if (entries.length === 1) {
    [entry] = entries;
  } else {
    throw new UsageError(
      `${path} has ${entries.length} hosting entries; pick one with --target <name>.`,
    );
  }
  return {
    config: toServingConfig(entry),
    ignore: entry.ignore ?? DEFAULT_IGNORE,
  };
}
