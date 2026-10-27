/**
 * The super admin's actions as data (#78): each form on the admin's page to
 * the params of its request (@cafemenu/shared/requests checks the same
 * shape, and so do the rules), or the problem to show instead. Pure.
 *
 * Reasons and notice periods come from the policy
 * (@cafemenu/shared/admin-policy, section 8's provisional decisions), never
 * from literals here. Times on the forms are the cafe's own wall clock, in
 * its time zone, whatever zone the admin is in; the params carry instants.
 */

import { instantIn, wallTimeIn } from "@cafemenu/shared";
import {
  ADMIN_POLICY,
  REASON_NOTE_MAX,
  earliestEffect,
  type AdminPolicy,
} from "@cafemenu/shared/admin-policy";
import { maintenanceProblem } from "@cafemenu/shared/maintenance";

import type { Cafe } from "../platform/model";
import { siteOf } from "./directory";

export type ActionProblem =
  | "reason"
  | "note-long"
  | "notice"
  | "bad-time"
  | "confirm"
  | "message-long"
  | "ended"
  | "ends-first"
  | "email";

export type Checked<T> =
  { ok: true; params: T } | { ok: false; problem: ActionProblem };

const bad = (
  problem: ActionProblem,
): { ok: false; problem: ActionProblem } => ({
  ok: false,
  problem,
});

// -- times on the forms ------------------------------------------------------------

/** "2026-11-01T22:00" for <input type="datetime-local">: the cafe's clock at `ms`. */
export function toInputTime(ms: number, timeZone: string): string {
  return wallTimeIn(timeZone, ms).replace(" ", "T");
}

/** The instant an input's value names at the cafe; null for "", undefined if none. */
export function fromInputTime(
  value: string,
  timeZone: string,
): number | null | undefined {
  if (value.trim() === "") return null;
  return instantIn(timeZone, value.trim().replace("T", " ")) ?? undefined;
}

const dateOrNull = (ms: number | null) => (ms === null ? null : new Date(ms));

// -- reasons -----------------------------------------------------------------------

export interface ReasonForm {
  reason: string;
  note: string;
}

export const EMPTY_REASON: ReasonForm = { reason: "", note: "" };

function reasonParams(
  form: ReasonForm,
  allowed: readonly string[],
): Checked<{ reason: string; note: string }> {
  if (!allowed.includes(form.reason)) return bad("reason");
  const note = form.note.trim();
  if (note.length > REASON_NOTE_MAX) return bad("note-long");
  return { ok: true, params: { reason: form.reason, note } };
}

/**
 * When a reason lets an action take effect at the earliest, asked at `now`,
 * or null when it needs no notice.
 */
export function noticeUntil(
  reason: string,
  now: number,
  policy: AdminPolicy = ADMIN_POLICY,
): number | null {
  const earliest = earliestEffect(reason, now, policy);
  return earliest > now ? earliest : null;
}

// -- suspend and reactivate ----------------------------------------------------------

export interface SuspendForm extends ReasonForm {
  /** When it takes effect; "" for now. Required for a reason with notice. */
  effectiveAt: string;
}

export function suspendParams(
  form: SuspendForm,
  timeZone: string,
  now: number,
  policy: AdminPolicy = ADMIN_POLICY,
): Checked<{ reason: string; note: string; effectiveAt: Date | null }> {
  const reason = reasonParams(form, policy.suspensionReasons);
  if (!reason.ok) return reason;
  const at = fromInputTime(form.effectiveAt, timeZone);
  if (at === undefined) return bad("bad-time");
  const notice = noticeUntil(form.reason, now, policy);
  // A minute's grace, for the time the form took to fill in.
  if (notice !== null && (at === null || at < notice - 60_000)) {
    return bad("notice");
  }
  return {
    ok: true,
    params: { ...reason.params, effectiveAt: dateOrNull(at) },
  };
}

export function reactivateParams(
  form: ReasonForm,
  policy: AdminPolicy = ADMIN_POLICY,
): Checked<{ reason: string; note: string }> {
  return reasonParams(form, policy.reactivationReasons);
}

// -- delete --------------------------------------------------------------------------

export interface DeleteForm extends ReasonForm {
  /** The cafe's web address, typed to confirm. */
  confirm: string;
}

/** Whether `typed` names the cafe's web address, however it was pasted. */
export const confirmsSite = (typed: string, cafe: Pick<Cafe, "site">) =>
  siteOf(typed) === cafe.site;

export function deleteParams(
  form: DeleteForm,
  cafe: Pick<Cafe, "site">,
  policy: AdminPolicy = ADMIN_POLICY,
): Checked<{ reason: string; note: string; confirm: string }> {
  const reason = reasonParams(form, policy.suspensionReasons);
  if (!reason.ok) return reason;
  if (!confirmsSite(form.confirm, cafe)) return bad("confirm");
  return { ok: true, params: { ...reason.params, confirm: cafe.site } };
}

// -- maintenance ---------------------------------------------------------------------

export interface MaintenanceForm extends ReasonForm {
  message: string;
  /** Expected back, shown to customers; "" for none. */
  until: string;
  /** "" to start now. */
  startsAt: string;
  /** "" to end only when turned off. */
  endsAt: string;
}

export const EMPTY_MAINTENANCE: MaintenanceForm = {
  ...EMPTY_REASON,
  message: "",
  until: "",
  startsAt: "",
  endsAt: "",
};

// A type, not an interface: it goes where params are Record<string, unknown>.
export type MaintenanceOnParams = {
  reason: string;
  note: string;
  message: string;
  until: Date | null;
  startsAt: Date | null;
  endsAt: Date | null;
  batch: string | null;
};

/** The params for one cafe; for several, each cafe's own clock reads the times. */
export function maintenanceOnParams(
  form: MaintenanceForm,
  timeZone: string,
  now: number,
  batch: string | null = null,
  policy: AdminPolicy = ADMIN_POLICY,
): Checked<MaintenanceOnParams> {
  const reason = reasonParams(form, policy.maintenanceReasons);
  if (!reason.ok) return reason;
  const until = fromInputTime(form.until, timeZone);
  const startsAt = fromInputTime(form.startsAt, timeZone);
  const endsAt = fromInputTime(form.endsAt, timeZone);
  if (until === undefined || startsAt === undefined || endsAt === undefined) {
    return bad("bad-time");
  }
  const message = form.message.trim();
  const problem = maintenanceProblem({ message, startsAt, endsAt }, now);
  if (problem) return bad(problem);
  const notice = noticeUntil(form.reason, now, policy);
  if (notice !== null && (startsAt === null || startsAt < notice - 60_000)) {
    return bad("notice");
  }
  return {
    ok: true,
    params: {
      ...reason.params,
      message,
      until: dateOrNull(until),
      startsAt: dateOrNull(startsAt),
      endsAt: dateOrNull(endsAt),
      batch,
    },
  };
}

export function maintenanceOffParams(
  note: string,
  batch: string | null = null,
): Checked<{ note: string; batch: string | null }> {
  const trimmed = note.trim();
  if (trimmed.length > REASON_NOTE_MAX) return bad("note-long");
  return { ok: true, params: { note: trimmed, batch } };
}

// -- admins --------------------------------------------------------------------------

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function adminParams(
  email: string,
  note: string,
): Checked<{ email: string; note: string }> {
  const address = email.trim();
  if (!EMAIL.test(address)) return bad("email");
  const trimmed = note.trim();
  if (trimmed.length > REASON_NOTE_MAX) return bad("note-long");
  return { ok: true, params: { email: address, note: trimmed } };
}
