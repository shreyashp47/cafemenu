import { cn } from "@/lib/cn";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/order-status";

const LOOK: Record<
  OrderStatus,
  { label: string; emoji: string; className: string }
> = {
  // An order from a table staff have not confirmed yet (order-status.ts).
  // Dashed, like a note still to be checked, and not alarming: it is usually
  // a real guest who simply has not been seen yet.
  pending: {
    label: "Waiting for the counter",
    emoji: "⏳",
    className: "bg-paper text-secondary-deep border-secondary border-dashed",
  },
  received: {
    label: "Received",
    emoji: "📝",
    className: "bg-tan text-ink border-line",
  },
  preparing: {
    label: "Preparing",
    emoji: "🔥",
    className: "bg-highlight-soft text-primary-dark border-highlight",
  },
  ready: {
    label: "Ready",
    emoji: "☕",
    // text-sage-deep, not text-sage: sage on sage-soft is 2.99:1
    className: "bg-sage-soft text-sage-deep border-sage",
  },
  served: {
    label: "Served",
    emoji: "✨",
    className: "bg-sage-deep text-on-dark border-sage-deep",
  },
  completed: {
    label: "Completed",
    emoji: "✓",
    className: "bg-tan-deep text-primary-dark border-tan-deep",
  },
  rejected: {
    label: "Rejected",
    emoji: "✕",
    className: "bg-paper text-berry-deep border-berry-deep",
  },
};

/**
 * A status this build does not know yet — say, one written by a newer version
 * of the app — still renders, as a plain neutral badge with its own name,
 * rather than crashing an owner's history screen.
 */
function lookOf(status: string): {
  label: string;
  emoji: string;
  className: string;
} {
  const known = Object.prototype.hasOwnProperty.call(LOOK, status)
    ? LOOK[status as OrderStatus]
    : undefined;
  if (known) return known;
  const words = status.replace(/[-_]+/g, " ").trim() || "Unknown";
  return {
    label: words.charAt(0).toUpperCase() + words.slice(1),
    emoji: "•",
    className: "bg-paper text-ink border-line",
  };
}

export function StatusBadge({
  status,
  size = "md",
  className,
}: {
  status: OrderStatus | (string & {});
  size?: "sm" | "md";
  className?: string;
}) {
  const look = lookOf(status);
  return (
    <span
      data-status={status}
      className={cn(
        "rounded-pill font-round inline-flex shrink-0 items-center gap-1 border-2 font-semibold",
        look.className,
        size === "sm" ? "text-2xs px-2.5 py-0.5" : "px-3 py-1 text-sm",
        className,
      )}
    >
      <span aria-hidden="true">{look.emoji}</span>
      {look.label}
    </span>
  );
}

export function statusLabel(status: OrderStatus | (string & {})): string {
  return lookOf(status).label;
}

export function statusEmoji(status: OrderStatus | (string & {})): string {
  return lookOf(status).emoji;
}

export { ORDER_STATUSES };
export default StatusBadge;
