import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { readHostingConfig } from "../src/hosting-files.mjs";
import {
  INIT_JSON,
  MISSING_PAGE,
  PAGES,
  UNSTAMPED,
  runChecks,
  securityHeaders,
  smokeCheck,
  swVersionIn,
} from "../src/smoke-check.mjs";
import { SETTINGS, fakeShared } from "./helpers/release.mjs";

const URL_ = "https://lantern-cafe.web.app";
const SW = "abc123def456";
const HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
};
const EXPECT = Object.freeze({
  cafe: "Lantern Cafe",
  projectId: "lantern-cafe-1a2b",
  swVersion: SW,
  table: 2,
  headers: HEADERS,
});

const html = (body = "<h1>Menu</h1>") => ({
  body,
  type: "text/html; charset=utf-8",
  headers: HEADERS,
});
const json = (value) => ({
  body: JSON.stringify(value),
  type: "application/json",
  headers: HEADERS,
});

/** A cafe that is fine: what every check wants. */
const healthy = () => ({
  "/": html(),
  "/order": html("<h1>Order</h1>"),
  "/staff": html("<h1>Staff</h1>"),
  "/admin": html("<h1>Owner</h1>"),
  "/offline": html("<h1>Offline</h1>"),
  "/sw.js": {
    body: `const VERSION = "${SW}";`,
    type: "text/javascript",
    headers: HEADERS,
  },
  "/site.json": json(SETTINGS),
  [INIT_JSON]: json({
    projectId: EXPECT.projectId,
    appId: "1:123:web:abc",
    apiKey: "key",
  }),
});

/**
 * A fetch for a site made of `routes` ({path: {status, body, type, headers}}).
 * A route may be a function of how many times its path has been asked for,
 * an Error (a dropped connection) or missing (404). Records every request.
 */
function siteFetch(routes) {
  const requests = [];
  const counts = new Map();
  async function fetchImpl(input, init = {}) {
    const url = new URL(String(input));
    requests.push({ url: `${url.pathname}${url.search}`, init });
    const n = (counts.get(url.pathname) ?? 0) + 1;
    counts.set(url.pathname, n);
    let route = routes[url.pathname];
    if (typeof route === "function") route = route(n);
    if (route instanceof Error) throw route;
    if (!route) {
      return new Response("Not Found", {
        status: 404,
        headers: { "content-type": "text/html", ...HEADERS },
      });
    }
    return new Response(route.body ?? "ok", {
      status: route.status ?? 200,
      headers: {
        "content-type": route.type ?? "text/html",
        ...route.headers,
      },
    });
  }
  return { fetchImpl, requests };
}

const run = (routes, options = {}) => {
  const site = siteFetch(routes);
  return runChecks({
    url: URL_,
    expect: EXPECT,
    loadShared: async () => fakeShared,
    fetchImpl: site.fetchImpl,
    ...options,
  }).then((result) => ({ ...result, site }));
};
const byId = (result, id) => result.checks.find((c) => c.id === id);

