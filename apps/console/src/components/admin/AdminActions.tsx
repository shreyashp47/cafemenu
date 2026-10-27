"use client";

import { useState, type FormEvent } from "react";
import { ADMIN_POLICY, type AdminPolicy } from "@cafemenu/shared/admin-policy";
import type { AdminRequestKind } from "@cafemenu/shared/requests";
import { MAINTENANCE_MESSAGE_MAX } from "@cafemenu/shared/maintenance";
import { formatDateTime } from "@/lib/format";
import { errorText, fill, messages } from "@/lib/messages";
import {
  EMPTY_MAINTENANCE,
  deleteParams,
  maintenanceOffParams,
  maintenanceOnParams,
  noticeUntil,
  reactivateParams,
  suspendParams,
  toInputTime,
  type ActionProblem,
  type Checked,
  type MaintenanceForm,
} from "@/lib/admin/actions";
import type { DirectoryRow } from "@/lib/admin/directory";
import type { DataBundle } from "@/lib/data/types";
import type { Cafe } from "@/lib/platform/model";
import { Rich } from "../Rich";
import { Button } from "../Button";
import { Field, controlClass, controlProps } from "../form/Field";

const { actions: text, words } = messages.admin;

type CafeAction = Exclude<AdminRequestKind, "appoint-admin" | "remove-admin">;

/**
 * What can be asked of this cafe now. A suspension still waiting for its
 * date can be called off with reactivate, as well as asked again.
 */
export function actionsFor(
  row: DirectoryRow,
  { suspensionWaiting = false } = {},
): CafeAction[] {
  const cafe = row.cafe;
  if (!cafe) return [];
  const hasSite = cafe.projectId !== null && cafe.status !== "draft";
  return [
    ...(row.status === "suspended"
      ? (["reactivate"] as const)
      : suspensionWaiting
        ? (["suspend", "reactivate"] as const)
        : (["suspend"] as const)),
    ...(hasSite
      ? ([
          row.maintenance === "off" ? "maintenance-on" : "maintenance-off",
        ] as const)
      : []),
    "delete-owner",
  ];
}

const reasonWords = words.reasons as Record<string, string>;

function reasonsFor(kind: CafeAction, policy: AdminPolicy): readonly string[] {
  switch (kind) {
    case "reactivate":
      return policy.reactivationReasons;
    case "maintenance-on":
      return policy.maintenanceReasons;
    case "maintenance-off":
      return [];
    default:
      return policy.suspensionReasons;
  }
}

interface Form extends MaintenanceForm {
  effectiveAt: string;
  confirm: string;
}

const EMPTY: Form = { ...EMPTY_MAINTENANCE, effectiveAt: "", confirm: "" };

/**
 * The admin's actions on one cafe (#78): each a request the backend does on
 * its next run, which the cafe's history then shows. Reasons and notice
 * periods are the policy's (@cafemenu/shared/admin-policy); times are read
 * on the cafe's own clock. Delete asks for the web address to be typed.
 */
