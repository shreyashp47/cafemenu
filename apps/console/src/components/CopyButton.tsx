"use client";

import { useEffect, useState } from "react";

/**
 * Copies `text` to the clipboard. Rendered only where the Clipboard API
 * exists, so it never shows a button that cannot work; the text it copies is
 * always on the page as well.
 */
export function CopyButton({
  text,
  label,
  done,
}: {
  text: string;
  label: string;
  done: string;
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
      className="min-h-tap min-w-tap rounded-pill border-on-dark/40 text-on-dark hover:bg-surface/10 inline-flex items-center justify-center border px-4 text-sm font-semibold"
    >
      <span aria-live="polite">{copied ? done : label}</span>
    </button>
  );
}
