/**
 * A scanned table code lasts TABLE_CODE_TTL_MS (3 hours) on the phone, so a
 * visit last week no longer lets anyone order from home.
 */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTableCode } from "@/hooks/useTableCode";
import {
  TABLE_CODE_TTL_MS,
  forgetTableKeys,
  readTableCode,
  readTableKey,
  rememberTableKey,
} from "@/lib/table-keys";

const T0 = Date.UTC(2026, 8, 28, 12, 0, 0);
const MIN = 60_000;
const CODE = "ScannedCode1";

beforeEach(() => {
  forgetTableKeys();
  localStorage.clear();
});

describe("table code expiry", () => {
  it("is three hours", () => {
    expect(TABLE_CODE_TTL_MS).toBe(3 * 60 * MIN);
  });

  it("still works at 2h59, and not at 3h01", () => {
    vi.useFakeTimers({ now: T0 });
    rememberTableKey(3, CODE);

    vi.setSystemTime(T0 + 179 * MIN);
    expect(readTableKey(3)).toBe(CODE);
    expect(readTableCode(3)).toEqual({
      state: "valid",
      key: CODE,
      expiresAt: T0 + TABLE_CODE_TTL_MS,
    });

    vi.setSystemTime(T0 + 181 * MIN);
    expect(readTableKey(3)).toBeNull();
    expect(readTableCode(3)).toEqual({ state: "expired" });
  });

  it("restarts the three hours on a new scan", () => {
    vi.useFakeTimers({ now: T0 });
    rememberTableKey(3, CODE);
    vi.setSystemTime(T0 + 170 * MIN);
    rememberTableKey(3, CODE); // scanned again at the table
    vi.setSystemTime(T0 + 181 * MIN);
    expect(readTableKey(3)).toBe(CODE);
    vi.setSystemTime(T0 + 170 * MIN + TABLE_CODE_TTL_MS + MIN);
    expect(readTableKey(3)).toBeNull();
  });

  it("revives an expired table with a fresh scan", () => {
    rememberTableKey(3, CODE, T0);
    expect(readTableCode(3, T0 + 4 * 60 * MIN).state).toBe("expired");
    rememberTableKey(3, "RenewedCode1", T0 + 4 * 60 * MIN);
    expect(readTableKey(3, T0 + 4 * 60 * MIN + 1)).toBe("RenewedCode1");
  });

  it("wipes the expired code from storage but remembers the table had one", () => {
    rememberTableKey(3, CODE, T0);
    expect(readTableCode(3, T0 + TABLE_CODE_TTL_MS).state).toBe("expired");
    const stored = localStorage.getItem("toe.tableKey.t3") ?? "";
    expect(stored).not.toContain(CODE);
    expect(JSON.parse(stored)).toEqual({ at: T0 });
    // Later reads still know it is a coded table.
    expect(readTableCode(3, T0).state).toBe("expired");
  });

  it("counts a table never scanned on this phone as unknown", () => {
    expect(readTableCode(4)).toEqual({ state: "none" });
  });

  it("treats a code saved before scan times were kept as expired", () => {
    localStorage.setItem("toe.tableKey.t5", "OldSavedCode");
    expect(readTableCode(5)).toEqual({ state: "expired" });
  });

  it("keeps the code for this page load when storage is refused", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    rememberTableKey(6, CODE, T0);
    expect(readTableKey(6, T0 + MIN)).toBe(CODE);
    expect(readTableKey(6, T0 + TABLE_CODE_TTL_MS + MIN)).toBeNull();
  });

  it("falls back to sessionStorage, which outlives the page load", () => {
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      name: string,
      value: string,
    ) {
      if (this === localStorage) throw new Error("QuotaExceededError");
      setItem.call(this, name, value);
    });
    rememberTableKey(6, CODE, T0);
    expect(sessionStorage.getItem("toe.tableKey.t6")).toContain(CODE);
    sessionStorage.clear();
  });

  it("does not let an old expired entry hide a newer scan kept elsewhere", () => {
    localStorage.setItem("toe.tableKey.t7", JSON.stringify({ at: T0 }));
    sessionStorage.setItem(
      "toe.tableKey.t7",
      JSON.stringify({ k: CODE, at: T0 + 4 * 60 * MIN }),
    );
    expect(readTableKey(7, T0 + 5 * 60 * MIN)).toBe(CODE);
    sessionStorage.clear();
  });

  it("prefers a rescan saved by another tab over this tab's memory", () => {
    rememberTableKey(8, CODE, T0); // this tab
    localStorage.setItem(
      "toe.tableKey.t8",
      JSON.stringify({ k: "RenewedCode1", at: T0 + 2 * 60 * MIN }),
    );
    expect(readTableKey(8, T0 + 4 * 60 * MIN)).toBe("RenewedCode1");
  });

  it("does not let a scan time in the future stretch the 3 hours", () => {
    rememberTableKey(9, CODE, T0 + 2 * MIN);
    expect(readTableKey(9, T0)).toBe(CODE); // small skew is fine
    rememberTableKey(9, CODE, T0 + 24 * 60 * MIN); // clock was a day fast
    expect(readTableCode(9, T0)).toEqual({ state: "expired" });
  });

  it("reads junk as never scanned, and clears it", () => {
    localStorage.setItem("toe.tableKey.t10", "{not json");
    expect(readTableCode(10)).toEqual({ state: "none" });
    expect(localStorage.getItem("toe.tableKey.t10")).toBeNull();
    localStorage.setItem("toe.tableKey.t10", JSON.stringify({ k: CODE }));
    expect(readTableCode(10)).toEqual({ state: "none" });
  });
});

describe("useTableCode", () => {
  it("changes its mind when the code runs out, without a reload", () => {
    vi.useFakeTimers({ now: T0 });
    rememberTableKey(3, CODE);
    const { result } = renderHook(() => useTableCode(3, null));
    expect(result.current.state).toBe("valid");

    act(() => vi.advanceTimersByTime(179 * MIN));
    expect(result.current.state).toBe("valid");
    act(() => vi.advanceTimersByTime(2 * MIN));
    expect(result.current.state).toBe("expired");
  });

  it("re-checks when the tab comes back into view", () => {
    vi.useFakeTimers({ now: T0, toFake: ["Date"] });
    rememberTableKey(3, CODE);
    const { result } = renderHook(() => useTableCode(3, null));
    expect(result.current.state).toBe("valid");

    // A sleeping phone: the clock moved, the timer did not fire.
    vi.setSystemTime(T0 + 181 * MIN);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.state).toBe("expired");
  });

  it("expires even if the router keeps handing back the scanned k", () => {
    vi.useFakeTimers({ now: T0 });
    rememberTableKey(3, CODE);
    const { result } = renderHook(() => useTableCode(3, CODE));
    expect(result.current.state).toBe("valid");
    act(() => vi.advanceTimersByTime(181 * MIN));
    expect(result.current.state).toBe("expired");
  });

  it("trusts a code still in the address before it has been saved", () => {
    const { result } = renderHook(() => useTableCode(3, CODE));
    expect(result.current).toMatchObject({ state: "valid", key: CODE });
  });
});
