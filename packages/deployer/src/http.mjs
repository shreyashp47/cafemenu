/**
 * The one place the deployer makes Google API calls. Everything in apis/
 * goes through `request`, which:
 *
 *   - attaches the access token, and only ever to https://*.googleapis.com
 *     (Hosting hands back an upload URL; it is checked before the token goes
 *     anywhere near it)
 *   - refuses any call marked as a write during a dry run
 *   - turns Google's error bodies into ApiError
 *   - retries reads, and only reads, on 429 and 5xx
 *   - polls long-running operations
 */
import { ApiError, DryRunWriteError, OperationError } from "./errors.mjs";

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Appends query parameters. Arrays repeat the key (`names=a&names=b`), which
 * is how Google's REST APIs take repeated fields; undefined and false are
 * left out.
 */
export function withQuery(url, params = {}) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined || value === false || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      query.append(name, String(item));
    }
  }
  const text = query.toString();
  return text ? `${url}${url.includes("?") ? "&" : "?"}${text}` : url;
}

function assertGoogleUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Not a URL: ${url}`);
  }
  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname.endsWith(".googleapis.com")
  ) {
    throw new Error(
      `Refusing to send credentials to ${parsed.origin}: only https://*.googleapis.com is allowed.`,
    );
  }
}

async function readError(res, method, url) {
  const text = await res.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* an HTML error page; the start of it is reported below */
  }
  // Some endpoints wrap the error in an array, as streaming methods do.
  const error = Array.isArray(json) ? json[0]?.error : json?.error;
  return new ApiError({
    method,
    url,
    status: res.status,
    code: typeof error?.status === "string" ? error.status : undefined,
    reason:
      typeof error?.message === "string"
        ? error.message
        : text.slice(0, 200) || res.statusText || "no details",
  });
}

/**
 * `getToken` returns an access token (see auth.mjs). `fetchImpl` and `sleep`
 * are injectable so tests can run without a network or real waiting.
 */
export function createGoogleClient({
  fetchImpl = fetch,
  getToken,
  dryRun = false,
  sleep = defaultSleep,
  now = Date.now,
  retries = 2,
}) {
  /**
   * Options:
   *   body      JSON request body
   *   raw       a Buffer sent as-is (with `contentType`)
   *   write     defaults to true for anything but GET; read-only POSTs
   *             (lookups, permission tests, validate-only creates) pass false
   *   notFound  value to return on 404 instead of throwing (e.g. null)
   */
  async function request(method, url, options = {}) {
    const { body, raw, contentType, notFound } = options;
    const write = options.write ?? method !== "GET";
    assertGoogleUrl(url);
    if (dryRun && write) throw new DryRunWriteError(method, url);

    const headers = { authorization: `Bearer ${await getToken()}` };
    let payload;
    if (raw !== undefined) {
      headers["content-type"] = contentType ?? "application/octet-stream";
      payload = raw;
    } else if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }

    for (let attempt = 0; ; attempt += 1) {
      let res;
      try {
        res = await fetchImpl(url, { method, headers, body: payload });
      } catch (error) {
        if (!write && attempt < retries) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new Error(
          `${method} ${url} did not get an answer: ${error.message}`,
        );
      }
      if (res.ok) {
        const text = await res.text();
        try {
          return text ? JSON.parse(text) : {};
        } catch {
          // Hosting's upload endpoint, for one, answers 200 without JSON.
          return {};
        }
      }
      if (res.status === 404 && notFound !== undefined) return notFound;
      if (!write && RETRYABLE.has(res.status) && attempt < retries) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw await readError(res, method, url);
    }
  }

  /**
   * Polls `GET {base}/{operation.name}` until the operation is done and
   * returns its `response`. Google's Operation resource: {name, done,
   * error?: Status, response?: object}.
   */
  async function waitForOperation(
    base,
    operation,
    { what, timeoutMs = 5 * 60_000, intervalMs = 2000 } = {},
  ) {
    let op = operation;
    const started = now();
    while (!op.done) {
      if (now() - started > timeoutMs) {
        throw new Error(
          `Timed out waiting for ${what} (${op.name}). It may still finish; re-running is safe.`,
        );
      }
      await sleep(intervalMs);
      op = await request("GET", `${base}/${op.name}`);
    }
    if (op.error) throw new OperationError(what, op.error);
    return op.response ?? {};
  }

  /** Follows `nextPageToken` and concatenates `field` across pages. */
  async function list(url, field, { pageSize, maxPages = 50 } = {}) {
    const items = [];
    let pageToken;
    for (let page = 0; page < maxPages; page += 1) {
      const res = await request("GET", withQuery(url, { pageSize, pageToken }));
      items.push(...(res[field] ?? []));
      pageToken = res.nextPageToken;
      if (!pageToken) return items;
    }
    throw new Error(`${url} returned more than ${maxPages} pages.`);
  }

  return {
    dryRun,
    request,
    get: (url, options) => request("GET", url, options),
    post: (url, body, options) => request("POST", url, { ...options, body }),
    patch: (url, body, options) => request("PATCH", url, { ...options, body }),
    list,
    waitForOperation,
  };
}
