import Link from "next/link";
import type { ReactNode } from "react";

export type Variant =
  "primary" | "secondary" | "danger" | "inverse" | "ghost-dark";

const base =
  "inline-flex min-h-tap items-center justify-center gap-2 rounded-pill px-5 text-[0.9375rem] font-semibold transition-colors";

const variants: Record<Variant, string> = {
  primary: "bg-brand text-surface hover:bg-brand-hover",
  secondary:
    "border border-line-strong bg-surface text-ink hover:border-brand hover:text-brand-ink",
  // What can't be undone: the admin's delete (#78).
  danger: "bg-danger text-surface hover:opacity-90",
  // For the brand-coloured band.
  inverse: "bg-surface text-brand-ink hover:bg-brand-soft",
  "ghost-dark": "border border-on-dark/60 text-surface hover:bg-surface/10",
};

/** The classes of a button-like control, for <button>s that match the links. */
export const buttonClass = (variant: Variant = "primary") =>
  `${base} ${variants[variant]}`;

/**
 * A link that looks like a button. In-page anchors (#try) and other sites get
 * a plain <a>; pages of the console go through next/link.
 */
export function ButtonLink({
  href,
  variant = "primary",
  children,
}: {
  href: string;
  variant?: Variant;
  children: ReactNode;
}) {
  const className = buttonClass(variant);
  if (href.startsWith("/") && !href.startsWith("//")) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}
