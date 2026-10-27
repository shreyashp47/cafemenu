/**
 * The super admin's policy (#78): the decisions of
 * docs/super-admin-requirements.md, section 8. They are PROVISIONAL, used in
 * the build until the maintainer settles them, so each lives here once and
 * the console, the backend and the rules follow it:
 *
 *   1. REASONS            why an account may be suspended, or a site put into
 *                         maintenance by the admin
 *   2. NOTICE_DAYS        how far ahead the owner must be told, per reason
 *   3. SUSPEND_TURNS_ON_MAINTENANCE   whether suspending also takes the
 *                         owner's sites into maintenance
 *   4. STAFF_BOARD_IN_MAINTENANCE     what the staff board can do then
 *   5. DELETE_KEEPS       what deleting an owner leaves behind
 *   6. APPOINT_OTHER_ADMINS           whether admins can appoint more admins
 *
 * firestore.rules can't import this: apps/console/firestore.rules lists the
 * reason codes again, and a test there checks the two lists agree. Change a
 * reason here and there together, and docs/legal/terms-of-service.md, which
 * tells owners the reasons.
 *
 * Plain JavaScript with types in admin-policy.d.mts, like support-window.mjs,
 * so the backend imports it on Node without a build step.
 */

/**
 * Why the admin suspends an account or takes a site into maintenance.
 * Decision 1. `migration` is for maintenance only: the platform's own work on
 * a cafe's data, such as #21's move of TOE's prices to paise (section 3.4).
 */
export const SUSPENSION_REASONS = Object.freeze([
  "abuse",
  "security",
  "legal-request",
  "non-payment",
  "owner-request",
]);
export const MAINTENANCE_REASONS = Object.freeze([
  ...SUSPENSION_REASONS,
  "migration",
]);

/**
 * Why the admin reactivates an account. Not one of section 8's decisions:
 * the doc asks for a reason from a list, and these are the ones that end a
 * suspension.
 */
export const REACTIVATION_REASONS = Object.freeze([
  "resolved",
  "payment-received",
  "made-in-error",
  "owner-request",
]);

/** The words for each reason, in emails, the log and the console. */
export const REASON_LABELS = Object.freeze({
  abuse: "abuse of the service",
  security: "a security problem",
  "legal-request": "a legal request",
  "non-payment": "non-payment",
  "owner-request": "your own request",
  migration: "work on your cafe's data",
  resolved: "the matter was resolved",
  "payment-received": "your payment was received",
  "made-in-error": "it was a mistake",
});

/**
 * How many days ahead the owner must be told before a suspension or an
 * admin's maintenance takes effect, per reason. Decision 2: none for
 * security and abuse, 7 days for non-payment. The decision says nothing of
 * the others; none, because a legal request or the owner's own can't wait,
 * and a migration is announced with its release.
 */
export const NOTICE_DAYS = Object.freeze({
  abuse: 0,
  security: 0,
  "legal-request": 0,
  "non-payment": 7,
  "owner-request": 0,
  migration: 0,
});

/** Decision 3: suspending leaves the site alone; the admin chooses maintenance separately. */
export const SUSPEND_TURNS_ON_MAINTENANCE = false;

/** Decision 4: "full", the staff board works as ever during maintenance; or "read-only". */
export const STAFF_BOARD_IN_MAINTENANCE = "full";

/**
 * Decision 5: deleting an owner removes everything CafeMenu holds about them
 * (their login, owner record, cafes, the cafes' setup, deployments, requests
 * and email records), except the admin log, which keeps its entries.
 */
export const DELETE_KEEPS = Object.freeze(["adminLog"]);

/**
 * Decision 6: only the first admin for now. Appointing and removing admins is
 * built (the backend does it, the console has the form), but the backend
 * refuses to appoint while this is false. The first admin is made once with
 * `npm run make-admin -w @cafemenu/platform-functions`.
 */
export const APPOINT_OTHER_ADMINS = false;

export const ADMIN_POLICY = Object.freeze({
  suspensionReasons: SUSPENSION_REASONS,
  reactivationReasons: REACTIVATION_REASONS,
  maintenanceReasons: MAINTENANCE_REASONS,
  noticeDays: NOTICE_DAYS,
  suspendTurnsOnMaintenance: SUSPEND_TURNS_ON_MAINTENANCE,
  staffBoardInMaintenance: STAFF_BOARD_IN_MAINTENANCE,
  deleteKeeps: DELETE_KEEPS,
  appointOtherAdmins: APPOINT_OTHER_ADMINS,
});

/** The longest free text an admin may add to a reason. */
export const REASON_NOTE_MAX = 500;

const DAY = 86_400_000;

/**
 * The earliest a suspension or an admin's maintenance for `reason`, asked
 * for at `askedAt` (ms), may take effect: `askedAt` itself when no notice is
 * due. `policy` defaults to ADMIN_POLICY.
 */
export function earliestEffect(reason, askedAt, policy = ADMIN_POLICY) {
  const days = policy.noticeDays[reason] ?? 0;
  return askedAt + days * DAY;
}
