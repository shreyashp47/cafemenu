import { cn } from "@/lib/cn";
import type { ComponentProps, ReactNode } from "react";

export function Card({ className, ...rest }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "border-line-soft bg-paper shadow-card rounded-lg border-2",
        className,
      )}
      {...rest}
    />
  );
}

/** Tan variant, for grouping things that shouldn't read as one card. */
export function Panel({ className, ...rest }: ComponentProps<"div">) {
  return (
    <div className={cn("bg-tan/70 rounded-lg p-4", className)} {...rest} />
  );
}

export function CardHeader({
  title,
  hint,
  action,
  className,
}: {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-line-soft flex items-start justify-between gap-3 border-b-2 px-4 py-3",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="truncate text-lg">{title}</h2>
        {hint ? <p className="text-muted mt-0.5 text-sm">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}

export default Card;
