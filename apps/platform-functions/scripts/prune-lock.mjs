/**
 * A lockfile for the staged functions (stage.mjs), cut out of the repository's
 * own: the versions the tests ran on are the versions that get deployed, and
 * Cloud Build runs `npm ci` on it instead of resolving the tree from nothing,
 * which crashes npm 10 on this repository (CONTRIBUTING.md).
 *
 * The workspace's packages sit in the root lockfile as `apps/<name>/node_modules/…`
 * (its own versions) beside the hoisted `node_modules/…` (everyone's). In the
 * staged folder the workspace *is* the root, so its `node_modules` move up a
 * level; wherever that puts two versions of a package in one place, the
 * hoisted one is nested under whoever needs it instead. Every dependency is
 * then checked to resolve to the very version it had in the repository, or the
 * cut is refused.
 */

const NODE_MODULES = "/node_modules/";

/** The package a lockfile key names: "node_modules/a/node_modules/@s/b" → "@s/b". */
const nameOf = (key) => key.slice(key.lastIndexOf("node_modules/") + 13);

/** The key a package resolves `name` to, looking from `from` up to the root, as Node does. */
function lookup(entries, from, name) {
  for (let at = from; ;) {
    const key = at ? `${at}${NODE_MODULES}${name}` : `node_modules/${name}`;
    if (entries.has(key)) return key;
    if (!at) return null;
    const up = at.lastIndexOf(NODE_MODULES);
    at = up === -1 ? "" : at.slice(0, up);
  }
}

/** What an installed package needs installed beside it: not dev, not optional peers. */
function needs(entry) {
  const optionalPeers = entry.peerDependenciesMeta ?? {};
  return [
    ...Object.keys(entry.dependencies ?? {}),
    ...Object.keys(entry.optionalDependencies ?? {}),
    ...Object.keys(entry.peerDependencies ?? {}).filter(
      (name) => !optionalPeers[name]?.optional,
    ),
  ];
}

/**
 * @param lock       the root package-lock.json, parsed (lockfileVersion 3)
 * @param workspace  the workspace's folder in it: "apps/platform-functions"
 * @param staged     the staged package.json, parsed
 * @param vendored   {name: {path, manifest}} for each `file:` dependency
 *                   (the deployer and shared), as laid out in the staged folder
 */
export function pruneLock(lock, { workspace, staged, vendored }) {
  if (lock.lockfileVersion !== 3) {
    throw new Error("Only lockfileVersion 3 can be cut down.");
  }
  const old = new Map(Object.entries(lock.packages));
  const own = `${workspace}/`;

  // -- 1. what the functions need, by the keys it has in the repository ----
  const wanted = new Set();
  const queue = Object.keys(staged.dependencies)
    .filter((name) => !vendored[name])
    .map((name) => [workspace, name]);
  while (queue.length) {
    const [from, name] = queue.shift();
    const key = lookup(old, from, name);
    if (!key) {
      if (from === workspace) {
        throw new Error(
          `${name} is not in the repository's package-lock.json.`,
        );
      }
      continue; // an optional dependency nobody installed
    }
    if (wanted.has(key)) continue;
    wanted.add(key);
    for (const next of needs(old.get(key))) queue.push([key, next]);
  }

  // -- 2. where they go in the staged folder ---------------------------------
  /** new key → the key it was in the repository */
  const placed = new Map();
  const remap = (key) => (key.startsWith(own) ? key.slice(own.length) : key);
  const subtree = (key) =>
    [...wanted].filter(
      (k) => k === key || k.startsWith(`${key}${NODE_MODULES}`),
    );

  /** Puts `key` and what is nested under it at `at`. */
  const place = (key, at) => {
    for (const k of subtree(key)) placed.set(at + k.slice(key.length), k);
  };

  // The workspace's own first, then the hoisted ones that still fit.
  for (const key of [...wanted].filter((k) => k.startsWith(own))) {
    placed.set(remap(key), key);
  }
  const depth = (key) => key.split(NODE_MODULES).length;
  const hoisted = [...wanted]
    .filter((k) => !k.startsWith(own))
    .sort((a, b) => depth(a) - depth(b));
  for (const key of hoisted) {
    const up = key.lastIndexOf(NODE_MODULES);
    const parentStays =
      up === -1 || placed.get(key.slice(0, up)) === key.slice(0, up);
    // Nested under a package that moved aside, it moves with it (below).
    if (!placed.has(key) && parentStays) placed.set(key, key);
  }

  // Wherever a package finds a different version than it had, or none, give
  // it the one it had: at the top if the top is free, else beside it.
  const instances = () => [...placed.entries()];
  for (let round = 0; ; round += 1) {
    if (round > 50) throw new Error("The lockfile could not be cut down.");
    let fixed = 0;
    for (const [at, was] of instances()) {
      for (const name of needs(old.get(was))) {
        const want = lookup(old, was, name);
        if (!want) continue;
        const found = lookup(placed, at, name);
        if (found !== null && placed.get(found) === want) continue;
        place(
          want,
          found === null
            ? `node_modules/${name}`
            : `${at}${NODE_MODULES}${name}`,
        );
        fixed += 1;
      }
    }
    if (fixed === 0) break;
  }

  // -- 3. the lockfile ----------------------------------------------------------
  const packages = {
    "": {
      name: staged.name,
      version: staged.version,
      license: staged.license,
      dependencies: staged.dependencies,
      engines: staged.engines,
    },
  };
  for (const [at, was] of placed) {
    const { dev, devOptional, ...entry } = old.get(was);
    if (dev) {
      throw new Error(
        `${was} is only a development dependency in the repository.`,
      );
    }
    // With no development dependencies left, "dev or optional" is "optional".
    packages[at] = devOptional ? { ...entry, optional: true } : entry;
  }
  // The deployer and shared, beside the functions, linked as `file:` dependencies.
  for (const [name, { path, manifest }] of Object.entries(vendored)) {
    packages[`node_modules/${name}`] = { resolved: path, link: true };
    packages[path] = {
      name,
      version: manifest.version,
      license: manifest.license,
      dependencies: manifest.dependencies,
      engines: manifest.engines,
    };
  }
  const sorted = Object.keys(packages).sort((a, b) =>
    a === "" ? -1 : b === "" ? 1 : a.localeCompare(b, "en"),
  );
  return {
    name: staged.name,
    version: staged.version,
    lockfileVersion: 3,
    requires: true,
    packages: Object.fromEntries(sorted.map((key) => [key, packages[key]])),
  };
}
