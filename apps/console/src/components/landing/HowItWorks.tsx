import { messages } from "@/lib/messages";
import { Rich } from "../Rich";
import { KeyIcon } from "./icons";
import { Section } from "./Section";

const { how } = messages;

export function HowItWorks() {
  return (
    <Section id="how" title={how.title} lead={how.lead}>
      <div className="grid gap-10 lg:grid-cols-[1.5fr_1fr] lg:gap-14">
        <ol className="space-y-8">
          {how.steps.map((step, i) => (
            <li
              key={step.title}
              // A line from this step's number down to the next one's.
              className="after:bg-line-strong relative flex gap-5 after:absolute after:top-11 after:-bottom-7 after:left-5 after:w-px last:after:hidden"
            >
              <span
                aria-hidden="true"
                className="border-brand bg-paper font-display text-brand-ink relative inline-flex size-10 shrink-0 items-center justify-center rounded-full border-2 text-lg"
              >
                {i + 1}
              </span>
              <div className="pt-1.5">
                <h3 className="text-ink text-lg font-semibold">{step.title}</h3>
                <p className="text-text mt-1">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <aside className="border-line bg-surface shadow-card self-start rounded-lg border p-6">
          <span className="bg-accent-soft text-accent-ink inline-flex size-10 items-center justify-center rounded-md">
            <KeyIcon />
          </span>
          <p className="text-text mt-4">
            <Rich text={how.ownership} />
          </p>
        </aside>
      </div>
    </Section>
  );
}
