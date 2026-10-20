import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Static export, so the app can be served by Firebase Hosting (or any plain
  // static host) with no Node runtime. It is safe here: there are no route
  // handlers, no server actions and no dynamic rendering — all data is fetched
  // client-side from Firestore or localStorage, and every route prerenders.
  //
  // The cost is that `headers()` below is ignored on export. The same headers
  // are declared in firebase.json so they still ship; see the comment there.
  output: "export",

  poweredByHeader: false,

  async headers() {
    return [
      {
        // The cafe's own QR pages may be embedded in nothing, but a bookmarked
        // or installed copy should never be framed or sniffed.
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            // The staff board uses vibration for the new-order alert; nothing
            // else is needed, so everything else is denied.
            value: "geolocation=(), microphone=(), camera=(), payment=()",
          },
        ],
      },
      {
        // The service worker must never be cached, or a stale one can pin an
        // old app shell on the counter phone indefinitely.
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600" }],
      },
    ];
  },
};

export default nextConfig;
