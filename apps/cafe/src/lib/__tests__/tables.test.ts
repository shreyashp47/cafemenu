/**
 * The owner's table list: what counts as a table, and how the free-form field
 * on /admin/qr is read. A wrong answer here either hides a real table from
 * customers or lets the owner save one the order rules will refuse.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { getTableNumbers } from "@/lib/config";
import {
  MAX_TABLE_NUMBER,
  checkTablesForSave,
  formatTableList,
  isSimpleRun,
  normalizeTables,
  parseTableText,
  tablesUpTo,
} from "@/lib/tables";

describe("normalizeTables", () => {
  it("sorts and de-duplicates", () => {
    expect(normalizeTables([3, 1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("drops anything that is not a whole number 1..50", () => {
    expect(normalizeTables([0, 1, 1.5, "2", 51, null, 50])).toEqual([1, 50]);
  });

  it("treats a missing, empty or wrong-shaped value as nothing saved", () => {
    expect(normalizeTables(undefined)).toBeNull();
    expect(normalizeTables([])).toBeNull();
    expect(normalizeTables("1,2,3")).toBeNull();
    expect(normalizeTables([0, -1])).toBeNull();
  });
});

describe("checkTablesForSave", () => {
  it("returns the list as it will be written", () => {
    expect(checkTablesForSave([4, 2, 2])).toEqual([2, 4]);
  });

  it("refuses an empty list or an out-of-range table", () => {
    expect(() => checkTablesForSave([])).toThrow(/at least one/);
    expect(() => checkTablesForSave([1, 51])).toThrow(/1 to 50/);
    expect(() => checkTablesForSave([0])).toThrow(/1 to 50/);
  });
});

describe("tablesUpTo", () => {
  it("numbers tables from 1", () => {
    expect(tablesUpTo(4)).toEqual([1, 2, 3, 4]);
  });

  it("clamps to 1..50", () => {
    expect(tablesUpTo(0)).toEqual([1]);
    expect(tablesUpTo(99)).toHaveLength(MAX_TABLE_NUMBER);
  });
});

describe("isSimpleRun", () => {
  it("is true only for exactly 1..N", () => {
    expect(isSimpleRun([1, 2, 3])).toBe(true);
    expect(isSimpleRun([1, 2, 4])).toBe(false);
    expect(isSimpleRun([2, 3])).toBe(false);
    expect(isSimpleRun([])).toBe(false);
  });
});

describe("formatTableList", () => {
  it("collapses runs into ranges", () => {
    expect(formatTableList([1, 2, 3, 4, 12, 14, 15])).toBe("1-4, 12, 14, 15");
    expect(formatTableList([7])).toBe("7");
    expect(formatTableList([])).toBe("");
  });

  it("round-trips through parseTableText", () => {
    const list = [1, 2, 3, 9, 10, 11, 20, 22];
    expect(parseTableText(formatTableList(list)).tables).toEqual(list);
  });
});

describe("parseTableText", () => {
  it("reads numbers and ranges, separated by commas or spaces", () => {
    expect(parseTableText("1-3, 12 14").tables).toEqual([1, 2, 3, 12, 14]);
    expect(parseTableText("1 - 3").tables).toEqual([1, 2, 3]);
    expect(parseTableText("1–3").tables).toEqual([1, 2, 3]);
  });

  it("sorts and de-duplicates", () => {
    expect(parseTableText("5, 1, 5, 1-2").tables).toEqual([1, 2, 5]);
  });

  it("reports what it could not use, word for word", () => {
    expect(parseTableText("1, two, 0, 51, 9-3, 3.5").rejected).toEqual([
      "two",
      "0",
      "51",
      "9-3",
      "3.5",
    ]);
  });

  it("treats a blank field as no tables", () => {
    expect(parseTableText("  ,  ")).toEqual({ tables: [], rejected: [] });
  });
});

describe("getTableNumbers (the env default)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("drops numbers above 50, which no order could carry", () => {
    vi.stubEnv("NEXT_PUBLIC_TABLES", "3, 1, 60, 3");
    expect(getTableNumbers()).toEqual([1, 3]);
  });

  it("falls back to 1..6 when unset or unusable", () => {
    vi.stubEnv("NEXT_PUBLIC_TABLES", "");
    expect(getTableNumbers()).toEqual([1, 2, 3, 4, 5, 6]);
    vi.stubEnv("NEXT_PUBLIC_TABLES", "99");
    expect(getTableNumbers()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("never offers a table the order rules would refuse", () => {
    for (const n of getTableNumbers()) {
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(MAX_TABLE_NUMBER);
    }
  });
});
