"use client";

import type { Maintenance } from "@cafemenu/shared/maintenance";

import { CafeMark } from "@/components/CafeMark";
import { Doodles } from "@/components/Doodles";
import { useCafeSettings } from "@/hooks/useCafeSettings";
import { t } from "@/lib/i18n";
import { formatWhen } from "@/lib/maintenance-form";

/**
 * What a customer sees instead of the menu while the cafe's site is in
 * maintenance (#78): the cafe's name and logo, its message (or ours), and
 * when it expects to be back, in the cafe's own time. The QR codes keep
 * pointing here, so nothing needs reprinting; an order already placed keeps
 * its own status screen. The page is only the polite half: the rules refuse
 * a new order whatever a page sends.
 */
export function MaintenancePage({ maintenance }: { maintenance: Maintenance }) {
  const { settings } = useCafeSettings();
  return (
    <main className="relative mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-5 px-5 py-10 text-center">
      <Doodles />
      <CafeMark size={96} />
      <p className="font-hand text-primary-dark text-2xl">{settings.name}</p>
      <h1 className="text-3xl">{t("maintenance.title")}</h1>
      <p className="text-body max-w-sm text-base leading-snug">
        {maintenance.message || t("maintenance.defaultMessage")}
      </p>
      {maintenance.until !== null ? (
        <p className="text-body font-semibold">
          {t("maintenance.backAt", {
            when: formatWhen(maintenance.until, settings.timeZone),
          })}
        </p>
      ) : null}
      <p className="text-muted max-w-xs text-sm">
        {t("maintenance.placedOrders")}
      </p>
    </main>
  );
}
