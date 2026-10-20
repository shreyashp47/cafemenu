/**
 * Corner decoration (docs/anime-theme.md §4: "a few small plant leaves / coffee bean
 * doodles in corners, kept subtle and low-opacity"). Purely decorative, so it
 * is aria-hidden and never intercepts taps.
 */

function Bean({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="100%"
      height="100%"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <ellipse
        cx="12"
        cy="12"
        rx="7.5"
        ry="10.5"
        fill="none"
        stroke="#3E2418"
        strokeWidth="2.2"
        transform="rotate(-28 12 12)"
      />
      <path
        d="M5.6 15.6c2.6-1.2 4-3.2 4.2-6.1M18.4 8.4c-2.6 1.2-4 3.2-4.2 6.1"
        fill="none"
        stroke="#3E2418"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Leaf({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="100%"
      height="100%"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path
        d="M4 20C4 10 10 4 21 3c-1 11-6 17-17 17z"
        fill="none"
        stroke="#3E2418"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path
        d="M4 20C8 15 13 10 19 5.5"
        fill="none"
        stroke="#3E2418"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Steam({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="100%"
      height="100%"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path
        d="M8 21c-2-2.5 2-3.5 0-6s-2-3.5 0-6M15 21c-2-2.5 2-3.5 0-6"
        fill="none"
        stroke="#3E2418"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Doodles({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`doodle pointer-events-none absolute inset-0 overflow-hidden ${className ?? ""}`}
    >
      <Bean
        className="absolute top-24 -left-1 size-9"
        style={{ transform: "rotate(14deg)" }}
      />
      <Bean
        className="absolute top-[22rem] right-1 size-5"
        style={{ transform: "rotate(-38deg)" }}
      />
      <Leaf
        className="absolute top-3 -right-1 size-14"
        style={{ transform: "rotate(16deg)" }}
      />
      <Leaf
        className="absolute bottom-32 -left-1 size-11"
        style={{ transform: "rotate(-28deg)" }}
      />
      <Steam className="absolute right-8 bottom-6 size-6" />
    </div>
  );
}

/**
 * 1–2 second sparkle/petal burst on successful order placement (docs/anime-theme.md §4).
 * CSS-only, and fully disabled under prefers-reduced-motion.
 */
export function SparkleBurst({
  count = 14,
  active = true,
  className,
}: {
  count?: number;
  active?: boolean;
  className?: string;
}) {
  if (!active) return null;

  const palette = ["#E8A93E", "#C97B3D", "#6B8E5A", "#7A3E1D", "#F5D08A"];

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 z-10 overflow-hidden ${className ?? ""}`}
    >
      {Array.from({ length: count }, (_, i) => {
        // deterministic scatter so SSR and client markup match
        const angle = (360 / count) * i + (i % 3) * 9;
        const distance = 78 + (i % 5) * 26;
        return (
          <span
            key={i}
            className="animate-rise absolute top-1/2 left-1/2 size-2.5"
            style={
              {
                marginLeft: -5,
                marginTop: -5,
                background: palette[i % palette.length],
                borderRadius: i % 2 === 0 ? "9999px" : "2px",
                transform: `rotate(${angle}deg)`,
                ["--spin" as string]: `${(i % 2 ? 1 : -1) * (10 + i)}deg`,
                animationDelay: `${(i % 6) * 60}ms`,
                translate: `0 ${-distance / 4}rem`,
              } as React.CSSProperties
            }
          />
        );
      })}
    </div>
  );
}

export default Doodles;
