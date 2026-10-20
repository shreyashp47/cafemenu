import { Mascot, type MascotMood } from "@/components/Mascot";
import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

/** Loading placeholder for menu fetch + order placement. */
export function Loading({ label = "Warming up…" }: { label?: string }) {
  return (
    <div
      className="flex flex-col items-center gap-3 py-14"
      role="status"
      aria-live="polite"
    >
      <Mascot mood="sleepy" size={104} />
      <p className="font-hand text-muted text-xl">{label}</p>
    </div>
  );
}

/** Empty state (docs/anime-theme.md §4: mascot in empty states). */
export function EmptyState({
  title,
  body,
  action,
  mood = "worry",
}: {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  mood?: MascotMood;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <Mascot mood={mood} size={116} />
      <h3 className="font-hand text-ink text-2xl">{title}</h3>
      {body ? <p className="text-muted max-w-xs text-sm">{body}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        "animate-spin-slow inline-block size-5 rounded-full border-[3px] border-current border-t-transparent",
        className,
      )}
    />
  );
}

export default Loading;
