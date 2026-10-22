"use client";

/**
 * What a real cafe's page shows when it cannot find its Firebase project
 * (src/lib/boot.ts): offline with nothing kept on this device, or deployed
 * without a Firebase web app. Never the demo store instead: a customer would
 * order from the sample menu and the order would go nowhere.
 *
 * DataProvider also retries by itself when the device comes back online.
 */

import { Mascot } from "@/components/Mascot";
import { Button } from "@/components/ui/Button";
import { useCafeSettings } from "@/hooks/useCafeSettings";
import { t } from "@/lib/i18n";

export function CafeUnreachable({
  reason,
  onRetry,
}: {
  reason: "offline" | "no-config";
  onRetry: () => void;
}) {
  const { settings } = useCafeSettings();
  return (
    <main className="relative flex min-h-svh flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      <Mascot mood="sleepy" size={136} />
      <h1 className="font-hand text-primary text-4xl">
        {reason === "offline"
          ? t("unreachable.cantReach")
          : t("unreachable.notOpen")}
      </h1>
      <p className="text-muted max-w-sm">
        {reason === "offline"
          ? t("unreachable.offlineBody")
          : t("unreachable.setupBody")}
      </p>
      <Button size="lg" onClick={onRetry}>
        {t("unreachable.tryAgain")}
      </Button>
      {settings.name ? (
        <p className="text-2xs text-muted">{settings.name}</p>
      ) : null}
    </main>
  );
}
