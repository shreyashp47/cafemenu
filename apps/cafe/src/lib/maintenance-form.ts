/**
 * The owner's maintenance form (#78), as data: the dashboard's fields to the
 * record config/ownerMaintenance holds, and times to and from the form. Every
 * time on the form is the cafe's own wall clock (its settings' time zone),
 * whatever zone the owner's phone is in, so "22:00" means 22:00 at the cafe.
 */

import { instantIn, wallTimeIn } from "@cafemenu/shared";
import {
  maintenanceProblem,
  maintenanceRecord,
} from "@cafemenu/shared/maintenance";

import type { OwnerMaintenance } from "./data/types";
import { getLocale } from "./i18n";

/** What the form holds: text as typed, times as <input type="datetime-local"> gives them. */
export interface MaintenanceForm {
  message: string;
  /** When the cafe expects to be back, shown to customers; "" for none. */
  until: string;
  /** "" to start now. */
  startsAt: string;
  /** "" to end only when turned off. */
  endsAt: string;
}

export const EMPTY_MAINTENANCE_FORM: MaintenanceForm = {
  message: "",
  until: "",
  startsAt: "",
  endsAt: "",
};

export type MaintenanceFormProblem =
  "message-long" | "ended" | "ends-first" | "bad-time";

/** "2026-11-01T22:00" for <input type="datetime-local">: the cafe's wall clock at `ms`. */
export function toInputTime(ms: number, timeZone: string): string {
  return wallTimeIn(timeZone, ms).replace(" ", "T");
}

/** The instant of an input's value at the cafe, or null for "" ; undefined when it isn't one. */
export function fromInputTime(
  value: string,
  timeZone: string,
): number | null | undefined {
  if (value === "") return null;
  return instantIn(timeZone, value.replace("T", " ")) ?? undefined;
}

/** The record to save, or why it can't be. */
export function ownerMaintenanceFrom(
  form: MaintenanceForm,
  timeZone: string,
  now: number,
):
  | { ok: true; record: OwnerMaintenance }
  | { ok: false; problem: MaintenanceFormProblem } {
  const until = fromInputTime(form.until, timeZone);
  const startsAt = fromInputTime(form.startsAt, timeZone);
  const endsAt = fromInputTime(form.endsAt, timeZone);
  if (until === undefined || startsAt === undefined || endsAt === undefined) {
    return { ok: false, problem: "bad-time" };
  }
  const input = { message: form.message, until, startsAt, endsAt };
  const problem = maintenanceProblem(input, now);
  if (problem) return { ok: false, problem };
  const record = maintenanceRecord({ ...input, by: "owner" }, now);
  return { ok: true, record: record as OwnerMaintenance };
}

/** "1 Nov 2026, 10:00 pm", as the cafe's clock shows `ms`, in its locale. */
export function formatWhen(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat(getLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(ms));
}
