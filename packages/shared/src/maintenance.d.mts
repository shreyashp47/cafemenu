/** Types for maintenance.mjs: maintenance mode for a cafe's site (#78). */

export const MAINTENANCE_MESSAGE_MAX: number;

export type MaintenanceBy = "admin" | "owner";

/** A maintenance record as plain data, times in ms. */
export interface Maintenance {
  on: true;
  by: MaintenanceBy;
  message: string;
  until: number | null;
  startsAt: number | null;
  endsAt: number | null;
}

/** The two records as stored in the cafe's project, raw. */
export interface MaintenanceSources {
  site: unknown;
  owner: unknown;
}

export function readMaintenance(raw: unknown): Maintenance | null;
export function maintenanceActive(m: Maintenance | null, now: number): boolean;
export function activeMaintenance(
  sources: MaintenanceSources,
  now: number,
): Maintenance | null;
export function nextMaintenanceChange(
  sources: MaintenanceSources,
  now: number,
): number | null;

export type MaintenanceProblem = "message-long" | "ends-first" | "ended";

export interface MaintenanceInput {
  message?: string;
  until?: number | null;
  startsAt?: number | null;
  endsAt?: number | null;
}

export function maintenanceProblem(
  input: MaintenanceInput,
  now: number,
): MaintenanceProblem | null;

export function maintenanceRecord<T = Date>(
  input: MaintenanceInput & { by: MaintenanceBy },
  now: number,
  toTime?: (ms: number) => T,
): {
  on: true;
  by: MaintenanceBy;
  message: string;
  until: T | null;
  startsAt: T | null;
  endsAt: T | null;
};
