import { messages } from "@/lib/messages";

/**
 * The CafeMenu mark: a cup whose body carries the three corner squares of a QR
 * code. Original artwork; colours come from the tokens, so it works on paper
 * and on espresso. src/app/icon.svg is the same drawing for the browser tab.
 */
export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <rect width="32" height="32" rx="8" className="fill-brand" />
      <path
        d="M12.5 5.5c-1.2 1.3 1.2 2.2 0 3.6M16.5 5.5c-1.2 1.3 1.2 2.2 0 3.6"
        fill="none"
        strokeWidth="1.6"
        strokeLinecap="round"
        className="stroke-surface"
      />
      <path
        d="M7.5 11.5h15v6.5a6 6 0 0 1-6 6h-3a6 6 0 0 1-6-6z"
        className="fill-surface"
      />
      <path
        d="M22.5 13.5h1.25a2.75 2.75 0 0 1 0 5.5H22.5"
        fill="none"
        strokeWidth="1.8"
        className="stroke-surface"
      />
      <rect
        x="10"
        y="13.5"
        width="3.5"
        height="3.5"
        rx="0.8"
        className="fill-brand"
      />
      <rect
        x="16.5"
        y="13.5"
        width="3.5"
        height="3.5"
        rx="0.8"
        className="fill-brand"
      />
      <rect
        x="10"
        y="19"
        width="3.5"
        height="3.5"
        rx="0.8"
        className="fill-brand"
      />
    </svg>
  );
}

export function Logo({ onDark = false }: { onDark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark className="size-8 shrink-0" />
      <span
        className={`font-display text-xl tracking-tight ${onDark ? "text-on-dark" : "text-ink"}`}
      >
        {messages.meta.name}
      </span>
    </span>
  );
}
