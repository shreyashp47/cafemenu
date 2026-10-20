import { messages } from "@/lib/messages";
import { Logo } from "./Logo";

const { footer } = messages;

export function SiteFooter() {
  return (
    <footer className="bg-espresso text-on-dark-muted">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr]">
        <div className="space-y-3">
          <Logo onDark />
          <p className="max-w-sm">{footer.tagline}</p>
          <p className="text-sm">{footer.licence}</p>
          <p className="text-sm">{footer.legal}</p>
        </div>
        <nav aria-label={footer.linksLabel}>
          <h2 className="text-on-dark text-sm font-semibold tracking-wide uppercase">
            {footer.linksLabel}
          </h2>
          <ul className="mt-3 space-y-1">
            {footer.links.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="min-h-tap text-on-dark decoration-on-dark/40 hover:decoration-on-dark inline-flex items-center underline underline-offset-4"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
