import { Mascot } from "@/components/Mascot";
import { getCafeName } from "@/lib/config";
import Link from "next/link";

export const metadata = {
  title: "No connection",
  robots: { index: false, follow: false },
};

/**
 * Served by the service worker when a navigation fails (see public/sw.js). It is
 * deliberately dependency-free: it has to render from cache with no JS runtime
 * assumptions beyond the link back.
 */
export default function OfflinePage() {
  return (
    <main className="relative flex min-h-svh flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      <Mascot mood="sleepy" size={136} />
      <h1 className="font-hand text-primary text-4xl">Signal lost</h1>
      <p className="text-muted max-w-sm">
        This page needs the cafe&apos;s wifi. Reconnect and it will load by
        itself — your basket and your order are safe on this phone.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Link
          href="/order"
          className="rounded-pill bg-primary font-round text-on-dark inline-flex min-h-11 items-center justify-center px-5 font-semibold"
        >
          Try again
        </Link>
        <Link
          href="/staff"
          className="rounded-pill border-line bg-paper font-round text-ink inline-flex min-h-11 items-center justify-center border-2 px-5 font-semibold"
        >
          Order board
        </Link>
      </div>
      <p className="text-2xs text-muted">{getCafeName()}</p>
    </main>
  );
}
