import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Static export, for Firebase Hosting on the platform project. Like the cafe
  // app, the console has no route handlers, server actions or dynamic
  // rendering: every page prerenders, and data is read client-side from
  // Firestore or the demo store.
  //
  // `headers()` is ignored on export, so the security headers are declared in
  // firebase.json instead.
  output: "export",

  // The image optimiser needs a server, which an export does not have. The
  // screenshots in public/screens are already small PNGs sized for the page.
  images: { unoptimized: true },

  poweredByHeader: false,

  // @cafemenu/shared is TypeScript source in the workspace (packages/shared),
  // compiled as part of this app.
  transpilePackages: ["@cafemenu/shared"],
};

export default nextConfig;
