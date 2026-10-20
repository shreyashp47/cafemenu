"use client";

/**
 * The cafe's name where the build cannot put it.
 *
 * A static export writes every page's <title> and <meta> at build time, and one
 * build serves every cafe, so the build's own carry no cafe name ("Order from
 * your table", "No connection"). <CafeTitle> adds it once the cafe's settings
 * are known, on every page and after every navigation. The home-screen name of
 * an installed app comes from manifest.webmanifest, which the deployer writes
 * per cafe (src/app/manifest.ts).
 */

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { useCafeSettings } from "@/hooks/useCafeSettings";

/** The build's title for every page that does not set its own. */
export const DEFAULT_TITLE = "Order from your table";

/** "Mochi & Beans · Order from your table", "No connection · Mochi & Beans". */
export function titleFor(base: string, name: string): string {
  if (!name) return base;
  return base === DEFAULT_TITLE ? `${name} · ${base}` : `${base} · ${name}`;
}

// What this component last wrote, and the title it was made from, so running
// again (a new name, a navigation that kept the title) never stacks the name.
let lastWritten = "";
let lastBase = "";

function setMeta(name: string, content: string) {
  let tag = document.head.querySelector<HTMLMetaElement>(
    `meta[name="${name}"]`,
  );
  if (!tag) {
    tag = document.createElement("meta");
    tag.name = name;
    document.head.appendChild(tag);
  }
  tag.content = content;
}

export function CafeTitle() {
  const { settings, ready } = useCafeSettings();
  const pathname = usePathname();
  const name = ready ? settings.name : "";

  useEffect(() => {
    if (!name) return;
    const current = document.title;
    const base = current === lastWritten ? lastBase : current;
    lastBase = base;
    lastWritten = titleFor(base, name);
    document.title = lastWritten;
    // Read by iOS when the page is added to the home screen.
    setMeta("apple-mobile-web-app-title", name);
    setMeta("application-name", name);
  }, [name, pathname]);

  return null;
}

/** The cafe's name as text, empty until it is known. */
export function CafeName() {
  const { settings } = useCafeSettings();
  return <>{settings.name}</>;
}
