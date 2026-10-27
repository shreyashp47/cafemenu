/**
 * Hands the browser a CSV to save. A byte-order mark first, so a spreadsheet
 * reads the UTF-8 names (an owner's "Café") as they are.
 */
export function downloadCsv(filename: string, csv: string): void {
  if (typeof URL.createObjectURL !== "function") return; // no browser (tests)
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** "cafemenu-owners-2026-10-27.csv" */
export const csvName = (what: string, now: number) =>
  `cafemenu-${what}-${new Date(now).toISOString().slice(0, 10)}.csv`;
