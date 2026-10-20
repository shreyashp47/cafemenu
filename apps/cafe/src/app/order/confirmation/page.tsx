"use client";

/**
 * Order confirmation + live status (docs/requirements.md §4.1 steps 5–6).
 *
 * Closes open question #1 in §11: the customer DOES see live status. The screen
 * subscribes to their own order document, so the moment staff tap "Mark ready"
 * the phone updates — no refresh, no polling loop.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";

import { SparkleBurst } from "@/components/Doodles";
import { Icon } from "@/components/icons";
import { Mascot } from "@/components/Mascot";
import {
  DataProvider,
  useMenu,
  useOrder,
  useSpecialOffer,
} from "@/components/providers/DataProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, Loading } from "@/components/ui/Loading";
import { SpeechBubble } from "@/components/ui/SpeechBubble";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { WaitingForCounter } from "@/components/WaitingForCounter";
import { useCart } from "@/hooks/useCart";
import { dropKeyFromAddress } from "@/hooks/useTableCode";
import { useTableQuery } from "@/hooks/useTableQuery";
import { formatINR, lineSubtotal } from "@/lib/money";
import {
  CUSTOMER_STEPS,
  isFinalForCustomer,
  stepIndex,
  type OrderStatus,
} from "@/lib/order-status";
import { orderHref } from "@/lib/tables";
import type { Order, OrderLine } from "@/lib/types";
import { NUMBER_WAIT_MS, padDayNumber } from "@/lib/order-number";
import { readSessionOrderId, rememberSessionOrder } from "@/lib/order-session";

export default function ConfirmationPage() {
  return (
    <DataProvider>
      {/* See src/app/order/page.tsx: a static export prerenders with no query
          string, so the reader needs a Suspense boundary. */}
      <Suspense fallback={<Loading label="Finding your order…" />}>
        <ConfirmationScreen />
      </Suspense>
    </DataProvider>
  );
}

function ConfirmationScreen() {
  const {
    ready,
    tableNumber,
    orderId: idFromUrl,
    hasOrderId,
  } = useTableQuery();
  const [orderId, setOrderId] = useState<string | null>(null);

  // A refresh (or a back-navigation) can drop the id, so the per-table session
  // key in localStorage restores it and the customer lands back on their order.
  useEffect(() => {
    if (!ready) return;
    const remembered = tableNumber ? readSessionOrderId(tableNumber) : null;
    setOrderId(idFromUrl || remembered);
    // This page never takes a code from its address: a confirmation link is
    // the kind that gets shared or bookmarked, so one with `k` (from before
    // codes left the address) must not refresh the phone's 3 hours. It only
    // clears it. Watching the order needs no code.
    dropKeyFromAddress();
  }, [ready, tableNumber, idFromUrl]);

  if (!ready) return <Loading label="Finding your table…" />;

  if (tableNumber === null) {
    return (
      <EmptyState
        mood="worry"
        title="We lost that order"
        body="Head back to the menu and order again — it'll only take a moment."
        action={
          <Link href="/order">
            <Button>Back to the menu</Button>
          </Link>
        }
      />
    );
  }

  // No code in any link back to the menu: the menu uses the phone's saved one,
  // and asks for a fresh scan once that has run out.
  const menuHref = orderHref(tableNumber);

  if (!orderId) {
    return <OrderNotFound menuHref={menuHref} hadId={hasOrderId} />;
  }

  return (
    <StatusScreen
      tableNumber={tableNumber}
      menuHref={menuHref}
      orderId={orderId}
      onRemember={() => rememberSessionOrder(tableNumber, orderId)}
    />
  );
}

/**
 * The id is gone and nothing is remembered for this table — a stale bookmark,
 * or a different phone. Send the customer back to the menu rather than showing
 * a dead end.
 */
function OrderNotFound({
  menuHref,
  hadId,
}: {
  menuHref: string;
  hadId: boolean;
}) {
  const router = useRouter();

  useEffect(() => {
    if (hadId) return;
    router.replace(menuHref);
  }, [hadId, router, menuHref]);

  return <Loading label="Finding your order…" />;
}

