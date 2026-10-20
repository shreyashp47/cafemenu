/**
 * Issue #29: the service worker's cache version was a hardcoded "v1", so the
 * `activate` handler's eviction never evicted anything.
 *
 * Two halves are pinned here:
 *   1. the version is derived from the build's content, so a new build gets a
 *      new one and an identical build gets the same one;
 *   2. the real public/sw.js, run in a fake worker scope, deletes the previous
 *      build's caches when the new one activates — the behaviour the comment
 *      used to claim without anything checking it.
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { afterEach, describe, expect, it } from "vitest";

import {
  PLACEHOLDER,
  buildVersion,
  stampServiceWorker,
  stampSource,
} from "../lib/sw-version.mjs";

// A path, not a URL object: the suite runs under jsdom, whose URL is not a
// file: URL as far as node:fs is concerned.
const HERE = dirname(fileURLToPath(import.meta.url));
const SW_SOURCE = await readFile(join(HERE, "../../public/sw.js"), "utf8");

const dirs = [];
async function fakeExport(files) {
  const dir = await mkdtemp(join(tmpdir(), "sw-version-"));
  dirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const full = join(dir, rel);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, body);
  }
  return dir;
}

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

describe("buildVersion", () => {
  const base = {
    "index.html": "<html>build A</html>",
    "_next/static/chunks/app-abc.js": "console.log(1)",
    "sw.js": SW_SOURCE,
  };

  it("changes when anything in the build changes", async () => {
    const a = await buildVersion(await fakeExport(base));
    const b = await buildVersion(
      await fakeExport({ ...base, "index.html": "<html>build B</html>" }),
    );
    const c = await buildVersion(
      await fakeExport({ ...base, "_next/static/chunks/app-def.js": "x" }),
    );
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });

  it("is stable for identical output, and ignores sw.js itself", async () => {
    const a = await buildVersion(await fakeExport(base));
    const b = await buildVersion(
      await fakeExport({ ...base, "sw.js": "// stamped already" }),
    );
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });

  it("refuses an empty export", async () => {
    await expect(buildVersion(await fakeExport({}))).rejects.toThrow(
      /nothing in it/,
    );
  });
});

describe("stampSource / stampServiceWorker", () => {
  it("public/sw.js carries exactly one placeholder to stamp", () => {
    expect(SW_SOURCE.split(PLACEHOLDER)).toHaveLength(2);
  });

  it("fails loudly when the placeholder is gone", () => {
    expect(() => stampSource('const VERSION = "v1";', "abcdef123456")).toThrow(
      /Expected exactly one/,
    );
  });

  it("refuses to stamp something that is not a hash", () => {
    expect(() => stampSource(SW_SOURCE, '"; alert(1); "')).toThrow(/odd/);
  });

  it("writes the build's version into out/sw.js", async () => {
    const dir = await fakeExport({ "index.html": "hi", "sw.js": SW_SOURCE });
    const version = await stampServiceWorker(dir);
    const stamped = await readFile(join(dir, "sw.js"), "utf8");
    expect(stamped).not.toContain(PLACEHOLDER);
    expect(stamped).toContain(`const VERSION = "${version}";`);
  });
});

// --- running the real worker ----------------------------------------------

function fakeCacheStorage(initial) {
  const store = new Map(initial.map((name) => [name, new Map()]));
  return {
    store,
    async open(name) {
      if (!store.has(name)) store.set(name, new Map());
      const entries = store.get(name);
      return {
        async addAll(urls) {
          for (const url of urls) entries.set(url, `body of ${url}`);
        },
        async put(req, res) {
          entries.set(String(req.url ?? req), res);
        },
        async match(req) {
          return entries.get(String(req.url ?? req));
        },
      };
    },
    async keys() {
      return [...store.keys()];
    },
    async delete(name) {
      return store.delete(name);
    },
    async match() {
      return undefined;
    },
  };
}

/** Evaluates a stamped sw.js in a fake ServiceWorkerGlobalScope. */
function bootWorker(version, caches, { fetch: fetchImpl } = {}) {
  const listeners = {};
  const calls = { skipWaiting: 0, claim: 0 };
  const self = {
    location: { origin: "https://cafe.test" },
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
    skipWaiting: async () => {
      calls.skipWaiting += 1;
    },
    clients: {
      claim: async () => {
        calls.claim += 1;
      },
    },
  };
  vm.runInNewContext(stampSource(SW_SOURCE, version), {
    self,
    caches,
    fetch:
      fetchImpl ??
      (async () => {
        throw new Error("offline in tests");
      }),
    Response: class {
      static redirect(location, status) {
        return { redirect: location, status };
      }
      static error() {
        return { error: true };
      }
    },
    URL,
    Promise,
  });

  async function fire(type) {
    const pending = [];
    listeners[type]({ waitUntil: (p) => pending.push(p) });
    await Promise.all(pending);
  }
  /** Dispatches a fetch; resolves to the worker's response, or undefined. */
  async function request(url, mode = "cors") {
    let responded;
    listeners.fetch({
      request: { method: "GET", url, mode },
      respondWith: (p) => {
        responded = p;
      },
    });
    return responded === undefined ? undefined : await responded;
  }
  return { fire, calls, request };
}

