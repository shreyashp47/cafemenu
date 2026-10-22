"use client";

/**
 * The cafe's mark: its logo, or what stands in for one (issue #11). Its own
 * file, apart from CafeIdentity, so the root layout does not carry Mochi's
 * artwork to pages that never show it.
 */

import { monogramOf } from "@cafemenu/shared";
import { useState } from "react";

import { Mascot } from "@/components/Mascot";
import { useCafeSettings } from "@/hooks/useCafeSettings";

/**
 * The cafe's initials on a tile of its accent (docs/anime-theme.md §4): what
 * stands in for a logo. SVG rather than a styled box so it prints, since
 * browsers leave backgrounds off a printout. Decorative: the name is always
 * written next to it.
 */
export function Monogram({
  size,
  className = "",
}: {
  size: number;
  className?: string;
}) {
  const { settings } = useCafeSettings();
  const letters = monogramOf(settings.name);
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      aria-hidden="true"
      className={`cafe-mark ${className}`}
    >
      <rect width="100" height="100" rx="24" className="fill-primary" />
      <text
        x="50"
        y="50"
        dy="0.36em"
        textAnchor="middle"
        fontSize={letters.length > 1 ? 42 : 54}
        fontWeight="600"
        className="fill-on-dark font-round"
      >
        {letters}
      </text>
    </svg>
  );
}

/**
 * The cafe's mark beside its name: its logo when it has one. Without one,
 * Mochi on Cozy (TOE's header, unchanged) and the monogram on every other
 * theme; `mascot={false}` shows nothing on Cozy instead (TOE's QR cards have
 * no mark). Which of the two shows is the stylesheet's call (`plain:`), so the
 * static page never flashes the wrong one.
 */
export function CafeMark({
  size,
  mascot = true,
  className = "",
}: {
  size: number;
  mascot?: boolean;
  className?: string;
}) {
  const { settings } = useCafeSettings();
  const [broken, setBroken] = useState<string | null>(null);
  const logo = settings.logo && settings.logo !== broken ? settings.logo : null;

  if (logo) {
    return (
      // A static export cannot optimise images, and the deployer already
      // writes the logo small (siteLogo in @cafemenu/shared/icons).
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logo}
        alt=""
        width={size}
        height={size}
        className={`object-contain ${className}`}
        style={{ width: size, height: size }}
        onError={() => setBroken(logo)}
      />
    );
  }
  return (
    <>
      {mascot ? <Mascot size={size} className={className} /> : null}
      <Monogram size={size} className={`plain:block hidden ${className}`} />
    </>
  );
}
