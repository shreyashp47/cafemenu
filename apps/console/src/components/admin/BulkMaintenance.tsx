"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ADMIN_POLICY } from "@cafemenu/shared/admin-policy";
import { MAINTENANCE_MESSAGE_MAX } from "@cafemenu/shared/maintenance";
import { formatDateTime } from "@/lib/format";
import { errorText, fill, messages } from "@/lib/messages";
import {
  EMPTY_MAINTENANCE,
  noticeUntil,
  type ActionProblem,
  type MaintenanceForm,
} from "@/lib/admin/actions";
import {
  bulkParams,
  bulkStatus,
  forgetPlan,
  isFinishedBatch,
  loadPlans,
  newBatchId,
  revertPlan,
  runBulk,
  savePlan,
  toResume,
  type BulkKind,
  type BulkPlan,
} from "@/lib/admin/bulk";
import type { BackendRequest, Cafe } from "@/lib/platform/model";
import type { DataBundle } from "@/lib/data/types";
import { Button, TextButton } from "../Button";
import { Field, FormSection, controlClass, controlProps } from "../form/Field";
import { TimeField } from "./AdminActions";

const { bulk: text, actions, words } = messages.admin;

/** How many of the admin's own requests the batches are read from. */
export const MINE_LIMIT = 300;

type Skipped = Array<{ cafeId: string; why: string }>;

/**
 * Maintenance on several cafes at once (#78): the form for the selected
 * cafes, then each batch this browser started, with how far it got and
 * Resume (the cafes never asked, and those that failed) and Revert
 * (maintenance off on every cafe the batch turned it on).
 */
