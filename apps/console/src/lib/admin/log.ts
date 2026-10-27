/**
 * The admin log on the admin's page (#78, section 3.3): filtered by action
 * and by what it is about, and exported as CSV. Entries are the backend's,
 * written once and never changed; this only reads them. Pure.
 */

import type { AdminLogEntry, Cafe, OwnerRecord } from "../platform/model";
import { toCsv } from "./directory";

export const LOG_ACTIONS = [
  "all",
  "suspend",
  "reactivate",
  "delete-owner",
  "maintenance-on",
  "maintenance-off",
  "appoint-admin",
  "remove-admin",
] as const;
export type LogAction = (typeof LOG_ACTIONS)[number];

export interface LogFilter {
  action: LogAction;
  /** Matched against the cafe's name and address, the owner's and the admin's email, the note. */
  query: string;
}

export interface LogLookups {
  cafes: ReadonlyMap<string, Cafe>;
  owners: ReadonlyMap<string, OwnerRecord>;
}

/** The cafe's name, or what the entry kept of a cafe that has been deleted. */
export function logCafeName(entry: AdminLogEntry, { cafes }: LogLookups) {
  const cafe = entry.cafeId ? cafes.get(entry.cafeId) : undefined;
  if (cafe) return cafe.settings.name;
  const site = entry.details.site;
  return typeof site === "string" ? `${site}.web.app` : (entry.cafeId ?? "");
}

export function logOwnerEmail(entry: AdminLogEntry, { owners }: LogLookups) {
  const owner = entry.ownerUid ? owners.get(entry.ownerUid) : undefined;
  const email = entry.details.email;
  return owner?.email ?? (typeof email === "string" ? email : "");
}

export function filterLog(
  entries: readonly AdminLogEntry[],
  filter: LogFilter,
  lookups: LogLookups,
): AdminLogEntry[] {
  const q = filter.query.trim().toLowerCase();
  return entries.filter(
    (entry) =>
      (filter.action === "all" || entry.action === filter.action) &&
      (!q ||
        [
          logCafeName(entry, lookups),
          logOwnerEmail(entry, lookups),
          entry.byEmail ?? "",
          entry.reason?.code ?? "",
          entry.reason?.note ?? "",
        ].some((field) => field.toLowerCase().includes(q))),
  );
}

export const LOG_CSV_HEADER = [
  "at",
  "admin",
  "action",
  "cafe",
  "cafe_id",
  "owner",
  "reason",
  "note",
  "details",
] as const;

export function logCsv(
  entries: readonly AdminLogEntry[],
  lookups: LogLookups,
): string {
  return toCsv(
    LOG_CSV_HEADER,
    entries.map((entry) => [
      new Date(entry.at).toISOString(),
      entry.byEmail ?? entry.by,
      entry.action,
      logCafeName(entry, lookups),
      entry.cafeId ?? "",
      logOwnerEmail(entry, lookups),
      entry.reason?.code ?? "",
      entry.reason?.note ?? "",
      JSON.stringify(entry.details),
    ]),
  );
}
