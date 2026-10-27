/**
 * The requests behind the owner area's buttons, when the backend answers on a
 * schedule instead of at once (NEXT_PUBLIC_BACKEND=requests). Between pressing
 * Upgrade and the deployment appearing there are minutes in which only the
 * request exists: this decides what the page says about it.
 */

import type { BackendRequest } from "../platform/model";

/** A request nobody has picked up after this long means the schedule may be paused. */
export const LATE_AFTER_MS = 20 * 60_000;

/** A failed request is told about for this long, then it is old news. */
export const FAILED_SHOWN_MS = 24 * 60 * 60_000;

/** `check` belongs to the setup wizard, which waits on it itself. */
const isCafeChange = (request: BackendRequest) => request.kind !== "check";

export const isOpenRequest = (request: BackendRequest) =>
  isCafeChange(request) &&
  (request.status === "queued" || request.status === "running");

/** Whether a change to the cafe has been asked for and not yet finished. */
export function hasOpenRequest(requests: readonly BackendRequest[]): boolean {
  return requests.some(isOpenRequest);
}

export type RequestStage =
  /** Written, and the next run has not come yet. */
  | "waiting"
  /** Written a long while ago and still not picked up: the schedule may be paused. */
  | "late"
  /** A worker has it. */
  | "working"
  /** It did not go through. */
  | "failed";

export interface RequestView {
  request: BackendRequest;
  stage: RequestStage;
}

/**
 * What to tell the owner: the cafe's newest change request while it is open,
 * or has just failed, else nothing (a finished one is in the deployment
 * history). `requests` are newest first, as the repository returns them.
 */
export function requestToShow(
  requests: readonly BackendRequest[],
  now: number,
): RequestView | null {
  const request = requests.find(isCafeChange);
  if (!request) return null;
  if (request.status === "running") return { request, stage: "working" };
  if (request.status === "queued") {
    const late = now - request.createdAt > LATE_AFTER_MS;
    return { request, stage: late ? "late" : "waiting" };
  }
  if (
    request.status === "failed" &&
    now - (request.finishedAt ?? request.createdAt) < FAILED_SHOWN_MS
  ) {
    return { request, stage: "failed" };
  }
  return null;
}
