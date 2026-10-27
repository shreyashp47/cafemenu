import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EXIT, main, parseSmokeArgs } from "../src/smoke-cli.mjs";
import { INIT_JSON, MISSING_PAGE, UNSTAMPED } from "../src/smoke-check.mjs";
import { SETTINGS, fakeShared } from "./helpers/release.mjs";

const SITE = "https://lantern-cafe.web.app";
const SW = "abc123def456";
const SECURITY = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
];
const FIREBASE_JSON = JSON.stringify({
  hosting: { public: "out", headers: [{ source: "**", headers: SECURITY }] },
});

/** A cafe that answers as it should, with `change` laid over it. */
function cafe(change = {}) {
  const headers = {
    "content-type": "text/html",
    "x-content-type-options": "nosniff",
    "x-frame-options": "SAMEORIGIN",
  };
  const routes = {
    "/": "<h1>Menu</h1>",
    "/order": "<h1>Order</h1>",
    "/staff": "<h1>Staff</h1>",
    "/admin": "<h1>Owner</h1>",
    "/offline": "<h1>Offline</h1>",
    "/sw.js": `const VERSION = "${SW}";`,
    "/site.json": JSON.stringify(SETTINGS),
    [INIT_JSON]: JSON.stringify({
      projectId: "lantern-cafe-1a2b",
      appId: "1:1:web:a",
      apiKey: "k",
    }),
    ...change,
  };
  const requests = [];
  return {
    requests,
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      requests.push(url.pathname);
      const body = routes[url.pathname];
      if (body === undefined) {
        return new Response("Not Found", { status: 404, headers });
      }
      if (typeof body === "number")
        return new Response("", { status: body, headers });
      return new Response(body, {
        status: 200,
        headers: url.pathname.endsWith(".json")
          ? { ...headers, "content-type": "application/json" }
          : headers,
      });
    },
  };
}

const tryJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** Runs the command; returns {code, json, err} with stdout parsed as JSON. */
async function smoke(args, { site = cafe(), ...deps } = {}) {
  const out = [];
  const err = [];
  const code = await main(args, {
    fetchImpl: site.fetchImpl,
    loadShared: async () => fakeShared,
    sleep: async () => {},
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    ...deps,
  });
  return {
    code,
    out,
    err: err.join("\n"),
    json: out.length ? tryJson(out.join("\n")) : null,
  };
}

const ALL = [SITE, "--cafe", "Lantern Cafe", "--project", "lantern-cafe-1a2b"];

