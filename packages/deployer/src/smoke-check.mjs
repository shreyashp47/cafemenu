/**
 * The smoke test: does this URL serve a working CafeMenu site that is the one
 * we meant to deploy? Plain `fetch`, GET only, so it is safe against a real
 * cafe: it never places an order, signs in, or writes anything (that is what
 * `apps/cafe/scripts/flow.mjs` does, and why it stays demo-only).
 *
 * Ten checks, in this order:
 *
 *   home, order, staff, admin, offline
 *                  each answers 200 (no redirect, no error page); /order is
 *                  asked for with a table of the cafe's, as a scanned QR does
 *   service-worker /sw.js carries the expected build's cache version
 *                  (stamp-sw.mjs writes it into the build)
 *   site-json      /site.json is valid settings for @cafemenu/shared, not a
 *                  preview ("demo"), and names the expected cafe
 *   firebase-init  /__/firebase/init.json is the expected project's web config
 *   headers        the security headers of firebase.json are on every page
 *   not-found      an address that isn't a page still answers 404
 *
 * What a check expects comes in as `expect`: {cafe, projectId, swVersion,
 * headers, table, demo}. A check whose expectation is missing is "skip" when
 * its file isn't there at all (a build served as it is has no site.json, no
 * init.json and no firebase.json headers), and still judges a file that is.
 * The deployer always passes everything, so for it nothing is skipped.
 *
 * `smokeCheck` runs the checks again, with growing waits, until they all pass:
 * a Hosting release takes a short while to reach every edge. The result is
 * plain JSON, which the deployer acts on and the `smoke` script prints:
 *
 *   {ok, url, attempts, failed: ["staff"], expect: {...},
 *    checks: [{id, label, status: "pass" | "fail" | "skip", detail}]}
 */

export const SW_VERSION = /\bconst VERSION = "([^"]*)"/;
/** What public/sw.js holds until the build stamps it (scripts/lib/sw-version.mjs). */
export const UNSTAMPED = "__SW_VERSION__";

/** The cache version a service worker's source carries, or null. */
export const swVersionIn = (source) => SW_VERSION.exec(source)?.[1] ?? null;

/**
 * The headers firebase.json puts on every address (`source: "**"`): the
 * security ones. `config` is a Hosting ServingConfig (`toServingConfig`);
 * returns {name: value}.
 */
export function securityHeaders(config = {}) {
  const headers = {};
  for (const rule of config.headers ?? []) {
    if (rule.glob === "**" || rule.glob === "/**") {
      Object.assign(headers, rule.headers);
    }
  }
  return headers;
}

/** The pages of the cafe app a customer, the staff or the owner can reach (apps/cafe/src/app). */
export const PAGES = Object.freeze([
  { id: "home", label: "The front door", path: "/" },
  { id: "order", label: "The order page", path: "/order", needsTable: true },
  { id: "staff", label: "The staff board", path: "/staff" },
  { id: "admin", label: "The owner's dashboard", path: "/admin" },
  { id: "offline", label: "The offline page", path: "/offline" },
]);

export const RETRY = Object.freeze({ attempts: 6, waitMs: 5_000 });
export const REQUEST_TIMEOUT_MS = 10_000;

/** An address no page of the cafe has. */
export const MISSING_PAGE = "/smoke-test-no-such-page";
export const INIT_JSON = "/__/firebase/init.json";

const pass = (id, label, detail) => ({ id, label, status: "pass", detail });
const fail = (id, label, detail) => ({ id, label, status: "fail", detail });
const skip = (id, label, detail) => ({ id, label, status: "skip", detail });

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const quote = (text) => JSON.stringify(text);
/** Whitespace and case don't make a header value a different one. */
const sameHeader = (a, b) =>
  a.replace(/\s+/g, " ").trim().toLowerCase() ===
  b.replace(/\s+/g, " ").trim().toLowerCase();

/** What was answered, for a message: "500", "301 to /x", "nothing (…)". */
function describe(res) {
  if (res.error) return `nothing (${res.error})`;
  const to = res.headers.get("location");
  return to ? `${res.status} to ${to}` : String(res.status);
}

/**
 * One run of every check against `url`. Never throws for a problem with the
 * site: a failed check is the answer. `loadShared` is asked for only when a
 * site.json has to be checked.
 */
