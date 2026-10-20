import type { MetadataRoute } from "next";

import { DEFAULT_SETTINGS, webManifest } from "@cafemenu/shared";

// Required by `output: "export"`: a metadata route has no request to read, so it
// has to be told explicitly to render at build time. Without this the static
// export fails on this one route.
export const dynamic = "force-static";

/**
 * Web app manifest (docs/requirements.md §3, §7).
 *
 * Fixed at build time, so this is only the demo cafe's: what `npm run dev` and
 * a demo deploy serve. On a real cafe the deployer overwrites
 * manifest.webmanifest on every deploy with the same `webManifest()` from
 * @cafemenu/shared, given that cafe's settings, which is how its name and
 * colours reach the home screen.
 */
export default function manifest(): MetadataRoute.Manifest {
  return webManifest(DEFAULT_SETTINGS);
}
