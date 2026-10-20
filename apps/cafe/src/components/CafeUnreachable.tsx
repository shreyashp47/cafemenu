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
        {reason === "offline" ? "Can't reach the cafe" : "Not open yet"}
      </h1>
      <p className="text-muted max-w-sm">
        {reason === "offline"
          ? "This page needs a connection to load the menu and orders. Check the wifi or mobile data and try again."
          : "This cafe's site is still being set up. Try again in a minute, or order at the counter."}
      </p>
      <Button size="lg" onClick={onRetry}>
        Try again
      </Button>
      {settings.name ? (
        <p className="text-2xs text-muted">{settings.name}</p>
      ) : null}
    </main>
  );
}
