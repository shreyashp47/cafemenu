import type { ReactNode } from "react";
import { Rich } from "../Rich";

/**
 * One landing-page section: its own id for the header's links, an h2 named
 * by `aria-labelledby`, and an optional lead paragraph.
 */
export function Section({
  id,
  title,
  lead,
  tone = "paper",
  children,
}: {
  id: string;
  title: string;
  lead?: string;
  tone?: "paper" | "sunk";
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={tone === "sunk" ? "bg-sunk" : undefined}
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="max-w-2xl">
          <h2
            id={`${id}-title`}
            className="font-display text-ink text-3xl leading-tight tracking-tight sm:text-4xl"
          >
            {title}
          </h2>
          {lead && (
            <p className="text-text mt-4 text-lg">
              <Rich text={lead} />
            </p>
          )}
        </div>
        <div className="mt-10 sm:mt-12">{children}</div>
      </div>
    </section>
  );
}