export function BulkMaintenance({
  data,
  cafes,
  selected,
  open,
  onClose,
}: {
  data: DataBundle;
  cafes: ReadonlyMap<string, Cafe>;
  selected: readonly string[];
  open: boolean;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<BulkKind>("maintenance-on");
  const [form, setForm] = useState<MaintenanceForm>(EMPTY_MAINTENANCE);
  const [problem, setProblem] = useState<string | null>(null);
  const [running, setRunning] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [skipped, setSkipped] = useState<Skipped>([]);
  const [plans, setPlans] = useState<BulkPlan[]>(() => loadPlans(Date.now()));
  const [mine, setMine] = useState<BackendRequest[]>([]);

  useEffect(
    () => data.directory.subscribeMine(MINE_LIMIT, setMine, () => setMine([])),
    [data],
  );

  const nameOf = (id: string) => cafes.get(id)?.settings.name ?? id;
  const problemText = (p: ActionProblem) => {
    const notice = form.reason ? noticeUntil(form.reason, Date.now()) : null;
    return fill(actions.problems[p], {
      when: notice === null ? "" : formatDateTime(notice),
    });
  };
  const names = useMemo(
    () => selected.map((id) => cafes.get(id)?.settings.name ?? id).join(", "),
    [selected, cafes],
  );

  async function run(plan: BulkPlan, cafeIds: readonly string[]) {
    savePlan(plan, Date.now());
    setPlans(loadPlans(Date.now()));
    setSkipped([]);
    let done = 0;
    setRunning({ done, total: cafeIds.length });
    const left = await runBulk(plan, cafeIds, cafes, async (input) => {
      const id = await data.directory.ask(input);
      done += 1;
      setRunning({ done, total: cafeIds.length });
      return id;
    });
    setRunning(null);
    setSkipped(
      left.map(({ cafeId, why }) => ({
        cafeId,
        why: typeof why === "string" ? problemText(why) : errorText(why),
      })),
    );
  }

  async function start(event: FormEvent) {
    event.preventDefault();
    const now = Date.now();
    const plan: BulkPlan = {
      batch: newBatchId(now),
      kind,
      cafeIds: [...selected],
      form,
      startedAt: now,
    };
    // The form's own problems, as the first cafe sees them, before anything is asked.
    const first = cafes.get(selected[0]);
    const checked = first ? bulkParams(plan, first, now) : null;
    if (checked && !checked.ok && checked.problem !== "ended") {
      setProblem(problemText(checked.problem));
      return;
    }
    setProblem(null);
    await run(plan, plan.cafeIds);
    setForm(EMPTY_MAINTENANCE);
    onClose();
  }

  if (!data.directory.canAct) return null;
  if (!open && plans.length === 0) return null;

  const set = (patch: Partial<MaintenanceForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setProblem(null);
  };

  return (
    <FormSection id="admin-bulk" title={text.title}>
      {open && selected.length > 0 && (
        <form className="space-y-4" onSubmit={start} noValidate>
          <p className="text-text">{text.explain}</p>
          <p className="text-ink font-medium">{fill(text.cafes, { names })}</p>
          <Field id="bulk-kind" label={text.kind.label}>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as BulkKind)}
              {...controlProps("bulk-kind", {})}
              className={`${controlClass} min-h-tap`}
            >
              <option value="maintenance-on">
                {text.kind["maintenance-on"]}
              </option>
              <option value="maintenance-off">
                {text.kind["maintenance-off"]}
              </option>
            </select>
          </Field>
          {kind === "maintenance-on" && (
            <>
              <Field id="bulk-reason" label={actions.reason}>
                <select
                  value={form.reason}
                  onChange={(e) => set({ reason: e.target.value })}
                  {...controlProps("bulk-reason", {})}
                  className={`${controlClass} min-h-tap`}
                >
                  <option value="">{actions.reasonPick}</option>
                  {ADMIN_POLICY.maintenanceReasons.map((reason) => (
                    <option key={reason} value={reason}>
                      {(words.reasons as Record<string, string>)[reason] ??
                        reason}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                id="bulk-message"
                label={actions.message}
                hint={actions.messageHint}
              >
                <textarea
                  rows={2}
                  maxLength={MAINTENANCE_MESSAGE_MAX}
                  value={form.message}
                  onChange={(e) => set({ message: e.target.value })}
                  {...controlProps("bulk-message", {
                    hint: actions.messageHint,
                  })}
                  className={`${controlClass} py-2`}
                />
              </Field>
              <TimeField
                id="bulk-until"
                label={actions.until}
                hint={text.untilHint}
                value={form.until}
                onChange={(until) => set({ until })}
              />
              <TimeField
                id="bulk-starts"
                label={actions.startsAt}
                hint={text.startsAtHint}
                value={form.startsAt}
                onChange={(startsAt) => set({ startsAt })}
              />
              <TimeField
                id="bulk-ends"
                label={actions.endsAt}
                hint={text.endsAtHint}
                value={form.endsAt}
                onChange={(endsAt) => set({ endsAt })}
              />
            </>
          )}
          <Field id="bulk-note" label={actions.note} hint={actions.noteHint}>
            <textarea
              rows={2}
              value={form.note}
              onChange={(e) => set({ note: e.target.value })}
              {...controlProps("bulk-note", { hint: actions.noteHint })}
              className={`${controlClass} py-2`}
            />
          </Field>
          {problem && (
            <p role="alert" className="text-danger font-medium">
              {problem}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Button type="submit" disabled={running !== null}>
              {selected.length === 1
                ? text.start.one
                : fill(text.start.other, { count: selected.length })}
            </Button>
            <TextButton onClick={onClose}>{text.cancel}</TextButton>
          </div>
        </form>
      )}

      {running && (
        <p role="status" className="text-text">
          {fill(text.asking, { ...running })}
        </p>
      )}
      {skipped.length > 0 && (
        <ul role="alert" className="text-danger list-disc pl-5">
          {skipped.map(({ cafeId, why }) => (
            <li key={cafeId}>
              {fill(text.skipped, { name: nameOf(cafeId), why })}
            </li>
          ))}
        </ul>
      )}

      {plans.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-ink text-lg font-semibold">{text.batches}</h3>
          <ul className="space-y-3">
            {plans.map((plan) => {
              const status = bulkStatus(plan, mine);
              const again = toResume(status);
              const counts = {
                done: status.done.length,
                waiting: status.waiting.length,
                failed: status.failed.length,
                notAsked: status.notAsked.length,
              };
              return (
                <li
                  key={plan.batch}
                  className="border-line space-y-2 rounded-lg border p-3"
                >
                  <p className="text-ink font-semibold">
                    {fill(text.batch, {
                      kind: text.kind[plan.kind],
                      when: formatDateTime(plan.startedAt),
                    })}
                  </p>
                  <p className="text-text">
                    {fill(text.progress, counts)}{" "}
                    {isFinishedBatch(status) && counts.failed === 0
                      ? text.finished
                      : ""}
                  </p>
                  <div className="flex flex-wrap gap-x-5 gap-y-1">
                    {again.length > 0 && (
                      <TextButton
                        disabled={running !== null}
                        onClick={() => void run(plan, again)}
                      >
                        {text.resume}
                      </TextButton>
                    )}
                    {plan.kind === "maintenance-on" &&
                      status.done.length + status.waiting.length > 0 && (
                        <TextButton
                          disabled={running !== null}
                          onClick={() => {
                            const now = Date.now();
                            const revert = revertPlan(
                              plan,
                              status,
                              now,
                              fill(text.revertNote, { batch: plan.batch }),
                            );
                            if (revert) void run(revert, revert.cafeIds);
                          }}
                        >
                          {text.revert}
                        </TextButton>
                      )}
                    <TextButton
                      onClick={() => {
                        forgetPlan(plan.batch, Date.now());
                        setPlans(loadPlans(Date.now()));
                      }}
                    >
                      {text.forget}
                    </TextButton>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </FormSection>
  );
}
