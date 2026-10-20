import type { MetadataRoute } from "next";

import { getCafeName, getCafeTagline } from "@/lib/config";

// Required by `output: "export"`: a metadata route has no request to read, so it
// has to be told explicitly to render at build time. Without this the static
// export fails on this one route.
export const dynamic = "force-static";

/**
 * Web app manifest (docs/requirements.md §3, §7).
 *
 * `start_url` is /staff because that is the screen the cafe actually installs to
 * its counter phone; the customer flow is reached by scanning a QR code and never
 * needs installing.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${getCafeName()} · ${getCafeTagline()}`,
    short_name: getCafeName(),
    description:
      "Order from your table by QR code, and run the cafe's order board from your phone.",
    start_url: "/staff",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F2E4D3",
    theme_color: "#7A3E1D",
    categories: ["food", "shopping", "business"],
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Order board",
        short_name: "Orders",
        url: "/staff",
      },
      {
        name: "Monthly reports",
        short_name: "Reports",
        url: "/admin/reports",
      },
    ],
  };
}
