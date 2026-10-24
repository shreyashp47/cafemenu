import { formatDateTime } from "@/lib/format";
import { fill, messages } from "@/lib/messages";
import type { Deployment } from "@/lib/platform/model";
import { ACTIVE_STATUSES } from "@/lib/owner/updates";

const { history: text } = messages.cafe.updates;

/** What a deployment did, in a few words: "Upgrade from 1.1.0 to 1.1.1". */
export function deploymentTitle(d: Deployment): string {
  const version = d.version ?? "";
  switch (d.kind) {
    case "deploy":
      return d.fromVersion
        ? fill(text.kind.deployFrom, { from: d.fromVersion, version })
        : fill(text.kind.deploy, { version });
    case "rollback":
      return fill(text.kind.rollback, { version });
    default:
      return text.kind[d.kind];
  }
}

/** Past tense for the latest one; its steps while it runs or when it failed. */
function Item({ d, detailed }: { d: Deployment; detailed: boolean }) {
  const active = ACTIVE_STATUSES.includes(d.status);
  const bad = d.status === "failed" || d.status === "rolled-back";
  return (
    <div>
      <p className="text-ink font-semibold">{deploymentTitle(d)}</p>
      <p className={bad ? "text-danger font-medium" : "text-text"}>
        {text.status[d.status]}
        <span className="text-muted font-normal">
          {" · "}
          {text.trigger[d.trigger]}
          {" · "}
          <time dateTime={new Date(d.createdAt).toISOString()}>
            {formatDateTime(d.createdAt)}
          </time>
        </span>
      </p>
      {d.error && (
        <p className="bg-danger-soft text-danger mt-2 rounded-md p-3 text-sm">
          {fill(text.failed, { error: d.error })}
        </p>
      )}
      {detailed && (active || bad) && d.steps.length > 0 && (
        <ol aria-label={text.stepsLabel} className="mt-3 space-y-1 text-sm">
          {d.steps.map((step) => (
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
      )}
    </div>
  );
}

/**
 * The cafe's deployments, newest first (the repository already limits it):
 * the latest one in full, with its steps while it runs or if it failed, and
 * the rest folded away.
 */
export function DeploymentList({
  deployments,
}: {
  deployments: readonly Deployment[];
}) {
  const [latest, ...earlier] = deployments;
  return (
    <section aria-labelledby="updates-history-title" className="space-y-3">
      <h3 id="updates-history-title" className="text-ink text-lg font-semibold">
        {text.title}
      </h3>
      {!latest && <p className="text-muted">{text.none}</p>}
      {latest && (
        <div
          role="status"
          aria-label={text.latest}
          className="border-line bg-sunk rounded-lg border p-4"
        >
          <Item d={latest} detailed />
        </div>
      )}
      {earlier.length > 0 && (
        <details className="group">
          <summary className="text-brand-ink min-h-tap inline-flex cursor-pointer items-center font-medium underline underline-offset-4">
            {fill(text.show, { count: earlier.length })}
          </summary>
          <ul className="divide-line mt-2 divide-y">
            {earlier.map((d) => (
              <li key={d.id} className="py-3">
                <Item d={d} detailed={false} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
