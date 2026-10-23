"use client";

import { useEffect, useRef } from "react";

/**
 * The heading of one stage of a flow (sign-up, onboarding). When a stage
 * replaces another on the page, the page goes back to the top and the focus
 * moves to its heading, so a screen reader hears where the owner now is; on
 * the first load it stays put.
 */
export function StageHeading({
  eyebrow,
  title,
  focus,
}: {
  eyebrow?: string;
  title: string;
  /** Take the focus when shown: false for the stage the page opened on. */
  focus: boolean;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!focus) return;
    window.scrollTo({ top: 0 });
    ref.current?.focus({ preventScroll: true });
  }, [focus]);
  return (
    <div>
      {eyebrow && (
        <p className="text-brand-ink text-sm font-semibold tracking-wide uppercase">
          {eyebrow}
        </p>
      )}
      <h1
        ref={ref}
        tabIndex={-1}
        className="font-display text-ink mt-2 text-3xl leading-tight tracking-tight focus:outline-none sm:text-4xl"
      >
        {title}
      </h1>
    </div>
  );
}
