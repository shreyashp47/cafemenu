"use client";

/**
 * The table's QR code on the customer's phone: taken out of the address bar as
 * soon as the page has it, and judged fresh or stale as time passes.
 *
 * See src/lib/table-keys.ts for why codes exist and TABLE_CODE_TTL_MS for how
 * long a scan lasts.
 */

import { useEffect, useRef, useState } from "react";

import {
  TABLE_CODE_TTL_MS,
  readTableCode,
  rememberTableKey,
  type TableCode,
} from "@/lib/table-keys";

/**
 * Removes `k` from the address without a navigation, keeping every other part
 * (`table`, `id`, the hash). The code then never sits in the browser's
 * back/forward list, a bookmark, or the link a share sheet sends: the phone's
 * saved copy (with its 3-hour clock) is the only one left.
 *
 * The state argument must be `null`, not `history.state`. Next's app router
 * patches replaceState and, for a state carrying its own `__NA` marker, passes
 * the call straight through without telling the router: the address bar
 * changed but `useSearchParams` kept returning `k`, so the scanned tab trusted
 * the code forever. With `null` the patch copies its internal state across
 * itself and updates the router's URL.
 */
export function dropKeyFromAddress(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("k")) return;
  url.searchParams.delete("k");
  window.history.replaceState(
    null,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
}

/**
 * Saves a scanned code for its table, restarting the 3 hours, then clears it
 * from the address. A malformed `k` is not saved but is still cleared.
 */
export function useTakeKeyFromAddress(
  ready: boolean,
  tableNumber: number | null,
  urlKey: string | null,
): void {
  useEffect(() => {
    if (!ready) return;
    if (tableNumber !== null && urlKey) rememberTableKey(tableNumber, urlKey);
    dropKeyFromAddress();
  }, [ready, tableNumber, urlKey]);
}

/**
 * The phone's code for this table, re-judged when it runs out, so a tab left
 * open past the 3 hours changes its mind without a reload. Also re-judged when
 * the tab comes back into view: a sleeping phone may not run the timer on time.
 *
 * `urlKey` covers only the renders after a scan and before the effect above
 * has saved it, so a fresh scan never flashes the "please scan" notice. Once
 * the saved copy holds that code, the saved copy decides, with its clock, even
 * if the router were ever to keep handing back the old query string.
 */
export function useTableCode(
  tableNumber: number,
  urlKey: string | null,
): TableCode {
  const [now, setNow] = useState(() => Date.now());
  const stored = readTableCode(tableNumber, now);
  // Which `urlKey` has been seen saved. Tracked by value, so a later scan of a
  // different code in the same tab is trusted again until it is saved too.
  const saved = useRef<string | null>(null);
  if (urlKey && stored.state === "valid" && stored.key === urlKey) {
    saved.current = urlKey;
  }
  const code: TableCode =
    urlKey && saved.current !== urlKey
      ? { state: "valid", key: urlKey, expiresAt: now + TABLE_CODE_TTL_MS }
      : stored;
  const expiresAt = code.state === "valid" ? code.expiresAt : null;

  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer =
      expiresAt === null
        ? undefined
        : setTimeout(refresh, Math.max(0, expiresAt - Date.now()) + 50);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [expiresAt]);

  return code;
}
