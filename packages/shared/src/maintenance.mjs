/**
 * Maintenance mode for a cafe's website (#78, docs/super-admin-requirements.md
 * section 3.4): while it is on, customers see a "back soon" page instead of
 * the menu and no new order is taken; an order already placed, the staff
 * board and the owner's dashboard keep working.
 *
 * Two documents in the cafe's own project hold it, with the same shape:
 *
 *   config/site.maintenance   the admin's, written by CafeMenu's deploy
 *                             account only; the owner can't clear it
 *   config/ownerMaintenance   the owner's own, from their dashboard
 *
 *   { on, by: "admin" | "owner", message, until, startsAt, endsAt }
 *
 *   message    what customers read; empty for the default ("We'll be back soon")
 *   until      when the cafe expects to be back, shown to customers; null for
 *              no date. Only words: it ends nothing.
 *   startsAt   when it takes effect; null for at once
 *   endsAt     when it ends by itself; null for when it is turned off
 *
 * Times are instants (Firestore timestamps); a form takes them in the cafe's
 * own time zone (instantIn in time-zone.ts). The cafe's firestore.rules apply
 * the same test as maintenanceActive below, against the server's clock, so a
 * schedule starts and ends on time whatever the phone's clock says.
 *
 * Plain JavaScript with types in maintenance.d.mts, so the backend imports
 * it on Node without a build step.
 */
import { toMillis } from "./support-window.mjs";

/** The longest message customers are shown. firestore.rules has the same. */
export const MAINTENANCE_MESSAGE_MAX = 280;

/**
 * A stored maintenance record as plain data with times in ms, or null when
 * it isn't one, or is off. Never throws on a bad record: a document that
 * doesn't make sense reads as no maintenance, and the rules (which fail
 * closed) still decide about orders.
 */
export function readMaintenance(raw) {
  if (typeof raw !== "object" || raw === null || raw.on !== true) return null;
  const time = (value) =>
    value === null || value === undefined ? null : toMillis(value);
  return {
    on: true,
    by: raw.by === "admin" ? "admin" : "owner",
    message:
      typeof raw.message === "string"
        ? raw.message.slice(0, MAINTENANCE_MESSAGE_MAX)
        : "",
    until: time(raw.until),
    startsAt: time(raw.startsAt),
    endsAt: time(raw.endsAt),
  };
}

/** Whether `m` (from readMaintenance) is in effect at `now` (ms). */
export function maintenanceActive(m, now) {
  return (
    m !== null &&
    m.on === true &&
    (m.startsAt === null || m.startsAt <= now) &&
    (m.endsAt === null || now < m.endsAt)
  );
}

/**
 * The maintenance in effect at `now`, from the admin's and the owner's
 * records (raw, as stored), or null. The admin's wins when both are on: it
 * is the one the owner can't end.
 */
export function activeMaintenance({ site, owner }, now) {
  for (const raw of [site, owner]) {
    const m = readMaintenance(raw);
    if (maintenanceActive(m, now)) return m;
  }
  return null;
}

/**
 * When the answer to activeMaintenance next changes on its own (a scheduled
 * start or end after `now`), or null: when a page should look again.
 */
export function nextMaintenanceChange({ site, owner }, now) {
  const times = [site, owner]
    .map(readMaintenance)
    .filter((m) => m !== null)
    .flatMap((m) => [m.startsAt, m.endsAt])
    .filter((t) => t !== null && t > now);
  return times.length ? Math.min(...times) : null;
}

/**
 * What is wrong with maintenance about to be turned on, or null:
 *
 *   message-long   longer than MAINTENANCE_MESSAGE_MAX
 *   ends-first     endsAt is not after startsAt (or after now, when it starts at once)
 *   ended          endsAt is already past
 *
 * Times in ms or null.
 */
export function maintenanceProblem(
  { message = "", startsAt = null, endsAt = null },
  now,
) {
  if (typeof message !== "string" || message.length > MAINTENANCE_MESSAGE_MAX)
    return "message-long";
  if (endsAt !== null && endsAt <= now) return "ended";
  if (endsAt !== null && startsAt !== null && endsAt <= startsAt)
    return "ends-first";
  return null;
}

/**
 * The record to store for maintenance turned on by `by`, with each time
 * through `toTime` (to a Date, or a Firestore Timestamp). Throws a TypeError
 * naming the problem, so nothing wrong is ever written.
 */
export function maintenanceRecord(
  { by, message = "", until = null, startsAt = null, endsAt = null },
  now,
  toTime = (ms) => new Date(ms),
) {
  if (by !== "admin" && by !== "owner") {
    throw new TypeError("Maintenance is the admin's or the owner's.");
  }
  const problem = maintenanceProblem({ message, startsAt, endsAt }, now);
  if (problem)
    throw new TypeError(`This maintenance can't be set (${problem}).`);
  const time = (ms) => (ms === null ? null : toTime(ms));
  return {
    on: true,
    by,
    message: message.trim(),
    until: time(until),
    startsAt: time(startsAt),
    endsAt: time(endsAt),
  };
}
