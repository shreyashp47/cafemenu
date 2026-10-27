/**
 * The super admin's directory of owners and cafes (#78, section 3.1 of
 * docs/super-admin-requirements.md) as data: one row per cafe with its
 * owner, plus a row for each account with no cafe; the search, the filters
 * and the CSV export. Pure, so every case is tested without a browser.
 *
 * Built from `owners/` (the backend's copy of Authentication), `cafes/` and
 * the latest deployments: what the rules let the admin read. Nothing here
 * reaches a cafe's orders, customers or staff, which live in the owner's
 * own project.
 */

import { PLANS, type PlanId } from "@cafemenu/shared";
import { maintenanceActive } from "@cafemenu/shared/maintenance";

import type {
  Cafe,
  CafeMaintenance,
  Deployment,
  OwnerRecord,
  OwnerStatus,
} from "../platform/model";
import {
  HEALTH_LEVELS,
  adminRows,
  followOf,
  type CafeHealth,
  type HealthLevel,
  type Smoke,
} from "./overview";

/** Where a cafe's site is with CafeMenu's maintenance. */
export type MaintenanceState = "on" | "scheduled" | "off";

export function maintenanceState(
  maintenance: CafeMaintenance | null | undefined,
  now: number,
): MaintenanceState {
  if (!maintenance) return "off";
  if (maintenanceActive(maintenance, now)) return "on";
  return maintenance.startsAt !== null && maintenance.startsAt > now
    ? "scheduled"
    : "off";
}

export interface DirectoryRow {
  /** Unique in the list: the cafe's id, or "owner:<uid>" for one with none. */
  key: string;
  cafe: Cafe | null;
  /** The account, when the directory has it (the hourly copy may lag). */
  owner: OwnerRecord | null;
  ownerUid: string;
  email: string;
  status: OwnerStatus;
  health: CafeHealth | null;
  last: Deployment | null;
  smoke: { result: Smoke; at: number } | null;
  maintenance: MaintenanceState;
}

/**
 * Every cafe with its owner, those that need a look first, then by name
 * (adminRows); then every account with no cafe, by email. A suspended
 * owner's cafes read as suspended whatever the directory says, since the
 * cafe record is what the backend changes first.
 */
export function directoryRows(
  cafes: readonly Cafe[],
  owners: readonly OwnerRecord[],
  deployments: readonly Deployment[],
  now: number,
): DirectoryRow[] {
  const ownerOf = new Map(owners.map((o) => [o.uid, o]));
  const rows: DirectoryRow[] = adminRows(cafes, deployments).map(
    ({ cafe, health, last, smoke }) => {
      const owner = ownerOf.get(cafe.ownerUid) ?? null;
      return {
        key: cafe.id,
        cafe,
        owner,
        ownerUid: cafe.ownerUid,
        email: owner?.email ?? cafe.ownerEmail,
        status:
          cafe.status === "suspended" || owner?.status === "suspended"
            ? "suspended"
            : "active",
        health,
        last,
        smoke,
        maintenance: maintenanceState(cafe.maintenance, now),
      };
    },
  );
  const withCafe = new Set(cafes.map((c) => c.ownerUid));
  const cafeless: DirectoryRow[] = owners
    .filter((o) => !withCafe.has(o.uid))
    .sort((a, b) => a.email.localeCompare(b.email, "en"))
    .map((owner) => ({
      key: `owner:${owner.uid}`,
      cafe: null,
      owner,
      ownerUid: owner.uid,
      email: owner.email,
      status: owner.status,
      health: null,
      last: null,
      smoke: null,
      maintenance: "off",
    }));
  return [...rows, ...cafeless];
}

export interface DirectorySummary {
  owners: number;
  total: number;
  live: number;
  suspended: number;
  maintenance: number;
  attention: number;
}

export function directorySummary(
  rows: readonly DirectoryRow[],
): DirectorySummary {
  const cafes = rows.filter((r) => r.cafe !== null);
  return {
    owners: new Set(rows.map((r) => r.ownerUid)).size,
    total: cafes.length,
    live: cafes.filter((r) => r.cafe?.status === "live").length,
    suspended: new Set(
      rows.filter((r) => r.status === "suspended").map((r) => r.ownerUid),
    ).size,
    maintenance: cafes.filter((r) => r.maintenance === "on").length,
    attention: cafes.filter((r) => r.health?.level === "attention").length,
  };
}

// -- search and filters -------------------------------------------------------------