function StatusScreen({
  tableNumber,
  menuHref,
  orderId,
  onRemember,
}: {
  tableNumber: number;
  menuHref: string;
  orderId: string;
  onRemember: () => void;
}) {
  const { order, loading } = useOrder(orderId);
  const offer = useSpecialOffer();
  // the live menu is only needed so the cart reconciler can drop sold-out lines
  const { items: menu } = useMenu();
  const cart = useCart(tableNumber, menu);

  const lastStatus = useRef<OrderStatus | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const waitedOut = useNumberWait(order);

  useEffect(() => {
    if (!order) return;
    onRemember();
    if (lastStatus.current === null) {
      lastStatus.current = order.status;
      return;
    }
    if (order.status !== lastStatus.current) {
      lastStatus.current = order.status;
      // brief 1.5s burst, then cleared so repeat use isn't slowed down
      setCelebrate(true);
      const timer = setTimeout(() => setCelebrate(false), 1600);
      return () => clearTimeout(timer);
    }
  }, [order, onRemember]);

  const previous = useMemo<OrderLine[]>(
    () =>
      order?.items.map((i) => ({
        menuItemId: i.menuItemId,
        name: i.name,
        price: i.price,
        qty: i.qty,
      })) ?? [],
    [order],
  );

  if (loading) return <Loading label="Sending it up to the counter…" />;

  if (!order) {
    return (
      <main className="shell py-10">
        <EmptyState
          mood="worry"
          title="We can't find that order"
          body="It may have been cleared from this device. Ask the counter and we'll take another one."
          action={
            <Link href={menuHref}>
              <Button>Start a new order</Button>
            </Link>
          }
        />
      </main>
    );
  }

  if (order.status === "rejected") {
    return (
      <RejectedNotice
        tableNumber={tableNumber}
        dayNumber={order.dayNumber}
        reason={order.rejectReason}
        menuHref={menuHref}
      />
    );
  }

  // The first order from a table staff have not confirmed yet.
  if (order.status === "pending") return <WaitingForCounter order={order} />;

  const done = isFinalForCustomer(order.status);
  const activeStep = stepIndex(order.status);

  return (
    <div className="relative min-h-svh pb-8">
      <SparkleBurst active={celebrate} />

      <header className="safe-t border-line-soft bg-cream/85 relative z-10 border-b-2 px-4 py-3 backdrop-blur-sm">
        <div className="shell text-muted flex items-center gap-2 text-sm font-semibold">
          <Icon name="pin" size={16} />
          Table {tableNumber}
          <HeaderNumber dayNumber={order.dayNumber} />
        </div>
      </header>

      <main className="shell relative z-10 flex flex-col gap-5 pt-6">
        {/* big and clear: mascot + speech bubble + order number (§4.1 step 6) */}
        <section className="flex flex-col items-center gap-3 text-center">
          <Mascot mood={done ? "cheer" : "happy"} size={132} />
          <div>
            <h1 className="font-hand text-primary text-4xl leading-none">
              {done ? "All yours!" : "Got it!"}
            </h1>
            <NumberLine
              order={order}
              tableNumber={tableNumber}
              waitedOut={waitedOut}
            />
          </div>
        </section>

        {/* the big mascot is already right above, so no second one here */}
        <SpeechBubble
          mood={done ? "cheer" : "happy"}
          tail="none"
          showMascot={false}
        >
          {done
            ? "Enjoy! Pay at the counter whenever you're ready."
            : offer.enabled && offer.text
              ? offer.text
              : "We'll bring it over. Sit tight, this takes a minute."}
        </SpeechBubble>

        <StatusTimeline current={order.status} activeStep={activeStep} />

        <Card className="overflow-hidden">
          <h2 className="border-line-soft border-b-2 px-4 py-2.5 text-lg">
            What you ordered
          </h2>
          <ul className="divide-line-soft divide-y-2">
            {order.items.map((line) => (
              <li
                key={`${line.menuItemId}-${line.name}`}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <span className="tnum font-round text-primary w-6 shrink-0">
                  {line.qty}×
                </span>
                <span className="text-ink min-w-0 flex-1 truncate">
                  {line.name}
                </span>
                <span className="tnum text-body shrink-0 font-semibold">
                  {formatINR(lineSubtotal(line))}
                </span>
              </li>
            ))}
            <li className="bg-highlight-soft/40 flex items-center justify-between gap-3 px-4 py-3">
              <span className="font-round text-ink text-lg">Total</span>
              <span className="tnum font-round text-primary text-xl">
                {formatINR(order.total)}
              </span>
            </li>
          </ul>
        </Card>

        <p className="border-line bg-tan/50 text-body rounded-md border-2 border-dashed px-4 py-3 text-center text-sm">
          <Icon
            name="leaf"
            size={16}
            className="mr-1 inline-block align-[-2px]"
          />
          Pay at the counter when you&apos;re done. Nothing to install, no OTP.
        </p>

        <div className="flex flex-col gap-2 pb-6 sm:flex-row">
          <Button
            variant="secondary"
            fullWidth
            disabled={previous.length === 0}
            onClick={() => {
              cart.reAdd(previous);
              window.location.assign(menuHref);
            }}
          >
            Order again
          </Button>
          <Button
            variant="ghost"
            fullWidth
            onClick={() => window.location.assign(menuHref)}
          >
            Back to the menu
          </Button>
        </div>
      </main>
    </div>
  );
}

