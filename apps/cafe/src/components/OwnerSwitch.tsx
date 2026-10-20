/**
 * The owner's way between the order board and the owner dashboard.
 *
 * The owner signs in on /staff like everyone else and is sent to the dashboard;
 * the board is one tap away. The way across used to be an unlabelled chart icon
 * (and an unlabelled cart icon back), and the owner did not realise the
 * dashboard was there. This is a labelled two-part switch instead — "Orders | Owner" — shown only to the owner.
 * They are links, not tabs: each side is its own page.
 */

import Link from "next/link";

import { Icon, type IconName } from "@/components/icons";
import type { StaffRole } from "@/lib/data/types";

type Side = "orders" | "owner";

const SIDES: Array<{
  side: Side;
  href: string;
  label: string;
  icon: IconName;
}> = [
  { side: "orders", href: "/staff", label: "Orders", icon: "cart" },
  { side: "owner", href: "/admin", label: "Owner", icon: "chart" },
];

export function OwnerSwitch({
  role,
  current,
  className = "",
}: {
  role: StaffRole | undefined;
  current: Side;
  className?: string;
}) {
  if (role !== "owner") return null;

  return (
    <nav aria-label="Switch screen" className={className}>
      <ul className="rounded-pill border-line bg-paper grid grid-cols-2 gap-1 border-2 p-1 sm:inline-grid sm:min-w-72">
        {SIDES.map((s) => {
          const active = s.side === current;
          return (
            <li key={s.side}>
              <Link
                href={s.href}
                aria-current={active ? "page" : undefined}
                className={[
                  "rounded-pill font-round flex min-h-11 items-center justify-center gap-1.5 border-2 px-3.5 text-sm transition-colors",
                  active
                    ? "border-primary bg-primary text-on-dark"
                    : "text-ink border-transparent",
                ].join(" ")}
              >
                <Icon name={s.icon} size={17} />
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
