import { messages } from "@/lib/messages";
import { Rich } from "../Rich";
import { CheckIcon } from "./icons";
import { Section } from "./Section";

const { cost } = messages;

export function Cost() {
  return (
    <Section id="cost" title={cost.title} lead={cost.lead}>
      <ul className="grid gap-5 md:grid-cols-2">
        {cost.plans.map((plan) => (
          <li
            key={plan.name}
            className="border-line bg-surface shadow-card rounded-xl border p-7"
          >
            <h3 className="text-ink text-lg font-semibold">{plan.name}</h3>
            <p className="mt-3 flex items-baseline gap-2">
              <span className="font-display text-ink text-4xl">
                {plan.price}
              </span>
              <span className="text-muted">{plan.detail}</span>
            </p>
            <ul className="mt-6 space-y-3">
              {plan.items.map((item) => (
                <li key={item} className="text-text flex gap-3">
                  <span className="text-brand-ink mt-0.5">
                    <CheckIcon />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <div className="text-text mt-8 max-w-3xl space-y-3">
        <p>
          <Rich text={cost.need} />
        </p>
        <p className="text-muted">{cost.later}</p>
      </div>
    </Section>
  );
}
