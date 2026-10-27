import { messages } from "@/lib/messages";
import type { DeploymentStep } from "@/lib/platform/model";

const { history: text } = messages.cafe.updates;

/** The steps of a deployment or a request, each with where it has got to. */
export function StepList({ steps }: { steps: readonly DeploymentStep[] }) {
  if (steps.length === 0) return null;
  return (
    <ol aria-label={text.stepsLabel} className="mt-3 space-y-1 text-sm">
      {steps.map((step) => (
        <li key={step.id} className="flex gap-2">
          <span
            aria-hidden="true"
            className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
              step.status === "done"
                ? "bg-brand"
                : step.status === "running"
                  ? "bg-accent"
                  : step.status === "failed"
                    ? "bg-danger"
                    : "bg-line-strong"
            }`}
          />
          <span className="text-text">
            {step.label}
            <span className="text-muted"> ({text.step[step.status]})</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
