import Link from "next/link";
import type { ReactNode } from "react";

type Variant = "primary" | "secondary" | "inverse" | "ghost-dark";

const base =
  "inline-flex min-h-tap items-center justify-center gap-2 rounded-pill px-5 text-[0.9375rem] font-semibold transition-colors";

const variants: Record<Variant, string> = {
  primary: "bg-brand text-surface hover:bg-brand-hover",
  secondary:
    "border border-line-strong bg-surface text-ink hover:border-brand hover:text-brand-ink",
  // For the brand-coloured band.
  inverse: "bg-surface text-brand-ink hover:bg-brand-soft",
  "ghost-dark": "border border-on-dark/60 text-surface hover:bg-surface/10",
};

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
  const className = `${base} ${variants[variant]}`;
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