export interface DirectoryFilters {
  status: "all" | OwnerStatus;
  maintenance: "all" | MaintenanceState;
  plan: "all" | PlanId;
  /** How the cafe follows releases. */
  channel: "all" | "stable" | "beta" | "pinned";
  health: "all" | HealthLevel;
}

export const NO_FILTERS: DirectoryFilters = {
  status: "all",
  maintenance: "all",
  plan: "all",
  channel: "all",
  health: "all",
};

/** The choices each filter offers, "all" first. */
export const FILTER_CHOICES = {
  status: ["all", "active", "suspended"],
  maintenance: ["all", "on", "scheduled", "off"],
  plan: ["all", ...PLANS],
  channel: ["all", "stable", "beta", "pinned"],
  health: ["all", ...HEALTH_LEVELS],
} as const satisfies { [K in keyof DirectoryFilters]: readonly string[] };

/** "harbour-beans.web.app" from what an admin might paste: a URL, a name. */
export function siteOf(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.(web\.app|firebaseapp\.com)$/, "");
}

/** What a row is found by: email, owner name, cafe name, web address, project ID. */
function searchable(row: DirectoryRow): string[] {
  return [
    row.email,
    row.owner?.name ?? "",
    row.cafe?.settings.name ?? "",
    row.cafe ? `${row.cafe.site}.web.app` : "",
    row.cafe?.projectId ?? "",
  ].map((field) => field.toLowerCase());
}

export function matchesFilters(
  row: DirectoryRow,
  filters: DirectoryFilters,
): boolean {
  const { cafe } = row;
  if (filters.status !== "all" && row.status !== filters.status) return false;
  if (filters.maintenance !== "all" && row.maintenance !== filters.maintenance)
    return false;
  // An account with no cafe has no plan, channel or health to match.
  if (filters.plan !== "all" && cafe?.settings.plan !== filters.plan)
    return false;
  if (
    filters.channel !== "all" &&
    (!cafe || followOf(cafe.release).kind !== filters.channel)
  )
    return false;
  if (filters.health !== "all" && row.health?.level !== filters.health)
    return false;
  return true;
}

export function filterDirectory(
  rows: readonly DirectoryRow[],
  filters: DirectoryFilters,
  query: string,
): DirectoryRow[] {
  const q = query.trim().toLowerCase();
  const site = siteOf(query);
  return rows.filter(
    (row) =>
      matchesFilters(row, filters) &&
      (!q ||
        searchable(row).some(
          (field) => field.includes(q) || (site !== "" && field.includes(site)),
        )),
  );
}

// -- CSV -----------------------------------------------------------------------------

/**
 * One CSV cell: quoted when it must be, and a value a spreadsheet would run
 * as a formula (=, +, -, @ first) prefixed with ', so an owner's cafe name
 * can't become one in the admin's spreadsheet.
 */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(
  header: readonly string[],
  lines: readonly (readonly unknown[])[],
): string {
  return [header, ...lines]
    .map((line) => line.map(csvCell).join(","))
    .join("\r\n");
}

/** "2026-10-27T09:30:00.000Z", or empty. */
const iso = (ms: number | null | undefined) =>
  typeof ms === "number" ? new Date(ms).toISOString() : "";

export const DIRECTORY_CSV_HEADER = [
  "owner_name",
  "owner_email",
  "signed_up",
  "last_sign_in",
  "status",
  "cafe_name",
  "web_address",
  "firebase_project",
  "cafe_status",
  "maintenance",
  "plan",
  "version",
  "channel",
  "last_deploy",
  "last_deploy_status",
  "health",
] as const;

/** The directory as CSV, one line per row, in the order given. */
export function directoryCsv(rows: readonly DirectoryRow[]): string {
  return toCsv(
    DIRECTORY_CSV_HEADER,
    rows.map((row) => {
      const { cafe, owner, last } = row;
      const follow = cafe ? followOf(cafe.release) : null;
      return [
        owner?.name ?? "",
        row.email,
        iso(owner?.createdAt ?? cafe?.createdAt),
        iso(owner?.lastSignInAt),
        row.status,
        cafe?.settings.name ?? "",
        cafe ? `https://${cafe.site}.web.app` : "",
        cafe?.projectId ?? "",
        cafe?.status ?? "",
        row.maintenance,
        cafe?.settings.plan ?? "",
        cafe?.release.current ?? "",
        follow
          ? follow.line
            ? `${follow.kind} ${follow.line}`
            : follow.kind
          : "",
        iso(last?.createdAt),
        last?.status ?? "",
        row.health?.level ?? "",
      ];
    }),
  );
}
