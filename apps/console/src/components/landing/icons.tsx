/**
 * Small line icons for the landing page, drawn for it. Decorative only: the
 * text next to each says what it means.
 */

const props = {
  viewBox: "0 0 24 24",
  fill: "none",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
  className: "size-6 stroke-current",
};

/** A phone with a QR code on its screen. */
export function ScanIcon() {
  return (
    <svg {...props}>
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
      <path d="M9.5 7.5h2v2h-2zM12.5 7.5h2v2h-2zM9.5 10.5h2v2h-2zM13.5 11.5h1v1h-1z" />
      <path d="M10.5 18h3" />
    </svg>
  );
}

/** A key: the data is yours. */
export function KeyIcon() {
  return (
    <svg {...props}>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l8.5-8.5M16.5 6.5l2 2M14.5 8.5l1.5 1.5" />
    </svg>
  );
}

/** A leaf: free to run. */
export function LeafIcon() {
  return (
    <svg {...props}>
      <path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z" />
      <path d="M5 19l7-7" />
    </svg>
  );
}

/** A palette: your look. */
export function PaletteIcon() {
  return (
    <svg {...props}>
      <path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.5-1.8-.4-1.2.4-2.2 1.6-2.2H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10z" />
      <circle cx="7.5" cy="11" r="1" />
      <circle cx="10.5" cy="7" r="1" />
      <circle cx="15" cy="7.5" r="1" />
    </svg>
  );
}

/** Two arrows in a circle: updates. */
export function UpdateIcon() {
  return (
    <svg {...props}>
      <path d="M20 11a8 8 0 0 0-14.5-4.5M4 13a8 8 0 0 0 14.5 4.5" />
      <path d="M5 3v4h4M19 21v-4h-4" />
    </svg>
  );
}

/** A tick, for lists. */
export function CheckIcon() {
  return (
    <svg {...props} className="size-5 shrink-0 stroke-current">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}