export async function runChecks({
  url,
  expect = {},
  loadShared = async () => {
    throw new Error("none was given");
  },
  fetchImpl = fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
}) {
  const base = url.replace(/\/+$/, "");
  const table = expect.table ?? 1;
  const seen = new Map();

  /** GET `path` once per run: {status, headers, text, contentType} or {error}. */
  function get(path) {
    if (!seen.has(path)) {
      seen.set(
        path,
        (async () => {
          try {
            // "manual": a redirect where a page should be is a finding.
            // UNVERIFIED: run in spike #5 (what the real <site>.web.app
            // answers: redirects, 404.html, the headers, propagation time).
            const res = await fetchImpl(`${base}${path}`, {
              method: "GET",
              redirect: "manual",
              headers: { "cache-control": "no-cache" },
              signal: AbortSignal.timeout(timeoutMs),
            });
            return {
              status: res.status,
              headers: res.headers,
              contentType: res.headers.get("content-type") ?? "",
              text: await res.text(),
            };
          } catch (error) {
            return {
              error:
                error?.name === "TimeoutError" || error?.name === "AbortError"
                  ? `timed out after ${timeoutMs / 1000}s`
                  : (error?.cause?.code ?? error?.message ?? String(error)),
            };
          }
        })(),
      );
    }
    return seen.get(path);
  }

  const pages = PAGES.map(({ id, label, path, needsTable }) => ({
    id,
    label,
    address: needsTable ? `${path}?table=${table}` : path,
  }));
  const checks = [];

  for (const { id, label, address } of pages) {
    const res = await get(address);
    if (res.error || res.status !== 200) {
      checks.push(fail(id, label, `${address} answered ${describe(res)}`));
    } else if (res.text.length === 0) {
      checks.push(
        fail(id, label, `${address} answered 200 with nothing in it`),
      );
    } else {
      checks.push(pass(id, label, `${address} answered 200`));
    }
  }

  checks.push(await serviceWorker(get, expect));
  checks.push(await siteJson(get, expect, loadShared));
  checks.push(await firebaseInit(get, expect));
  checks.push(
    await headers(
      get,
      expect,
      pages.map((page) => page.address),
    ),
  );
  checks.push(await notFound(get));

  const failed = checks.filter((c) => c.status === "fail").map((c) => c.id);
  return {
    ok: failed.length === 0,
    url: base,
    failed,
    expect: {
      cafe: expect.cafe ?? null,
      projectId: expect.projectId ?? null,
      swVersion: expect.swVersion ?? null,
      table,
      headers: Object.keys(expect.headers ?? {}),
    },
    checks,
  };
}

async function serviceWorker(get, expect) {
  const [id, label] = ["service-worker", "The service worker"];
  const res = await get("/sw.js");
  if (res.error || res.status !== 200) {
    return fail(id, label, `/sw.js answered ${describe(res)}`);
  }
  const version = swVersionIn(res.text);
  if (version === null) {
    return fail(id, label, `/sw.js has no \`const VERSION = "…"\` in it`);
  }
  if (version === UNSTAMPED) {
    return fail(
      id,
      label,
      `/sw.js was never stamped with its cache version (still ${UNSTAMPED})`,
    );
  }
  if (expect.swVersion !== undefined && version !== expect.swVersion) {
    return fail(
      id,
      label,
      `cache version ${version}, expected ${expect.swVersion}: another build is being served`,
    );
  }
  return pass(
    id,
    label,
    expect.swVersion === undefined
      ? `cache version ${version} (none expected)`
      : `cache version ${version}`,
  );
}

/**
 * A JSON file of the site: its parsed value, or the finished check that says
 * why there isn't one. A 404 is a skip when the file wasn't expected.
 */
async function jsonFile(get, path, { id, label, expected, absent }) {
  const res = await get(path);
  if (res.error) {
    return { check: fail(id, label, `${path} answered ${describe(res)}`) };
  }
  if (res.status === 404 && !expected) {
    return { check: skip(id, label, `none: ${absent}`) };
  }
  if (res.status !== 200) {
    return { check: fail(id, label, `${path} answered ${describe(res)}`) };
  }
  // A host that answers every address with its index page has no such file.
  if (res.contentType.includes("text/html")) {
    return {
      check: fail(id, label, `${path} is an HTML page, not JSON (a rewrite?)`),
    };
  }
  try {
    return { value: JSON.parse(res.text) };
  } catch {
    return { check: fail(id, label, `${path} isn't JSON`) };
  }
}

async function siteJson(get, expect, loadShared) {
  const [id, label] = ["site-json", "The cafe's settings (site.json)"];
  const file = await jsonFile(get, "/site.json", {
    id,
    label,
    expected: expect.cafe !== undefined,
    absent: "a build served as it is has no site.json",
  });
  if (file.check) return file.check;

  let shared;
  try {
    shared = await loadShared();
  } catch (error) {
    return fail(
      id,
      label,
      `can't read it without @cafemenu/shared: ${error.message}`,
    );
  }
  const check = shared.validateSiteFile(file.value);
  if (!check.ok) {
    const shown = check.problems.slice(0, 3).join("; ");
    const more = check.problems.length - 3;
    return fail(
      id,
      label,
      `isn't valid settings: ${shown}${more > 0 ? ` (and ${more} more)` : ""}`,
    );
  }
  // Without the flag the file's presence says "a real cafe"; with it the app
  // runs on its sample store and never asks this cafe's Firestore for anything.
  if (file.value.demo === true && !expect.demo) {
    return fail(
      id,
      label,
      `is marked "demo": true, so the app would show sample data, not this cafe`,
    );
  }
  const name = file.value.name;
  if (expect.cafe !== undefined && name !== expect.cafe) {
    return fail(
      id,
      label,
      `names the cafe ${quote(name)}, expected ${quote(expect.cafe)}`,
    );
  }
  return pass(id, label, `names the cafe ${quote(name)}`);
}

