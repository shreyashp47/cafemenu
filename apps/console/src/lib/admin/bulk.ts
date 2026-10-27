/**
 * Maintenance on several cafes at once (#78), resumable if cut off: one
 * request per cafe, all carrying the same `batch` id. The plan (which cafes,
 * which form) is kept in this browser before the first request is written,
 * so a page closed halfway can pick up where it stopped; the requests
 * themselves say which cafes are done, failed or waiting, and the backend
 * finishes any it had started. A batch can be reverted: maintenance off on
 * every cafe it turned on, as a batch of its own.
 */

import type { BackendRequest, Cafe } from "../platform/model";
import {
  maintenanceOffParams,
  maintenanceOnParams,
  type ActionProblem,
  type MaintenanceForm,
} from "./actions";

export type BulkKind = "maintenance-on" | "maintenance-off";

export interface BulkPlan {
  batch: string;
  kind: BulkKind;
  cafeIds: string[];
  /** The form as filled in: for "on", the times are read on each cafe's clock. */
  form: MaintenanceForm;
  startedAt: number;
}

/** A new batch id: what the request params allow (letters, digits, - and _). */
export function newBatchId(now: number): string {
  const rand = Math.random().toString(36).slice(2, 6);
  return `batch-${now.toString(36)}-${rand}`;
}

/** One cafe's params in a batch, or the problem that stops it. */
export function bulkParams(
  plan: BulkPlan,
  cafe: Pick<Cafe, "settings">,
  now: number,
):
  | { ok: true; params: Record<string, unknown> }
  | { ok: false; problem: ActionProblem } {
  return plan.kind === "maintenance-on"
    ? maintenanceOnParams(plan.form, cafe.settings.timeZone, now, plan.batch)
    : maintenanceOffParams(plan.form.note, plan.batch);
}

export interface BulkStatus {
  done: string[];
  failed: string[];
  /** Asked, not answered yet: the backend's next run does them. */
  waiting: string[];
  /** Never asked: the page stopped before it got to them. */
  notAsked: string[];
}

/** Where each of the plan's cafes is, from the batch's requests (newest first). */
export function bulkStatus(
  plan: BulkPlan,
  requests: readonly BackendRequest[],
): BulkStatus {
  const latest = new Map<string, BackendRequest>();
  for (const r of requests) {
    if (r.kind !== plan.kind || r.params.batch !== plan.batch || !r.cafeId)
      continue;
    const have = latest.get(r.cafeId);
    if (!have || r.createdAt > have.createdAt) latest.set(r.cafeId, r);
  }
  const status: BulkStatus = {
    done: [],
    failed: [],
    waiting: [],
    notAsked: [],
  };
  for (const id of plan.cafeIds) {
    const r = latest.get(id);
    if (!r) status.notAsked.push(id);
    else if (r.status === "done") status.done.push(id);
    else if (r.status === "failed") status.failed.push(id);
    else status.waiting.push(id);
  }
  return status;
}

/** What "Resume" asks again: the cafes never asked, and those that failed. */
export const toResume = (status: BulkStatus) => [
  ...status.notAsked,
  ...status.failed,
];

export const isFinishedBatch = (status: BulkStatus) =>
  status.notAsked.length === 0 && status.waiting.length === 0;

/** A batch that turns maintenance off where `plan` turned it on. */
export function revertPlan(
  plan: BulkPlan,
  status: BulkStatus,
  now: number,
  note: string,
): BulkPlan | null {
  if (plan.kind !== "maintenance-on") return null;
  const cafeIds = [...status.done, ...status.waiting];
  if (cafeIds.length === 0) return null;
  return {
    batch: newBatchId(now),
    kind: "maintenance-off",
    cafeIds,
    form: { ...plan.form, note },
    startedAt: now,
  };
}

/**
 * Asks for each cafe in `cafeIds`, one after another, saving progress as it
 * goes. Returns the cafes it could not ask, with why: a problem with the
 * form for that cafe (say, a start already past), or the error the write
 * failed with.
 */
export async function runBulk(
  plan: BulkPlan,
  cafeIds: readonly string[],
  cafes: ReadonlyMap<string, Cafe>,
  ask: (input: {
    cafeId: string;
    kind: BulkKind;
    params: Record<string, unknown>;
  }) => Promise<string>,
  now: () => number = Date.now,
): Promise<Array<{ cafeId: string; why: ActionProblem | Error }>> {
  const skipped: Array<{ cafeId: string; why: ActionProblem | Error }> = [];
  for (const cafeId of cafeIds) {
    const cafe = cafes.get(cafeId);
    if (!cafe) {
      skipped.push({ cafeId, why: new Error("No such cafe.") });
      continue;
    }
    const checked = bulkParams(plan, cafe, now());
    if (!checked.ok) {
      skipped.push({ cafeId, why: checked.problem });
      continue;
    }
    try {
      await ask({ cafeId, kind: plan.kind, params: checked.params });
    } catch (error) {
      skipped.push({
        cafeId,
        why: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }
  return skipped;
}

// -- kept in this browser ------------------------------------------------------------

export const BULK_STORAGE_KEY = "cafemenu-console.bulk.v1";
/** Plans older than this are forgotten: their requests tell the rest. */
const KEEP_MS = 14 * 24 * 60 * 60_000;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isPlan(value: unknown): value is BulkPlan {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.batch === "string" &&
    (p.kind === "maintenance-on" || p.kind === "maintenance-off") &&
    Array.isArray(p.cafeIds) &&
    p.cafeIds.every((id) => typeof id === "string") &&
    typeof p.form === "object" &&
    p.form !== null &&
    typeof p.startedAt === "number"
  );
}

/** The plans this browser started, newest first. Never throws. */
export function loadPlans(now: number): BulkPlan[] {
  try {
    const raw = storage()?.getItem(BULK_STORAGE_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return (Array.isArray(list) ? list : [])
      .filter(isPlan)
      .filter((p) => now - p.startedAt < KEEP_MS)
      .sort((a, b) => b.startedAt - a.startedAt);
  } catch {
    return [];
  }
}

/** Keeps `plan` (replacing one with its batch id). Never throws. */
export function savePlan(plan: BulkPlan, now: number): void {
  try {
    const plans = [
      plan,
      ...loadPlans(now).filter((p) => p.batch !== plan.batch),
    ];
    storage()?.setItem(BULK_STORAGE_KEY, JSON.stringify(plans));
  } catch {
    // Private mode or full storage: the batch still runs, without a resume.
  }
}

export function forgetPlan(batch: string, now: number): void {
  try {
    const plans = loadPlans(now).filter((p) => p.batch !== batch);
    storage()?.setItem(BULK_STORAGE_KEY, JSON.stringify(plans));
  } catch {
    // As above.
  }
}
