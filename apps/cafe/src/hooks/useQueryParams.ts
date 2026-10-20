"use client";

/**
 * The page's query string, read on the client.
 *
 * Why Next's own `searchParams` *page prop* is not used: on a statically
 * prerendered route it reaches the client component as a plain `{}` rather than a
 * Promise, so awaiting it throws in production and silently sends every customer
 * who scanned a QR code to the fallback table picker.
 *
 * Why `useSearchParams` rather than reading `window.location.search` in an
 * effect: the effect version had an empty dependency array, so it read the query
 * string once on mount and never again. A full page load always worked, because
 * the component mounts with the table number already in the URL — but tapping a
 * table number on the picker is a *client-side* navigation to the same route, the
 * component does not remount, the effect does not re-run, and the page rendered
 * the picker again. The link worked, the URL changed, and the customer saw
 * nothing happen.
 *
 * The hook is the right tool precisely because it subscribes to the router: it
 * returns the current query on a soft navigation as well as a cold load. Because
 * a static export prerenders with no query at all, the page wraps the part that
 * reads this in `<Suspense>`; see `TableGate` in `src/app/order/page.tsx`.
 */

import { useSearchParams } from "next/navigation";

export type QueryParams = Readonly<Record<string, string>> | null;

/** `null` until the query string is known, so the first paint can show a loader. */
export function useQueryParams(): QueryParams {
  const search = useSearchParams();

  if (!search) return null;

  const next: Record<string, string> = {};
  search.forEach((value, key) => {
    next[key] = value;
  });
  return next;
}
