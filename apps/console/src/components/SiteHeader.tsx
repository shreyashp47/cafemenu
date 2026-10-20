import Link from "next/link";
import { messages } from "@/lib/messages";
import { ButtonLink } from "./ButtonLink";
import { Logo } from "./Logo";
import { Rich } from "./Rich";

const { nav, status } = messages;

/** In-page sections, in page order. On the sign-up page they lead home. */
const SECTIONS = [
  { id: "how", label: nav.how },
  { id: "features", label: nav.features },
  { id: "cost", label: nav.cost },
  { id: "try", label: nav.try },
  { id: "faq", label: nav.faq },
] as const;

export function SiteHeader({ onHome = true }: { onHome?: boolean }) {
  const at = (id: string) => (onHome ? `#${id}` : `/#${id}`);
  return (
    <>
      <a
        href="#main"
        className="focus:bg-surface focus:text-ink focus:shadow-card sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:px-4 focus:py-2"
      >
        {nav.skip}
      </a>
      <div className="border-line bg-accent-soft border-b">
        <p className="text-text mx-auto w-full max-w-6xl px-4 py-2 text-center text-sm sm:px-6">
          <span className="sr-only">{status.label}: </span>
          <Rich text={status.text} />
        </p>
      </div>
      <header className="border-line bg-paper/95 supports-[backdrop-filter]:bg-paper/85 sticky top-0 z-30 border-b backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" aria-label={nav.home} className="rounded-md">
            <Logo />
          </Link>
          <nav aria-label={nav.label} className="hidden md:block">
            <ul className="flex items-center gap-1">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a
                    href={at(s.id)}
                    className="rounded-pill text-text hover:bg-sunk hover:text-ink px-3 py-2 text-[0.9375rem] font-medium"
                  >
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <ButtonLink href="/signup">{nav.signUp}</ButtonLink>
        </div>
      </header>
    </>
  );
}
