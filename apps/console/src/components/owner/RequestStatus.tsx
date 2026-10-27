import { fill, messages } from "@/lib/messages";
import type { RequestView } from "@/lib/owner/requests";
import { Rich } from "../Rich";
import { StepList } from "./StepList";

const { pending: text } = messages.cafe;

/**
 * A change the owner asked for that the backend has not finished: Upgrade,
 * Roll back, Save branding. The backend works through requests every few
 * minutes (NEXT_PUBLIC_BACKEND=requests), so between asking and the
 * deployment appearing in the history there is only this: when to expect it,
 * what it is doing, and why it didn't go through.
 */
export function RequestStatus({ view }: { view: RequestView }) {
  const { request, stage } = view;
  const failed = stage === "failed";
  return (
    <div
      role="status"
      aria-label={text.title[request.kind]}
      className={`rounded-lg border p-4 ${
        failed ? "border-danger bg-danger-soft" : "border-line bg-sunk"
      }`}
    >
      <p className="text-ink font-semibold">{text.title[request.kind]}</p>
      <p className={failed ? "text-danger mt-1 font-medium" : "text-text mt-1"}>
        {stage === "failed" ? (
          request.error ? (
            fill(text.failed, { error: request.error })
          ) : (
            text.failedNoReason
          )
        ) : stage === "working" ? (
          text.working
        ) : (
          <Rich text={stage === "late" ? text.late : text.waiting} />
        )}
      </p>
      {stage === "working" && request.detail && (
        <p className="text-muted mt-1 text-sm">{request.detail}</p>
      )}
      {stage !== "failed" && <StepList steps={request.steps} />}
    </div>
  );
}
