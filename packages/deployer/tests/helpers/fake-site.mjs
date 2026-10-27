/**
 * The cafe's address on the fake Google: <site>.web.app serves what the live
 * Hosting release holds, the way Hosting does it: clean URLs, the version's
 * headers, 404.html for what isn't there, and /__/firebase/init.json from the
 * linked web app. So a deploy test can run the smoke test against what the
 * deploy really put in place.
 *
 * Tests bend it through `state`:
 *
 *   state.siteHook(url, n)   n counts the requests so far; return a Response to
 *                            answer that request instead (a stale edge, a 500,
 *                            a dropped connection...), or nothing to let it be
 *   state.siteRequests       "GET /path" for every request, in order
 */
import { gunzipSync } from "node:zlib";

import { globToRegExp } from "../../src/hosting-files.mjs";

export const isSiteHost = (hostname) =>
  hostname.endsWith(".web.app") || hostname.endsWith(".firebaseapp.com");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json",
  ".js": "text/javascript",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

const typeOf = (path) =>
  TYPES[path.slice(path.lastIndexOf("."))] ?? "application/octet-stream";

/** What the fake Hosting does with a request: `calls` holds the uploads. */
export function serveSite({ state, calls, project }, url, init = {}) {
  const requests = (state.siteRequests ??= []);
  requests.push(`${init.method ?? "GET"} ${url.pathname}${url.search}`);
  const hooked = state.siteHook?.(url, requests.length);
  if (hooked) return hooked;

  const live = state.releases[0]?.version.name;
  const version = live && state.versions.get(live);
  if (!version) return new Response("Site Not Found", { status: 404 });
  const config = version.config ?? {};

  const content = (path) => {
    const hash = version.files.get(path);
    const upload = calls.find((c) => c.raw && c.url.endsWith(`/${hash}`));
    return gunzipSync(upload.raw);
  };
  const respond = (status, path, bytes) => {
    const headers = { "content-type": typeOf(path) };
    for (const rule of config.headers ?? []) {
      const matches = rule.glob
        ? globToRegExp(rule.glob).test(url.pathname)
        : new RegExp(rule.regex).test(url.pathname);
      if (matches) Object.assign(headers, rule.headers);
    }
    return new Response(bytes, { status, headers });
  };

  const { pathname } = url;
  if (pathname === "/__/firebase/init.json") {
    return respond(
      200,
      pathname,
      JSON.stringify(
        state.webAppConfig ?? {
          projectId: project,
          appId: "1:1234567890:web:abcdef",
          apiKey: "fake-api-key",
          authDomain: `${project}.firebaseapp.com`,
        },
      ),
    );
  }
  const candidates = [pathname === "/" ? "/index.html" : pathname];
  if (config.cleanUrls) candidates.push(`${pathname}.html`);
  const found = candidates.find((path) => version.files.has(path));
  if (found) return respond(200, found, content(found));
  return version.files.has("/404.html")
    ? respond(404, "/404.html", content("/404.html"))
    : respond(404, "/404.html", "Not Found");
}
