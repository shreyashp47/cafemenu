/**
 * Whether the cafe's site is in maintenance (#78), for every page: the
 * admin's (config/site.maintenance, which only CafeMenu writes) and the
 * owner's (config/ownerMaintenance), both raw, as DataProvider hands them
 * over live. useMaintenance (src/hooks) says which is in effect now.
 *
 * The page only shows it. What stops an order is the rules' inMaintenance(),
 * which applies the same test (@cafemenu/shared/maintenance) with the
 * server's clock.
 */

export interface MaintenanceSources {
  site: unknown;
  owner: unknown;
}

const NONE: MaintenanceSources = Object.freeze({ site: null, owner: null });

let sources: MaintenanceSources = NONE;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

/** config/site's `maintenance`, as last read. */
export function setSiteMaintenance(raw: unknown): void {
  if (raw === sources.site) return;
  sources = { ...sources, site: raw ?? null };
  emit();
}

/** config/ownerMaintenance, as last read. */
export function setOwnerMaintenance(raw: unknown): void {
  if (raw === sources.owner) return;
  sources = { ...sources, owner: raw ?? null };
  emit();
}

export function subscribeMaintenance(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The same object until something changes. */
export const getMaintenanceSources = (): MaintenanceSources => sources;

/** What the static export renders: no maintenance known. */
export const getServerMaintenanceSources = (): MaintenanceSources => NONE;

/** Forgets both. For tests. */
export function resetMaintenance(): void {
  sources = NONE;
  emit();
}

/**
 * How an owner who has left CafeMenu ends maintenance CafeMenu left on: the
 * owner's dashboard links here (docs/super-admin-requirements.md section 4).
 */
export const MAINTENANCE_HELP_URL =
  "https://github.com/shreyashp47/cafemenu/blob/main/docs/legal/access-explained.md#maintenance-after-leaving";
