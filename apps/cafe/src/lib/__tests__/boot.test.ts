/**
 * Which backend a page boots into (src/lib/boot.ts). The case that matters
 * most is the last describe block: a real cafe that cannot load its config
 * must never be shown the demo store.
 */

import { DEFAULT_SETTINGS } from "@cafemenu/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FIREBASE_CONFIG_KEY,
  INIT_JSON_PATH,
  activeFirebaseConfig,
  boot,
  parseFirebaseConfig,
  peekBoot,
  primeBoot,
  readDeviceConfig,
  resolveBoot,
  retryBoot,
  type BootDeps,
} from "@/lib/boot";
import type { FirebaseWebConfig } from "@/lib/config";

const INIT = {
  apiKey: "AIza-test-key",
  appId: "1:123:web:abc",
  authDomain: "their-cafe.firebaseapp.com",
  databaseURL: "",
  messagingSenderId: "123",
  projectId: "their-cafe",
  storageBucket: "their-cafe.firebasestorage.app",
  measurementId: "",
  projectNumber: "123",
  locationId: "asia-south1",
};
const CONFIG: FirebaseWebConfig = {
  apiKey: "AIza-test-key",
  appId: "1:123:web:abc",
  authDomain: "their-cafe.firebaseapp.com",
  messagingSenderId: "123",
  projectId: "their-cafe",
  storageBucket: "their-cafe.firebasestorage.app",
};
const SITE = { ...DEFAULT_SETTINGS, name: "TOE Cafe" };

type Answer = object | 404 | 500 | "network" | "html";

function json(body: object) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** A fake host: what each of the two deploy files answers. */
function host(
  init: Answer,
  site: Answer,
  env: FirebaseWebConfig | null = null,
) {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  } as unknown as Storage;
  const requested: string[] = [];
  const answer = async (a: Answer): Promise<Response> => {
    if (a === "network") throw new TypeError("Failed to fetch");
    if (a === 404) return new Response("Not found", { status: 404 });
    if (a === 500) return new Response("oops", { status: 500 });
    if (a === "html") {
      return new Response("<!doctype html><title>Menu</title>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return json(a);
  };
  const deps: BootDeps = {
    fetch: (path) => {
      requested.push(path);
      return answer(path === INIT_JSON_PATH ? init : site);
    },
    storage: () => storage,
    env: () => env,
  };
  return { deps, store, requested };
}

describe("resolveBoot: the ordinary cases", () => {
  it("uses Hosting's init.json on a real cafe", async () => {
    const { deps } = host(INIT, SITE);
    const result = await resolveBoot(deps);
    expect(result.backend).toEqual({
      kind: "firebase",
      config: CONFIG,
      source: "hosting",
    });
    expect(result.site).toEqual({
      status: "ok",
      value: { settings: SITE, demo: false },
    });
  });

  it("uses init.json on a cafe deployed before site.json existed", async () => {
    const { deps } = host(INIT, 404);
    const result = await resolveBoot(deps);
    expect(result.backend).toMatchObject({
      kind: "firebase",
      source: "hosting",
    });
    expect(result.site).toEqual({ status: "missing" });
  });

  it("is demo mode when neither file exists, as on npm run dev", async () => {
    const { deps } = host(404, 404);
    expect(await resolveBoot(deps)).toEqual({
      backend: { kind: "demo" },
      site: { status: "missing" },
    });
  });

  it("is demo mode on a static host that answers every path with its page", async () => {
    const { deps } = host("html", "html");
    expect((await resolveBoot(deps)).backend).toEqual({ kind: "demo" });
  });

  it("is demo mode, with the file's settings, when site.json says demo", async () => {
    const { deps, requested } = host(INIT, { ...SITE, demo: true });
    const result = await resolveBoot(deps);
    expect(result.backend).toEqual({ kind: "demo" });
    expect(result.site).toEqual({
      status: "ok",
      value: { settings: SITE, demo: true },
    });
    expect(requested).toContain("/site.json");
  });

  it("lets the .env.local block win, without asking Hosting", async () => {
    const { deps, requested } = host(INIT, 404, CONFIG);
    const result = await resolveBoot(deps);
    expect(result.backend).toEqual({
      kind: "firebase",
      config: CONFIG,
      source: "env",
    });
    expect(requested).toEqual(["/site.json"]);
  });

  it("asks for both files fresh, never from the HTTP cache", async () => {
    const calls: RequestInit[] = [];
    const { deps } = host(404, 404);
    const spy: BootDeps = {
      ...deps,
      fetch: (path, init) => {
        calls.push(init);
        return deps.fetch(path, init);
      },
    };
    await resolveBoot(spy);
    expect(calls).toHaveLength(2);
    for (const init of calls) expect(init.cache).toBe("no-cache");
  });
});

describe("resolveBoot: the device's copy of the config", () => {
  it("keeps init.json's config on the device", async () => {
    const { deps, store } = host(INIT, SITE);
    await resolveBoot(deps);
    expect(JSON.parse(store.get(FIREBASE_CONFIG_KEY)!)).toEqual(CONFIG);
    expect(readDeviceConfig(deps)).toEqual(CONFIG);
  });

  it("starts an offline counter phone from the copy", async () => {
    const { deps, store } = host("network", "network");
    store.set(FIREBASE_CONFIG_KEY, JSON.stringify(CONFIG));
    const result = await resolveBoot(deps);
    expect(result.backend).toEqual({
      kind: "firebase",
      config: CONFIG,
      source: "device",
    });
    expect(result.site).toEqual({ status: "error" });
  });

  it("uses the copy when init.json fails on the server's side too", async () => {
    const { deps, store } = host(500, SITE);
    store.set(FIREBASE_CONFIG_KEY, JSON.stringify(CONFIG));
    expect((await resolveBoot(deps)).backend).toMatchObject({
      kind: "firebase",
      source: "device",
    });
  });

  it("forgets the copy once the address definitely serves neither file", async () => {
    const { deps, store } = host(404, 404);
    store.set(FIREBASE_CONFIG_KEY, JSON.stringify(CONFIG));
    expect((await resolveBoot(deps)).backend).toEqual({ kind: "demo" });
    expect(store.has(FIREBASE_CONFIG_KEY)).toBe(false);
  });

  it("ignores a damaged copy", async () => {
    const { deps, store } = host("network", SITE);
    store.set(FIREBASE_CONFIG_KEY, "{not json");
    expect((await resolveBoot(deps)).backend.kind).toBe("unreachable");
    store.set(FIREBASE_CONFIG_KEY, JSON.stringify({ apiKey: "x" }));
    expect((await resolveBoot(deps)).backend.kind).toBe("unreachable");
  });

  it("survives storage that throws, as in some private modes", async () => {
    const { deps } = host(INIT, SITE);
    const broken: BootDeps = {
      ...deps,
      storage: () => {
        throw new Error("SecurityError");
      },
    };
    expect((await resolveBoot(broken)).backend.kind).toBe("firebase");
  });
});

describe("resolveBoot: a real cafe that cannot load its config is never demo", () => {
  it("offline, with site.json kept but no config on the device", async () => {
    const { deps } = host("network", SITE);
    expect((await resolveBoot(deps)).backend).toEqual({
      kind: "unreachable",
      reason: "offline",
    });
  });

  it("offline, with nothing on the device at all", async () => {
    const { deps } = host("network", "network");
    expect((await resolveBoot(deps)).backend).toEqual({
      kind: "unreachable",
      reason: "offline",
    });
  });

  it("when init.json is unreachable even though site.json is definitely absent", async () => {
    // One request dropped: not proof that this is a demo.
    const { deps } = host("network", 404);
    expect((await resolveBoot(deps)).backend.kind).toBe("unreachable");
  });

  it("when site.json was not reached, even though init.json is absent", async () => {
    const { deps } = host(404, "network");
    expect((await resolveBoot(deps)).backend.kind).toBe("unreachable");
  });

  it("deployed with a site.json but without a Firebase web app", async () => {
    const { deps } = host(404, SITE);
    expect((await resolveBoot(deps)).backend).toEqual({
      kind: "unreachable",
      reason: "no-config",
    });
  });

  it("when init.json is there but is not a usable config", async () => {
    const { deps } = host({ projectId: "their-cafe" }, SITE);
    expect((await resolveBoot(deps)).backend).toEqual({
      kind: "unreachable",
      reason: "no-config",
    });
  });

  it("when a request hangs: it gives up and reaches the retry", async () => {
    vi.useFakeTimers();
    const { deps } = host(404, SITE);
    const hanging: BootDeps = {
      ...deps,
      fetch: (path, init) =>
        path === INIT_JSON_PATH
          ? new Promise((_, reject) =>
              init.signal?.addEventListener("abort", () =>
                reject(new DOMException("aborted", "AbortError")),
              ),
            )
          : deps.fetch(path, init),
    };
    const pending = resolveBoot(hanging);
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await pending).backend).toEqual({
      kind: "unreachable",
      reason: "offline",
    });
  });
});