describe("the checks", () => {
  it("pass on a healthy cafe, asking for each address once", async () => {
    const result = await run(healthy());
    assert.equal(result.ok, true, JSON.stringify(result.checks));
    assert.deepEqual(
      result.checks.map((c) => [c.id, c.status]),
      [
        ["home", "pass"],
        ["order", "pass"],
        ["staff", "pass"],
        ["admin", "pass"],
        ["offline", "pass"],
        ["service-worker", "pass"],
        ["site-json", "pass"],
        ["firebase-init", "pass"],
        ["headers", "pass"],
        ["not-found", "pass"],
      ],
    );
    assert.deepEqual(result.failed, []);
    assert.deepEqual(
      result.site.requests.map((r) => r.url),
      [
        "/",
        "/order?table=2",
        "/staff",
        "/admin",
        "/offline",
        "/sw.js",
        "/site.json",
        INIT_JSON,
        MISSING_PAGE,
      ],
    );
  });

  it("only read: GET, no redirect followed, nothing sent but a cache hint", async () => {
    const result = await run(healthy());
    for (const { init } of result.site.requests) {
      assert.equal(init.method, "GET");
      assert.equal(init.redirect, "manual");
      assert.equal(init.body, undefined);
      assert.deepEqual(Object.keys(init.headers), ["cache-control"]);
    }
  });

  it("is a result that is JSON all the way down", async () => {
    const { site, ...result } = await run(healthy());
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
    assert.deepEqual(result.expect, {
      cafe: "Lantern Cafe",
      projectId: "lantern-cafe-1a2b",
      swVersion: SW,
      table: 2,
      headers: ["X-Content-Type-Options", "X-Frame-Options"],
    });
  });

  it("ignores a trailing slash on the address", async () => {
    const result = await run(healthy(), { url: `${URL_}//` });
    assert.equal(result.ok, true);
    assert.equal(result.url, URL_);
  });

  // Every way the check says no, and that it says it about the right thing.
  const err = (name, message = "fetch failed", cause) =>
    Object.assign(new Error(message, { cause }), { name });
  const without = (path) => ({ [path]: undefined });
  const FAILURES = [
    [
      "a page that errors",
      { "/staff": { status: 500 } },
      ["staff"],
      /^\/staff answered 500$/,
    ],
    [
      "a page that is gone",
      without("/admin"),
      ["admin"],
      /\/admin answered 404/,
    ],
    [
      "a page that redirects",
      { "/offline": { status: 301, headers: { location: "/offline/" } } },
      ["offline"],
      /301 to \/offline\//,
    ],
    ["a page with nothing in it", { "/": html("") }, ["home"], /nothing in it/],
    [
      "an address that doesn't resolve",
      { "/order": err("TypeError", "fetch failed", { code: "ENOTFOUND" }) },
      ["order"],
      /answered nothing \(ENOTFOUND\)/,
    ],
    [
      "a request that times out",
      {
        "/staff": err(
          "TimeoutError",
          "The operation was aborted due to timeout",
        ),
      },
      ["staff"],
      /answered nothing \(timed out after 10s\)/,
    ],
    [
      "another build's service worker",
      { "/sw.js": { body: 'const VERSION = "ffffffffffff";' } },
      ["service-worker"],
      /cache version ffffffffffff, expected abc123def456/,
    ],
    [
      "a service worker that was never stamped",
      { "/sw.js": { body: `const VERSION = "${UNSTAMPED}";` } },
      ["service-worker"],
      /never stamped/,
    ],
    [
      "a service worker with no version in it",
      { "/sw.js": { body: "self.addEventListener('fetch', () => {});" } },
      ["service-worker"],
      /no `const VERSION/,
    ],
    [
      "no service worker",
      without("/sw.js"),
      ["service-worker"],
      /\/sw.js answered 404/,
    ],
    [
      "no site.json",
      without("/site.json"),
      ["site-json"],
      /\/site.json answered 404/,
    ],
    [
      "a site.json that is the index page",
      { "/site.json": html("<h1>Menu</h1>") },
      ["site-json"],
      /an HTML page, not JSON/,
    ],
    [
      "a site.json that isn't JSON",
      { "/site.json": { body: "{oops", type: "application/json" } },
      ["site-json"],
      /isn't JSON/,
    ],
    [
      "a site.json that isn't valid settings",
      { "/site.json": json({ name: "Lantern Cafe" }) },
      ["site-json"],
      /isn't valid settings: schemaVersion: missing/,
    ],
    [
      "another cafe's site.json",
      { "/site.json": json({ ...SETTINGS, name: "Mochi & Beans" }) },
      ["site-json"],
      /names the cafe "Mochi & Beans", expected "Lantern Cafe"/,
    ],
    [
      "a site.json marked as a preview",
      { "/site.json": json({ ...SETTINGS, demo: true }) },
      ["site-json"],
      /"demo": true, so the app would show sample data/,
    ],
    [
      "no Firebase config",
      without(INIT_JSON),
      ["firebase-init"],
      /answered 404/,
    ],
    [
      "another project's Firebase config",
      { [INIT_JSON]: json({ projectId: "other", appId: "a", apiKey: "k" }) },
      ["firebase-init"],
      /is project "other", expected "lantern-cafe-1a2b"/,
    ],
    [
      "a Firebase config with no web app in it",
      { [INIT_JSON]: json({ projectId: EXPECT.projectId }) },
      ["firebase-init"],
      /has no apiKey, appId/,
    ],
    [
      "a security header that is missing",
      {
        "/staff": {
          ...html(),
          headers: { "X-Content-Type-Options": "nosniff" },
        },
      },
      ["headers"],
      /X-Frame-Options is missing on \/staff/,
    ],
    [
      "a security header with another value",
      {
        "/admin": {
          ...html(),
          headers: { ...HEADERS, "X-Frame-Options": "ALLOWALL" },
        },
      },
      ["headers"],
      /X-Frame-Options is "ALLOWALL" on \/admin, not "SAMEORIGIN"/,
    ],
    [
      "a catch-all rewrite",
      { [MISSING_PAGE]: html("<h1>Menu</h1>") },
      ["not-found"],
      /answered 200, not 404 \(a catch-all rewrite\?\)/,
    ],
  ];
  for (const [name, change, failed, detail] of FAILURES) {
    it(`fail on ${name}, and only that`, async () => {
      const result = await run({ ...healthy(), ...change });
      assert.equal(result.ok, false);
      assert.deepEqual(result.failed, failed);
      for (const id of failed) {
        assert.match(byId(result, id).detail, detail);
      }
      assert.ok(
        result.checks.every(
          (c) => failed.includes(c.id) || c.status === "pass",
        ),
        JSON.stringify(result.checks),
      );
    });
  }

  it("say a header is missing everywhere in one breath, not once per page", async () => {
    const bare = (body) => ({ body, type: "text/html" });
    const result = await run({
      ...healthy(),
      "/": bare("<h1>Menu</h1>"),
      "/order": bare("<h1>Order</h1>"),
      "/staff": bare("<h1>Staff</h1>"),
      "/admin": bare("<h1>Owner</h1>"),
      "/offline": bare("<h1>Offline</h1>"),
    });
    assert.deepEqual(result.failed, ["headers"]);
    assert.equal(
      byId(result, "headers").detail,
      "X-Content-Type-Options is missing on all 5 pages; X-Frame-Options is missing on all 5 pages",
    );
  });

  it("fail every check of a site that is down", async () => {
    const down = new Proxy(
      {},
      { get: () => err("TypeError", "fetch failed", { code: "ECONNREFUSED" }) },
    );
    const result = await run(down);
    assert.equal(result.ok, false);
    assert.equal(result.failed.length, 9); // all but headers: no page to judge
    assert.equal(byId(result, "headers").status, "skip");
  });

  it("say what is missing when site.json can't be read without @cafemenu/shared", async () => {
    const result = await run(healthy(), {
      loadShared: async () => {
        throw new Error("Making a cafe's files needs Node 22.18 or later");
      },
    });
    assert.deepEqual(result.failed, ["site-json"]);
    assert.match(
      byId(result, "site-json").detail,
      /can't read it without @cafemenu\/shared: Making a cafe's files needs Node 22/,
    );
  });

  it("compare header values by meaning, not by case or spacing", async () => {
    const result = await run(healthy(), {
      expect: {
        ...EXPECT,
        headers: { "permissions-policy": "geolocation=(),  camera=()" },
      },
      fetchImpl: siteFetch({
        ...healthy(),
        "/": {
          ...html(),
          headers: { "Permissions-Policy": "Geolocation=(), Camera=()" },
        },
        "/order": {
          ...html(),
          headers: { "Permissions-Policy": "geolocation=(), camera=()" },
        },
        "/staff": {
          ...html(),
          headers: { "Permissions-Policy": "geolocation=(), camera=()" },
        },
        "/admin": {
          ...html(),
          headers: { "Permissions-Policy": "geolocation=(), camera=()" },
        },
        "/offline": {
          ...html(),
          headers: { "Permissions-Policy": "geolocation=(), camera=()" },
        },
      }).fetchImpl,
    });
    assert.equal(byId(result, "headers").status, "pass");
  });
});

describe("a site with nothing to compare against", () => {
  const bare = () => {
    const { "/site.json": _, [INIT_JSON]: __, ...routes } = healthy();
    return routes;
  };

  it("skips what isn't there, and passes", async () => {
    const result = await run(bare(), { expect: {} });
    assert.equal(result.ok, true, JSON.stringify(result.checks));
    assert.deepEqual(
      result.checks.filter((c) => c.status === "skip").map((c) => c.id),
      ["site-json", "firebase-init", "headers"],
    );
    assert.match(byId(result, "service-worker").detail, /\(none expected\)/);
  });

  it("still judges a site.json that is there, and a service worker that isn't stamped", async () => {
    const result = await run(
      {
        ...bare(),
        "/site.json": json({ name: "x" }),
        "/sw.js": { body: `const VERSION = "${UNSTAMPED}";` },
      },
      { expect: {} },
    );
    assert.deepEqual(result.failed, ["service-worker", "site-json"]);
  });

  it("lets a preview be a preview when told to", async () => {
    const preview = {
      ...bare(),
      "/site.json": json({ ...SETTINGS, demo: true }),
    };
    assert.deepEqual((await run(preview, { expect: {} })).failed, [
      "site-json",
    ]);
    const result = await run(preview, { expect: { demo: true } });
    assert.equal(result.ok, true, JSON.stringify(result.checks));
  });

  it("asks for /order with table 1 unless told another", async () => {
    const result = await run(bare(), { expect: {} });
    assert.ok(result.site.requests.some((r) => r.url === "/order?table=1"));
  });
});

describe("trying again", () => {
  const options = (routes, extra = {}) => {
    const site = siteFetch(routes);
    const sleeps = [];
    const retries = [];
    return {
      site,
      sleeps,
      retries,
      options: {
        url: URL_,
        expect: EXPECT,
        loadShared: async () => fakeShared,
        fetchImpl: site.fetchImpl,
        sleep: async (ms) => sleeps.push(ms),
        onRetry: (r) => retries.push([r.attempt, r.waitMs, r.result.failed]),
        ...extra,
      },
    };
  };

  it("passes at once without waiting", async () => {
    const t = options(healthy());
    const result = await smokeCheck(t.options);
    assert.equal(result.ok, true);
    assert.equal(result.attempts, 1);
    assert.deepEqual(t.sleeps, []);
  });

  it("waits for a release that reaches the edge late, then passes", async () => {
    // The old release answers for the first two tries.
    const t = options({
      ...healthy(),
      "/sw.js": (n) => ({
        body: `const VERSION = "${n <= 2 ? "oldoldoldold" : SW}";`,
      }),
      "/staff": (n) => (n <= 1 ? { status: 404 } : html()),
    });
    const result = await smokeCheck(t.options);
    assert.equal(result.ok, true, JSON.stringify(result.checks));
    assert.equal(result.attempts, 3);
    assert.deepEqual(t.sleeps, [5_000, 10_000]);
    assert.deepEqual(t.retries, [
      [1, 5_000, ["staff", "service-worker"]],
      [2, 10_000, ["service-worker"]],
    ]);
  });

  it("gives up after its tries, with the last run's result", async () => {
    const t = options(
      { ...healthy(), "/admin": { status: 500 } },
      { attempts: 4, waitMs: 1_000 },
    );
    const result = await smokeCheck(t.options);
    assert.equal(result.ok, false);
    assert.equal(result.attempts, 4);
    assert.deepEqual(result.failed, ["admin"]);
    assert.deepEqual(t.sleeps, [1_000, 2_000, 3_000]);
  });

  it("tries six times, over 75 seconds, unless told otherwise", async () => {
    const t = options({ ...healthy(), "/admin": { status: 500 } });
    const result = await smokeCheck(t.options);
    assert.equal(result.attempts, 6);
    assert.deepEqual(t.sleeps, [5_000, 10_000, 15_000, 20_000, 25_000]);
  });

  it("asks everything again each time", async () => {
    const t = options({
      ...healthy(),
      "/admin": (n) => (n < 2 ? { status: 500 } : html()),
    });
    await smokeCheck(t.options);
    assert.equal(t.site.requests.filter((r) => r.url === "/").length, 2);
  });
});

describe("what the checks are told", () => {
  it("reads the cache version out of a service worker", () => {
    assert.equal(
      swVersionIn('const PREFIX = "cafe-";\nconst VERSION = "3f2a";'),
      "3f2a",
    );
    assert.equal(swVersionIn("const VERSIONS = 1"), null);
    assert.equal(swVersionIn(""), null);
  });

  it("takes the headers of the `**` rule, and no other", () => {
    assert.deepEqual(
      securityHeaders({
        headers: [
          { glob: "**", headers: { A: "1" } },
          { glob: "/sw.js", headers: { B: "2" } },
          { regex: "^/x", headers: { C: "3" } },
          { glob: "/**", headers: { D: "4" } },
        ],
      }),
      { A: "1", D: "4" },
    );
    assert.deepEqual(securityHeaders({}), {});
  });

  // The two files the cafe app owns, which the checks have to keep in step with.
  it("finds the placeholder in the cafe app's public/sw.js", async () => {
    const source = await readFile(
      new URL("../../../apps/cafe/public/sw.js", import.meta.url),
      "utf8",
    );
    assert.equal(swVersionIn(source), UNSTAMPED);
  });

  it("only asks for pages the cafe app has", async () => {
    for (const { path } of PAGES) {
      const page = new URL(
        `../../../apps/cafe/src/app${path === "/" ? "" : path}/page.tsx`,
        import.meta.url,
      );
      await readFile(page); // throws if the app has no such page
    }
  });

  it("finds the security headers in the cafe app's firebase.json", async () => {
    const { config } = await readHostingConfig(
      fileURLToPath(
        new URL("../../../apps/cafe/firebase.json", import.meta.url),
      ),
    );
    const names = Object.keys(securityHeaders(config));
    for (const name of ["X-Content-Type-Options", "X-Frame-Options"]) {
      assert.ok(names.includes(name), `${name} in ${names.join(", ")}`);
    }
  });
});

describe("with the real @cafemenu/shared", () => {
  it(
    "reads the site.json the deployer writes",
    {
      skip: !process.features.typescript && "this Node can't import TypeScript",
    },
    async () => {
      const { loadShared } = await import("../src/cafe-files.mjs");
      const shared = await loadShared();
      const settings = shared.validateCafeSettings(SETTINGS);
      assert.equal(settings.ok, true, settings.problems?.join("; "));
      const routes = {
        ...healthy(),
        "/site.json": json(shared.siteFileFor(settings.settings)),
      };
      const ok = await run(routes, { loadShared: async () => shared });
      assert.equal(ok.ok, true, JSON.stringify(ok.checks));
      const preview = await run(
        {
          ...routes,
          "/site.json": json(
            shared.siteFileFor(settings.settings, { demo: true }),
          ),
        },
        { loadShared: async () => shared },
      );
      assert.deepEqual(preview.failed, ["site-json"]);
      const broken = await run(
        {
          ...routes,
          "/site.json": json({ ...SETTINGS, tables: "all of them" }),
        },
        { loadShared: async () => shared },
      );
      assert.match(byId(broken, "site-json").detail, /tables: must be/);
    },
  );
});
