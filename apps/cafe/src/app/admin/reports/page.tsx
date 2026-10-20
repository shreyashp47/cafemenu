"use client";

/**
 * Monthly + date-range reporting (docs/requirements.md §4.3 steps 3–4, §5.4).
 *
 * The chart is CSS-only: docs/anime-theme.md §6 says keep animations and the payload
 * small, and a monthly bar chart of 31 bars does not need a charting library.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { Icon } from "@/components/icons";
import {
  useIsDemo,
  useMenu,
  useOrderRepo,
} from "@/components/providers/DataProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Input } from "@/components/ui/Input";
import { EmptyState, Loading } from "@/components/ui/Loading";
import { demoSeedOrders } from "@/lib/data/demo-store";
import { buildSampleOrders } from "@/lib/data/sample-orders";
import { formatINR } from "@/lib/money";
import { summariseIntegrity } from "@/lib/order-integrity";
import { orderLabel } from "@/lib/order-number";
import {
  buildReport,
  countsAsSale,
  currentMonth,
  monthRange,
  ordersToCsv,
  peakDay,
  shiftMonth,
} from "@/lib/reports";
import type { Order } from "@/lib/types";

type Mode = "month" | "range";

function toInputDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromInputDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d)).getTime();
}

export default function ReportsPage() {
  const repo = useOrderRepo();
  const isDemo = useIsDemo();
  const [mode, setMode] = useState<Mode>("month");
  const [cursor, setCursor] = useState(() => currentMonth());
  const [from, setFrom] = useState(() =>
    toInputDate(
      new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime(),
    ),
  );
  const [to, setTo] = useState(() => toInputDate(Date.now()));
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  async function seedSampleMonth() {
    setSeeding(true);
    try {
      demoSeedOrders(buildSampleOrders(240));
      await load();
    } finally {
      setSeeding(false);
    }
  }

  const range = useMemo(() => {
    if (mode === "month") return monthRange(cursor.year, cursor.month0);
    const start = fromInputDate(from);
    const end = fromInputDate(to);
    if (start === null || end === null) return null;
    // `to` is inclusive in the UI, exclusive in the query
    return { from: start, to: end + 86_400_000 };
  }, [mode, cursor, from, to]);

  const load = useCallback(async () => {
    if (!repo || !range) return;
    setLoading(true);
    setError(null);
    try {
      // Bounded range query keeps Firestore reads inside the free tier (§2, §5.4)
      setOrders(await repo.listRange(range.from, range.to));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load orders.");
    } finally {
      setLoading(false);
    }
  }, [repo, range]);

  useEffect(() => {
    void load();
  }, [load]);

  const report = useMemo(
    () => (range ? buildReport(orders, range) : null),
    [orders, range],
  );

  // Issue #27: order totals are written by the customer's phone. The figures
  // above are already summed from the line items, not the stored totals, but an
  // order whose stored total disagrees with its own items is one the counter may
  // have charged wrongly, so it is listed for the owner to reconcile.
  const { items: menu } = useMenu();
  // Rejected orders were never charged, so a doctored total on one is not
  // something the counter needs to reconcile.
  const integrity = useMemo(
    () => summariseIntegrity(orders.filter(countsAsSale), menu),
    [orders, menu],
  );

  function downloadCsv() {
    const csv = ordersToCsv(orders);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cafe-orders-${toInputDate(range?.from ?? Date.now())}-to-${toInputDate((range?.to ?? Date.now()) - 1)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  if (loading && !report) return <Loading label="Adding up the month…" />;

  return (
    <div className="flex flex-col gap-4 pb-8">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          {mode === "month" ? (
            <div className="flex items-end gap-2">
              <Button
                variant="ghost"
                aria-label="Previous month"
                onClick={() =>
                  setCursor(shiftMonth(cursor.year, cursor.month0, -1))
                }
              >
                <Icon name="back" size={18} />
              </Button>
              <div className="border-line bg-cream-soft font-round text-ink min-w-[10rem] rounded-sm border-2 px-3.5 py-2.5 text-center text-lg">
                {new Date(cursor.year, cursor.month0, 1).toLocaleDateString(
                  "en-IN",
                  { month: "long", year: "numeric" },
                )}
              </div>
              <Button
                variant="ghost"
                aria-label="Next month"
                onClick={() =>
                  setCursor(shiftMonth(cursor.year, cursor.month0, 1))
                }
              >
                <Icon name="back" size={18} className="rotate-180" />
              </Button>
            </div>
          ) : (
            <div className="grid flex-1 gap-3 sm:grid-cols-2">
              <Field label="From" htmlFor="from">
                <Input
                  id="from"
                  type="date"
                  value={from}
                  max={to}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </Field>
              <Field label="To" htmlFor="to" hint="Inclusive.">
                <Input
                  id="to"
                  type="date"
                  value={to}
                  min={from}
                  onChange={(e) => setTo(e.target.value)}
                />
              </Field>
            </div>
          )}

          <div className="flex gap-2">
            {(["month", "range"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={[
                  "rounded-pill font-round min-h-11 border-2 px-4 text-sm capitalize",
                  mode === m
                    ? "border-primary bg-primary text-on-dark"
                    : "border-line bg-paper text-ink",
                ].join(" ")}
              >
                {m === "month" ? "This month" : "Custom dates"}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {error ? (
        <p
          role="alert"
          className="border-berry bg-paper text-berry-deep rounded-md border-2 px-3 py-2 text-sm"
        >
          {error}
        </p>
      ) : null}

      {report && report.orderCount === 0 ? (
        <Card className="px-6 py-10 text-center">
          <EmptyState
            title="No orders in this period"
            body="Orders placed on the customer side show up here the moment they are completed."
            action={
              isDemo ? (
                <Button
                  variant="secondary"
                  disabled={seeding}
                  onClick={() => void seedSampleMonth()}
                >
                  <Icon name="sparkle" size={18} />
                  {seeding ? "Adding…" : "Add a sample month"}
                </Button>
              ) : null
            }
          />
        </Card>
      ) : report ? (
        <>
          <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <Stat
              label="Revenue"
              value={formatINR(report.revenue)}
              icon="chart"
            />
            <Stat
              label="Orders"
              value={String(report.orderCount)}
              icon="cart"
            />
            <Stat
              label="Average order"
              value={formatINR(report.averageOrderValue)}
              icon="sparkle"
            />
          </ul>

          <IntegrityNotice {...integrity} />

          {report.rejectedCount > 0 ? (
            <p className="border-line bg-paper text-muted rounded-md border-2 border-dashed px-3 py-2 text-sm">
              {report.rejectedCount} rejected order
              {report.rejectedCount === 1 ? " is" : "s are"} left out of these
              figures. They are in the CSV, marked &ldquo;rejected&rdquo;.
            </p>
          ) : null}

          {report.pendingCount > 0 ? (
            <p className="border-line bg-paper text-muted rounded-md border-2 border-dashed px-3 py-2 text-sm">
              {report.pendingCount} order
              {report.pendingCount === 1 ? " is" : "s are"} still waiting for
              the counter to confirm the table, and not counted yet. They are in
              the CSV, marked &ldquo;pending&rdquo;.
            </p>
          ) : null}

          <Card className="p-4">
            <h2 className="text-lg">Revenue by day</h2>
            <RevenueChart report={report} />
          </Card>

          {isDemo ? (
            <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
              <p className="text-muted text-sm">
                Demo data. Add another sample month to compare periods.
              </p>
              <Button
                size="sm"
                variant="ghost"
                disabled={seeding}
                onClick={() => void seedSampleMonth()}
              >
                <Icon name="sparkle" size={16} />
                {seeding ? "Adding…" : "Add another month"}
              </Button>
            </Card>
          ) : null}

          <Card className="overflow-hidden">
            <div className="border-line-soft flex items-center justify-between gap-3 border-b-2 px-4 py-3">
              <h2 className="text-lg">Best sellers</h2>
              <Button size="sm" variant="secondary" onClick={downloadCsv}>
                <Icon name="chart" size={16} />
                CSV
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[26rem] text-left">
                <thead>
                  <tr className="border-line-soft text-2xs text-muted border-b-2 tracking-wide uppercase">
                    <th scope="col" className="px-4 py-2 font-semibold">
                      Item
                    </th>
                    <th
                      scope="col"
                      className="px-2 py-2 text-right font-semibold"
                    >
                      Sold
                    </th>
                    <th
                      scope="col"
                      className="px-2 py-2 text-right font-semibold"
                    >
                      Revenue
                    </th>
                    <th scope="col" className="px-4 py-2 font-semibold">
                      Share
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.topItems.map((item) => (
                    <tr
                      key={item.name}
                      className="border-line-soft border-b last:border-0"
                    >
                      <th
                        scope="row"
                        className="text-ink px-4 py-2 font-normal"
                      >
                        {item.name}
                      </th>
                      <td className="tnum text-body px-2 py-2 text-right">
                        {item.qty}
                      </td>
                      <td className="tnum text-primary px-2 py-2 text-right font-semibold">
                        {formatINR(item.revenue)}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className="rounded-pill bg-tan flex h-2.5 w-full overflow-hidden"
                          role="img"
                          aria-label={`${Math.round(item.share * 100)}% of revenue`}
                        >
                          <span
                            className="rounded-pill bg-secondary h-full"
                            style={{
                              width: `${Math.max(2, item.share * 100)}%`,
                            }}
                          />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <p className="border-line bg-tan/50 text-body rounded-md border-2 border-dashed px-4 py-3 text-sm">
            Orders are never deleted automatically — six months of history is
            the target, and every figure above is recomputed from the full order
            list.
          </p>
        </>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: "chart" | "cart" | "sparkle";
}) {
  return (
    <li className="border-line-soft bg-paper shadow-card rounded-lg border-2 p-4">
      <p className="text-2xs text-muted flex items-center gap-1.5 font-semibold tracking-[0.12em] uppercase">
        <Icon name={icon} size={14} />
        {label}
      </p>
      <p className="tnum font-round text-primary mt-1 text-2xl">{value}</p>
    </li>
  );
}

function RevenueChart({
  report,
}: {
  report: NonNullable<ReturnType<typeof buildReport>>;
}) {
  const peak = peakDay(report.byDay);
  // Fixed pixel bar area. A percentage height resolves against an auto-height
  // flex item, which collapses every bar to zero — this bit us once already.
  const AREA = 112;

  if (report.byDay.length === 0) {
    return <p className="text-muted mt-2 text-sm">Nothing to chart yet.</p>;
  }

  // With a full month of days every label would collide, so show the first, the
  // last, and a few in between. The rest live in the tooltip.
  const step = Math.max(1, Math.ceil(report.byDay.length / 8));
  const best = [...report.byDay].sort((a, b) => b.revenue - a.revenue)[0];

  return (
    <>
      <ol className="mt-3 flex items-end gap-1 sm:gap-1.5">
        {report.byDay.map((day, index) => {
          const barPx = peak > 0 ? Math.max(3, (day.revenue / peak) * AREA) : 3;
          const showLabel =
            index === 0 ||
            index === report.byDay.length - 1 ||
            index % step === 0;
          return (
            <li
              key={day.date}
              className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
              title={`${day.label}: ${formatINR(day.revenue)} from ${
                day.orders
              } order${day.orders === 1 ? "" : "s"}`}
            >
              <span className="flex h-28 w-full items-end">
                <span
                  className="bg-secondary/85 w-full rounded-t-sm transition-[height] duration-500"
                  style={{ height: `${barPx}px` }}
                />
              </span>
              <span className="tnum text-2xs text-muted">
                {showLabel ? day.dayOfMonth : ""}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="text-muted mt-2 text-sm">
        Best day:{" "}
        <span className="tnum text-ink font-semibold">
          {best
            ? `${best.label} · ${formatINR(best.revenue)} from ${best.orders} order${
                best.orders === 1 ? "" : "s"
              }`
            : "—"}
        </span>
      </p>
    </>
  );
}

function orderNumbers(orders: Order[]): string {
  const shown = orders.slice(0, 12).map(orderLabel);
  const more = orders.length - shown.length;
  return more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(", ");
}

function IntegrityNotice({
  totalMismatch,
  differsFromMenu,
}: ReturnType<typeof summariseIntegrity>) {
  if (totalMismatch.length === 0 && differsFromMenu.length === 0) return null;
  return (
    <Card className="flex flex-col gap-2 p-4 text-sm" data-integrity="report">
      {totalMismatch.length > 0 ? (
        <p role="alert" className="text-berry-deep">
          <span className="font-semibold">
            {totalMismatch.length === 1
              ? "1 order has a total that doesn't match its items"
              : `${totalMismatch.length} orders have a total that doesn't match their items`}
          </span>{" "}
          ({orderNumbers(totalMismatch)}). The revenue above is added up from
          the items, not those totals — check these against what the till
          actually took.
        </p>
      ) : null}
      {differsFromMenu.length > 0 ? (
        <p className="text-muted">
          {differsFromMenu.length === 1
            ? "1 order has items"
            : `${differsFromMenu.length} orders have items`}{" "}
          priced or named differently from today&apos;s menu (
          {orderNumbers(differsFromMenu)}). Usually that is a menu change since
          they were placed; if the menu has not changed, look at them.
        </p>
      ) : null}
    </Card>
  );
}
