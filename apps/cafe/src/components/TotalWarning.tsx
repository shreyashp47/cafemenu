/**
 * The staff board's "this order's money does not add up" flag (issue #27).
 *
 * Detection, not prevention: the order is already in the database at whatever
 * figure the phone sent. What this does is make sure the barista cannot miss
 * it before taking payment, and tells them what to charge instead. See
 * src/lib/order-integrity.ts for what is compared and why.
 */

import { formatINR } from "@/lib/money";
import type { IntegrityCheck } from "@/lib/order-integrity";

export function TotalWarning({ check }: { check: IntegrityCheck }) {
  if (check.ok) return null;
  return (
    <div
      role="alert"
      data-integrity="flagged"
      className="border-berry bg-paper text-berry-deep mx-3 mb-2 rounded-sm border-2 px-2.5 py-1.5 text-sm"
    >
      <p className="font-semibold">
        Total doesn&apos;t match menu — check before charging
      </p>
      <ul className="mt-0.5 list-disc pl-4">
        {check.issues.map((issue) => (
          <li key={issue.message}>{issue.message}</li>
        ))}
      </ul>
      {check.menuTotal !== null && check.menuTotal !== check.storedTotal ? (
        <p className="tnum mt-1 font-semibold">
          At today&apos;s menu prices: {formatINR(check.menuTotal)}
        </p>
      ) : null}
    </div>
  );
}

/** The ticket's footer figure: struck through when it cannot be trusted. */
export function TicketTotal({ check }: { check: IntegrityCheck }) {
  if (check.ok) {
    return (
      <span className="tnum font-round text-ink text-lg">
        {formatINR(check.storedTotal)}
      </span>
    );
  }
  return (
    <span className="tnum font-round text-berry-deep flex items-baseline gap-1.5 text-lg">
      <span className="sr-only">Order total, flagged:</span>
      <s className="text-muted text-sm">{formatINR(check.storedTotal)}</s>
      <span aria-hidden="true">⚠</span>
      {check.menuTotal !== null ? formatINR(check.menuTotal) : "Check"}
    </span>
  );
}
