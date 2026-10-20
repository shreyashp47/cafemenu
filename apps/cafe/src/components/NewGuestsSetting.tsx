"use client";

import { useState } from "react";

import {
  useOrderingSettings,
  useSessionRepo,
} from "@/components/providers/DataProvider";
import { Card } from "@/components/ui/Card";
import { Switch } from "@/components/ui/Switch";
import { TABLE_OPEN_HOURS } from "@/lib/table-open";

/**
 * "Approve new tables": the owner's switch for staff confirming new guests
 * (src/lib/table-open.ts), saved to config/ordering. OFF by default, so every
 * order goes straight to the kitchen until the owner turns it on. Lives on
 * the owner's dashboard (/admin), near the top.
 */
export function NewGuestsSetting() {
  const repo = useSessionRepo();
  const { settings, loading } = useOrderingSettings();
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const on = settings.confirmNewGuests;

  async function toggle(next: boolean) {
    if (!repo) return;
    setState("busy");
    try {
      await repo.saveSettings({ confirmNewGuests: next });
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <Card className="p-4 print:hidden">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-60">
          <h2 className="text-lg" id="approve-new-tables">
            Approve new tables
          </h2>
          <p className="text-muted mt-0.5 text-sm">
            Off: every order goes straight to the kitchen. On: a table&apos;s
            first order waits for staff to tap Accept, and then its orders go
            straight through for {TABLE_OPEN_HOURS} hours.
          </p>
        </div>
        <Switch
          checked={on}
          onChange={(next) => void toggle(next)}
          disabled={loading || state === "busy"}
          label={on ? "On" : "Off"}
          srContext="Approve new tables"
          // A setting, not an alarm: off is the normal state now.
          tone="plain"
        />
      </div>
      {state === "error" ? (
        <p role="alert" className="text-berry-deep mt-2 text-sm font-semibold">
          That didn&apos;t save. Try again.
        </p>
      ) : null}
    </Card>
  );
}