/**
 * Staff turned the order away (src/lib/order-status.ts, "rejected"). Said
 * plainly, with the reason if they gave one, and pointed at the one place that
 * can sort it out. No "Order again" here: re-sending the same basket is not
 * the fix for an order the counter just refused.
 */
function RejectedNotice({
  tableNumber,
  dayNumber,
  reason,
  menuHref,
}: {
  tableNumber: number;
  dayNumber?: number;
  reason?: string;
  menuHref: string;
}) {
  return (
    <div className="relative min-h-svh pb-8">
      <header className="safe-t border-line-soft bg-cream/85 relative z-10 border-b-2 px-4 py-3 backdrop-blur-sm">
        <div className="shell text-muted flex items-center gap-2 text-sm font-semibold">
          <Icon name="pin" size={16} />
          Table {tableNumber}
          <HeaderNumber dayNumber={dayNumber} />
        </div>
      </header>

      <main className="shell relative z-10 flex flex-col items-center gap-5 pt-8 text-center">
        <Mascot mood="worry" size={132} />
        <div role="status" aria-live="polite">
          <h1 className="font-hand text-berry-deep text-4xl leading-tight">
            The counter couldn&apos;t accept this order
          </h1>
          <p className="text-muted mt-2">
            {dayNumber !== undefined ? (
              <>
                Order{" "}
                <span className="tnum font-round text-ink">
                  #{padDayNumber(dayNumber)}
                </span>{" "}
              </>
            ) : (
              "Your order "
            )}
            won&apos;t be made, and there&apos;s nothing to pay for it.
          </p>
        </div>

        {reason ? (
          <Card className="w-full px-4 py-3">
            <p className="text-2xs text-muted font-semibold tracking-[0.12em] uppercase">
              Reason
            </p>
            <p className="text-ink mt-0.5 text-lg">{reason}</p>
          </Card>
        ) : null}

        <p className="border-line bg-tan/50 text-body w-full rounded-md border-2 border-dashed px-4 py-3 text-sm">
          Please speak to the counter — they&apos;ll sort it out with you.
        </p>

        <Button
          variant="ghost"
          fullWidth
          onClick={() => window.location.assign(menuHref)}
        >
          Back to the menu
        </Button>
      </main>
    </div>
  );
}

