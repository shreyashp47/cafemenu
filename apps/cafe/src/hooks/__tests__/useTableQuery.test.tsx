/**
 * Regression tests for the QR entry point.
 *
 * The `/order` page is statically prerendered, which means Next.js hands the
 * client component a plain `{}` for `searchParams` rather than a Promise. The
 * original implementation awaited it, which threw in production only and sent
 * every customer who scanned a QR code to the fallback table picker instead of
 * the menu. These tests pin the behaviour that actually ships.
 */

import { render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTableQuery } from "@/hooks/useTableQuery";
import { orderHref, parseTableNumber, readTableFromSearch } from "@/lib/tables";

/**
 * `useQueryParams` now reads through Next's `useSearchParams`, which is what
 * makes it correct across client-side navigations. Outside a router that hook has
 * nothing to read, so it is stood in for by the real thing it wraps: the query
 * string on the current location.
 *
 * The bug this hook had — reading the query once on mount, so a soft navigation
 * to `/order?table=3` left the table picker on screen — is not reachable from a
 * unit test, because there is no router to navigate. That case is covered by
 * `scripts/entry.mjs`, which drives a real browser.
 */
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

function setLocation(search: string) {
  window.history.replaceState({}, "", `/order${search}`);
}

beforeEach(() => setLocation(""));
afterEach(() => setLocation(""));

describe("useTableQuery", () => {
  it("resolves a valid table from the query string", () => {
    setLocation("?table=4");
    const { result } = renderHook(() => useTableQuery());
    expect(result.current.ready).toBe(true);
    expect(result.current.tableNumber).toBe(4);
  });

  it("reports a missing table as null rather than throwing", () => {
    const { result } = renderHook(() => useTableQuery());
    expect(result.current.ready).toBe(true);
    expect(result.current.tableNumber).toBeNull();
    expect(result.current.raw).toBeNull();
  });

  it("is ready on the first client render, without a mount cycle", () => {
    // The loader used to come from this hook returning `ready: false` until an
    // effect had run. It now comes from the <Suspense> boundary around
    // OrderScreen, because a static export prerenders with no query string and
    // the hook reads through Next's useSearchParams — which has the query
    // available immediately on the client.
    //
    // The intent is unchanged and still holds: the first paint is the mascot
    // loader, not a flash of the table picker on a QR scan. `scripts/entry.mjs`
    // checks that in a real browser, which is the only place it is observable.
    setLocation("?table=4");
    const seen: boolean[] = [];
    function Probe() {
      seen.push(useTableQuery().ready);
      return null;
    }
    render(<Probe />);
    expect(seen.every(Boolean)).toBe(true);
  });

  it("keeps the raw value for the 'that looks odd' copy", () => {
    setLocation("?table=banana");
    const { result } = renderHook(() => useTableQuery());
    expect(result.current.tableNumber).toBeNull();
    expect(result.current.raw).toBe("banana");
  });

  it("ignores an empty table value", () => {
    setLocation("?table=");
    const { result } = renderHook(() => useTableQuery());
    expect(result.current.tableNumber).toBeNull();
  });

  it("handles a large table number", () => {
    setLocation("?table=12");
    const { result } = renderHook(() => useTableQuery());
    expect(result.current.tableNumber).toBe(12);
  });

  it("ignores unrelated query parameters", () => {
    setLocation("?utm_source=table-tent&utm_medium=qr&table=7");
    const { result } = renderHook(() => useTableQuery());
    expect(result.current.tableNumber).toBe(7);
  });

  it("surfaces the order id used by the confirmation screen", () => {
    setLocation("?table=3&id=o-abc");
    const { result } = renderHook(() => useTableQuery());
    expect(result.current.orderId).toBe("o-abc");
    expect(result.current.hasOrderId).toBe(true);
  });

  it("distinguishes a missing id from an empty one", () => {
    setLocation("?table=3");
    expect(renderHook(() => useTableQuery()).result.current.hasOrderId).toBe(
      false,
    );

    setLocation("?table=3&id=");
    const empty = renderHook(() => useTableQuery()).result.current;
    expect(empty.hasOrderId).toBe(true);
    expect(empty.orderId).toBeNull();
  });
});

describe("the QR url contract", () => {
  it("parses exactly what the QR generator encodes", () => {
    // /admin/qr encodes `${base}/order?table=N`
    const url = orderHref(6);
    expect(url).toBe("/order?table=6");
    expect(readTableFromSearch(url.slice(url.indexOf("?")))).toBe(6);
  });

  it("never produces a table of zero or less", () => {
    for (const bad of ["0", "-1", "1e3", "NaN", " ", "%20"]) {
      expect(parseTableNumber(bad)).toBeNull();
    }
  });

  it("does not accept a decimal or a signed number", () => {
    expect(parseTableNumber("2.5")).toBeNull();
    expect(parseTableNumber("+3")).toBeNull();
    expect(parseTableNumber(2.5)).toBeNull();
  });
});
