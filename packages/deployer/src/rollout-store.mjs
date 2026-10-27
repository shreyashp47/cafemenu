/**
 * Where a rollout remembers how far it got, so `--resume` can pick up after a
 * pause or a crash.
 *
 * A RolloutStore has three methods:
 *
 *   get(id) → Rollout | null
 *   list() → Rollout[]          oldest first
 *   save(rollout) → void        replaces the rollout with that id
 *
 * Rollout {
 *   id, version,
 *   status,              "running" | "paused" | "completed"
 *   pausedBecause,       why it paused, or null
 *   batchSize, failurePercent,
 *   startedAt, updatedAt, finishedAt,
 *   cafes: {[cafeId]: {
 *     wave,              "canary" | "beta" | "stable", or null if skipped
 *     status,            "pending" | "running" | "done" | "rolled-back" |
 *                        "failed" | "skipped"
 *     reason,            why it was skipped, rolled back or failed
 *     rolledBackTo,      the version a rolled-back cafe runs again
 *     attempts, startedAt, finishedAt
 *   }}
 * }
 *
 * createJsonRolloutStore is the CLI's: one JSON file on disk, written after
 * every cafe.
 *
 * TODO(#28): a platform-Firestore RolloutStore, a `rollouts/{id}` document in
 * the console's project for the admin page to list, pause and resume. Each
 * cafe's deploy then also gets a `deployments/{id}` with trigger "rollout"
 * (see the TODO in src/deploy-log.mjs).
 */
import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";

export const DEFAULT_ROLLOUT_FILE = "cafemenu-rollouts.json";

const empty = () => ({ format: 1, rollouts: {} });

export function createJsonRolloutStore(path) {
  async function load() {
    try {
      const data = JSON.parse(await readFile(path, "utf8"));
      if (data?.format !== 1)
        throw new Error(`${path} isn't a rollout file (format 1).`);
      return data;
    } catch (error) {
      if (error.code === "ENOENT") return empty();
      throw error;
    }
  }
  return {
    path,
    async get(id) {
      return (await load()).rollouts[id] ?? null;
    },
    async list() {
      return Object.values((await load()).rollouts);
    },
    async save(rollout) {
      const data = await load();
      data.rollouts[rollout.id] = rollout;
      // Written next to itself, then renamed: a crash never leaves half a file.
      const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`);
      await rename(tmp, path);
    },
  };
}
