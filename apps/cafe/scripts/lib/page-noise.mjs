/**
 * Browser messages the page checks (scripts/audit.mjs, entry.mjs, flow.mjs,
 * screenshot.mjs) forgive, and why. Everything not listed here is still a
 * failure. Two things, today.
 *
 * 1. The boot's two questions on a demo deploy (isBootFileMiss). Every page
 * asks for /__/firebase/init.json and /site.json (src/lib/boot.ts), and a 404
 * from both is how it knows it is a demo. Browsers log every 404 as a console
 * error, "Failed to load resource", fetch() included. Only a 404, and only for
 * those two addresses: any other missing resource still fails.
 *
 * 2. WebKit reporting a router prefetch that Next.js abandoned
 * (withoutAbortedPrefetches). Next prefetches the router data of every link on screen
 * (`/order.txt?_rsc=…`). When the page navigates away or closes while one is
 * still in flight, the request is cancelled, and WebKit, unlike Chromium,
 * reports the cancellation as two errors:
 *
 *   pageerror: …/order.txt?_rsc=… due to access control checks.
 *   console:   Failed to fetch RSC payload for …/order.txt. Falling back to
 *              browser navigation. TypeError: Load failed
 *
 * Nothing is broken: nobody asked for that page, and had they, Next would
 * have loaded it as an ordinary navigation, which is what the second message
 * says. It depends only on timing, so it failed one CI run of a docs-only
 * commit whose predecessor passed (run 39389049479).
 *
 * Only the pair is forgiven, and only on WebKit and the same `.txt` address:
 * either message alone, or about anything but router data, may be a real
 * fault and still fails.
 */

export const BOOT_FILES = ["/__/firebase/init.json", "/site.json"];

/** True for a Playwright console message that is the boot's expected 404. */
export function isBootFileMiss(message) {
  if (
    !/^Failed to load resource: the server responded with a status of 404\b/.test(
      message.text(),
    )
  ) {
    return false;
  }
  try {
    return BOOT_FILES.includes(new URL(message.location().url).pathname);
  } catch {
    return false;
  }
}

const ABORTED_PREFETCH =
  /^pageerror: (\S+\.txt)\?_rsc=\S+ due to access control checks\.?$/;
const FELL_BACK =
  /^console: Failed to fetch RSC payload for (\S+\.txt)\. Falling back to browser navigation\. TypeError: Load failed$/;

/** "http://host/a.txt" and WebKit's "/host/a.txt" name the same file. */
const key = (address) =>
  address.replace(/^[a-z]+:\/\//i, "").replace(/^\/+/, "");

/**
 * `errors` without the WebKit prefetch-abort pairs. Each entry is a message as
 * audit.mjs collects it, "pageerror: …" or "console: …".
 */
export function withoutAbortedPrefetches(engine, errors) {
  if (engine !== "webkit") return errors;
  const aborted = new Set();
  const fellBack = new Set();
  for (const e of errors) {
    const a = ABORTED_PREFETCH.exec(e);
    if (a) aborted.add(key(a[1]));
    const f = FELL_BACK.exec(e);
    if (f) fellBack.add(key(f[1]));
  }
  const paired = new Set([...aborted].filter((k) => fellBack.has(k)));
  if (paired.size === 0) return errors;
  return errors.filter((e) => {
    const m = ABORTED_PREFETCH.exec(e) ?? FELL_BACK.exec(e);
    return !(m && paired.has(key(m[1])));
  });
}
