import { messages } from "@/lib/messages";

const { steps } = messages.setup;

/**
 * Where the owner is among the five steps: done, now, or to come. Numbers
 * on screen, words for a screen reader.
 */
export function SetupSteps({ current }: { current: number }) {
  return (
    <nav aria-label={steps.label}>
      <ol className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {steps.items.map((label, i) => {
          const n = i + 1;
          const done = n < current;
          const now = n === current;
          return (
            <li
              key={label}
              aria-current={now ? "step" : undefined}
              className={`flex items-center gap-2 ${now ? "text-ink font-semibold" : "text-muted"}`}
            >
              <span
                aria-hidden="true"
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
                  done
                    ? "bg-brand text-surface"
                    : now
                      ? "border-brand text-brand-ink border-2"
                      : "border-line-field border"
                }`}
              >
                {done ? "✓" : n}
              </span>
              <span>
                {label}
                {done && <span className="sr-only"> ({steps.done})</span>}
                {now && <span className="sr-only"> ({steps.current})</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
