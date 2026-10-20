/**
 * Warm-toned line icons.
 *
 * Theme doc §4 asks for "small anime-style icons for menu categories (drinks,
 * snacks, desserts) instead of plain text labels". Hand-drawn inline SVG keeps
 * them crisp at any size, adds zero requests, and inherits `currentColor` so
 * they always match the palette. These are original drawings, not icon-pack
 * imports, so there is no licence to track.
 */

import { cn } from "@/lib/cn";

export type IconName =
  // categories
  | "drink"
  | "bite"
  | "sweet"
  // per-item art
  | "espresso"
  | "cappuccino"
  | "coldbrew"
  | "matcha"
  | "chai"
  | "scone"
  | "toastie"
  | "sandwich"
  | "cookie"
  | "cheesecake"
  | "softserve"
  | "brownie"
  // ui
  | "cart"
  | "plus"
  | "minus"
  | "check"
  | "flame"
  | "clock"
  | "leaf"
  | "sparkle"
  | "pin"
  | "qr"
  | "chart"
  | "sound"
  | "mute"
  | "logout"
  | "trash"
  | "back"
  | "edit"
  | "close"
  | "chevron";

const PATHS: Record<IconName, React.ReactNode> = {
  drink: (
    <>
      <path d="M6 9h11v7a5 5 0 01-5 5h-1a5 5 0 01-5-5z" />
      <path d="M17 10.5h2.2a2.3 2.3 0 010 4.6H17" />
      <path d="M4 23h15" />
    </>
  ),
  bite: (
    <>
      <path d="M4 14c0-3.3 3.6-6 8-6s8 2.7 8 6-3.6 6-8 6-8-2.7-8-6z" />
      <path d="M4 14c0-1.4 1-2.6 2.6-3.4" />
      <circle cx="9" cy="12" r=".9" fill="currentColor" stroke="none" />
      <circle cx="13.5" cy="16" r=".9" fill="currentColor" stroke="none" />
      <circle cx="15" cy="11" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  sweet: (
    <>
      <path d="M5 12h14l-1.4 8.2a2 2 0 01-2 1.8H8.4a2 2 0 01-2-1.8z" />
      <path d="M8 12V8.5M12 12V7M16 12V8.5" />
      <path d="M4 9.5c2-1.6 4-1.6 6 0s4 1.6 6 0" />
    </>
  ),

  espresso: (
    <>
      <path d="M5 11h12v5a5 5 0 01-5 5h-2a5 5 0 01-5-5z" />
      <path d="M17 12.5h1.8a2.2 2.2 0 010 4.4H17" />
      <path d="M3 23.5h17" />
      <path d="M9 7.5c0-1 1-1.4 1-2.4M13 7.5c0-1 1-1.4 1-2.4" />
    </>
  ),
  cappuccino: (
    <>
      <path d="M5 9h13v8a6 6 0 01-6 6h-1a6 6 0 01-6-6z" />
      <path d="M18 10.5h2a2.2 2.2 0 010 4.4h-2" />
      <ellipse cx="11.5" cy="10" rx="5" ry="1.8" />
      <path d="M9 5.5c0-1 1-1.4 1-2.4M13 5.5c0-1 1-1.4 1-2.4" />
    </>
  ),
  coldbrew: (
    <>
      <path d="M6 6h12l-1.5 16H7.5z" />
      <path d="M6.8 12h10.4M7.4 17h9.2" />
      <rect x="9" y="2.5" width="2.4" height="4" rx="1" />
      <rect x="13" y="2" width="2.4" height="4.5" rx="1" />
    </>
  ),
  matcha: (
    <>
      <path d="M6 8h12l-1.4 15H7.4z" />
      <path d="M6.6 13.5h10.8" />
      <circle cx="12" cy="18" r="2.4" />
      <path d="M16 3.5c1.6.6 2.4 1.8 2.4 3.5" />
    </>
  ),
  chai: (
    <>
      <path d="M6 8h12l-1.2 15H7.2z" />
      <path d="M7 13.5c2-1.4 4-1.4 6 0s3.4 1.2 4.4.2" />
      <path d="M9 5c0-1.4 1-1.8 1-3M14 5c0-1.4 1-1.8 1-3" />
    </>
  ),

  scone: (
    <>
      <path d="M4 16c0-4 3.6-7 8-7s8 3 8 7-3.6 6-8 6-8-2-8-6z" />
      <path d="M4.4 15.4c2-1.2 4-1.2 6 0s4 1.2 6 0" />
      <circle cx="9" cy="13" r="1" fill="currentColor" stroke="none" />
      <circle cx="14" cy="17" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  toastie: (
    <>
      <path d="M4 12.5L12 5l8 7.5-2 2.5H6z" />
      <path d="M6.5 15h11l1 5.5h-13z" />
      <path d="M9.5 17.5c1 1 3 1 4 0" />
    </>
  ),
  sandwich: (
    <>
      <path d="M4 12.5L12 6l8 6.5-1.4 2.2H5.4z" />
      <path d="M5.4 14.8h13.2l-1.2 2.2H6.6z" />
      <path d="M6.6 17h10.8l1 4.5H5.6z" />
    </>
  ),

  cookie: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="9" cy="10" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="9.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="11" cy="15" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="14.5" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  cheesecake: (
    <>
      <path d="M4 18h16l-1-8H5z" />
      <path d="M5 10c1.5-2 3.5-3 7-3s5.5 1 7 3" />
      <path d="M8 18v3M16 18v3" />
      <path d="M4 18h16" />
    </>
  ),
  softserve: (
    <>
      <path d="M7 13.5h10l-3 8h-4z" />
      <path d="M8.5 13.5c-.5-2 1-3 1.5-4.5.4 1.2 1.2 1.6 2 2.2-.2-1.4.6-2.4 1.4-3.4.2 1.4 1 2 1.6 2.8.6-1 1.4-1.6 2-2.4-.2 2.2.5 3.4.5 5.3z" />
    </>
  ),
  brownie: (
    <>
      <path d="M4 12h16v8H4z" />
      <path d="M4 12c0-2 3.6-3.5 8-3.5S20 10 20 12" />
      <circle cx="9" cy="15" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="16.5" r="1" fill="currentColor" stroke="none" />
    </>
  ),

  cart: (
    <>
      <path d="M3 4h2.2l2.3 10.5h9.6L19 7H6" />
      <circle cx="9" cy="19" r="1.6" />
      <circle cx="16.5" cy="19" r="1.6" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  check: <path d="M4.5 12.5l5 5 10-11" />,
  flame: (
    <path d="M12 2.5c3.5 3.2 5.5 6 5.5 9.2A5.5 5.5 0 0112 21.5a5.5 5.5 0 01-5.5-9.8c.9 1 1.9 1.4 3 1.2-.6-3.4.2-7.2 2.5-10.4z" />
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  leaf: (
    <>
      <path d="M5 20c0-9 5.5-14 16-15-1 10.5-5.5 15-16 15z" />
      <path d="M5 20C8.5 15 13 10.5 19 6" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3l1.7 4.8L18.5 9.5l-4.8 1.7L12 16l-1.7-4.8L5.5 9.5l4.8-1.7z" />
      <path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.6" />
    </>
  ),
  qr: (
    <>
      <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" />
      <path d="M14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM14 20h2.5M20 14v2.5" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <path d="M8 17V11M12 17V7M16 17v-4" />
    </>
  ),
  sound: (
    <>
      <path d="M4 10h3.5L12 6v12L7.5 14H4z" />
      <path d="M15.5 9.5a4 4 0 010 5M18 7a7.5 7.5 0 010 10" />
    </>
  ),
  mute: (
    <>
      <path d="M4 10h3.5L12 6v12L7.5 14H4z" />
      <path d="M16 10l4 4M20 10l-4 4" />
    </>
  ),
  logout: (
    <>
      <path d="M13 5H6v14h7" />
      <path d="M11 12h9M17 8.5l3.5 3.5L17 15.5" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V5h6v2" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  back: <path d="M14.5 5.5L8 12l6.5 6.5" />,
  edit: (
    <>
      <path d="M4 20h4L19 9a2.1 2.1 0 00-3-3L5 17v3z" />
      <path d="M14 8l2.5 2.5" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  chevron: <path d="M6 9.5l6 6 6-6" />,
};

export function Icon({
  name,
  size = 24,
  className,
  strokeWidth = 1.9,
  title,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0", className)}
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      {PATHS[name]}
    </svg>
  );
}

/** Category -> icon, with a sane fallback for a category the owner invents. */
export const CATEGORY_ICONS: Record<string, IconName> = {
  Drinks: "drink",
  Bites: "bite",
  Sweets: "sweet",
  Snacks: "bite",
  Desserts: "sweet",
  Coffee: "drink",
  Tea: "drink",
};

export function categoryIcon(category: string): IconName {
  return CATEGORY_ICONS[category] ?? "drink";
}

export function itemArtIcon(art: string | undefined): IconName {
  return art && art in PATHS ? (art as IconName) : "drink";
}

export default Icon;