/**
 * True once the customer has waited NUMBER_WAIT_MS on this screen for a number
 * that has not come. That only happens when no staff board is open, or an older
 * board that does not number orders is; the screen then stops promising one.
 * Counted from when this screen saw the order, not from createdAt, so a phone
 * with a wrong clock waits the same as any other. An order that is clearly old
 * (a revisited page) gives up at once.
 *
 * A `pending` order is not numbered until staff accept it, so the wait only
 * starts then: a guest who waited five minutes for the counter still sees
 * "Your number is coming…" for the second it takes after Accept. For the same
 * reason "clearly old" is not judged while it waits.
 */
function useNumberWait(order: Order | null): boolean {
  const unnumbered =
    Boolean(order) &&
    order?.dayNumber === undefined &&
    order?.status !== "pending";
  const sawPending = useRef(false);
  if (order?.status === "pending") sawPending.current = true;
  const stale =
    unnumbered &&
    !sawPending.current &&
    Date.now() - (order?.createdAt ?? 0) > 10 * 60_000;
  const [waitedOut, setWaitedOut] = useState(false);
  useEffect(() => {
    if (!unnumbered) return;
    const timer = setTimeout(() => setWaitedOut(true), NUMBER_WAIT_MS);
    return () => clearTimeout(timer);
  }, [unnumbered]);
  return unnumbered && (waitedOut || stale);
}

/** The pill in the header: the number once there is one, nothing fake before. */
function HeaderNumber({ dayNumber }: { dayNumber?: number }) {
  return (
    <span className="tnum rounded-pill bg-paper text-primary ml-auto px-2.5 py-0.5">
      {dayNumber !== undefined
        ? `Order #${padDayNumber(dayNumber)}`
        : "Order received"}
    </span>
  );
}

/**
 * The line under "Got it!". The day number is the one the counter calls out,
 * so it is only shown once the board has written it: before then the screen
 * says a number is coming rather than showing a stand-in that would change.
 */
function NumberLine({
  order,
  tableNumber,
  waitedOut,
}: {
  order: Order;
  tableNumber: number;
  waitedOut: boolean;
}) {
  if (order.dayNumber !== undefined) {
    return (
      <p className="text-muted mt-1" aria-live="polite">
        Order{" "}
        <span className="tnum font-round text-ink text-lg">
          #{padDayNumber(order.dayNumber)}
        </span>{" "}
        is on its way to table {tableNumber}.
      </p>
    );
  }
  return (
    <p className="text-muted mt-1" aria-live="polite">
      <span className="text-ink font-semibold">Order received</span> for table{" "}
      {tableNumber}.{" "}
      {waitedOut ? (
        <span className="mt-0.5 block text-sm">The counter has it.</span>
      ) : (
        <span className="mt-0.5 block animate-pulse text-sm">
          Your number is coming…
        </span>
      )}
    </p>
  );
}

function StatusTimeline({
  current,
  activeStep,
}: {
  current: OrderStatus;
  activeStep: number;
}) {
  return (
    <section aria-label="Order progress">
      <ol className="flex items-stretch gap-1.5">
        {CUSTOMER_STEPS.map((step, index) => {
          const done = index < activeStep;
          const active = index === activeStep;
          return (
            <li key={step} className="min-w-0 flex-1">
              <div
                className={[
                  "rounded-pill h-1.5 transition-colors duration-500",
                  done ? "bg-sage" : active ? "bg-highlight" : "bg-tan-deep/60",
                ].join(" ")}
              />
              <div className="mt-1.5 flex justify-center">
                <StatusBadge
                  status={step}
                  size="sm"
                  className={
                    active ? "animate-badge-pop" : !done ? "opacity-55" : ""
                  }
                />
              </div>
            </li>
          );
        })}
      </ol>
      <p className="text-muted mt-3 text-center text-sm" aria-live="polite">
        {current === "received"
          ? "The counter has your order."
          : current === "preparing"
            ? "Being made right now."
            : current === "ready"
              ? "Ready — a barista is bringing it over."
              : current === "served"
                ? "Served. Enjoy!"
                : "This order is closed."}
      </p>
    </section>
  );
}
