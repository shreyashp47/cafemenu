import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

type Tone = "status" | "plain";

const TONES: Record<
  Tone,
  { on: string; off: string; trackOn: string; trackOff: string }
> = {
  // on = good (sage), off = a problem the owner should notice (berry)
  status: {
    on: "border-sage bg-sage-soft text-sage-deep",
    off: "border-berry bg-berry/10 text-berry-deep",
    trackOn: "bg-sage-deep",
    trackOff: "bg-berry-deep",
  },
  // on = sage, off = neutral: a setting, not an alarm
  plain: {
    on: "border-sage bg-sage-soft text-sage-deep",
    off: "border-line bg-paper text-ink",
    trackOn: "bg-sage-deep",
    trackOff: "bg-muted",
  },
};

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Visible text beside the track. Never covered by the knob. */
  label: ReactNode;
  /** Extra words for screen readers only, e.g. which item this switch is for. */
  srContext?: string;
  disabled?: boolean;
  tone?: Tone;
  className?: string;
  id?: string;
}

/**
 * An on/off switch with its label always readable. The knob lives inside its
 * track (left-0.5 + translate), the whole pill is the 44px tap target, and the
 * slide is skipped for anyone who asks for reduced motion.
 */
export function Switch({
  checked,
  onChange,
  label,
  srContext,
  disabled = false,
  tone = "status",
  className,
  id,
}: SwitchProps) {
  const t = TONES[tone];
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "rounded-pill font-round inline-flex min-h-11 shrink-0 items-center gap-2 border-2 py-1 pr-3 pl-1.5 text-sm font-semibold whitespace-nowrap",
        "disabled:opacity-60 motion-safe:transition-colors",
        "focus-visible:outline-ring focus-visible:outline-3 focus-visible:outline-offset-2",
        checked ? t.on : t.off,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "rounded-pill relative h-6 w-10 shrink-0 motion-safe:transition-colors",
          checked ? t.trackOn : t.trackOff,
        )}
      >
        <span
          className={cn(
            "rounded-pill bg-paper shadow-soft absolute top-0.5 left-0.5 size-5 motion-safe:transition-transform",
            checked ? "translate-x-4" : "translate-x-0",
          )}
        />
      </span>
      <span>{label}</span>
      {srContext ? <span className="sr-only">{srContext}</span> : null}
    </button>
  );
}

export default Switch;
