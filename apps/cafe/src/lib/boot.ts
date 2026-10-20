/**
 * Which backend this page runs on, decided once per page load.
 *
 * One build serves every cafe, so the Firebase project cannot be baked in.
 * Firebase Hosting serves each project's own web config at the reserved address
 * /__/firebase/init.json, so the same files talk to whichever project they are
 * deployed to. In order:
 *
 *   1. the Firebase block in .env.local, when all six are set (local
 *      development; a release build has none);
 *   2. a site.json that says `"demo": true`: a preview deploy, demo store;
 *   3. init.json: a real cafe on Firebase Hosting. The config is kept on the
 *      device as well;
 *   4. init.json unreachable (an offline counter phone): the config kept on the
 *      device, if there is one;
 *   5. neither init.json nor site.json exists: demo mode, as with `npm run dev`
 *      or any plain static host;
 *   6. anything else is "unreachable", and the page offers a retry.
 *
 * Step 6 is the one that matters. site.json is written by the deployer on every
 * deploy, so its presence means a real cafe. A real cafe that cannot load its
 * config must never fall back to demo data: a customer would order from the
 * sample menu and the order would go nowhere. So demo mode needs both files to
 * be definitely absent (a 404, not a dropped connection), and a failed request
 * with nothing on the device is a retry screen, not a guess.
 *
 * public/sw.js keeps a copy of both files (network first), so a counter phone
 * that loaded the app once still starts without a connection.
 *
 * Only the decision lives here. src/lib/data/index.ts turns it into
 * repositories, behind a dynamic import, so a demo visitor never downloads the
 * Firebase SDK.
 */

import { SITE_FILE_PATH, parseSiteFile, type SiteFile } from "@cafemenu/shared";

import { envFirebaseConfig, type FirebaseWebConfig } from "./config";

export const INIT_JSON_PATH = "/__/firebase/init.json";
export const FIREBASE_CONFIG_KEY = "cafemenu.firebase-config.v1";

/** Long enough for a slow phone network, short enough to reach the retry. */
const FETCH_TIMEOUT_MS = 10_000;

/** One deploy-time file: there, definitely not there (404), or not reached. */
export type Fetched<T> =
  { status: "ok"; value: T } | { status: "missing" } | { status: "error" };

export type Backend =
  | {
      kind: "firebase";
      config: FirebaseWebConfig;
      /** env: .env.local; hosting: init.json; device: the copy kept here. */
      source: "env" | "hosting" | "device";
    }
  | { kind: "demo" }
  | {
      kind: "unreachable";
      /** offline: init.json was not reached; no-config: it is not there. */
      reason: "offline" | "no-config";
    };

export interface Boot {
  backend: Backend;
  /** site.json, for the cafe's settings (src/lib/settings.ts). */
  site: Fetched<SiteFile>;
}

export interface BootDeps {
  fetch: (path: string, init: RequestInit) => Promise<Response>;
  storage: () => Storage | null;
  env: () => FirebaseWebConfig | null;
}

function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const browserDeps: BootDeps = {
  fetch: (path, init) => fetch(path, init),
  storage: browserStorage,
  env: envFirebaseConfig,
};

/** Hosting's init.json carries more than the SDK needs; keep what it uses. */
export function parseFirebaseConfig(raw: unknown): FirebaseWebConfig | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const text = (value: unknown) =>
    typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  const apiKey = text(r.apiKey);
  const projectId = text(r.projectId);
  const appId = text(r.appId);
  if (!apiKey || !projectId || !appId) return null;
  const config: FirebaseWebConfig = {
    apiKey,
    projectId,
    appId,
    authDomain: text(r.authDomain) ?? `${projectId}.firebaseapp.com`,
  };
  const bucket = text(r.storageBucket);
  const sender = text(r.messagingSenderId);
  if (bucket) config.storageBucket = bucket;
  if (sender) config.messagingSenderId = sender;
  return config;
}

