"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "@/components/icons";
import { InstallHint } from "@/components/Pwa";
import { Mascot } from "@/components/Mascot";
import { NotSetUp } from "@/components/NotSetUp";
import { OpenTables } from "@/components/OpenTables";
import { OwnerSwitch } from "@/components/OwnerSwitch";
import {
  DataProvider,
  useActiveOrders,
  useIsDemo,
  useMenu,
  useStaffSession,
  useTableSessions,
} from "@/components/providers/DataProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, Loading } from "@/components/ui/Loading";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TicketTotal, TotalWarning } from "@/components/TotalWarning";
import { useDayNumbers } from "@/hooks/useDayNumbers";
import { useOrderChime } from "@/hooks/useOrderChime";
import { getCafeName } from "@/lib/config";
import {
  friendlySignInError,
  friendlyStatusError,
} from "@/lib/friendly-errors";
import { formatINR, formatWait, lineSubtotal } from "@/lib/money";
import { checkOrderIntegrity } from "@/lib/order-integrity";
import { orderLabel, padDayNumber } from "@/lib/order-number";
import {
  PENDING_REJECT_REASON,
  REJECT_REASONS,
  actionsFor,
  canReject,
  isAwaitingCounter,
  transition,
  type OrderStatus,
} from "@/lib/order-status";
import {
  extendedOpenUntil,
  isTableOpen,
  keepsTableOpen,
} from "@/lib/table-open";
import type { MenuItem, Order } from "@/lib/types";
import { DEMO_CREDENTIALS } from "@/lib/data/seed";

export default function StaffPage() {
  return (
    <DataProvider>
      <StaffScreen />
    </DataProvider>
  );
}

