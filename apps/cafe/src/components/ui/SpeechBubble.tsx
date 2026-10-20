import { Mascot, type MascotMood } from "@/components/Mascot";
import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

/**
 * Manga speech bubble (docs/anime-theme.md §4). Tail is a rotated square rather than a
 * pseudo-element so it can be positioned without magic offsets.
 */
export function SpeechBubble({
  children,
  mood = "cheer",
  className,
  tail = "left",
  showMascot = true,
}: {
  children: ReactNode;
  mood?: MascotMood;
  className?: string;
  tail?: "left" | "right" | "none";
  /** Set false when a larger mascot already appears directly above. */
  showMascot?: boolean;
}) {
  return (
    <div className={cn("flex items-end gap-3", className)}>
      {showMascot ? (
        <Mascot mood={mood} size={92} className="shrink-0" />
      ) : null}
      <div className="border-line bg-paper shadow-card relative flex-1 rounded-lg rounded-bl-md border-2 px-4 py-3">
        <p className="font-round text-ink text-base">{children}</p>
        {tail !== "none" ? (
          <span
            aria-hidden="true"
            className={cn(
              "border-line bg-paper absolute -bottom-2 size-4 rotate-45 border-r-2 border-b-2",
              tail === "left" ? "left-7" : "right-7",
            )}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Tilted washi-taped sticky note (docs/anime-theme.md §4: handwritten sticky-note
 * accents + washi-tape detail). Used for the cafe's sticky tagline and the
 * "today's special" board.
 */
export function WashiNote({
  children,
  tilt = -2,
  tone = "highlight",
  className,
}: {
  children: ReactNode;
  tilt?: number;
  tone?: "highlight" | "paper" | "sage";
  className?: string;
}) {
  const tones = {
    highlight: "bg-highlight-soft border-highlight",
    paper: "bg-paper border-line",
    sage: "bg-sage-soft border-sage",
  } as const;

  return (
    <div
      className={cn(
        "shadow-card relative inline-block rounded-md border-2 px-4 py-2",
        tones[tone],
        className,
      )}
      style={{ transform: `rotate(${tilt}deg)` }}
    >
      {/* washi tape */}
      <span
        aria-hidden="true"
        className="bg-secondary/45 absolute -top-2.5 left-1/2 h-4 w-16 -translate-x-1/2 rounded-[2px] backdrop-blur-[1px]"
      />
      <span className="font-hand text-primary-dark text-xl leading-tight">
        {children}
      </span>
    </div>
  );
}

export default SpeechBubble;
