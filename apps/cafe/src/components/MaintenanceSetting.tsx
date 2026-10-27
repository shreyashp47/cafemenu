"use client";

import { useState, type FormEvent } from "react";

import {
  MAINTENANCE_MESSAGE_MAX,
  maintenanceActive,
  type Maintenance,
} from "@cafemenu/shared/maintenance";

import { useConfigRepo } from "@/components/providers/DataProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Input, Textarea } from "@/components/ui/Input";
import { useCafeSettings } from "@/hooks/useCafeSettings";
import { useMaintenance } from "@/hooks/useMaintenance";
import type { OwnerMaintenance } from "@/lib/data/types";
import { t, type MessageKey } from "@/lib/i18n";
import {
  EMPTY_MAINTENANCE_FORM,
  formatWhen,
  ownerMaintenanceFrom,
  type MaintenanceForm,
  type MaintenanceFormProblem,
} from "@/lib/maintenance-form";

const PROBLEMS: Record<MaintenanceFormProblem, MessageKey> = {
  "message-long": "siteMaintenance.problems.messageLong",
  ended: "siteMaintenance.problems.ended",
  "ends-first": "siteMaintenance.problems.endsFirst",
  "bad-time": "siteMaintenance.problems.badTime",
};

/** The owner's maintenance, unless it has already ended by its own schedule. */
function stillOn(owner: Maintenance | null, now: number): Maintenance | null {
  if (!owner) return null;
  return owner.endsAt !== null && owner.endsAt <= now ? null : owner;
}

/**
 * "Maintenance mode", the owner's own (#78): pause ordering for a holiday or
 * a renovation, with a message, an expected return, and a start and end in
 * the cafe's time. Saved to config/ownerMaintenance, which the rules check
 * before every order. CafeMenu's maintenance (config/site) is separate: it
 * shows here, and only CafeMenu can end it. On the owner's dashboard (/admin).
 */
export function MaintenanceSetting() {
  const repo = useConfigRepo();
  const { settings, ready } = useCafeSettings();
  const { owner, admin } = useMaintenance();
  const [form, setForm] = useState<MaintenanceForm>(EMPTY_MAINTENANCE_FORM);
  const [problem, setProblem] = useState<MaintenanceFormProblem | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const zone = settings.timeZone;
  const now = Date.now();
  const on = stillOn(owner, now);

  async function save(record: OwnerMaintenance | null) {
    if (!repo) return;
    setState("busy");
    try {
      await repo.saveOwnerMaintenance(record);
      setState("idle");
      if (record === null) setForm(EMPTY_MAINTENANCE_FORM);
    } catch {
      setState("error");
    }
  }

  function turnOn(event: FormEvent) {
    event.preventDefault();
    const result = ownerMaintenanceFrom(form, zone, Date.now());
    if (!result.ok) {
      setProblem(result.problem);
      return;
    }
    setProblem(null);
    void save(result.record);
  }

  const edit =
    (key: keyof MaintenanceForm) => (event: { target: { value: string } }) => {
      setProblem(null);
      setForm((f) => ({ ...f, [key]: event.target.value }));
    };

  return (
    <Card className="p-4 print:hidden">
      <h2 className="text-lg" id="maintenance-mode">
        {t("siteMaintenance.title")}
      </h2>
      <p className="text-muted mt-0.5 text-sm">
        {t("siteMaintenance.explain")}
      </p>

      {admin ? (
        <p className="text-body mt-2 text-sm font-semibold">
          {t("siteMaintenance.adminToo")}
        </p>
      ) : null}

      {on ? (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-ink text-sm font-semibold" role="status">
            {maintenanceActive(on, now)
              ? t("siteMaintenance.onNow")
              : t("siteMaintenance.onScheduled", {
                  when: formatWhen(on.startsAt ?? now, zone),
                })}{" "}
            {on.endsAt !== null
              ? t("siteMaintenance.endsWhen", {
                  when: formatWhen(on.endsAt, zone),
                })
              : null}
          </p>
          {on.message ? (
            <p className="border-line bg-cream-soft text-body rounded-sm border-2 px-2 py-1.5 text-sm">
              {on.message}
            </p>
          ) : null}
          <Button
            variant="secondary"
            disabled={!repo || state === "busy"}
            onClick={() => void save(null)}
          >
            {state === "busy"
              ? t("siteMaintenance.saving")
              : t("siteMaintenance.turnOff")}
          </Button>
        </div>
      ) : (
        <form className="mt-3 flex flex-col gap-3" onSubmit={turnOn} noValidate>
          <Field
            label={t("siteMaintenance.message")}
            hint={t("siteMaintenance.messageHint")}
            error={
              problem === "message-long"
                ? t(PROBLEMS["message-long"])
                : undefined
            }
            htmlFor="maintenance-message"
          >
            <Textarea
              id="maintenance-message"
              rows={2}
              maxLength={MAINTENANCE_MESSAGE_MAX}
              value={form.message}
              onChange={edit("message")}
            />
          </Field>
          <Field
            label={t("siteMaintenance.until")}
            hint={t("siteMaintenance.untilHint", { zone })}
            htmlFor="maintenance-until"
          >
            <Input
              id="maintenance-until"
              type="datetime-local"
              value={form.until}
              onChange={edit("until")}
            />
          </Field>
          <Field
            label={t("siteMaintenance.startsAt")}
            hint={t("siteMaintenance.startsAtHint", { zone })}
            htmlFor="maintenance-starts"
          >
            <Input
              id="maintenance-starts"
              type="datetime-local"
              value={form.startsAt}
              onChange={edit("startsAt")}
            />
          </Field>
          <Field
            label={t("siteMaintenance.endsAt")}
            hint={t("siteMaintenance.endsAtHint", { zone })}
            error={
              problem && problem !== "message-long"
                ? t(PROBLEMS[problem])
                : undefined
            }
            htmlFor="maintenance-ends"
          >
            <Input
              id="maintenance-ends"
              type="datetime-local"
              value={form.endsAt}
              onChange={edit("endsAt")}
            />
          </Field>
          <Button type="submit" disabled={!repo || !ready || state === "busy"}>
            {state === "busy"
              ? t("siteMaintenance.saving")
              : t("siteMaintenance.turnOn")}
          </Button>
        </form>
      )}

      {state === "error" ? (
        <p role="alert" className="text-berry-deep mt-2 text-sm font-semibold">
          {t("siteMaintenance.didntSave")}
        </p>
      ) : null}
    </Card>
  );
}
