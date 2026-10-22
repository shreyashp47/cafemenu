import { CafeName } from "@/components/CafeIdentity";
import { Mascot } from "@/components/Mascot";
import Link from "next/link";
import { t } from "@/lib/i18n";

export const metadata = {
  title: t("offline.metaTitle"),
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
      <h1 className="font-hand text-primary text-4xl">
        {t("offline.signalLost")}
      </h1>
      <p className="text-muted max-w-sm">{t("offline.pageNeedsCafes")}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Link
          href="/order"
          className="rounded-pill bg-primary font-round text-on-dark inline-flex min-h-11 items-center justify-center px-5 font-semibold"
        >
          {t("offline.tryAgain")}
        </Link>
        <Link
          href="/staff"
          className="rounded-pill border-line bg-paper font-round text-ink inline-flex min-h-11 items-center justify-center border-2 px-5 font-semibold"
        >
          {t("offline.orderBoard")}
        </Link>
      </div>
      <p className="text-2xs text-muted">
        <CafeName />
      </p>
    </main>
  );
}
