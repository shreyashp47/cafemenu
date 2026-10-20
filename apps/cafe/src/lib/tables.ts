/** Table-number plumbing for `/order?table=N` (docs/requirements.md §5.5). */

import { getTableNumbers } from "./config";

/**
 * The highest table number an order can carry. firestore.rules refuses an
 * order with `tableNumber` outside 1..50, so a table above this could be
 * printed and scanned but never ordered from. The owner's table list is capped
 * here for the same reason.
 */
export const MAX_TABLE_NUMBER = 50;

/** Accepts `?table=4`, `#table=4`, or a bare `4`. */
export function parseTableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const n = Number.parseInt(trimmed, 10);
  return n > 0 ? n : null;
}

export function readTableFromSearch(search: string): number | null {
  const params = new URLSearchParams(search);
  return parseTableNumber(params.get("table"));
}

/**
 * The order page for a table. With a table code (src/lib/table-keys.ts) it is
 * the link a QR card carries, and only the card: the app's own links never
 * add one. Without one it only works for a table that has no code yet, or on a
 * phone that scanned the card within the last 3 hours (TABLE_CODE_TTL_MS).
 */
export function orderHref(tableNumber: number, key?: string | null): string {
  const base = `/order?table=${tableNumber}`;
  return key ? `${base}&k=${encodeURIComponent(key)}` : base;
}

const isTable = (n: unknown): n is number =>
  typeof n === "number" &&
  Number.isInteger(n) &&
  n >= 1 &&
  n <= MAX_TABLE_NUMBER;

/**
 * The saved table list (`config/tables.tables`) as the app will use it: sorted,
 * unique, every entry a whole number 1..50. Anything that is not a list, or has
 * no usable entry, is `null`, which callers read as "nothing saved, use the
 * default". Bad entries are dropped rather than failing the whole list, so one
 * stray value in the document cannot take every table offline.
 */
export function normalizeTables(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const ok = value.filter(isTable);
  return ok.length > 0 ? [...new Set(ok)].sort((a, b) => a - b) : null;
}

/** Tables 1..count, with count clamped to 1..50. */
export function tablesUpTo(count: number): number[] {
  const n = Math.min(Math.max(Math.trunc(count) || 1, 1), MAX_TABLE_NUMBER);
  return Array.from({ length: n }, (_, i) => i + 1);
}

/** True when the list is exactly 1..N, i.e. the "number of tables" shape. */
export function isSimpleRun(tables: readonly number[]): boolean {
  return tables.length > 0 && tables.every((n, i) => n === i + 1);
}

/** "1-8, 12, 14": consecutive numbers collapse into a range. */
export function formatTableList(tables: readonly number[]): string {
  const parts: string[] = [];
  let start = 0;
  for (let i = 1; i <= tables.length; i += 1) {
    if (i < tables.length && tables[i] === tables[i - 1] + 1) continue;
    const from = tables[start];
    const to = tables[i - 1];
    if (to === from) parts.push(String(from));
    else if (to === from + 1) parts.push(`${from}, ${to}`);
    else parts.push(`${from}-${to}`);
    start = i;
  }
  return parts.join(", ");
}

/**
 * Reads the owner's free-form list: numbers and ranges separated by commas or
 * spaces, e.g. "1-8, 12 14". Anything it cannot use comes back in `rejected`,
 * word for word, so the screen can say exactly what was wrong instead of
 * quietly saving a shorter list than the owner typed.
 */
export function parseTableText(text: string): {
  tables: number[];
  rejected: string[];
} {
  const found: number[] = [];
  const rejected: string[] = [];
  const tokens = text
    // "1 - 8" is one range, not three tokens.
    .replace(/\s*[-–]\s*/g, "-")
    .split(/[\s,]+/)
    .filter(Boolean);
  for (const token of tokens) {
    const range = /^(\d{1,3})-(\d{1,3})$/.exec(token);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (isTable(from) && isTable(to) && from <= to) {
        for (let n = from; n <= to; n += 1) found.push(n);
      } else {
        rejected.push(token);
      }
    } else if (/^\d{1,3}$/.test(token) && isTable(Number(token))) {
      found.push(Number(token));
    } else {
      rejected.push(token);
    }
  }
  return { tables: [...new Set(found)].sort((a, b) => a - b), rejected };
}

export { getTableNumbers };

/**
 * The list a save will actually write, or an error. Both backends call this so
 * the demo store cannot accept a list the Firestore rules would refuse.
 */
export function checkTablesForSave(tables: readonly number[]): number[] {
  if (!tables.every(isTable)) {
    throw new Error(
      `Table numbers must be whole numbers from 1 to ${MAX_TABLE_NUMBER}.`,
    );
  }
  const clean = normalizeTables(tables);
  if (!clean) throw new Error("Add at least one table.");
  return clean;
}
