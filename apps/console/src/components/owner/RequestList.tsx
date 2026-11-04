import { formatDateTime } from "@/lib/format";
import { fill, messages } from "@/lib/messages";
import type { BackendRequest } from "@/lib/platform/model";

const { requests: text } = messages.cafe.updates;

/** What a request asks for, in a few words: "Upgrade to 1.2.0". */
export function requestTitle(request: BackendRequest): string {
  const version =
    typeof request.params.version === "string" ? request.params.version : "";
  return fill(text.kind[request.kind], { version });
}

/**
 * The owner's requests that the backend on GitHub Actions has not turned into
 * a deployment yet (#77): waiting for its next run, which takes a few
 * minutes, starting, or refused with the backend's reason. Updates live, as
 * the page watches the requests. Once one is a deployment, DeploymentList
 * shows its steps.
 */
export function RequestList({
  requests,
}: {
  requests: readonly BackendRequest[];
}) {
  if (requests.length === 0) return null;
  return (
    <section aria-labelledby="updates-requests-title" className="space-y-3">
      <h3
        id="updates-requests-title"
        className="text-ink text-lg font-semibold"
      >
        {text.title}
      </h3>
      <div role="status" aria-label={text.label}>
        <ul className="border-line bg-sunk divide-line divide-y rounded-lg border px-4">
          {requests.map((request) => (
            <li key={request.id} className="py-3">
              <p className="text-ink font-semibold">{requestTitle(request)}</p>
              <p
                className={
                  request.status === "failed"
                    ? "text-danger font-medium"
                    : "text-text"
                }
              >
                {text.status[request.status]}
                <span className="text-muted font-normal">
                  {" · "}
                  <time dateTime={new Date(request.createdAt).toISOString()}>
                    {fill(text.asked, {
                      when: formatDateTime(request.createdAt),
                    })}
                  </time>
                </span>
              </p>
              {request.status !== "failed" && request.progress?.detail && (
                <p className="text-muted text-sm">{request.progress.detail}</p>
              )}
              {request.status === "failed" && request.error && (
                <p className="bg-danger-soft text-danger mt-2 rounded-md p-3 text-sm">
                  {fill(text.failed, { error: request.error })}
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
