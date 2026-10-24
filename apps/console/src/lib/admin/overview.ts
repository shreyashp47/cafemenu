/**
 * The admin's view of every cafe (#30) as data: how each one is doing, from
 * its latest deployment and the smoke test in it; the filters; the audit
 * list of deployments. Pure, so every case is tested without a browser; the
 * components only show it, and the words are in messages/en.json under
 * `admin`.
 *
 * Everything here is read from the cafes and deployments the rules let the
 * admin read. Nothing here reaches a cafe's orders, which live in the
 * owner's own project, or lets the admin act as an owner.
 */

import type {
  Cafe,
  CafeRelease,
  Deployment,
  DeploymentStatus,
} from "../platform/model";

// -- the smoke test ---------------------------------------------------------------

/** The step the deployer records for its smoke test (release.mjs). */
export const SMOKE_STEP = "smoke";

export type Smoke = "passed" | "failed" | "not-run";

/**
 * How a deployment's smoke test went; null when it has none (a branding
 * sync, setup). A step that never got to run is "not-run".
 */
export function smokeOf(deployment: Deployment): Smoke | null {
  const step = deployment.steps.find((s) => s.id === SMOKE_STEP);
  if (!step) return null;
  if (step.status === "done") return "passed";
  if (step.status === "failed") return "failed";
  return "not-run";
}

// -- health -----------------------------------------------------------------------

/**
 *   ok         live, and its latest deployment went through
 *   busy       something is being set up or deployed right now
 *   attention  the admin should look: a failed or rolled-back deployment, a
 *              failed setup, or access removed
 *   paused     suspended by the admin
 *   unknown    live, with no deployment on record
 *   not-live   a draft: not set up yet
 */
export const HEALTH_LEVELS = [
  "ok",
  "busy",
  "attention",
  "paused",
  "unknown",
  "not-live",
] as const;
export type HealthLevel = (typeof HEALTH_LEVELS)[number];

export type HealthReason =
  | "healthy"
  | "running"
  | "failed"
  | "rolled-back"
  | "no-deploys"
  | "draft"
  | "provisioning"
  | "setup-failed"
  | "disconnected"
  | "suspended";

export interface CafeHealth {
  level: HealthLevel;
  reason: HealthReason;
  /** What went wrong, from the deployment, when something did. */
  error: string | null;
}

/** `latest` is the cafe's newest deployment, if it has any. */
export function cafeHealth(
  cafe: Pick<Cafe, "status">,
  latest: Deployment | null,
): CafeHealth {
  const error = latest?.error ?? null;
  switch (cafe.status) {
    case "draft":
      return { level: "not-live", reason: "draft", error: null };
    case "provisioning":
      return { level: "busy", reason: "provisioning", error: null };
    case "failed":
      return { level: "attention", reason: "setup-failed", error };
    case "disconnected":
      return { level: "attention", reason: "disconnected", error };
    case "suspended":
      return { level: "paused", reason: "suspended", error: null };
    case "live":
      break;
  }
  if (!latest) return { level: "unknown", reason: "no-deploys", error: null };
  switch (latest.status) {
    case "queued":
    case "running":
      return { level: "busy", reason: "running", error: null };
    case "failed":
      return { level: "attention", reason: "failed", error };
    case "rolled-back":
      return { level: "attention", reason: "rolled-back", error };
    default:
      return { level: "ok", reason: "healthy", error: null };
  }
}

// -- one row per cafe -------------------------------------------------------------

export interface AdminRow {
  cafe: Cafe;
  health: CafeHealth;
  /** The newest deployment of any kind. */
  last: Deployment | null;
  /** The newest smoke test, from the newest deployment that had one. */
  smoke: { result: Smoke; at: number } | null;
}

/** The deployments by cafe, each list newest first. */
export function byCafe(
  deployments: readonly Deployment[],
): Map<string, Deployment[]> {
  const grouped = new Map<string, Deployment[]>();
  for (const d of [...deployments].sort((a, b) => b.createdAt - a.createdAt)) {
    const list = grouped.get(d.cafeId);
    if (list) list.push(d);
    else grouped.set(d.cafeId, [d]);
  }
  return grouped;
}

const HEALTH_ORDER: Record<HealthLevel, number> = {
  attention: 0,
  busy: 1,
  unknown: 2,
  paused: 3,
  ok: 4,
  "not-live": 5,
};

/**
 * Every cafe with how it is doing: those that need a look first, then by
 * name. `deployments` may hold only the latest ones, so a cafe that has none
 * in them reads as having none.
 */
