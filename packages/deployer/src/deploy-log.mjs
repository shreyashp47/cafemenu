/**
 * Where the deployer remembers what each cafe runs, so rollback knows what
 * "previous" is and the next deploy knows what it replaces.
 *
 * A DeployLog has two methods:
 *
 *   get(project) → CafeRecord | null
 *   record({deployment, cafe}) → void
 *       Appends `deployment` and, when `cafe` is given, replaces the
 *       project's CafeRecord. Called once per run, at its end, and never in a
 *       dry run.
 *
 * CafeRecord {
 *   site,                      the Hosting site the releases went to
 *   current, previous,         Release | null
 *   schemaFloor,               the highest minSchemaVersion of any release
 *                              deployed: the oldest schema whose releases
 *                              still run on the cafe's data. It never goes
 *                              down, as data never migrates down.
 * }
 * Release {
 *   version, schemaVersion, minSchemaVersion, sha256 (of the package),
 *   hostingVersion ("sites/{site}/versions/{id}"),
 *   rulesetName ("projects/{id}/rulesets/{id}"), deployedAt
 * }
 * Deployment {
 *   id, project, site, kind: "deploy" | "rollback" | "branding",
 *   version, fromVersion, status: "succeeded" | "failed",
 *   steps: [{id, label, status: "done" | "failed" | "pending"}],
 *   error, createdAt, finishedAt
 * }
 *
 * createJsonDeployLog is the CLI's: one JSON file on disk.
 *
 * TODO(#28): a platform-Firestore DeployLog for the console, writing what
 * apps/console/src/lib/platform/model.ts reads: `cafes/{id}.release.current`
 * and `.previous` (version strings only, so the Release details above need a
 * home of their own, e.g. a field on the cafe or on `releases/{version}`), and
 * one `deployments/{id}` per run ({cafeId, ownerUid, kind, version,
 * fromVersion, status, trigger, steps, error, createdAt, finishedAt}; kind
 * "branding" is what this file calls sync-branding).
 */
import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";

export const DEFAULT_LOG_FILE = "cafemenu-deploys.json";

const empty = () => ({ format: 1, cafes: {}, deployments: [] });

export function createJsonDeployLog(path, { now = () => new Date() } = {}) {
  async function load() {
    try {
      const data = JSON.parse(await readFile(path, "utf8"));
      if (data?.format !== 1)
        throw new Error(`${path} isn't a deploy log (format 1).`);
      return data;
    } catch (error) {
      if (error.code === "ENOENT") return empty();
      throw error;
    }
  }
  return {
    path,
    async get(project) {
      return (await load()).cafes[project] ?? null;
    },
    async record({ deployment, cafe }) {
      const data = await load();
      data.deployments.push({
        id: randomUUID(),
        finishedAt: now().toISOString(),
        ...deployment,
      });
      if (cafe) data.cafes[deployment.project] = cafe;
      // Written next to itself, then renamed: a crash never leaves half a file.
      const tmp = `${path}.${process.pid}.tmp`;
      await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`);
      await rename(tmp, path);
    },
  };
}

/**
 * Tracks a run's steps for its Deployment: `run(id, label, fn)` marks the
 * step done or failed around fn. `steps` lists them all, the ones never
 * reached as pending.
 */
export function stepTracker(plan) {
  const steps = plan.map(([id, label]) => ({ id, label, status: "pending" }));
  return {
    steps,
    async run(id, fn) {
      const step = steps.find((s) => s.id === id);
      try {
        const result = await fn();
        step.status = "done";
        return result;
      } catch (error) {
        step.status = "failed";
        throw error;
      }
    },
  };
}
