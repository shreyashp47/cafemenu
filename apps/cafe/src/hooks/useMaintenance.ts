"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import {
  activeMaintenance,
  nextMaintenanceChange,
  readMaintenance,
  type Maintenance,
} from "@cafemenu/shared/maintenance";

import {
  getMaintenanceSources,
  getServerMaintenanceSources,
  subscribeMaintenance,
} from "@/lib/maintenance";

export interface MaintenanceView {
  /** The maintenance in effect now, the admin's first; null when ordering is open. */
  active: Maintenance | null;
  /** The admin's, on (perhaps scheduled for later), or null. */
  admin: Maintenance | null;
  /** The owner's own, on (perhaps scheduled for later), or null. */
  owner: Maintenance | null;
}

/**
 * The cafe's maintenance mode, live (#78): it follows config/site and
 * config/ownerMaintenance as they change, and looks again by itself at a
 * scheduled start or end, so a page flips on time without a reload.
 */
export function useMaintenance(): MaintenanceView {
  const sources = useSyncExternalStore(
    subscribeMaintenance,
    getMaintenanceSources,
    getServerMaintenanceSources,
  );
  const [, setTick] = useState(0);
  useEffect(() => {
    const next = nextMaintenanceChange(sources, Date.now());
    if (next === null) return;
    // setTimeout holds at most ~24.8 days; a later change is looked at then.
    const wait = Math.min(Math.max(next - Date.now(), 0) + 50, 2 ** 31 - 1);
    const id = setTimeout(() => setTick((n) => n + 1), wait);
    return () => clearTimeout(id);
  });
  const now = Date.now();
  return {
    active: activeMaintenance(sources, now),
    admin: readMaintenance(sources.site),
    owner: readMaintenance(sources.owner),
  };
}