export function adminRows(
  cafes: readonly Cafe[],
  deployments: readonly Deployment[],
): AdminRow[] {
  const grouped = byCafe(deployments);
  return cafes
    .map((cafe) => {
      const list = grouped.get(cafe.id) ?? [];
      const last = list[0] ?? null;
      const withSmoke = list.find((d) => smokeOf(d) !== null);
      return {
        cafe,
        health: cafeHealth(cafe, last),
        last,
        smoke: withSmoke
          ? { result: smokeOf(withSmoke) as Smoke, at: withSmoke.createdAt }
          : null,
      };
    })
    .sort(
      (a, b) =>
        HEALTH_ORDER[a.health.level] - HEALTH_ORDER[b.health.level] ||
        a.cafe.settings.name.localeCompare(b.cafe.settings.name, "en"),
    );
}

export interface Summary {
  total: number;
  live: number;
  attention: number;
  busy: number;
}

export function summary(rows: readonly AdminRow[]): Summary {
  return {
    total: rows.length,
    live: rows.filter((r) => r.cafe.status === "live").length,
    attention: rows.filter((r) => r.health.level === "attention").length,
    busy: rows.filter((r) => r.health.level === "busy").length,
  };
}

// -- filters ----------------------------------------------------------------------

export const ADMIN_FILTERS = [
  "all",
  "attention",
  "busy",
  "beta",
  "pinned",
] as const;
export type AdminFilter = (typeof ADMIN_FILTERS)[number];

/** How a cafe follows releases, for display: stable, beta, or a line. */
export function followOf(release: CafeRelease): {
  kind: "stable" | "beta" | "pinned";
  line: string | null;
} {
  if (release.pinned !== null) return { kind: "pinned", line: release.pinned };
  return { kind: release.channel, line: null };
}

export function matchesFilter(row: AdminRow, filter: AdminFilter): boolean {
  switch (filter) {
    case "attention":
      return row.health.level === "attention";
    case "busy":
      return row.health.level === "busy";
    case "beta":
      return row.cafe.release.channel === "beta";
    case "pinned":
      return row.cafe.release.pinned !== null;
    default:
      return true;
  }
}

/** The rows that pass `filter` and whose name, site or owner has `query`. */
export function filterRows(
  rows: readonly AdminRow[],
  filter: AdminFilter,
  query: string,
): AdminRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter(
    (row) =>
      matchesFilter(row, filter) &&
      (!q ||
        [row.cafe.settings.name, row.cafe.site, row.cafe.ownerEmail].some(
          (field) => field.toLowerCase().includes(q),
        )),
  );
}

// -- the audit list ------------------------------------------------------------------

export interface AuditRow {
  deployment: Deployment;
  /** The cafe's name, or its id when the cafe is not in the list. */
  cafeName: string;
  /** Who asked: the owner's email, or "rollout" or "admin". */
  who: { kind: "owner"; email: string } | { kind: "rollout" | "admin" };
}

export interface AuditFilter {
  /** One cafe's id, or null for all. */
  cafeId: string | null;
  /** Only deployments that did not go through. */
  problemsOnly: boolean;
}

const PROBLEM_STATUSES: readonly DeploymentStatus[] = ["failed", "rolled-back"];

/** Newest first, as the repository gives them. */
export function auditRows(
  deployments: readonly Deployment[],
  cafes: readonly Cafe[],
  filter: AuditFilter = { cafeId: null, problemsOnly: false },
): AuditRow[] {
  const known = new Map(cafes.map((c) => [c.id, c]));
  return deployments
    .filter(
      (d) =>
        (filter.cafeId === null || d.cafeId === filter.cafeId) &&
        (!filter.problemsOnly || PROBLEM_STATUSES.includes(d.status)),
    )
    .map((deployment) => {
      const cafe = known.get(deployment.cafeId);
      return {
        deployment,
        cafeName: cafe?.settings.name ?? deployment.cafeId,
        who:
          deployment.trigger === "owner"
            ? { kind: "owner", email: cafe?.ownerEmail ?? "" }
            : { kind: deployment.trigger },
      };
    });
}

// -- rollouts (a stub for #32) -----------------------------------------------------

export type RolloutButton = "start" | "pause" | "resume";

/** What the one button on a release's rollout does, if anything. */
export function rolloutButton(
  status: "running" | "paused" | "completed" | undefined,
): RolloutButton | null {
  switch (status) {
    case undefined:
      return "start";
    case "running":
      return "pause";
    case "paused":
      return "resume";
    default:
      return null;
  }
}