export function AdminActions({
  data,
  row,
  ownerIsAdmin,
  suspensionWaiting = false,
  policy = ADMIN_POLICY,
}: {
  data: DataBundle;
  row: DirectoryRow;
  ownerIsAdmin: boolean;
  /** A suspension is queued for a later date (its notice period). */
  suspensionWaiting?: boolean;
  policy?: AdminPolicy;
}) {
  const cafe = row.cafe as Cafe;
  const choices = actionsFor(row, { suspensionWaiting });
  const [kind, setKind] = useState<CafeAction>(choices[0]);
  const [form, setForm] = useState<Form>(EMPTY);
  const [problem, setProblem] = useState<ActionProblem | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "asked">("idle");
  const [error, setError] = useState<string | null>(null);
  const zone = cafe.settings.timeZone;
  const current = choices.includes(kind) ? kind : choices[0];
  const reasons = reasonsFor(current, policy);
  const notice = form.reason
    ? noticeUntil(form.reason, Date.now(), policy)
    : null;

  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setProblem(null);
    setState("idle");
    setError(null);
  };

  function pickReason(reason: string) {
    const until = noticeUntil(reason, Date.now(), policy);
    // A reason with notice starts the date at the earliest it may be.
    const at = until === null ? "" : toInputTime(until, zone);
    set({
      reason,
      ...(current === "suspend" && !form.effectiveAt && { effectiveAt: at }),
      ...(current === "maintenance-on" && !form.startsAt && { startsAt: at }),
    });
  }

  function paramsFor(): Checked<Record<string, unknown>> {
    const now = Date.now();
    switch (current) {
      case "suspend":
        return suspendParams(form, zone, now, policy);
      case "reactivate":
        return reactivateParams(form, policy);
      case "delete-owner":
        return deleteParams(form, cafe, policy);
      case "maintenance-on":
        return maintenanceOnParams(form, zone, now, null, policy);
      case "maintenance-off":
        return maintenanceOffParams(form.note);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const checked = paramsFor();
    if (!checked.ok) {
      setProblem(checked.problem);
      return;
    }
    setState("busy");
    try {
      await data.directory.ask({
        cafeId: cafe.id,
        kind: current,
        params: checked.params,
      });
      setForm(EMPTY);
      setState("asked");
    } catch (failure) {
      setError(errorText(failure));
      setState("idle");
    }
  }

  const problemText = (p: ActionProblem) =>
    fill(text.problems[p], {
      when: notice !== null ? formatDateTime(notice, zone) : "",
    });
  const fieldError = (...which: ActionProblem[]) =>
    problem && which.includes(problem) ? problemText(problem) : undefined;
  const blocked =
    ownerIsAdmin && (current === "suspend" || current === "delete-owner");

  return (
    <section aria-labelledby="admin-actions-title" className="space-y-4">
      <h3 id="admin-actions-title" className="text-ink text-lg font-semibold">
        {text.title}
      </h3>
      {!data.directory.canAct ? (
        <p className="text-text">
          <Rich text={text.cannot} />
        </p>
      ) : (
        <form className="space-y-4" onSubmit={submit} noValidate>
          <Field id="admin-action-kind" label={text.choose}>
            <select
              value={current}
              onChange={(e) => {
                setKind(e.target.value as CafeAction);
                set(EMPTY);
              }}
              {...controlProps("admin-action-kind", {})}
              className={`${controlClass} min-h-tap`}
            >
              {choices.map((choice) => (
                <option key={choice} value={choice}>
                  {text.kinds[choice]}
                </option>
              ))}
            </select>
          </Field>
          <p className="text-text">{text.explain[current]}</p>

          {current === "delete-owner" && (
            <p className="bg-accent-soft text-ink rounded-md p-3">
              <Rich
                text={
                  cafe.projectId
                    ? fill(text.deleteReminder, { project: cafe.projectId })
                    : text.deleteNoProject
                }
              />
            </p>
          )}
          {blocked && (
            <p role="alert" className="text-danger font-medium">
              {text.adminOwner}
            </p>
          )}

          {reasons.length > 0 && (
            <Field
              id="admin-action-reason"
              label={text.reason}
              error={fieldError("reason")}
            >
              <select
                value={form.reason}
                onChange={(e) => pickReason(e.target.value)}
                {...controlProps("admin-action-reason", {
                  error: fieldError("reason"),
                })}
                className={`${controlClass} min-h-tap`}
              >
                <option value="">{text.reasonPick}</option>
                {reasons.map((reason) => (
                  <option key={reason} value={reason}>
                    {reasonWords[reason] ?? reason}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {notice !== null &&
            (current === "suspend" || current === "maintenance-on") && (
              <p className="text-text">
                {fill(text.notice, {
                  reason: reasonWords[form.reason] ?? form.reason,
                  days: policy.noticeDays[form.reason] ?? 0,
                  when: formatDateTime(notice, zone),
                })}
              </p>
            )}

          {current === "suspend" && (
            <TimeField
              id="admin-action-effective"
              label={text.effectiveAt}
              hint={fill(text.effectiveHint, { zone })}
              value={form.effectiveAt}
              error={fieldError("notice", "bad-time")}
              onChange={(effectiveAt) => set({ effectiveAt })}
            />
          )}

          {current === "maintenance-on" && (
            <>
              <Field
                id="admin-action-message"
                label={text.message}
                hint={text.messageHint}
                error={fieldError("message-long")}
              >
                <textarea
                  rows={2}
                  maxLength={MAINTENANCE_MESSAGE_MAX}
                  value={form.message}
                  onChange={(e) => set({ message: e.target.value })}
                  {...controlProps("admin-action-message", {
                    hint: text.messageHint,
                    error: fieldError("message-long"),
                  })}
                  className={`${controlClass} py-2`}
                />
              </Field>
              <TimeField
                id="admin-action-until"
                label={text.until}
                hint={fill(text.untilHint, { zone })}
                value={form.until}
                onChange={(until) => set({ until })}
              />
              <TimeField
                id="admin-action-starts"
                label={text.startsAt}
                hint={fill(text.startsAtHint, { zone })}
                value={form.startsAt}
                error={fieldError("notice")}
                onChange={(startsAt) => set({ startsAt })}
              />
              <TimeField
                id="admin-action-ends"
                label={text.endsAt}
                hint={fill(text.endsAtHint, { zone })}
                value={form.endsAt}
                error={fieldError("ended", "ends-first", "bad-time")}
                onChange={(endsAt) => set({ endsAt })}
              />
            </>
          )}

          <Field
            id="admin-action-note"
            label={current === "maintenance-off" ? text.offNote : text.note}
            hint={text.noteHint}
            error={fieldError("note-long")}
          >
            <textarea
              rows={2}
              value={form.note}
              onChange={(e) => set({ note: e.target.value })}
              {...controlProps("admin-action-note", {
                hint: text.noteHint,
                error: fieldError("note-long"),
              })}
              className={`${controlClass} py-2`}
            />
          </Field>

          {current === "delete-owner" && (
            <Field
              id="admin-action-confirm"
              label={text.confirm}
              hint={fill(text.confirmHint, { site: cafe.site })}
              error={fieldError("confirm")}
            >
              <input
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={form.confirm}
                onChange={(e) => set({ confirm: e.target.value })}
                {...controlProps("admin-action-confirm", {
                  hint: text.confirmHint,
                  error: fieldError("confirm"),
                })}
                className={`${controlClass} min-h-tap`}
              />
            </Field>
          )}

          <Button
            type="submit"
            variant={current === "delete-owner" ? "danger" : "primary"}
            disabled={state === "busy" || blocked}
          >
            {state === "busy" ? text.asking : text.submit[current]}
          </Button>
          {state === "asked" && (
            <p role="status" className="text-brand-ink font-medium">
              {text.asked}
            </p>
          )}
          {error && (
            <p role="alert" className="text-danger font-medium">
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}

export function TimeField({
  id,
  label,
  hint,
  value,
  error,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...controlProps(id, { hint, error })}
        className={`${controlClass} min-h-tap`}
      />
    </Field>
  );
}
