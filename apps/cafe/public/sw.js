/**
 * Minimal service worker for the cafe's counter phone.
 *
 * Scope is deliberately small (theme doc §6: the page must load fast on cafe
 * wifi). There is no workbox here on purpose, and the only build step is the
 * one-line version stamp described below:
 *
 *   - navigations: network-first with an offline fallback, so staff always get
 *     live data when there is a connection and still get *something* when there
 *     isn't;
 *   - static assets under /_next/static: cache-first (they are immutable and
 *     content-hashed, so this is safe);
 *   - page router data (*.txt): network-first, cache only when offline;
 *   - icons: stale-while-revalidate.
 *
 * Deliberately NOT cached: Firestore/Auth traffic (always network) and anything
 * under /staff or /admin, which must never show a stale order board.
 *
 * Updates: every build gets a new VERSION, so a new deploy is a byte-different
 * sw.js, which is what makes the browser install it. It skips waiting and claims
 * open pages straight away, and `activate` deletes every older cafe-* cache. The
 * page is never reloaded from here — src/components/Pwa.tsx offers a reload
 * button instead, because a silent reload on the counter phone would drop the
 * armed order sound and whatever the barista was in the middle of tapping.
 */

// Stamped at build time by scripts/stamp-sw.mjs, which replaces the placeholder
// in out/sw.js with a hash of everything else in the export. It used to be a
// hardcoded "v1" that nothing ever changed, so the cache names were constant
// forever and the eviction in `activate` below never evicted anything.
//
// This file in public/ keeps the placeholder on purpose: `npm run build` is the
// only thing that should decide the version, and the stamp script refuses to
// finish if it cannot find the placeholder to replace.
const VERSION = "__SW_VERSION__";
const PREFIX = "cafe-";
const SHELL_CACHE = `${PREFIX}shell-${VERSION}`;
const ASSET_CACHE = `${PREFIX}assets-${VERSION}`;

const PRECACHE = ["/offline", "/icon.svg", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            // Only caches this app made. Anything else on the origin is not ours
            // to delete.
            .filter(
              (key) =>
                key.startsWith(PREFIX) &&
                key !== SHELL_CACHE &&
                key !== ASSET_CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isLiveOnly(url) {
  return (
    url.pathname.startsWith("/staff") ||
    url.pathname.startsWith("/admin") ||
    url.pathname.startsWith("/api/") ||
    url.hostname.endsWith("googleapis.com") ||
    url.hostname.endsWith("firebaseio.com") ||
    url.hostname.endsWith("firebasestorage.googleapis.com")
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Every .txt in the export is a page's router data (/admin.txt is /admin's),
  // fetched by Next when a link is tapped. When that data comes from a
  // different build than the open page, Next falls back to a full navigation —
  // to the .txt address itself, leaving the owner looking at raw text on
  // /admin.txt. Send any navigation to one of these back to its page. This
  // runs before the /staff and /admin exclusion below on purpose.
  if (request.mode === "navigate" && url.pathname.endsWith(".txt")) {
    const page = url.pathname.slice(0, -".txt".length).replace(/\/index$/, "");
    event.respondWith(Response.redirect(url.origin + (page || "/"), 302));
    return;
  }

  // Never serve live data from cache.
  if (isLiveOnly(url)) return;

  // Immutable build output: cache-first.
  //
  // The fetch is retried once and, failing that, falls back to any cached copy
  // before giving up. Without this a single dropped request on flaky wifi
  // rejects the respondWith promise outright, and the page dies on a missing
  // chunk — which is exactly the network this app is built to work on.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const response = await fetch(request);
            if (response.ok) cache.put(request, response.clone());
            return response;
          } catch {
            // fall through to the retry, then the cache
          }
        }
        return new Response("", { status: 504, statusText: "asset unavailable" });
      }),
    );
    return;
  }

  // Navigations: network-first, offline page as the fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || caches.match("/offline");
        }),
    );
    return;
  }

  // Router data: network-first. It must come from the same build as the page
  // showing it, so a cached copy from an earlier deploy is only good offline.
  // Served stale-while-revalidate like the icons, it was the previous build's
  // data after every deploy, and so the .txt navigation above.
  if (url.origin === self.location.origin && url.pathname.endsWith(".txt")) {
    event.respondWith(
      caches.open(ASSET_CACHE).then((cache) =>
        fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(async () => (await cache.match(request)) || Response.error()),
      ),
    );
    return;
  }

  // Icons and other same-origin assets: stale-while-revalidate.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => hit);
        return hit || network;
      }),
    );
  }
});
