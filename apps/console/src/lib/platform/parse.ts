/**
 * Turning what Firestore (or the demo store) hands back into the typed model,
 * without trusting it. A document that does not have the shape is dropped
 * (null), so one bad record cannot break a list.
 */

import { parseCafeSettings } from "@cafemenu/shared";
import { REQUEST_KINDS, REQUEST_STATUSES } from "@cafemenu/shared/requests";
import {
  DEPLOYMENT_KINDS,
  DEPLOYMENT_STATUSES,
  DEPLOYMENT_TRIGGERS,
  STARTING_MENU_SOURCES,
  STEP_STATUSES,
  type BackendRequest,
  type Cafe,
  type CafeRelease,
  type Deployment,
  type DeploymentStep,
  type Release,
  type StartingMenu,
} from "./model";
import {
  isCafeStatus,
  isMinorLine,
  isPlainObject,
  isRegionFormat,
  isReleaseChannel,
  isStartingMenuItem,
  isVersion,
} from "./validate";

/**
 * Milliseconds from a Firestore Timestamp, a Date, or a number. A pending
 * serverTimestamp() reads as null in a local snapshot until the server
 * answers; that becomes `fallback`, so a just-written cafe still parses.
 */
export function toMillis(value: unknown, fallback: number | null = null) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { toMillis?: unknown }).toMillis === "function"
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return fallback;
}

const stringOrNull = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const versionOrNull = (value: unknown): string | null =>
  isVersion(value) ? value : null;

const oneOf = <T extends string>(
  list: readonly T[],
  value: unknown,
): value is T => (list as readonly unknown[]).includes(value);

export function parseCafeRelease(value: unknown): CafeRelease | null {
  if (!isPlainObject(value) || !isReleaseChannel(value.channel)) return null;
  return {
    channel: value.channel,
    pinned: isMinorLine(value.pinned) ? value.pinned : null,
    current: versionOrNull(value.current),
    previous: versionOrNull(value.previous),
  };
}

export function parseCafe(id: string, data: unknown): Cafe | null {
  if (!isPlainObject(data)) return null;
  const release = parseCafeRelease(data.release);
  if (
    typeof data.ownerUid !== "string" ||
    typeof data.ownerEmail !== "string" ||
    typeof data.site !== "string" ||
    !isCafeStatus(data.status) ||
    !release
  ) {
    return null;
  }
  const now = Date.now();
  const createdAt = toMillis(data.createdAt, now) ?? now;
  return {
    id,
    ownerUid: data.ownerUid,
    ownerEmail: data.ownerEmail,
    projectId: stringOrNull(data.projectId),
    site: data.site,
    region: isRegionFormat(data.region) ? data.region : null,
    // The cafe app's own lenient read: a field that is missing or invalid
    // reads as its default, so an older record still opens.
    settings: parseCafeSettings(data.settings),
    release,
    status: data.status,
    createdAt,
    updatedAt: toMillis(data.updatedAt, now) ?? createdAt,
  };
}

/** A stored starting menu, rows that do not have the shape dropped. */
export function parseStartingMenu(data: unknown): StartingMenu | null {
  if (!isPlainObject(data)) return null;
  if (
    !oneOf(STARTING_MENU_SOURCES, data.source) ||
    typeof data.currency !== "string" ||
    !Array.isArray(data.items)
  ) {
    return null;
  }
  return {
    source: data.source,
    template: stringOrNull(data.template),
    currency: data.currency,
    items: data.items.filter(isStartingMenuItem),
  };
}

export function parseRelease(id: string, data: unknown): Release | null {
  if (!isPlainObject(data) || !isVersion(id)) return null;
  if (!isReleaseChannel(data.channel)) return null;
  const publishedAt = toMillis(data.publishedAt);
  if (publishedAt === null) return null;
  return {
    version: id,
    channel: data.channel,
    notes: typeof data.notes === "string" ? data.notes : "",
    publishedAt,
    schemaVersion:
      typeof data.schemaVersion === "number" &&
      Number.isInteger(data.schemaVersion)
        ? data.schemaVersion
        : 0,
    withdrawn: data.withdrawn === true,
  };
}

