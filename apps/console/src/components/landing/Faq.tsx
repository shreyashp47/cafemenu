import { messages } from "@/lib/messages";
import { Rich } from "../Rich";
import { Section } from "./Section";

const { faq } = messages;

/** Plain <details>: no script, works with a keyboard and a screen reader. */
export function Faq() {
  return (
    <Section id="faq" title={faq.title}>
      <div className="divide-line border-line bg-surface shadow-card max-w-3xl divide-y rounded-xl border">
        {faq.items.map((item) => (
          <details key={item.q} className="group">
            <summary className="min-h-tap text-ink flex cursor-pointer items-center justify-between gap-4 px-5 py-4 text-lg font-semibold sm:px-6">
              {item.q}
              <span
                aria-hidden="true"
                className="text-brand-ink relative size-5 shrink-0 before:absolute before:top-1/2 before:left-0 before:h-0.5 before:w-5 before:-translate-y-1/2 before:bg-current after:absolute after:top-0 after:left-1/2 after:h-5 after:w-0.5 after:-translate-x-1/2 after:bg-current after:transition-transform group-open:after:scale-y-0"
              />
            </summary>
            <p className="text-text px-5 pb-5 sm:px-6">
              <Rich text={item.a} />
            </p>
          </details>
        ))}
      </div>
    </Section>
  );
}