function StaffScreen() {
  const { user, loading, signIn, signInWithPin, signOut } = useStaffSession();
  const isDemo = useIsDemo();
  const router = useRouter();
  // The owner signing in here usually wants the dashboard, so send them there —
  // but only straight after signing in on this screen. Redirecting every owner
  // visit would make the order board unreachable for them, including from the
  // Orders | Owner switch, which links back here.
  const [signedInHere, setSignedInHere] = useState(false);
  const ownerJustSignedIn = signedInHere && user?.role === "owner";
  useEffect(() => {
    if (ownerJustSignedIn) router.replace("/admin");
  }, [ownerJustSignedIn, router]);
  const signInHere = useCallback(
    async (email: string, password: string) => {
      await signIn(email, password);
      setSignedInHere(true);
    },
    [signIn],
  );
  const { muted, setMuted, armed, unlock, chime, buzz } = useOrderChime();
  // Only once there is a staff session: the rules refuse a list to anyone who
  // is not staff, so subscribing earlier — or as an account with no /staff
  // document — just guarantees a permission error.
  const canWork = Boolean(user) && user?.role !== "unassigned";
  const { orders, loading: ordersLoading, error } = useActiveOrders(canWork);
  // Read in advance() below, which stays a stable callback.
  const ordersRef = useRef(orders);
  ordersRef.current = orders;
  // Today's numbers (#0001…) are handed out here, by whichever board sees the
  // order first. See src/lib/day-number.ts.
  const { stalled: numbering } = useDayNumbers(
    orders,
    canWork && !ordersLoading,
  );
  // The live menu, to re-price every ticket against (issue #27). Menu reads are
  // public and it is one small collection, so this is one cheap listener.
  const { items: menu } = useMenu();
  // Which tables staff have confirmed (src/lib/table-open.ts). Read through a
  // ref in the actions below so they stay stable callbacks.
  const { sessions } = useTableSessions(canWork);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const [closingTable, setClosingTable] = useState<number | null>(null);
  const [tableFilter, setTableFilter] = useState<number | "all">("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{
    orderId: string;
    message: string;
  } | null>(null);

  const known = useRef<Set<string>>(new Set());
  const primed = useRef(false);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());

  // New-order alert: sound + vibration, once per unseen order id
  // (docs/requirements.md §5.3, docs/anime-theme.md §5 — not just a toast).
  useEffect(() => {
    if (ordersLoading) return;

    if (!primed.current) {
      // First snapshot: adopt whatever is already in flight without alarming.
      orders.forEach((o) => known.current.add(o.id));
      primed.current = true;
      return;
    }

    const fresh = orders.filter((o) => !known.current.has(o.id));
    orders.forEach((o) => known.current.add(o.id));
    if (fresh.length === 0) return;

    setFreshIds(new Set(fresh.map((o) => o.id)));
    const timer = setTimeout(() => setFreshIds(new Set()), 4200);
    chime();
    buzz();
    return () => clearTimeout(timer);
  }, [orders, ordersLoading, chime, buzz]);

  // Browsers only allow audio after a gesture; try on every interaction until
  // the sound is really on. pointerdown alone is not enough: in Chrome a touch
  // pointerdown is not a user activation for audio, but pointerup and click
  // are. Listeners are passive and never stop the tap itself.
  useEffect(() => {
    if (armed) return;
    const events = ["pointerdown", "pointerup", "click", "keydown"] as const;
    const onGesture = () => unlock();
    for (const type of events) window.addEventListener(type, onGesture);
    return () => {
      for (const type of events) window.removeEventListener(type, onGesture);
    };
  }, [armed, unlock]);

  const tables = useMemo(
    () => [...new Set(orders.map((o) => o.tableNumber))].sort((a, b) => a - b),
    [orders],
  );
  const visible = useMemo(
    () =>
      tableFilter === "all"
        ? orders
        : orders.filter((o) => o.tableNumber === tableFilter),
    [orders, tableFilter],
  );
  // New guests (pending) get their own section above the kitchen's tickets:
  // they are a question for whoever is at the counter, not food to make.
  const newGuests = useMemo(
    () => visible.filter((o) => isAwaitingCounter(o.status)),
    [visible],
  );
  const kitchen = useMemo(
    () => visible.filter((o) => !isAwaitingCounter(o.status)),
    [visible],
  );

  const advance = useCallback(async (order: Order, to: OrderStatus) => {
    setBusyId(order.id);
    setActionError(null);
    try {
      // Guard the transition client-side too; the Firestore rules are the
      // real enforcement, this keeps the UI honest in demo mode. It used to
      // return silently, which is how a button that could never work ("Complete"
      // on a Ready ticket) looked like a dead tap instead of a bug.
      if (!transition(order.status, to)) {
        setActionError({
          orderId: order.id,
          message:
            "That step isn't allowed from here — the order may have already moved on.",
        });
        return;
      }
      const { loadBundle } = await import("@/lib/data");
      const bundle = await loadBundle();
      const now = Date.now();
      const current = sessionsRef.current[order.tableNumber];
      const openUntil = extendedOpenUntil(current, now);
      if (isAwaitingCounter(order.status)) {
        // Accept: the order goes to the kitchen and the table opens, so the
        // group's next orders skip this step. Every other order waiting from
        // the same table goes with it (two phones at one table): the table
        // is open now, so leaving one waiting would tell that guest
        // something untrue.
        const others = ordersRef.current
          .filter(
            (o) =>
              o.id !== order.id &&
              o.tableNumber === order.tableNumber &&
              isAwaitingCounter(o.status),
          )
          .map((o) => o.id);
        try {
          await bundle.orders.accept(
            [order.id, ...others],
            order.tableNumber,
            openUntil,
          );
        } catch (err) {
          // One of the others moved on in the meantime (another board
          // rejected it, say), which refuses the whole commit. The one staff
          // tapped still goes through on its own.
          if (others.length === 0 || !isRefusal(err)) throw err;
          await bundle.orders.accept([order.id], order.tableNumber, openUntil);
        }
      } else if (
        keepsTableOpen(to) &&
        isTableOpen(sessionsRef.current, order.tableNumber, now) &&
        openUntil > (current ?? 0)
      ) {
        // Working on an open table's order keeps it open for another few
        // hours, in the same commit. A table already closed stays closed.
        try {
          await bundle.orders.setStatus(order.id, to, {
            table: order.tableNumber,
            openUntil,
          });
        } catch (err) {
          // A tablet whose clock runs over an hour fast asks for an openUntil
          // past what the rules allow (MAX_OPEN_HOURS), and the whole commit
          // is refused. The order's step matters more than the table's
          // time, so do that on its own.
          if (!isRefusal(err)) throw err;
          await bundle.orders.setStatus(order.id, to);
        }
      } else {
        await bundle.orders.setStatus(order.id, to);
      }
    } catch (err) {
      setActionError({ orderId: order.id, message: friendlyStatusError(err) });
    } finally {
      setBusyId(null);
    }
  }, []);

  const reject = useCallback(async (order: Order, reason?: string) => {
    setBusyId(order.id);
    setActionError(null);
    try {
      if (!transition(order.status, "rejected")) {
        setActionError({
          orderId: order.id,
          message:
            "This order can't be rejected any more — it has already been served.",
        });
        return;
      }
      const { loadBundle } = await import("@/lib/data");
      const bundle = await loadBundle();
      await bundle.orders.reject(order.id, reason);
    } catch (err) {
      setActionError({ orderId: order.id, message: friendlyStatusError(err) });
    } finally {
      setBusyId(null);
    }
  }, []);

  const [tableError, setTableError] = useState<string | null>(null);
  const closeTable = useCallback(async (table: number) => {
    setClosingTable(table);
    setTableError(null);
    try {
      const { loadBundle } = await import("@/lib/data");
      const bundle = await loadBundle();
      await bundle.sessions.close(table);
    } catch (err) {
      setTableError(friendlyStatusError(err));
    } finally {
      setClosingTable(null);
    }
  }, []);

  if (loading) return <Loading label="Checking your badge…" />;
  if (ownerJustSignedIn)
    return <Loading label="Opening the owner dashboard…" />;

  if (!user) {
    return (
      <StaffLogin
        signIn={signInHere}
        signInWithPin={signInWithPin}
        isDemo={isDemo}
        onFirstGesture={unlock}
      />
    );
  }

  if (user.role === "unassigned") {
    return <NotSetUp user={user} onSignOut={() => void signOut()} />;
  }

  return (
    <div className="min-h-svh pb-10">
      <header className="safe-t border-line-soft bg-cream/95 sticky top-0 z-30 border-b-2 backdrop-blur">
        <div className="shell-wide flex items-center gap-2.5 py-2.5">
          <Mascot size={40} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg leading-tight">Order board</h1>
            <p className="text-2xs text-muted truncate font-semibold tracking-[0.12em] uppercase">
              {getCafeName()} · {user.displayName}
              {user.role === "owner" ? " (owner)" : ""}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setMuted(!muted)}
            aria-pressed={muted}
            aria-label={
              muted ? "Unmute new order sound" : "Mute new order sound"
            }
            title={muted ? "Sound off" : "Sound on"}
            className={[
              "rounded-pill grid size-11 shrink-0 place-items-center border-2 transition-colors",
              muted
                ? "border-line bg-tan text-muted"
                : "border-primary bg-paper text-primary",
            ].join(" ")}
          >
            <Icon name={muted ? "mute" : "sound"} size={20} />
          </button>

          <button
            type="button"
            onClick={() => void signOut()}
            aria-label="Sign out"
            className="rounded-pill border-line bg-paper text-muted grid size-11 shrink-0 place-items-center border-2"
          >
            <Icon name="logout" size={20} />
          </button>
        </div>

        <OwnerSwitch
          role={user.role}
          current="orders"
          className="shell-wide pb-2.5"
        />

        {/* The first tap anywhere switches the sound on, so this line must
            not change height when it does: if it shrank or disappeared, the
            board would jump up under the finger and that tap (often Accept)
            would land on nothing. Both wordings share one grid cell, which is
            always as tall as the longer one, at any text size. */}
        {!muted ? (
          <p
            data-sound-hint={armed ? "on" : "ask"}
            className="shell-wide text-2xs text-secondary grid pb-2 font-semibold"
          >
            <span
              aria-hidden={armed ? undefined : true}
              className={
                armed ? "[grid-area:1/1]" : "invisible [grid-area:1/1]"
              }
            >
              Order sound on.
            </span>
            <span
              aria-hidden={armed ? true : undefined}
              className={
                armed ? "invisible [grid-area:1/1]" : "[grid-area:1/1]"
              }
            >
              Tap anywhere to switch the order sound on.
            </span>
          </p>
        ) : null}
      </header>

      <InstallHint appName={getCafeName()} />

      <main className="shell-wide pt-4">
        {error ? (
          <p
            role="alert"
            className="border-berry bg-paper text-berry-deep mb-3 rounded-md border-2 px-3 py-2 text-sm"
          >
            Live updates dropped: {error.message}
          </p>
        ) : null}

        {numbering ? (
          <p
            role="status"
            className="border-secondary bg-paper text-body mb-3 rounded-md border-2 px-3 py-2 text-sm"
          >
            New orders aren&apos;t getting today&apos;s numbers right now, so
            they show their older short number instead. Orders still come in as
            normal. ({numbering.message})
          </p>
        ) : null}

        <OpenTables
          sessions={sessions}
          busyTable={closingTable}
          onClose={(table) => void closeTable(table)}
        />
        {tableError ? (
          <p
            role="alert"
            className="border-berry bg-paper text-berry-deep mb-3 rounded-md border-2 px-3 py-2 text-sm"
          >
            Couldn&apos;t close that table: {tableError}
          </p>
        ) : null}

        <div className="mb-3 flex items-center gap-2 overflow-x-auto pb-1">
          <FilterChip
            active={tableFilter === "all"}
            onClick={() => setTableFilter("all")}
          >
            All ({orders.length})
          </FilterChip>
          {tables.map((n) => (
            <FilterChip
              key={n}
              active={tableFilter === n}
              onClick={() => setTableFilter(n)}
            >
              T{n} ({orders.filter((o) => o.tableNumber === n).length})
            </FilterChip>
          ))}
        </div>

        {!ordersLoading && newGuests.length > 0 ? (
          <section
            aria-labelledby="new-guests"
            className="border-secondary bg-highlight-soft/30 mb-4 rounded-lg border-2 border-dashed p-3"
          >
            <h2 id="new-guests" className="text-secondary-deep text-lg">
              New guests — check the table
            </h2>
            <p className="text-body mb-2.5 text-sm">
              First order from a table you haven&apos;t confirmed. If someone is
              sitting there, Accept: it goes to the kitchen and the table stays
              open for their next orders.
            </p>
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {newGuests.map((order) => (
                <OrderTicket
                  key={order.id}
                  order={order}
                  menu={menu}
                  isFresh={freshIds.has(order.id)}
                  numberingStalled={Boolean(numbering)}
                  busy={busyId === order.id}
                  error={
                    actionError?.orderId === order.id
                      ? actionError.message
                      : null
                  }
                  onAdvance={(to) => void advance(order, to)}
                  onReject={(reason) => void reject(order, reason)}
                />
              ))}
            </ul>
          </section>
        ) : null}

        {ordersLoading ? (
          <Loading label="Listening for orders…" />
        ) : kitchen.length === 0 && newGuests.length > 0 ? (
          <p className="text-muted text-sm">Nothing in the kitchen yet.</p>
        ) : kitchen.length === 0 ? (
          <EmptyState
            mood="sleepy"
            title={
              orders.length === 0 ? "All caught up" : "Nothing on that table"
            }
            body={
              orders.length === 0
                ? "New orders appear here the moment a customer taps Place order."
                : undefined
            }
          />
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {kitchen.map((order) => (
              <OrderTicket
                key={order.id}
                order={order}
                menu={menu}
                isFresh={freshIds.has(order.id)}
                numberingStalled={Boolean(numbering)}
                busy={busyId === order.id}
                error={
                  actionError?.orderId === order.id ? actionError.message : null
                }
                onAdvance={(to) => void advance(order, to)}
                onReject={(reason) => void reject(order, reason)}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "rounded-pill font-round min-h-11 shrink-0 border-2 px-4 text-sm transition-colors",
        active
          ? "border-primary bg-primary text-on-dark"
          : "border-line bg-paper text-ink",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function OrderTicket({
  order,
  menu,
  isFresh,
  numberingStalled,
  busy,
  error,
  onAdvance,
  onReject,
}: {
  order: Order;
  menu: MenuItem[];
  isFresh: boolean;
  /** Numbering has stopped on this board: show the fallback number. */
  numberingStalled: boolean;
  busy: boolean;
  /** Why the last status change on this ticket failed, if it did. */
  error: string | null;
  onAdvance: (to: OrderStatus) => void;
  onReject: (reason?: string) => void;
}) {
  // Rejecting is a two-step action on the ticket itself, not a browser
  // confirm(): the counter tablet is often an installed app where the native
  // dialog looks like a system error, and the second step is also where the
  // reason is picked.
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  // 1s tick keeps the wait timer live without a Firestore read.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const newGuest = isAwaitingCounter(order.status);
  const waited = now - order.createdAt;
  const urgent = waited > 8 * 60_000;
  const warn = waited > 4 * 60_000;
  const actions = actionsFor(order.status);
  // The total on the order came from the customer's phone. Re-derive it here,
  // where the money is taken, so a doctored one cannot slip past the counter.
  const check = useMemo(() => checkOrderIntegrity(order, menu), [order, menu]);

  return (
    <Card
      data-order-id={order.id}
      // The board renders tickets straight into a <ul>.
      role="listitem"
      className={[
        "flex flex-col overflow-hidden",
        isFresh ? "animate-alert-flash border-berry" : "",
      ].join(" ")}
    >
      <div className="border-line-soft flex items-center gap-3 border-b-2 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <span className="text-2xs text-muted font-semibold tracking-[0.12em] uppercase">
              Table
            </span>
            <span
              className={[
                "font-round text-primary leading-none",
                newGuest ? "text-5xl" : "text-3xl",
              ].join(" ")}
            >
              {order.tableNumber}
            </span>
            <TicketNumber order={order} stalled={numberingStalled} />
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge status={order.status} size="sm" />
          <span
            className={[
              "tnum font-round flex items-center gap-1 text-sm",
              urgent
                ? "text-berry-deep"
                : warn
                  ? "text-secondary"
                  : "text-muted",
            ].join(" ")}
          >
            <Icon name="clock" size={14} />
            {formatWait(waited)}
          </span>
        </div>
      </div>

      <ul className="divide-line-soft flex-1 divide-y">
        {order.items.map((line) => (
          <li
            key={`${line.menuItemId}-${line.name}`}
            className="flex items-baseline gap-2 px-3 py-1.5"
          >
            <span className="tnum font-round text-primary w-7 shrink-0 text-lg">
              {line.qty}×
            </span>
            <span className="text-ink min-w-0 flex-1 text-[0.95rem] leading-snug">
              {line.name}
            </span>
            <span className="tnum text-muted shrink-0 text-sm">
              {formatINR(lineSubtotal(line))}
            </span>
          </li>
        ))}
      </ul>

      {order.notes ? (
        <p className="border-line bg-tan/60 text-body mx-3 mb-2 rounded-sm border-2 border-dashed px-2.5 py-1.5 text-sm">
          <span className="font-semibold">Note:</span> {order.notes}
        </p>
      ) : null}

      <TotalWarning check={check} />

      {error ? (
        <p
          role="alert"
          className="border-berry bg-paper text-berry-deep mx-3 mb-2 rounded-sm border-2 px-2.5 py-1.5 text-sm font-semibold"
        >
          {error}
        </p>
      ) : null}

      {confirming ? (
        <RejectConfirm
          order={order}
          reason={reason}
          busy={busy}
          onReason={setReason}
          onConfirm={() => onReject(reason ?? undefined)}
          onKeep={() => {
            setConfirming(false);
            setReason(null);
          }}
        />
      ) : null}

      <div className="border-line-soft flex items-center justify-between gap-2 border-t-2 px-3 py-2">
        <TicketTotal check={check} />
        <div className="flex flex-wrap justify-end gap-2">
          {actions.length === 0 ? (
            <span className="text-muted text-sm">Closed</span>
          ) : (
            actions
              .slice()
              .sort((a, b) => Number(b.primary) - Number(a.primary))
              .map((action) => (
                <Button
                  key={action.to}
                  size="sm"
                  variant={action.variant}
                  disabled={busy}
                  onClick={() => onAdvance(action.to)}
                >
                  {action.label}
                </Button>
              ))
          )}
          {canReject(order.status) && !confirming ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setConfirming(true);
                // A new guest nobody can see is the usual reason; still one
                // tap to change or clear.
                if (newGuest) setReason(PENDING_REJECT_REASON);
              }}
              aria-label={`Reject order ${orderLabel(order)}`}
            >
              Reject
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

/**
 * Today's number, big enough to read across the counter. Until the board has
 * numbered the order (a second or so) a quiet placeholder holds its place, so
 * the number never appears as one thing and then changes to another. Only if
 * numbering has stopped does the older short number stand in.
 *
 * A new guest's order is not numbered until staff accept it (a stranger's
 * order that is turned away should not use up one of the day's numbers), so
 * it shows a still placeholder that says so rather than one that looks busy.
 */
function TicketNumber({ order, stalled }: { order: Order; stalled: boolean }) {
  if (order.dayNumber !== undefined) {
    return (
      <span className="tnum font-round text-ink ml-1 text-2xl leading-none">
        #{padDayNumber(order.dayNumber)}
      </span>
    );
  }
  if (isAwaitingCounter(order.status)) {
    return (
      <span
        className="tnum text-muted ml-1 text-2xl leading-none"
        title="Gets its number when you accept it"
      >
        <span aria-hidden="true">#····</span>
        <span className="sr-only">Number on Accept</span>
      </span>
    );
  }
  if (stalled) {
    return (
      <span className="tnum text-muted ml-1 text-sm">{orderLabel(order)}</span>
    );
  }
  return (
    <span
      className="tnum text-muted ml-1 animate-pulse text-2xl leading-none"
      title="Numbering this order…"
    >
      <span aria-hidden="true">#····</span>
      <span className="sr-only">Number coming</span>
    </span>
  );
}

function RejectConfirm({
  order,
  reason,
  busy,
  onReason,
  onConfirm,
  onKeep,
}: {
  order: Order;
  reason: string | null;
  busy: boolean;
  onReason: (reason: string | null) => void;
  onConfirm: () => void;
  onKeep: () => void;
}) {
  const headingId = `reject-${order.id}`;
  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className="border-berry-deep bg-berry/5 mx-3 mb-2 rounded-md border-2 p-3"
    >
      <p id={headingId} className="text-berry-deep font-semibold">
        Reject order {orderLabel(order)} from table {order.tableNumber}?
      </p>
      <p className="text-muted mt-0.5 text-sm">
        It leaves the board and the customer&apos;s phone says the counter
        couldn&apos;t accept it. This can&apos;t be undone.
      </p>
      <p className="text-2xs text-muted mt-2.5 font-semibold tracking-[0.12em] uppercase">
        Reason (optional, shown to the customer)
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {REJECT_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={reason === r}
            onClick={() => onReason(reason === r ? null : r)}
            className={[
              "rounded-pill min-h-11 border-2 px-3 text-sm font-semibold transition-colors",
              reason === r
                ? "border-berry-deep bg-berry-deep text-on-dark"
                : "border-line bg-paper text-ink",
            ].join(" ")}
          >
            {r}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={busy} onClick={onKeep}>
          Keep order
        </Button>
        <Button size="sm" variant="danger" disabled={busy} onClick={onConfirm}>
          {busy ? "Rejecting…" : "Reject order"}
        </Button>
      </div>
    </div>
  );
}

function StaffLogin({
  signIn,
  signInWithPin,
  isDemo,
  onFirstGesture,
}: {
  signIn: (email: string, password: string) => Promise<void>;
  signInWithPin: (pin: string) => Promise<void>;
  isDemo: boolean;
  onFirstGesture: () => void;
}) {
  const [mode, setMode] = useState<"pin" | "password">(
    isDemo ? "pin" : "password",
  );
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    onFirstGesture();
    setBusy(true);
    setError(null);
    try {
      if (mode === "pin") await signInWithPin(pin);
      else await signIn(email, password);
    } catch (err) {
      setError(friendlySignInError(err));
    } finally {
      setBusy(false);
    }
  }

  function fillDemo(which: "staff" | "owner") {
    const creds = DEMO_CREDENTIALS[which];
    setMode("password");
    setEmail(creds.email);
    setPassword(creds.password);
    onFirstGesture();
  }

  return (
    <main className="relative flex min-h-svh flex-col items-center justify-center gap-4 px-5 py-10">
      <Mascot mood="worry" size={120} />
      <div className="text-center">
        <h1 className="font-hand text-primary text-4xl">Staff only</h1>
        <p className="text-muted text-sm">Counter view for {getCafeName()}</p>
      </div>

      <form
        onSubmit={submit}
        className="border-line bg-paper shadow-card flex w-full max-w-sm flex-col gap-3 rounded-lg border-2 p-4"
      >
        {isDemo ? (
          <div className="flex gap-2">
            {(["pin", "password"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
                aria-pressed={mode === m}
                className={[
                  "rounded-pill font-round min-h-11 flex-1 border-2 text-sm capitalize",
                  mode === m
                    ? "border-primary bg-primary text-on-dark"
                    : "border-line bg-cream text-ink",
                ].join(" ")}
              >
                {m === "pin" ? "PIN" : "Email"}
              </button>
            ))}
          </div>
        ) : null}

        {mode === "pin" ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-ink text-sm font-semibold">
              Today&apos;s PIN
            </span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              className="tnum border-line bg-cream-soft font-round text-ink focus:border-primary min-h-14 rounded-sm border-2 text-center text-3xl tracking-[0.5em] focus:outline-none"
              placeholder="••••"
            />
          </label>
        ) : (
          <>
            <label className="flex flex-col gap-1.5">
              <span className="text-ink text-sm font-semibold">Email</span>
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="border-line bg-cream-soft text-ink focus:border-primary min-h-12 rounded-sm border-2 px-3 focus:outline-none"
                placeholder="staff@cafe.com"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-ink text-sm font-semibold">Password</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="border-line bg-cream-soft text-ink focus:border-primary min-h-12 rounded-sm border-2 px-3 focus:outline-none"
                placeholder="••••••••"
              />
            </label>
          </>
        )}

        {error ? (
          <p role="alert" className="text-berry-deep text-sm font-semibold">
            {error}
          </p>
        ) : null}

        <Button type="submit" size="lg" fullWidth disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>

        {isDemo ? (
          <div className="border-secondary/50 bg-highlight-soft/40 text-2xs text-primary-dark rounded-sm border-2 border-dashed p-2.5 text-center leading-relaxed">
            <p className="font-semibold">Demo accounts</p>
            <p className="tnum">
              PIN 1122 · staff@demo.cafe / cafe1122 · owner@demo.cafe / cafe1122
            </p>
            <div className="mt-1.5 flex justify-center gap-2">
              <button
                type="button"
                onClick={() => fillDemo("staff")}
                className="rounded-pill border-secondary min-h-9 border-2 px-3 font-semibold"
              >
                Fill staff
              </button>
              <button
                type="button"
                onClick={() => fillDemo("owner")}
                className="rounded-pill border-secondary min-h-9 border-2 px-3 font-semibold"
              >
                Fill owner
              </button>
            </div>
          </div>
        ) : null}
      </form>
    </main>
  );
}

/** The rules (or the demo store standing in for them) said no. */
function isRefusal(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === "permission-denied";
}
