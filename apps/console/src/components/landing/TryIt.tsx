import { messages } from "@/lib/messages";
import { CopyButton } from "../CopyButton";
import { Rich } from "../Rich";
import { Section } from "./Section";

const { try: tryIt } = messages;

/**
 * How to run the cafe app's demo locally, until there is a hosted one. It
 * never points at a real cafe's site: a test order there would be a real
 * order on a real counter (house rule 1).
 */
export function TryIt() {
  const lines = tryIt.commands.split("\n");
  return (
    <Section id="try" title={tryIt.title} lead={tryIt.lead} tone="sunk">
      <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:gap-12">
        {/* min-w-0: the commands scroll inside their box, not the page. */}
        <div className="min-w-0">
          <p className="text-text">
            <Rich text={tryIt.needs} />
          </p>
          <div className="bg-espresso shadow-card mt-4 overflow-hidden rounded-lg">
            <div className="border-on-dark/15 flex items-center justify-between gap-3 border-b py-2 pr-2 pl-4">
              <span className="flex gap-1.5" aria-hidden="true">
                <span className="bg-on-dark/25 size-2.5 rounded-full" />
                <span className="bg-on-dark/25 size-2.5 rounded-full" />
                <span className="bg-on-dark/25 size-2.5 rounded-full" />
              </span>
              <CopyButton
                text={tryIt.commands}
                label={tryIt.copy}
                done={tryIt.copied}
              />
            </div>
            <pre
              aria-label={tryIt.terminalLabel}
              className="text-on-dark overflow-x-auto p-4 font-mono text-[0.875rem] leading-7 sm:p-5"
              tabIndex={0}
            >
              <code>
                {lines.map((line) => (
                  <span key={line} className="block">
                    <span
                      aria-hidden="true"
                      className="text-accent select-none"
                    >
                      ${" "}
                    </span>
                    {line}
                  </span>
                ))}
              </code>
            </pre>
          </div>
        </div>

        <div className="min-w-0 space-y-5">
          <p className="text-text">{tryIt.then}</p>
          <ul className="space-y-3">
            {tryIt.pages.map((page) => (
              <li
                key={page.url}
                className="border-line bg-surface rounded-lg border p-4"
              >
                <span className="text-brand-ink text-sm font-semibold tracking-wide uppercase">
                  {page.label}
                </span>
                <a
                  href={page.url}
                  className="text-ink decoration-line-strong hover:decoration-brand mt-1 block font-mono text-[0.875rem] break-all underline underline-offset-4"
                >
                  {page.url}
                </a>
                <span className="text-muted mt-1 block text-[0.9375rem]">
                  <Rich text={page.text} />
                </span>
              </li>
            ))}
          </ul>
          <p className="text-muted text-[0.9375rem]">
            {tryIt.local} {tryIt.hosted}
          </p>
          <p className="border-accent/40 bg-accent-soft text-text rounded-lg border p-4 text-[0.9375rem]">
            <Rich text={tryIt.careful} />
          </p>
        </div>
      </div>
    </Section>
  );
}
