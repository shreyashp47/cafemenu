"use client";

import Link from "next/link";

import { maintenanceActive } from "@cafemenu/shared/maintenance";

import { useCafeSettings } from "@/hooks/useCafeSettings";
import { useMaintenance } from "@/hooks/useMaintenance";
import { t } from "@/lib/i18n";
import { rich } from "@/lib/i18n-rich";
import { MAINTENANCE_HELP_URL } from "@/lib/maintenance";
import { formatWhen } from "@/lib/maintenance-form";

const BOX =
  "border-highlight bg-highlight-soft text-ink mb-3 rounded-md border-2 px-3 py-2 text-sm";

/**
 * The line at the top of the staff board and the owner's dashboard while the
 * site is in maintenance (#78), so nobody wonders why no orders come in. The
 * board keeps working (orders already placed can be finished); the owner
 * also hears whose maintenance it is, and, for CafeMenu's, that only
 * CafeMenu can end it and how to if they leave CafeMenu while it's on.
 */
export function MaintenanceBanner({ who }: { who: "staff" | "owner" }) {
  const { active, admin } = useMaintenance();
  const { settings } = useCafeSettings();
  const now = Date.now();

  if (who === "staff") {
    return active ? (
      <p role="status" className={BOX}>
        {t("siteMaintenance.staffBanner")}
      </p>
    ) : null;
  }

  if (admin && maintenanceActive(admin, now)) {
    return (
      <div role="status" className={BOX}>
        <p className="font-semibold">{t("siteMaintenance.adminBanner")}</p>
        <p className="text-muted mt-1">
          {rich("siteMaintenance.adminLeft", {
            link: (words) => (
              <a
                href={MAINTENANCE_HELP_URL}
                target="_blank"
                rel="noreferrer"
                className="text-primary font-semibold underline"
              >
                {words}
              </a>
            ),
          })}
        </p>
      </div>
    );
  }
  if (admin && admin.startsAt !== null && admin.startsAt > now) {
    return (
      <p role="status" className={BOX}>
        {t("siteMaintenance.adminScheduled", {
          when: formatWhen(admin.startsAt, settings.timeZone),
        })}
      </p>
    );
  }
  return active ? (
    <p role="status" className={BOX}>
      {t("siteMaintenance.ownerBanner")}{" "}
      <Link
        href="/admin#maintenance-mode"
        className="text-primary font-semibold underline"
      >
        {t("siteMaintenance.turnOff")}
      </Link>
    </p>
  ) : null;
}
