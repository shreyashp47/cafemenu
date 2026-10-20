"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";

import {
  formatTimeLeft,
  openTables,
  type TableSessions,
} from "@/lib/table-open";

/**
 * The staff board's "Open tables" strip: every table staff have confirmed,
 * how long it stays open, and a Close button for when the group leaves.
 *
 * An open table's orders skip the "check the table" step
 * (src/lib/table-open.ts), so closing one as the guests go is what makes the
 * next person with that table's link wait for the counter again. Tables close
 * on their own too; this only saves waiting for the clock.
 */
export function OpenTables({
  sessions,
  busyTable,
  onClose,
}: {
  sessions: TableSessions;
  /** A Close in flight, so its button can say so. */
  busyTable: number | null;
  onClose: (table: number) => void;
}) {
  // A coarse tick is plenty: the strip shows minutes.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  // And a fresh clock whenever a table changes: a table closed just now has
  // openUntil = now, which a clock from before the tap would still call open.
  useEffect(() => setNow(Date.now()), [sessions]);

  const open = openTables(sessions, now);
  // Close asks first, as Reject does: a mis-tap would make a seated group's
  // next order wait for the counter again.
  const [confirming, setConfirming] = useState<number | null>(null);
  const asking = open.some((t) => t.table === confirming) ? confirming : null;

  return (
    <section aria-labelledby="open-tables" className="mb-3">
      <h2
        id="open-tables"
        className="text-2xs text-muted mb-1.5 font-semibold tracking-[0.12em] uppercase"
      >
        Open tables
      </h2>
      {open.length === 0 ? (
        <p className="text-muted text-sm">
          None. A new group&apos;s first order waits for you to accept it.
        </p>
      ) : (
        <>
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {open.map(({ table, msLeft }) => (
              <li
                key={table}
                data-open-table={table}
                className="rounded-pill border-sage bg-sage-soft flex shrink-0 items-center gap-2 border-2 py-1 pr-1 pl-3"
              >
                <span className="font-round text-sage-deep text-lg leading-none">
                  T{table}
                </span>
                <span className="tnum text-sage-deep text-xs font-semibold">
                  {formatTimeLeft(msLeft)}
                </span>
                <button
                  type="button"
                  onClick={() => setConfirming(table)}
                  disabled={busyTable === table}
                  aria-label={`Close table ${table}`}
                  aria-expanded={asking === table}
                  className="rounded-pill border-line bg-paper text-ink min-h-11 border-2 px-3 text-sm font-semibold disabled:opacity-60"
                >
                  {busyTable === table ? "Closing…" : "Close"}
                </button>
              </li>
            ))}
          </ul>
          {asking !== null ? (
            <div
              role="group"
              aria-labelledby="close-table-question"
              className="border-line bg-paper mt-2 rounded-md border-2 p-3"
            >
              <p id="close-table-question" className="text-ink font-semibold">
                Close table {asking}?
              </p>
              <p className="text-muted mt-0.5 text-sm">
                Do it when the group has left: the next order from this table
                will wait for you to accept it.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    onClose(asking);
                    setConfirming(null);
                  }}
                >
                  Close table
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirming(null)}
                >
                  Keep open
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
