/**
 * What each plan includes (issue #17).
 *
 * CafeMenu is free for now and may have paid plans later (PLAN.md, "Pricing").
 * So that adding one is not a rework, every feature a plan could switch is
 * asked for through `features(settings)` instead of being assumed, even while
 * the only plan, "free", includes all of them and nothing anybody sees changes.
 *
 * To add a feature: add it to `Features`, then say for every plan in PLAN_FEATURES
 * whether it has it (the type insists), then ask `features(settings).yourFeature`
 * where the app shows it. To add a plan: add it to PLANS in ./settings.ts and
 * give it a row here.
 *
 * This decides what the app shows, not what it allows: anything that has to be
 * enforced (a cap on tables, say) needs firestore.rules as well.
 */

import type { CafeSettings, PlanId } from "./settings.ts";

export interface Features {
  /** The CSV download of the orders on /admin/reports. */
  csvExport: boolean;
}

export const PLAN_FEATURES: {
  readonly [P in PlanId]: Readonly<Features>;
} = Object.freeze({
  free: Object.freeze({ csvExport: true }),
});

/**
 * What this cafe's plan includes. A plan this release does not know (one added
 * by a later release) gets the free plan's features; parseCafeSettings already
 * reads an unknown plan as the base's, which is "free" unless something says
 * otherwise.
 */
export function features(settings: Pick<CafeSettings, "plan">): Features {
  return { ...(PLAN_FEATURES[settings.plan] ?? PLAN_FEATURES.free) };
}