describe("smoke", () => {
  it("exits 0 and prints the result as JSON when everything passes", async () => {
    const r = await smoke([...ALL, "--sw-version", SW]);
    assert.equal(r.code, EXIT.ok, r.err);
    assert.equal(r.out.length, 1, "stdout is the JSON and nothing else");
    assert.equal(r.json.ok, true);
    assert.equal(r.json.url, SITE);
    assert.equal(r.json.attempts, 1);
    assert.deepEqual(r.json.failed, []);
    assert.match(r.err, /ok {3}The front door: \/ answered 200/);
    assert.match(r.err, /All checks passed\./);
  });

  it("exits 1, with the failed checks named, when one fails", async () => {
    const r = await smoke([...ALL, "--sw-version", SW, "--attempts", "2"], {
      site: cafe({ "/staff": 500 }),
    });
    assert.equal(r.code, EXIT.failed);
    assert.equal(r.json.ok, false);
    assert.deepEqual(r.json.failed, ["staff"]);
    assert.equal(r.json.attempts, 2);
    assert.match(r.err, /FAIL The staff board: \/staff answered 500/);
    assert.match(r.err, /attempt 1\/2 failed \(staff\); trying again in 5s/);
    assert.match(r.err, /Failed: staff\./);
  });

  it("checks the cache version it is given", async () => {
    const r = await smoke([
      SITE,
      "--sw-version",
      "ffffffffffff",
      "--attempts",
      "1",
    ]);
    assert.equal(r.code, EXIT.failed);
    assert.deepEqual(r.json.failed, ["service-worker"]);
  });

  it("takes the cache version from a build's sw.js", async () => {
    const readFile = async (path) => {
      assert.equal(path, "apps/cafe/out/sw.js");
      return `const VERSION = "${SW}";`;
    };
    const r = await smoke([SITE, "--build", "apps/cafe/out/"], { readFile });
    assert.equal(r.code, EXIT.ok, r.err);
    assert.equal(r.json.expect.swVersion, SW);
  });

  it("won't take a version from a build that isn't stamped, or isn't there", async () => {
    const unstamped = await smoke([SITE, "--build", "out"], {
      readFile: async () => `const VERSION = "${UNSTAMPED}";`,
    });
    assert.equal(unstamped.code, EXIT.usage);
    assert.match(unstamped.err, /out\/sw.js has no stamped cache version/);
    const missing = await smoke([SITE, "--build", "out"], {
      readFile: async () => {
        throw Object.assign(new Error("no"), { code: "ENOENT" });
      },
    });
    assert.equal(missing.code, EXIT.usage);
    assert.match(missing.err, /Can't read out\/sw.js \(ENOENT\)/);
    assert.equal(missing.json, null);
  });

  it("takes the security headers from a firebase.json", async () => {
    const readFile = async (path) => {
      assert.equal(path, "apps/cafe/firebase.json");
      return FIREBASE_JSON;
    };
    const ok = await smoke(
      [SITE, "--firebase-json", "apps/cafe/firebase.json"],
      { readFile },
    );
    assert.equal(ok.code, EXIT.ok, ok.err);
    assert.deepEqual(ok.json.expect.headers, [
      "X-Content-Type-Options",
      "X-Frame-Options",
    ]);

    // The same pages, with none of the headers.
    const bare = {
      fetchImpl: async (input) =>
        new Response("<h1>x</h1>", {
          status: new URL(input).pathname === MISSING_PAGE ? 404 : 200,
          headers: { "content-type": "text/html" },
        }),
    };
    const bad = await smoke(
      [SITE, "--firebase-json", "apps/cafe/firebase.json", "--attempts", "1"],
      { readFile, site: bare },
    );
    assert.equal(bad.code, EXIT.failed);
    assert.ok(bad.json.failed.includes("headers"));
  });

  it("asks for the table it is given, and lets a preview through with --demo", async () => {
    const site = cafe({
      "/site.json": JSON.stringify({ ...SETTINGS, demo: true }),
    });
    const r = await smoke([SITE, "--table", "7", "--demo"], { site });
    assert.equal(r.code, EXIT.ok, r.err);
    assert.equal(r.json.expect.table, 7);
  });

  it("explains itself on --help", async () => {
    const r = await smoke(["--help"]);
    assert.equal(r.code, EXIT.ok);
    assert.match(r.out[0], /^Usage: smoke <url>/);
  });

  it("reports needing Node 22 for site.json as a failed check, not a crash", async () => {
    const r = await smoke([...ALL, "--attempts", "1"], {
      loadShared: async () => {
        throw new Error("needs Node 22.18 or later");
      },
    });
    assert.equal(r.code, EXIT.failed);
    assert.deepEqual(r.json.failed, ["site-json"]);
  });

  describe("usage errors exit 2 and print no JSON", () => {
    for (const [args, message] of [
      [[], /Give the site's address/],
      [["a", "b"], /Give the site's address/],
      [["not a url"], /Not an address/],
      [["ftp://x.web.app"], /without a path/],
      [[`${SITE}/staff`], /without a path/],
      [[`${SITE}/?x=1`], /without a path/],
      [[SITE, "--sw-version", "a", "--build", "out"], /not both/],
      [[SITE, "--target", "app"], /--target needs --firebase-json/],
      [[SITE, "--table", "0"], /--table takes a whole number from 1 to 50/],
      [[SITE, "--table", "51"], /--table takes/],
      [[SITE, "--attempts", "many"], /--attempts takes/],
      [[SITE, "--wait=-1"], /--wait takes a number of seconds/],
      [[SITE, "--wait", ""], /--wait takes a number of seconds/],
      [[SITE, "--nonsense"], /Unknown option/],
    ]) {
      it(JSON.stringify(args), async () => {
        const r = await smoke(args);
        assert.equal(r.code, EXIT.usage);
        assert.match(r.err, message);
        assert.equal(r.json, null);
      });
    }
  });

  it("reads --wait in seconds and --attempts as a count", () => {
    const options = parseSmokeArgs([SITE, "--wait", "0.5", "--attempts", "3"]);
    assert.equal(options.waitMs, 500);
    assert.equal(options.attempts, 3);
    assert.equal(parseSmokeArgs([SITE]).attempts, 6);
    assert.equal(parseSmokeArgs([SITE]).waitMs, 5_000);
  });

  describe("--browser", () => {
    it("walks the entry paths of apps/cafe after the plain checks pass", async () => {
      const calls = [];
      const r = await smoke(
        [...ALL, "--sw-version", SW, "--table", "4", "--browser"],
        {
          spawnEntry: async (run) => {
            calls.push(run.args);
            return { code: 0, output: "entry: all checks passed" };
          },
        },
      );
      assert.equal(r.code, EXIT.ok, r.err);
      assert.deepEqual(calls, [
        ["--url", SITE, "--table", "4", "--sw-version", SW],
      ]);
      assert.deepEqual(r.json.checks.at(-1), {
        id: "browser",
        label: "Every way in, in a real browser",
        status: "pass",
        detail: "entry.mjs: all checks passed",
      });
    });

    it("fails the result when the browser does", async () => {
      const r = await smoke([...ALL, "--browser"], {
        spawnEntry: async () => ({
          code: 1,
          output: "  FAIL ? shows the menu\nentry: 1 check(s) failed",
        }),
      });
      assert.equal(r.code, EXIT.failed);
      assert.equal(r.json.ok, false);
      assert.deepEqual(r.json.failed, ["browser"]);
      assert.match(
        r.json.checks.at(-1).detail,
        /entry.mjs exited 1: .*1 check\(s\) failed/,
      );
    });

    it("isn't started when a plain check has already failed", async () => {
      let started = false;
      const r = await smoke([...ALL, "--browser", "--attempts", "1"], {
        site: cafe({ "/admin": 500 }),
        spawnEntry: async () => {
          started = true;
          return { code: 0, output: "" };
        },
      });
      assert.equal(started, false);
      assert.equal(r.code, EXIT.failed);
      assert.equal(r.json.checks.at(-1).status, "skip");
      assert.deepEqual(r.json.failed, ["admin"]);
    });

    it("is off unless asked for", async () => {
      const r = await smoke(ALL, {
        spawnEntry: async () => assert.fail("no browser was asked for"),
      });
      assert.equal(
        r.json.checks.some((c) => c.id === "browser"),
        false,
      );
    });
  });
});
