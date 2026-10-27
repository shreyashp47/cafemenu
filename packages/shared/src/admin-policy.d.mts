/** Types for admin-policy.mjs: section 8's provisional decisions (#78). */

export type SuspensionReason =
  "abuse" | "security" | "legal-request" | "non-payment" | "owner-request";

export type MaintenanceReason = SuspensionReason | "migration";

export type ReactivationReason =
  "resolved" | "payment-received" | "made-in-error" | "owner-request";

export type AnyReason = MaintenanceReason | ReactivationReason;

export const SUSPENSION_REASONS: readonly SuspensionReason[];
export const MAINTENANCE_REASONS: readonly MaintenanceReason[];
export const REACTIVATION_REASONS: readonly ReactivationReason[];
export const REASON_LABELS: Readonly<Record<AnyReason, string>>;
export const NOTICE_DAYS: Readonly<Record<MaintenanceReason, number>>;
export const SUSPEND_TURNS_ON_MAINTENANCE: boolean;
export const STAFF_BOARD_IN_MAINTENANCE: "full" | "read-only";
export const DELETE_KEEPS: readonly string[];
export const APPOINT_OTHER_ADMINS: boolean;

export interface AdminPolicy {
  suspensionReasons: readonly SuspensionReason[];
  reactivationReasons: readonly ReactivationReason[];
  maintenanceReasons: readonly MaintenanceReason[];
  noticeDays: Readonly<Record<string, number>>;
  suspendTurnsOnMaintenance: boolean;
  staffBoardInMaintenance: "full" | "read-only";
  deleteKeeps: readonly string[];
  appointOtherAdmins: boolean;
}

export const ADMIN_POLICY: AdminPolicy;
export const REASON_NOTE_MAX: number;

export function earliestEffect(
  reason: string,
  askedAt: number,
  policy?: AdminPolicy,
): number;