function parseStep(value: unknown): DeploymentStep | null {
  if (!isPlainObject(value)) return null;
  if (typeof value.id !== "string" || !oneOf(STEP_STATUSES, value.status)) {
    return null;
  }
  return {
    id: value.id,
    label: typeof value.label === "string" ? value.label : value.id,
    status: value.status,
  };
}

export function parseDeployment(id: string, data: unknown): Deployment | null {
  if (!isPlainObject(data)) return null;
  if (
    typeof data.cafeId !== "string" ||
    typeof data.ownerUid !== "string" ||
    !oneOf(DEPLOYMENT_KINDS, data.kind) ||
    !oneOf(DEPLOYMENT_STATUSES, data.status) ||
    !oneOf(DEPLOYMENT_TRIGGERS, data.trigger)
  ) {
    return null;
  }
  const createdAt = toMillis(data.createdAt);
  if (createdAt === null) return null;
  const steps = Array.isArray(data.steps)
    ? data.steps
        .map(parseStep)
        .filter((step): step is DeploymentStep => step !== null)
    : [];
  return {
    id,
    cafeId: data.cafeId,
    ownerUid: data.ownerUid,
    kind: data.kind,
    version: versionOrNull(data.version),
    fromVersion: versionOrNull(data.fromVersion),
    status: data.status,
    trigger: data.trigger,
    steps,
    error: stringOrNull(data.error),
    createdAt,
    finishedAt: toMillis(data.finishedAt),
  };
}

/** Newest first, by semantic version (pre-releases before their release). */
export function compareVersionsDesc(a: string, b: string): number {
  const split = (v: string) => {
    const dash = v.indexOf("-");
    const core = dash === -1 ? v : v.slice(0, dash);
    return {
      nums: core.split(".").map(Number),
      pre: dash === -1 ? "" : v.slice(dash + 1),
    };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = (y.nums[i] ?? 0) - (x.nums[i] ?? 0);
    if (diff !== 0) return diff;
  }
  // 1.5.0 is newer than 1.5.0-beta.1.
  if (x.pre === y.pre) return 0;
  if (!x.pre) return -1;
  if (!y.pre) return 1;
  return y.pre.localeCompare(x.pre, "en", { numeric: true });
}

/** A request's steps and "now doing" line; anything that is not a step is dropped. */
function parseProgress(value: unknown): BackendRequest["progress"] {
  if (!isPlainObject(value) || !Array.isArray(value.steps)) return null;
  return {
    steps: value.steps
      .map(parseStep)
      .filter((step): step is DeploymentStep => step !== null),
    detail: stringOrNull(value.detail),
  };
}

/**
 * A request to the backend (#77). A just-written one still has a pending
 * serverTimestamp(); it reads as now, so the owner sees it at once.
 */
export function parseRequest(id: string, data: unknown): BackendRequest | null {
  if (!isPlainObject(data)) return null;
  if (
    typeof data.cafeId !== "string" ||
    typeof data.by !== "string" ||
    !oneOf(REQUEST_KINDS, data.kind) ||
    !oneOf(REQUEST_STATUSES, data.status)
  ) {
    return null;
  }
  const now = Date.now();
  return {
    id,
    cafeId: data.cafeId,
    kind: data.kind,
    params: isPlainObject(data.params) ? data.params : {},
    status: data.status,
    by: data.by,
    createdAt: toMillis(data.createdAt, now) ?? now,
    progress: parseProgress(data.progress),
    result: data.result ?? null,
    error: stringOrNull(data.error),
    errorCode: stringOrNull(data.errorCode),
    deploymentId: stringOrNull(data.deploymentId),
    finishedAt: toMillis(data.finishedAt),
  };
}