async function fetchJson(
  deps: BootDeps,
  path: string,
): Promise<Fetched<unknown>> {
  const controller =
    typeof AbortController === "function" ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await deps.fetch(path, {
      cache: "no-cache",
      credentials: "same-origin",
      signal: controller?.signal,
    });
    if (response.status === 404) return { status: "missing" };
    if (!response.ok) return { status: "error" };
    // A host that answers every address with its index page (a single-page
    // fallback) does not have the file either.
    if ((response.headers.get("content-type") ?? "").includes("text/html")) {
      return { status: "missing" };
    }
    try {
      return { status: "ok", value: await response.json() };
    } catch {
      return { status: "missing" };
    }
  } catch {
    return { status: "error" };
  } finally {
    clearTimeout(timer);
  }
}

export function readDeviceConfig(deps: BootDeps = browserDeps) {
  try {
    const raw = deps.storage()?.getItem(FIREBASE_CONFIG_KEY);
    return raw ? parseFirebaseConfig(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function keepDeviceConfig(deps: BootDeps, config: FirebaseWebConfig | null) {
  try {
    const storage = deps.storage();
    if (config) storage?.setItem(FIREBASE_CONFIG_KEY, JSON.stringify(config));
    else storage?.removeItem(FIREBASE_CONFIG_KEY);
  } catch {
    /* private mode: this device just will not start offline */
  }
}

/** The decision itself. Never throws. Exported for its tests. */
export async function resolveBoot(deps: BootDeps = browserDeps): Promise<Boot> {
  const env = deps.env();
  const [init, rawSite] = await Promise.all([
    env
      ? Promise.resolve<Fetched<unknown>>({ status: "missing" })
      : fetchJson(deps, INIT_JSON_PATH),
    fetchJson(deps, SITE_FILE_PATH),
  ]);

  let site: Fetched<SiteFile> =
    rawSite.status === "ok" ? { status: "missing" } : rawSite;
  if (rawSite.status === "ok") {
    const file = parseSiteFile(rawSite.value);
    if (file) site = { status: "ok", value: file };
  }

  if (env)
    return { backend: { kind: "firebase", config: env, source: "env" }, site };
  if (site.status === "ok" && site.value.demo) {
    return { backend: { kind: "demo" }, site };
  }

  const config = init.status === "ok" ? parseFirebaseConfig(init.value) : null;
  if (config) {
    keepDeviceConfig(deps, config);
    return {
      backend: { kind: "firebase", config, source: "hosting" },
      site,
    };
  }

  const reached = init.status !== "error";
  if (!reached) {
    const kept = readDeviceConfig(deps);
    if (kept) {
      return {
        backend: { kind: "firebase", config: kept, source: "device" },
        site,
      };
    }
  }

  if (reached && site.status === "missing") {
    // This address definitely serves neither file now, so whatever this
    // device kept from it before no longer applies.
    keepDeviceConfig(deps, null);
    return { backend: { kind: "demo" }, site };
  }

  return {
    backend: {
      kind: "unreachable",
      reason: reached ? "no-config" : "offline",
    },
    site,
  };
}

// --- once per page load -------------------------------------------------------

let pending: Promise<Boot> | null = null;
let settled: Boot | null = null;

/** The page's boot, started on first use and shared by every caller. */
export function boot(): Promise<Boot> {
  pending ??= resolveBoot().then((result) => {
    settled = result;
    return result;
  });
  return pending;
}

/** The boot if it has already finished, so a later mount need not wait. */
export function peekBoot(): Boot | null {
  return settled;
}

/** Starts over, for the retry button on an unreachable cafe. */
export function retryBoot(): Promise<Boot> {
  pending = null;
  settled = null;
  return boot();
}

/**
 * Settles the boot without fetching anything. The unit tests use it to start
 * every page in demo mode, as `npm run dev` does.
 */
export function primeBoot(result: Boot): void {
  settled = result;
  pending = Promise.resolve(result);
}

/** The Firebase config the page booted with, for src/lib/data/firebase.ts. */
export function activeFirebaseConfig(): FirebaseWebConfig | null {
  return settled?.backend.kind === "firebase" ? settled.backend.config : null;
}