async function firebaseInit(get, expect) {
  const [id, label] = ["firebase-init", "The Firebase project (init.json)"];
  const file = await jsonFile(get, INIT_JSON, {
    id,
    label,
    expected: expect.projectId !== undefined,
    absent: "a plain static host has no Firebase config",
  });
  if (file.check) return file.check;

  const config = file.value;
  // The three values the app needs to start (parseFirebaseConfig in boot.ts).
  const missing = ["apiKey", "projectId", "appId"].filter(
    (key) => typeof config?.[key] !== "string" || config[key].trim() === "",
  );
  if (missing.length > 0) {
    return fail(
      id,
      label,
      `has no ${missing.join(", ")}: the site isn't linked to a web app`,
    );
  }
  if (expect.projectId !== undefined && config.projectId !== expect.projectId) {
    return fail(
      id,
      label,
      `is project ${quote(config.projectId)}, expected ${quote(expect.projectId)}`,
    );
  }
  return pass(id, label, `project ${config.projectId}`);
}

async function headers(get, expect, paths) {
  const [id, label] = ["headers", "The security headers"];
  const wanted = Object.entries(expect.headers ?? {});
  if (wanted.length === 0) {
    return skip(id, label, "none given (no firebase.json to read them from)");
  }
  const answered = [];
  for (const path of paths) {
    const res = await get(path);
    // A page that didn't answer has its own failed check.
    if (!res.error && res.status === 200) answered.push({ path, res });
  }
  const problems = [];
  for (const [name, value] of wanted) {
    const missing = [];
    for (const { path, res } of answered) {
      const got = res.headers.get(name);
      if (got === null) missing.push(path);
      else if (!sameHeader(got, value)) {
        problems.push(
          `${name} is ${quote(got)} on ${path}, not ${quote(value)}`,
        );
      }
    }
    if (missing.length > 0) {
      const where =
        missing.length === answered.length
          ? `all ${missing.length} pages`
          : missing.join(", ");
      problems.push(`${name} is missing on ${where}`);
    }
  }
  const judged = answered.length;
  if (judged === 0) {
    return skip(id, label, "no page answered, so there is none to look at");
  }
  if (problems.length > 0) {
    const more = problems.length - 4;
    return fail(
      id,
      label,
      `${problems.slice(0, 4).join("; ")}${more > 0 ? ` (and ${more} more)` : ""}`,
    );
  }
  return pass(
    id,
    label,
    `${wanted.map(([name]) => name).join(", ")} on ${judged} pages`,
  );
}

async function notFound(get) {
  const [id, label] = ["not-found", "An unknown address"];
  const res = await get(MISSING_PAGE);
  if (res.error || res.status !== 404) {
    // Only a 200 means a rewrite sends every address to a page.
    const hint = res.status === 200 ? " (a catch-all rewrite?)" : "";
    return fail(
      id,
      label,
      `${MISSING_PAGE} answered ${describe(res)}, not 404${hint}`,
    );
  }
  return pass(id, label, `${MISSING_PAGE} answered 404`);
}

/**
 * `runChecks` until they all pass, at most `attempts` times, waiting
 * `waitMs`, then twice that, and so on in between. Returns the last run's
 * result with `attempts` added. `onRetry({attempt, attempts, waitMs, result})`
 * is told before each wait.
 */
export async function smokeCheck({
  attempts = RETRY.attempts,
  waitMs = RETRY.waitMs,
  sleep = sleepFor,
  onRetry,
  ...options
}) {
  let result;
  let attempt = 0;
  while (attempt < attempts) {
    attempt += 1;
    result = await runChecks(options);
    if (result.ok || attempt === attempts) break;
    const wait = waitMs * attempt;
    onRetry?.({ attempt, attempts, waitMs: wait, result });
    await sleep(wait);
  }
  const { ok, url, ...rest } = result;
  return { ok, url, attempts: attempt, ...rest };
}

/** One line per failed check, for a message: "The staff board: /staff answered 500". */
export const failures = (result) =>
  result.checks
    .filter((c) => c.status === "fail")
    .map((c) => `${c.label}: ${c.detail}`);
