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
import { useCafeSettings } from "@/hooks/useCafeSettings";
import { cn } from "@/lib/cn";
import { demoSeedOrders } from "@/lib/data/demo-store";
import { buildSampleOrders } from "@/lib/data/sample-orders";
import { friendlyLoadError } from "@/lib/friendly-errors";
import { formatMoney, lineSubtotal, orderTotal } from "@/lib/money";
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
import { formatNumber, t } from "@/lib/i18n";

/** Rows rendered at a time; the rest are one tap away. */
const PAGE_SIZE = 50;

/**
 * Dates and times as the cafe's clock showed them (settings.timeZone), not the
 * device's: the history is filtered by the cafe's days, so a row has to say
 * the cafe's date too, even for an owner looking from abroad.
 */
function cafeClock(timeZone: string, locale: string) {
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone });
  const date = format({ day: "numeric", month: "short" });
  const time = format({ hour: "numeric", minute: "2-digit", hour12: true });
  const full = format({
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return {
    short: (ms: number) =>
      t("history.dateTime", { date: date.format(ms), time: time.format(ms) }),
    full: (ms: number) => full.format(ms),
  };
}

type CafeClock = ReturnType<typeof cafeClock>;

export default function OrderHistoryPage() {
  const repo = useOrderRepo();
  const isDemo = useIsDemo();
  const { items: menu } = useMenu();
  const { settings } = useCafeSettings();
  const { timeZone, locale } = settings;
  const clock = useMemo(() => cafeClock(timeZone, locale), [timeZone, locale]);

  const [from, setFrom] = useState(() => {
    const r = presetRange("today", timeZone);
    return toInputDate(r.from, timeZone);
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

  const check = useMemo(
    () => inputRange(from, to, timeZone),
    [from, to, timeZone],
  );
  const range = check.ok ? check.range : null;
  const preset = matchingPreset(from, to, timeZone);

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
    const r = presetRange(id, timeZone);
    setFrom(toInputDate(r.from, timeZone));
    setTo(toInputDate(r.to - 1, timeZone));
  }

  async function seedSampleMonth() {
    setSeeding(true);
    try {
      demoSeedOrders(buildSampleOrders(240, Date.now(), timeZone), timeZone);
      await load();
    } finally {
      setSeeding(false);
    }
  }

  const report = useMemo(
    () => (range ? buildReport(orders, range, timeZone) : null),
    [orders, range, timeZone],
  );
  const filtered = useMemo(
    () => filterOrders(orders, filters),
    [orders, filters],
  );
  const filteredReport = useMemo(
    () => (range ? buildReport(filtered, range, timeZone) : null),
    [filtered, range, timeZone],
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
    const csv = ordersToCsv(filtered, timeZone, settings);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cafe-history-${toInputDate(range.from, timeZone)}-to-${toInputDate(range.to - 1, timeZone)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4 pb-8">
      <Card className="flex flex-col gap-3 p-4">
        <div>
          <h2 className="text-xl">{t("history.orderHistory")}</h2>
          <p className="text-muted text-sm">{t("history.lookUpAny")}</p>
        </div>

        <div
          role="group"
          aria-label={t("history.dateRange")}
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
              {t(p.label)}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("history.from")} htmlFor="history-from">
            <Input
              id="history-from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field
            label={t("history.to")}
            htmlFor="history-to"
            hint={t("history.inclusive")}
          >
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
            {t("history.tryAgain")}
          </Button>
        </Card>
      ) : null}

      {check.ok && !loadedOnce && loading ? (
        <Loading label={t("history.findingPastOrders")} />
      ) : check.ok && report && !error ? (
        <>
          <Card className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0" aria-live="polite">
                <p
                  className="tnum font-round text-primary text-2xl"
                  data-testid="history-summary"
                >
                  {t("count.orders", { count: report.orderCount })} ·{" "}
                  {formatMoney(report.revenue, settings)}
                </p>
                <p className="text-muted text-sm">
                  {notCounted > 0
                    ? `${t("history.plusRejected", {
                        orders: t("count.rejectedOrders", {
                          count: notCounted,
                        }),
                      })} `
                    : ""}
                  {waiting > 0
                    ? `${t("history.ordersWaiting", {
                        orders: t("count.orders", { count: waiting }),
                      })} `
                    : ""}
                  {t("history.salesNote")}
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
                  {loading ? t("history.refreshing") : t("history.refresh")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={filtered.length === 0}
                  onClick={downloadCsv}
                >
                  <Icon name="chart" size={16} />
                  {t("history.exportCsv")}
                </Button>
              </div>
            </div>
            {capped ? (
              <p className="border-highlight bg-highlight-soft text-ink rounded-md border-2 px-3 py-2 text-sm">
                {t("history.capped", { limit: formatNumber(HISTORY_LIMIT) })}
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
                title={t("history.noOrdersRange")}
                body={t("history.tryAnotherDay")}
                action={
                  isDemo ? (
                    <Button
                      variant="secondary"
                      disabled={seeding}
                      onClick={() => void seedSampleMonth()}
                    >
                      <Icon name="sparkle" size={18} />
                      {seeding
                        ? t("history.adding")
                        : t("history.addSampleMonth")}
                    </Button>
                  ) : null
                }
              />
            </Card>
          ) : filtered.length === 0 ? (
            <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
              <p className="text-ink font-semibold">
                {t("history.noOrdersMatch")}
              </p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setFilters(NO_FILTERS)}
              >
                {t("history.clearFilters")}
              </Button>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              {filtering && filteredReport ? (
                <p className="border-line-soft text-muted tnum border-b-2 px-4 py-2.5 text-sm">
                  {t("history.showing", {
                    shown: t("count.orders", { count: filtered.length }),
                    total: orders.length,
                    sales: formatMoney(filteredReport.revenue, settings),
                  })}
                </p>
              ) : null}
              <ul className="divide-line-soft divide-y-2">
                {filtered.slice(0, shown).map((order) => (
                  <HistoryRow
                    key={order.id}
                    order={order}
                    menu={menu}
                    clock={clock}
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
                    {t("history.shownOf", { shown, total: filtered.length })}
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShown((n) => n + PAGE_SIZE)}
                  >
                    {t("history.showMore", {
                      count: Math.min(PAGE_SIZE, filtered.length - shown),
                    })}
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
      <Field label={t("history.status")} htmlFor="history-status">
        <Select
          id="history-status"
          value={filters.status}
          onChange={(e) => onChange({ ...filters, status: e.target.value })}
        >
          <option value="all">{t("history.all")}</option>
          <option value="active">{t("history.active")}</option>
          {TERMINAL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("history.table")} htmlFor="history-table">
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
          <option value="">{t("history.allTables")}</option>
          {tables.map((n) => (
            <option key={n} value={n}>
              {t("history.tableNumber", { table: n })}
            </option>
          ))}
        </Select>
      </Field>
      <div className="col-span-2 sm:col-span-1">
        <Field
          label={t("history.search")}
          htmlFor="history-search"
          hint={t("history.orderNumberLike")}
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
  clock,
  open,
  onToggle,
}: {
  order: Order;
  menu: MenuItem[];
  clock: CafeClock;
  open: boolean;
  onToggle: () => void;
}) {
  const { settings } = useCafeSettings();
  const check = useMemo(
    () => checkOrderIntegrity(order, menu, settings),
    [order, menu, settings],
  );
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
              {t("history.tableNumber", { table: order.tableNumber })}
            </span>
          </span>
          <span className="tnum text-muted block text-sm">
            {clock.short(order.createdAt)} · {t("count.items", { count })}
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
                <span className="sr-only">{t("history.totalDoesntMatch")}</span>
              </>
            ) : null}
            {formatMoney(order.total, settings)}
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

      {open ? (
        <OrderDetails id={panelId} order={order} check={check} clock={clock} />
      ) : null}
    </li>
  );
}

function OrderDetails({
  id,
  order,
  check,
  clock,
}: {
  id: string;
  order: Order;
  check: ReturnType<typeof checkOrderIntegrity>;
  clock: CafeClock;
}) {
  const { settings } = useCafeSettings();
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
              {line.qty} × {formatMoney(line.price, settings)}
            </span>
            <span className="tnum text-ink w-16 shrink-0 text-right font-semibold">
              {formatMoney(lineSubtotal(line), settings)}
            </span>
          </li>
        ))}
        <li className="flex items-baseline justify-between gap-2 px-3 py-2">
          <span className="text-ink font-semibold">{t("history.total")}</span>
          <span className="tnum font-round text-primary text-base">
            {formatMoney(order.total, settings)}
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
            {t("history.totalDoesntMatch2")}
          </span>{" "}
          {t("history.mismatchNote", {
            message: mismatch.message,
            total: formatMoney(orderTotal(order.items), settings),
          })}
        </p>
      ) : null}

      {reason ? (
        <p className="border-line bg-paper text-ink rounded-md border-2 px-3 py-2">
          <span className="font-semibold">{t("history.reasonGiven")}</span>{" "}
          {reason}
        </p>
      ) : null}

      {order.notes ? (
        <p className="border-line bg-tan/60 text-body rounded-md border-2 border-dashed px-3 py-2">
          <span className="font-semibold">{t("history.note")}</span>{" "}
          {order.notes}
        </p>
      ) : null}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        <dt className="text-muted">{t("history.number")}</dt>
        <dd className="tnum text-ink">
          {orderLabel(order)}
          {order.dayNumber === undefined ? (
            <span className="text-muted"> {t("history.noDailyNumber")}</span>
          ) : null}
        </dd>
        <dt className="text-muted">{t("history.placed")}</dt>
        <dd className="tnum text-ink">{clock.full(order.createdAt)}</dd>
        {order.completedAt ? (
          <>
            <dt className="text-muted">{t("history.completed")}</dt>
            <dd className="tnum text-ink">{clock.full(order.completedAt)}</dd>
          </>
        ) : null}
        <dt className="text-muted">{t("history.status")}</dt>
        <dd className="text-ink">{statusLabel(order.status)}</dd>
        <dt className="text-muted">{t("history.payment")}</dt>
        <dd className="text-ink">
          {order.paymentMethod === "upi"
            ? t("history.payUpi")
            : t("history.payCounter")}
        </dd>
        <dt className="text-muted self-center">{t("history.orderId")}</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-2">
          <code className="text-ink bg-paper border-line-soft rounded-sm border px-1.5 py-0.5 text-xs break-all">
            {order.id}
          </code>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void copyId()}
            aria-label={t("history.copyOrderId", { id: order.id })}
          >
            {copied ? t("history.copied") : t("history.copy")}
          </Button>
        </dd>
      </dl>

      {menuNotes.length > 0 ? (
        <p className="text-muted">
          {t("history.menuDiffers", {
            notes: menuNotes.map((i) => i.message).join(" "),
          })}
        </p>
      ) : null}
    </div>
  );
}