describe("parseFirebaseConfig", () => {
  it("keeps what the SDK uses from init.json, and drops the rest", () => {
    expect(parseFirebaseConfig(INIT)).toEqual(CONFIG);
  });

  it("works out authDomain when Hosting leaves it out", () => {
    expect(
      parseFirebaseConfig({ apiKey: "k", appId: "a", projectId: "p" }),
    ).toEqual({
      apiKey: "k",
      appId: "a",
      projectId: "p",
      authDomain: "p.firebaseapp.com",
    });
  });

  it("refuses a config without a key, an app or a project", () => {
    for (const raw of [
      null,
      "config",
      { appId: "a", projectId: "p" },
      { apiKey: "k", projectId: "p" },
      { apiKey: "k", appId: "a" },
      { apiKey: " ", appId: "a", projectId: "p" },
    ]) {
      expect(parseFirebaseConfig(raw)).toBeNull();
    }
  });
});

describe("boot(): once per page", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // Back to the demo mode the rest of the suite runs in (src/test/setup.ts).
    primeBoot({ backend: { kind: "demo" }, site: { status: "missing" } });
  });

  it("is shared by every caller, and peekable once it has settled", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const first = retryBoot();
    expect(peekBoot()).toBeNull();
    expect(boot()).toBe(first);
    await first;
    expect(peekBoot()?.backend).toEqual({ kind: "demo" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("starts over on a retry, and remembers the Firebase config it found", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    expect((await retryBoot()).backend.kind).toBe("unreachable");
    expect(activeFirebaseConfig()).toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) =>
        path === INIT_JSON_PATH ? json(INIT) : json(SITE),
      ),
    );
    expect((await retryBoot()).backend.kind).toBe("firebase");
    expect(activeFirebaseConfig()).toEqual(CONFIG);
  });
});
