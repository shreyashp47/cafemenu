"use client";

import { useEffect, useState } from "react";

const TONES = {
  // On the espresso band (the landing page's terminal).
  dark: "border-on-dark/40 text-on-dark hover:bg-surface/10",
  // On paper and cards.
  light:
    "border-line-strong bg-surface text-ink hover:border-brand hover:text-brand-ink",
} as const;

/**
 * Copies `text` to the clipboard. Rendered only where the Clipboard API
 * exists, so it never shows a button that cannot work; the text it copies is
 * always on the page as well. `describedBy` names what is copied, for a
 * screen reader that hears only "Copy".
 */
export function CopyButton({
  text,
  label,
  done,
  tone = "dark",
  describedBy,
}: {
  text: string;
  label: string;
  done: string;
  tone?: keyof typeof TONES;
  describedBy?: string;
}) {
  const [supported, setSupported] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setSupported(
      typeof navigator !== "undefined" && !!navigator.clipboard?.writeText,
    );
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => setCopied(true),
          () => setCopied(false),
        );
      }}
      aria-describedby={describedBy}
      className={`min-h-tap min-w-tap rounded-pill inline-flex items-center justify-center border px-4 text-sm font-semibold ${TONES[tone]}`}
    >
      <span aria-live="polite">{copied ? done : label}</span>
    </button>
  );
}
