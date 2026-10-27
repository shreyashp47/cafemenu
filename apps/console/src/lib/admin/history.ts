/**
 * One cafe's full history for the admin (#78, section 3.1): its requests,
 * deployments, status changes, maintenance windows and the emails its owner
 * was sent, as one timeline, newest first. Pure.
 */

import type {
  AdminLogEntry,
  BackendRequest,
  Deployment,
  SentEmail,
} from "../platform/model";
import type { CafeHistory } from "../data/types";

export type HistoryItem =
  | { kind: "request"; at: number; request: BackendRequest }
  | { kind: "deployment"; at: number; deployment: Deployment }
  | { kind: "admin"; at: number; entry: AdminLogEntry }
  | { kind: "email"; at: number; email: SentEmail };

export const HISTORY_FILTERS = [
  "all",
  "requests",
  "deployments",
  "status",
  "maintenance",
  "emails",
] as const;
export type HistoryFilter = (typeof HISTORY_FILTERS)[number];

const STATUS_ACTIONS = ["suspend", "reactivate", "delete-owner"];
const MAINTENANCE_ACTIONS = ["maintenance-on", "maintenance-off"];

function matches(item: HistoryItem, filter: HistoryFilter): boolean {
  switch (filter) {
    case "requests":
      return item.kind === "request";
    case "deployments":
      return item.kind === "deployment";
    case "status":
      return (
        item.kind === "admin" && STATUS_ACTIONS.includes(item.entry.action)
      );
    case "maintenance":
      return (
        item.kind === "admin" && MAINTENANCE_ACTIONS.includes(item.entry.action)
      );
    case "emails":
      return item.kind === "email";
    default:
      return true;
  }
}

/**
 * The timeline. An admin request that went through is shown by its log
 * entry, which says more; one that waits or failed is shown as itself.
 */
export function historyItems(
  history: CafeHistory,
  filter: HistoryFilter = "all",
): HistoryItem[] {
  const logged = new Set(history.log.map((e) => e.id));
  const items: HistoryItem[] = [
    ...history.requests
      .filter((r) => !logged.has(r.id))
      .map((request) => ({
        kind: "request" as const,
        at: request.createdAt,
        request,
      })),
    ...history.deployments.map((deployment) => ({
      kind: "deployment" as const,
      at: deployment.createdAt,
      deployment,
    })),
    ...history.log.map((entry) => ({
      kind: "admin" as const,
      at: entry.at,
      entry,
    })),
    ...history.emails.map((email) => ({
      kind: "email" as const,
      at: email.at,
      email,
    })),
  ];
  return items
    .filter((item) => matches(item, filter))
    .sort((a, b) => b.at - a.at);
}

export interface MaintenanceWindow {
  from: number;
  /** When it was turned off; null while it is on. */
  to: number | null;
  on: AdminLogEntry;
  off: AdminLogEntry | null;
}

/** CafeMenu's maintenance windows on the cafe, newest first, from the log. */
export function maintenanceWindows(
  log: readonly AdminLogEntry[],
): MaintenanceWindow[] {
  const windows: MaintenanceWindow[] = [];
  let open: MaintenanceWindow | null = null;
  for (const entry of [...log].sort((a, b) => a.at - b.at)) {
    if (entry.action === "maintenance-on") {
      // A second "on" replaces the first's settings: one window still.
      if (!open) {
        open = { from: entry.at, to: null, on: entry, off: null };
        windows.push(open);
      }
    } else if (entry.action === "maintenance-off" && open) {
      open.to = entry.at;
      open.off = entry;
      open = null;
    }
  }
  return windows.reverse();
}