describe("public/sw.js activation", () => {
  it("evicts the previous build's caches on a device that had them", async () => {
    // A phone that installed the old hardcoded worker, plus a later build, plus a
    // cache that belongs to something else on the origin.
    const caches = fakeCacheStorage([
      "cafe-shell-v1",
      "cafe-assets-v1",
      "cafe-shell-0123456789ab",
      "cafe-assets-0123456789ab",
      "someone-elses-cache",
    ]);

    const worker = bootWorker("fedcba987654", caches);
    await worker.fire("install");
    await worker.fire("activate");

    expect([...caches.store.keys()].sort()).toEqual([
      "cafe-shell-fedcba987654",
      "someone-elses-cache",
    ]);
    // The new shell is precached, including the offline page.
    expect(caches.store.get("cafe-shell-fedcba987654").has("/offline")).toBe(
      true,
    );
    // And the new worker takes over open pages rather than waiting for every
    // tab to close, which on a counter phone is never.
    expect(worker.calls.skipWaiting).toBe(1);
    expect(worker.calls.claim).toBe(1);
  });

  it("a second deploy evicts the first deploy's caches", async () => {
    const caches = fakeCacheStorage([]);

    const first = bootWorker("aaaaaaaaaaaa", caches);
    await first.fire("install");
    await first.fire("activate");
    (await caches.open("cafe-assets-aaaaaaaaaaaa")).put(
      "/_next/static/x.js",
      "x",
    );
    expect([...caches.store.keys()].sort()).toEqual([
      "cafe-assets-aaaaaaaaaaaa",
      "cafe-shell-aaaaaaaaaaaa",
    ]);

    const second = bootWorker("bbbbbbbbbbbb", caches);
    await second.fire("install");
    await second.fire("activate");
    expect([...caches.store.keys()]).toEqual(["cafe-shell-bbbbbbbbbbbb"]);
  });
});

describe("public/sw.js page router data (*.txt)", () => {
  it("sends a tab that navigated to a page's .txt back to the page", async () => {
    const worker = bootWorker("aaaaaaaaaaaa", fakeCacheStorage([]));
    for (const [from, to] of [
      ["https://cafe.test/admin.txt?_rsc=1x2y", "https://cafe.test/admin"],
      ["https://cafe.test/admin/qr.txt", "https://cafe.test/admin/qr"],
      ["https://cafe.test/index.txt", "https://cafe.test/"],
      ["https://cafe.test/order.txt", "https://cafe.test/order"],
    ]) {
      expect(await worker.request(from, "navigate")).toEqual({
        redirect: to,
        status: 302,
      });
    }
  });

  it("fetches router data fresh, not the previous deploy's cached copy", async () => {
    const caches = fakeCacheStorage([]);
    const worker = bootWorker("aaaaaaaaaaaa", caches, {
      fetch: async () => ({ ok: true, body: "new build", clone: () => "copy" }),
    });
    const url = "https://cafe.test/order.txt?_rsc=abc";
    (await caches.open("cafe-assets-aaaaaaaaaaaa")).put(url, "old build");

    const response = await worker.request(url);
    expect(response.body).toBe("new build");
  });

  it("falls back to the cached router data when offline", async () => {
    const caches = fakeCacheStorage([]);
    const worker = bootWorker("aaaaaaaaaaaa", caches);
    const url = "https://cafe.test/order.txt?_rsc=abc";
    (await caches.open("cafe-assets-aaaaaaaaaaaa")).put(url, "cached");

    expect(await worker.request(url)).toBe("cached");
  });

  it("still leaves the order board's data to the network alone", async () => {
    const worker = bootWorker("aaaaaaaaaaaa", fakeCacheStorage([]));
    expect(
      await worker.request("https://cafe.test/staff.txt?_rsc=1"),
    ).toBeUndefined();
  });
});
