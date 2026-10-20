"use client";

/**
 * Owner gate + chrome for /admin.
 *
 * docs/requirements.md §3: staff and owner are both authenticated, but only the owner
 * can change the menu. The real enforcement is the Firestore rules
 * (isOwner()); this is the UI half, and it deliberately explains itself in plain
 * language because the cafe owner is not assumed to be technical (§2).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Icon, type IconName } from "@/components/icons";
import { Mascot } from "@/components/Mascot";
import { NotSetUp } from "@/components/NotSetUp";
import { OwnerSwitch } from "@/components/OwnerSwitch";
import {
  DataProvider,
  useStaffSession,
} from "@/components/providers/DataProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Loading } from "@/components/ui/Loading";
import { getCafeName } from "@/lib/config";
import { DEMO_CREDENTIALS } from "@/lib/data/seed";

const NAV: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/admin", label: "Menu", icon: "drink" },
  { href: "/admin/reports", label: "Reports", icon: "chart" },
  // "History", not "Orders": the Orders | Owner switch above means the live board
  { href: "/admin/orders", label: "History", icon: "clock" },
  { href: "/admin/qr", label: "Table QR codes", icon: "qr" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <DataProvider>
      <Gate>{children}</Gate>
    </DataProvider>
  );
}

function Gate({ children }: { children: ReactNode }) {
  const { user, loading, signOut } = useStaffSession();

  if (loading) return <Loading label="Opening the till…" />;

  if (!user) return <SignedOut />;
  if (user.role === "unassigned") {
    return <NotSetUp user={user} onSignOut={() => void signOut()} />;
  }
  if (user.role !== "owner") return <NotOwner />;

  return <Shell>{children}</Shell>;
}

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, signOut } = useStaffSession();

  return (
    <div className="min-h-svh pb-10">
      <header className="safe-t border-line-soft bg-cream/95 sticky top-0 z-30 border-b-2 backdrop-blur">
        <div className="shell-wide flex items-center gap-2.5 py-2.5">
          <Mascot size={40} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg leading-tight">Owner dashboard</h1>
            <p className="text-2xs text-muted truncate font-semibold tracking-[0.12em] uppercase">
              {getCafeName()}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            aria-label="Sign out"
            className="rounded-pill border-line bg-paper text-muted grid size-11 shrink-0 place-items-center border-2"
          >
            <Icon name="logout" size={20} />
          </button>
        </div>

        <OwnerSwitch
          role={user?.role}
          current="owner"
          className="shell-wide pb-2"
        />

        <nav aria-label="Dashboard sections" className="shell-wide pb-2">
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {NAV.map((item) => {
              const active =
                item.href === "/admin"
                  ? pathname === "/admin"
                  : pathname.startsWith(item.href);
              return (
                <li key={item.href} className="shrink-0">
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={[
                      "rounded-pill font-round flex min-h-11 items-center gap-1.5 border-2 px-3.5 text-sm transition-colors",
                      active
                        ? "border-primary bg-primary text-on-dark"
                        : "border-line bg-paper text-ink",
                    ].join(" ")}
                  >
                    <Icon name={item.icon} size={17} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>

      <main className="shell-wide pt-4">{children}</main>
    </div>
  );
}

function SignedOut() {
  return (
    <div className="shell flex min-h-svh flex-col items-center justify-center gap-4 text-center">
      <Mascot mood="worry" size={120} />
      <h1 className="font-hand text-primary text-4xl">Owner sign-in</h1>
      <p className="text-muted max-w-xs">
        This page changes your menu and shows your sales. Sign in on the staff
        screen with the owner account.
      </p>
      <Link href="/staff">
        <Button size="lg">Go to sign in</Button>
      </Link>
    </div>
  );
}

function NotOwner() {
  return (
    <div className="shell flex min-h-svh flex-col items-center justify-center gap-4 text-center">
      <Mascot mood="worry" size={120} />
      <h1 className="font-hand text-primary text-4xl">Owner only</h1>
      <p className="text-muted max-w-sm">
        You&apos;re signed in as staff, so you can run the order board — but
        menu edits and sales reports belong to the owner account.
      </p>
      <Card className="w-full max-w-xs p-4 text-left text-sm">
        <p className="text-ink font-semibold">Demo owner account</p>
        <p className="tnum text-muted mt-1">
          {DEMO_CREDENTIALS.owner.email} / {DEMO_CREDENTIALS.owner.password}
        </p>
      </Card>
      <Link href="/staff">
        <Button size="lg" variant="secondary">
          Back to the order board
        </Button>
      </Link>
    </div>
  );
}
