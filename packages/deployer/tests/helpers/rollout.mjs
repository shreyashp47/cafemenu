/**
 * Cafes, a cafe list on disk and a scripted deploy for the rollout tests.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createJsonCafeDirectory } from "../../src/cafe-directory.mjs";
import { rollout } from "../../src/commands/rollout.mjs";
import { createLogger } from "../../src/log.mjs";
import { createJsonRolloutStore } from "../../src/rollout-store.mjs";
import { SmokeTestError } from "../../src/smoke-test.mjs";
import { tempDir } from "./setup.mjs";

/** A cafe as the CafeDirectory lists it. */
export function cafe(id, release = {}, extra = {}) {
  return {
    id,
    name: id,
    projectId: `${id}-project`,
    site: id,
    settingsFile: `/cafes/${id}.json`,
    logoFile: null,
    canary: false,
    status: "live",
    release: {
      channel: "stable",
      pinned: null,
      current: null,
      previous: null,
      ...release,
    },
    ...extra,
  };
}

/** An entry of cafes.json. */
export function cafeEntry(id, release = {}, extra = {}) {
  return {
    id,
    projectId: `${id}-cafe`,
    site: id,
    settingsFile: `${id}.settings.json`,
    release: { channel: "stable", pinned: null, current: null, ...release },
    ...extra,
  };
}

/**
 * A rollout over `entries` (cafes.json entries) with a fake per-cafe deploy.
 * `fails` maps a cafe id to what its deploy does: "error" throws an Error,
 * "smoke" throws a SmokeTestError that was rolled back, "stuck" one whose
 * rollback failed too. It can be changed between runs. `releases` are the
 * published releases the support window is read from (an Error to have
 * reading them fail; left out, the rollout is not given any).
 */
export async function rolloutHarness(entries, { fails = {}, releases } = {}) {
  const dir = await tempDir();
  const cafesPath = join(dir, "cafes.json");
  await writeFile(cafesPath, JSON.stringify({ cafes: entries }, null, 2));
  const store = createJsonRolloutStore(join(dir, "rollouts.json"));
  const directory = createJsonCafeDirectory(cafesPath);
  const h = {
    dir,
    cafesPath,
    store,
    directory,
    fails,
    releases,
    deployed: [],
    lines: [],
    clock: 0,
    async deployCafe(c, { version, write }) {
      h.deployed.push(c.id);
      write(`deploying ${version} to ${c.id}`);
      const how = h.fails[c.id];
      if (how === "error") throw new Error(`${c.id}: the rules were refused`);
      if (how === "smoke" || how === "stuck") {
        const error = new SmokeTestError(`The smoke test failed on ${c.id}.`);
        if (how === "smoke") error.rolledBackTo = c.release.current ?? "1.0.0";
        throw error;
      }
    },
    /** Runs the command; `options` as the CLI parses them. */
    async run(options, { dryRun = false } = {}) {
      h.deployed = [];
      h.lines = [];
      const result = await rollout(
        {
          log: createLogger({ write: (l) => h.lines.push(l), dryRun }),
          dryRun,
          now: () => new Date(Date.UTC(2026, 9, 24, 10, 0, h.clock++)),
          directory,
          store,
          deployCafe: h.deployCafe,
          ...(h.releases !== undefined && {
            listReleases: async () => {
              if (h.releases instanceof Error) throw h.releases;
              return h.releases;
            },
          }),
        },
        { flags: "--cafes cafes.json", ...options },
      );
      return result;
    },
    output: () => h.lines.join("\n"),
    cafes: async () =>
      Object.fromEntries(
        (await directory.list()).map((c) => [c.id, c.release]),
      ),
    read: async () => JSON.parse(await readFile(cafesPath, "utf8")),
  };
  return h;
}
