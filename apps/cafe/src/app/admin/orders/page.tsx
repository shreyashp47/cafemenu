"use client";

/**
 * Order history: every past order in a date range, for the owner to look one
 * up — "table 4 says they were charged twice at lunch", "what did #417 have?".
 *
 * A snapshot, not a live view. The staff board is the live view; this reads one
 * bounded, capped range query per look (see src/lib/order-history.ts for the
 * limits and why) and has a Refresh button instead of a listener, so leaving it
 * open all day costs nothing.
 *
 * The money figures come from buildReport(), the same function the Reports page
 * uses, so the two pages always agree about what a day took.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "@/components/icons";
import {
  useIsDemo,
  useMenu,
  useOrderRepo,
} from "@/components/providers/DataProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui/Input";
import { EmptyState, Loading } from "@/components/ui/Loading";
import { StatusBadge, statusLabel } from "@/components/ui/StatusBadge";
import { cn } from "@/lib/cn";
import { demoSeedOrders } from "@/lib/data/demo-store";
import { buildSampleOrders } from "@/lib/data/sample-orders";
import { friendlyLoadError } from "@/lib/friendly-errors";
import {
  formatDate,
  formatINR,
  formatTime,
  lineSubtotal,
  orderTotal,
} from "@/lib/money";
import { checkOrderIntegrity } from "@/lib/order-integrity";
import { orderLabel } from "@/lib/order-number";
import {
  HISTORY_LIMIT,
  NO_FILTERS,
  PRESETS,
  TERMINAL_STATUSES,
  filterOrders,
  inputRange,
  itemCount,
  matchingPreset,
  presetRange,
  rejectReasonOf,
  tablesIn,
  toInputDate,
  type HistoryFilters,
  type PresetId,
} from "@/lib/order-history";
import { buildReport, ordersToCsv } from "@/lib/reports";
import type { MenuItem, Order } from "@/lib/types";

/** Rows rendered at a time; the rest are one tap away. */
const PAGE_SIZE = 50;

