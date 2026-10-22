/**
 * The web app manifest for a cafe.
 *
 * A static export fixes the manifest at build time, and one build serves every
 * cafe, so the build's own `manifest.webmanifest` is only the demo cafe's. The
 * deployer overwrites it on each deploy with `webManifest(cafeSettings)`, which
 * is why the shape lives here and not in the app: the app's build and the
 * deployer must agree on it.
 */

import type { CafeSettings } from "./settings.ts";
import { themeColours } from "./themes.ts";

/**
 * The app's icons, at the paths every build and every deploy use. The build
 * ships the demo cafe's; the deployer overwrites them all with the cafe's own
 * from `appIcons()` (@cafemenu/shared/icons).
 */
export const ICON_PATHS = Object.freeze({
  svg: "/icon.svg",
  any192: "/icon-192.png",
  any512: "/icon-512.png",
  maskable: "/icon-maskable-512.png",
  apple: "/apple-touch-icon.png",
  favicon: "/favicon.ico",
});

export interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: "any" | "maskable";
}

export interface WebManifest {
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: "standalone";
  orientation: "portrait";
  background_color: string;
  theme_color: string;
  categories: string[];
  icons: ManifestIcon[];
  shortcuts: { name: string; short_name: string; url: string }[];
}

/**
 * `start_url` is /staff because that is the screen a cafe installs on its
 * counter phone; customers arrive by QR code and never need to install.
 */
export function webManifest(settings: CafeSettings): WebManifest {
  const colours = themeColours(settings);
  return {
    name: settings.tagline
      ? `${settings.name} · ${settings.tagline}`
      : settings.name,
    short_name: settings.name,
    description:
      "Order from your table by QR code, and run the cafe's order board from your phone.",
    start_url: "/staff",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: colours.background,
    theme_color: colours.theme,
    categories: ["food", "shopping", "business"],
    icons: [
      {
        src: ICON_PATHS.svg,
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: ICON_PATHS.any192,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: ICON_PATHS.any512,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: ICON_PATHS.maskable,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "Order board", short_name: "Orders", url: "/staff" },
      { name: "Monthly reports", short_name: "Reports", url: "/admin/reports" },
    ],
  };
}