const fullDateTime = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export default function OrderHistoryPage() {
  const repo = useOrderRepo();
  const isDemo = useIsDemo();
  const { items: menu } = useMenu();

  const [from, setFrom] = useState(() => {
    const r = presetRange("today");
    return toInputDate(r.from);
  });
  const [to, setTo] = useState(() => from);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<HistoryFilters>(NO_FILTERS);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [open, setOpen] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const check = useMemo(() => inputRange(from, to), [from, to]);
  const range = check.ok ? check.range : null;
  const preset = matchingPreset(from, to);

  // Only the newest request may write to the page, so a slow "This month"
  // cannot land on top of a quick "Today" tapped after it.
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!repo || !range) return;
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await repo.listRange(range.from, range.to, HISTORY_LIMIT);
      if (id !== requestId.current) return;
      setOrders(result);
      setShown(PAGE_SIZE);
      setOpen(null);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(friendlyLoadError(err));
    } finally {
      if (id === requestId.current) {
        setLoading(false);
        setLoadedOnce(true);
      }
    }
  }, [repo, range]);

  useEffect(() => {
    void load();
  }, [load]);

  function pickPreset(id: PresetId) {
    const r = presetRange(id);
    setFrom(toInputDate(r.from));
    setTo(toInputDate(r.to - 1));
  }

  async function seedSampleMonth() {
    setSeeding(true);
    try {
      demoSeedOrders(buildSampleOrders(240));
      await load();
    } finally {
      setSeeding(false);
    }
  }

  const report = useMemo(
    () => (range ? buildReport(orders, range) : null),
    [orders, range],
  );
  const filtered = useMemo(
    () => filterOrders(orders, filters),
    [orders, filters],
  );
  const filteredReport = useMemo(
    () => (range ? buildReport(filtered, range) : null),
    [filtered, range],
  );
  const tables = useMemo(() => tablesIn(orders), [orders]);
  const filtering =
    filters.status !== "all" ||
    filters.table !== null ||
    filters.search.trim() !== "";
  const capped = orders.length >= HISTORY_LIMIT;
  // Rejected orders: listed here, but left out of takings by buildReport.
  const notCounted = report?.rejectedCount ?? 0;
  // Pending: still waiting for staff to confirm the table. Not a sale yet.
  const waiting = report?.pendingCount ?? 0;

  function downloadCsv() {
    if (!range) return;
    const csv = ordersToCsv(filtered);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cafe-history-${toInputDate(range.from)}-to-${toInputDate(range.to - 1)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4 pb-8">
      <Card className="flex flex-col gap-3 p-4">
        <div>
          <h2 className="text-xl">Order history</h2>
          <p className="text-muted text-sm">
            Look up any past order. The live board is on the Orders screen.
          </p>
        </div>

        <div
          role="group"
          aria-label="Date range"
          className="flex flex-wrap gap-2"
        >
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => pickPreset(p.id)}
              aria-pressed={preset === p.id}
              className={cn(
                "rounded-pill font-round min-h-11 border-2 px-4 text-sm",
                preset === p.id
                  ? "border-primary bg-primary text-on-dark"
                  : "border-line bg-paper text-ink",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="From" htmlFor="history-from">
            <Input
              id="history-from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label="To" htmlFor="history-to" hint="Inclusive.">
            <Input
              id="history-to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
        </div>

        {!check.ok ? (
          <p
            role="alert"
            className="border-berry bg-paper text-berry-deep rounded-md border-2 px-3 py-2 text-sm"
          >
            {check.reason}
          </p>
        ) : null}
      </Card>

      {error ? (
        <Card
          role="alert"
          className="border-berry text-berry-deep flex flex-wrap items-center justify-between gap-3 p-4 text-sm"
        >
          <p className="min-w-0 flex-1">{error}</p>
          <Button size="sm" variant="ghost" onClick={() => void load()}>
            Try again
          </Button>
        </Card>
      ) : null}

      {check.ok && !loadedOnce && loading ? (
        <Loading label="Finding past orders…" />
      ) : check.ok && report && !error ? (
        <>
          <Card className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0" aria-live="polite">
                <p
                  className="tnum font-round text-primary text-2xl"
                  data-testid="history-summary"
                >
                  {plural(report.orderCount, "order")} ·{" "}
                  {formatINR(report.revenue)}
                </p>
                <p className="text-muted text-sm">
                  {notCounted > 0
                    ? `Plus ${plural(notCounted, "rejected order")}, not counted. `
                    : ""}
                  {waiting > 0
                    ? `${plural(waiting, "order")} waiting for the counter, not counted yet. `
                    : ""}
                  Sales are added up from each order&apos;s items, including
                  orders still being made — the same figures as Reports.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={loading}
                  onClick={() => void load()}
                >
                  <Icon
                    name="clock"
                    size={16}
                    className={loading ? "animate-spin-slow" : undefined}
                  />
                  {loading ? "Refreshing…" : "Refresh"}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={filtered.length === 0}
                  onClick={downloadCsv}
                >
                  <Icon name="chart" size={16} />
                  Export CSV
                </Button>
              </div>
            </div>
            {capped ? (
              <p className="border-highlight bg-highlight-soft text-ink rounded-md border-2 px-3 py-2 text-sm">
                This range has more than {HISTORY_LIMIT.toLocaleString("en-IN")}{" "}
                orders, so only the newest{" "}
                {HISTORY_LIMIT.toLocaleString("en-IN")} were loaded. Pick a
                shorter range to see the rest.
              </p>
            ) : null}
          </Card>

          {orders.length > 0 ? (
            <Filters
              filters={filters}
              tables={tables}
              onChange={(next) => {
                setFilters(next);
                setShown(PAGE_SIZE);
              }}
            />
          ) : null}

          {orders.length === 0 ? (
            <Card className="px-6 py-4 text-center">
              <EmptyState
                title="No orders in this range"
                body="Try another day, or a longer range."
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
          ) : filtered.length === 0 ? (
            <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
              <p className="text-ink font-semibold">
                No orders match these filters.
              </p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setFilters(NO_FILTERS)}
              >
                Clear filters
              </Button>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              {filtering && filteredReport ? (
                <p className="border-line-soft text-muted tnum border-b-2 px-4 py-2.5 text-sm">
                  Showing {plural(filtered.length, "order")} of {orders.length}
                  {" · "}
                  {formatINR(filteredReport.revenue)} in sales
                </p>
              ) : null}
              <ul className="divide-line-soft divide-y-2">
                {filtered.slice(0, shown).map((order) => (
                  <HistoryRow
                    key={order.id}
                    order={order}
                    menu={menu}
                    open={open === order.id}
                    onToggle={() =>
                      setOpen((cur) => (cur === order.id ? null : order.id))
                    }
                  />
                ))}
              </ul>
              {filtered.length > shown ? (
                <div className="border-line-soft flex flex-wrap items-center justify-between gap-2 border-t-2 px-4 py-3">
                  <p className="text-muted tnum text-sm">
                    {shown} of {filtered.length} shown
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShown((n) => n + PAGE_SIZE)}
                  >
                    Show {Math.min(PAGE_SIZE, filtered.length - shown)} more
                  </Button>
                </div>
              ) : null}
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}

function Filters({
  filters,
  tables,
  onChange,
}: {
  filters: HistoryFilters;
  tables: number[];
  onChange: (next: HistoryFilters) => void;
}) {
  return (
    <Card className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-[1fr_1fr_2fr]">
      <Field label="Status" htmlFor="history-status">
        <Select
          id="history-status"
          value={filters.status}
          onChange={(e) => onChange({ ...filters, status: e.target.value })}
        >
          <option value="all">All</option>
          <option value="active">Active</option>
          {TERMINAL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Table" htmlFor="history-table">
        <Select
          id="history-table"
          value={filters.table === null ? "" : String(filters.table)}
          onChange={(e) =>
            onChange({
              ...filters,
              table: e.target.value === "" ? null : Number(e.target.value),
            })
          }
        >
          <option value="">All tables</option>
          {tables.map((t) => (
            <option key={t} value={t}>
              Table {t}
            </option>
          ))}
        </Select>
      </Field>
      <div className="col-span-2 sm:col-span-1">
        <Field
          label="Search"
          htmlFor="history-search"
          hint="An order number like 0007, or an item like chai."
        >
          <Input
            id="history-search"
            type="search"
            value={filters.search}
            autoComplete="off"
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
          />
        </Field>
      </div>
    </Card>
  );
}

function HistoryRow({
  order,
  menu,
  open,
  onToggle,
}: {
  order: Order;
  menu: MenuItem[];
  open: boolean;
  onToggle: () => void;
}) {
  const check = useMemo(() => checkOrderIntegrity(order, menu), [order, menu]);
  const mismatch = check.issues.some((i) => i.kind === "total-mismatch");
  const count = itemCount(order);
  const panelId = `history-${order.id}`;

  return (
    <li data-order-id={order.id}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className={cn(
          "hover:bg-cream-soft flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
          open && "bg-cream-soft",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="tnum font-round text-ink text-lg">
              {orderLabel(order)}
            </span>
            <span className="text-body text-sm font-semibold">
              Table {order.tableNumber}
            </span>
          </span>
          <span className="tnum text-muted block text-sm">
            {formatDate(order.createdAt)}, {formatTime(order.createdAt)} ·{" "}
            {plural(count, "item")}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={cn(
              "tnum font-round flex items-center gap-1",
              mismatch ? "text-berry-deep" : "text-ink",
            )}
          >
            {mismatch ? (
              <>
                <span aria-hidden="true">⚠</span>
                <span className="sr-only">Total doesn&apos;t match items:</span>
              </>
            ) : null}
            {formatINR(order.total)}
          </span>
          <StatusBadge status={order.status} size="sm" />
        </span>
        <Icon
          name="chevron"
          size={18}
          className={cn(
            "text-muted shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? <OrderDetails id={panelId} order={order} check={check} /> : null}
    </li>
  );
}

function OrderDetails({
  id,
  order,
  check,
}: {
  id: string;
  order: Order;
  check: ReturnType<typeof checkOrderIntegrity>;
}) {
  const [copied, setCopied] = useState(false);
  const reason = rejectReasonOf(order);
  const mismatch = check.issues.find((i) => i.kind === "total-mismatch");
  const menuNotes = check.issues.filter((i) => i.kind !== "total-mismatch");

  async function copyId() {
    try {
      await navigator.clipboard.writeText(order.id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      id={id}
      className="bg-cream-soft/60 flex flex-col gap-3 px-4 pt-1 pb-4 text-sm"
    >
      <ul className="border-line-soft bg-paper divide-line-soft divide-y rounded-md border-2">
        {order.items.map((line, i) => (
          <li
            key={`${line.menuItemId}-${line.name}-${i}`}
            className="flex items-baseline gap-2 px-3 py-2"
          >
            <span className="text-ink min-w-0 flex-1">{line.name}</span>
            <span className="tnum text-muted shrink-0">
              {line.qty} × {formatINR(line.price)}
            </span>
            <span className="tnum text-ink w-16 shrink-0 text-right font-semibold">
              {formatINR(lineSubtotal(line))}
            </span>
          </li>
        ))}
        <li className="flex items-baseline justify-between gap-2 px-3 py-2">
          <span className="text-ink font-semibold">Total</span>
          <span className="tnum font-round text-primary text-base">
            {formatINR(order.total)}
          </span>
        </li>
      </ul>

      {mismatch ? (
        <p
          role="note"
          data-integrity="flagged"
          className="border-berry bg-paper text-berry-deep rounded-md border-2 px-3 py-2"
        >
          <span className="font-semibold">
            Total doesn&apos;t match its items.
          </span>{" "}
          {mismatch.message} Reports count {formatINR(orderTotal(order.items))}.
        </p>
      ) : null}

      {reason ? (
        <p className="border-line bg-paper text-ink rounded-md border-2 px-3 py-2">
          <span className="font-semibold">Reason given:</span> {reason}
        </p>
      ) : null}

      {order.notes ? (
        <p className="border-line bg-tan/60 text-body rounded-md border-2 border-dashed px-3 py-2">
          <span className="font-semibold">Note:</span> {order.notes}
        </p>
      ) : null}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        <dt className="text-muted">Number</dt>
        <dd className="tnum text-ink">
          {orderLabel(order)}
          {order.dayNumber === undefined ? (
            <span className="text-muted"> (no daily number)</span>
          ) : null}
        </dd>
        <dt className="text-muted">Placed</dt>
        <dd className="tnum text-ink">
          {fullDateTime.format(new Date(order.createdAt))}
        </dd>
        {order.completedAt ? (
          <>
            <dt className="text-muted">Completed</dt>
            <dd className="tnum text-ink">
              {fullDateTime.format(new Date(order.completedAt))}
            </dd>
          </>
        ) : null}
        <dt className="text-muted">Status</dt>
        <dd className="text-ink">{statusLabel(order.status)}</dd>
        <dt className="text-muted">Payment</dt>
        <dd className="text-ink">
          {order.paymentMethod === "upi" ? "UPI" : "At the counter"}
        </dd>
        <dt className="text-muted self-center">Order ID</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-2">
          <code className="text-ink bg-paper border-line-soft rounded-sm border px-1.5 py-0.5 text-xs break-all">
            {order.id}
          </code>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void copyId()}
            aria-label={`Copy order ID ${order.id}`}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </dd>
      </dl>

      {menuNotes.length > 0 ? (
        <p className="text-muted">
          Differs from today&apos;s menu:{" "}
          {menuNotes.map((i) => i.message).join(" ")} Usually that is a menu
          change since the order was placed.
        </p>
      ) : null}
    </div>
  );
}
