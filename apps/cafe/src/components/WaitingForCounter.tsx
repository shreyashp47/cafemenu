import { Icon } from "@/components/icons";
import { Mascot } from "@/components/Mascot";
import { Card } from "@/components/ui/Card";
import { formatINR, lineSubtotal } from "@/lib/money";
import { padDayNumber } from "@/lib/order-number";
import type { Order } from "@/lib/types";

/**
 * The customer's screen while their order is `pending`: the first order from
 * a table staff have not confirmed yet (src/lib/table-open.ts).
 *
 * Friendly, not alarming. Almost everyone who sees this is a real guest who
 * sat down a minute ago; the step only exists to stop orders from people who
 * are not in the cafe at all. So it says what happens next and that there is
 * nothing to do, and the page moves on by itself — to the normal "Got it!"
 * when staff accept, or to the rejected notice if they turn it away.
 */
export function WaitingForCounter({ order }: { order: Order }) {
  return (
    <div className="relative min-h-svh pb-8">
      <header className="safe-t border-line-soft bg-cream/85 relative z-10 border-b-2 px-4 py-3 backdrop-blur-sm">
        <div className="shell text-muted flex items-center gap-2 text-sm font-semibold">
          <Icon name="pin" size={16} />
          Table {order.tableNumber}
          {/* No number yet: the board numbers an order once staff accept it,
              and a stand-in here would only change under the customer. */}
          <span className="tnum rounded-pill bg-paper text-primary ml-auto px-2.5 py-0.5">
            {order.dayNumber !== undefined
              ? `Order #${padDayNumber(order.dayNumber)}`
              : "Order received"}
          </span>
        </div>
      </header>

      <main className="shell relative z-10 flex flex-col items-center gap-5 pt-8 text-center">
        <Mascot mood="happy" size={132} />
        <div role="status" aria-live="polite">
          <h1 className="font-hand text-primary text-4xl leading-tight">
            Waiting for the counter to confirm your table
          </h1>
          <p className="text-body mt-2">
            Someone at the counter will glance over at table {order.tableNumber}{" "}
            — it usually takes a moment. Your order goes to the kitchen as soon
            as they confirm.
          </p>
        </div>

        <p className="border-line bg-tan/50 text-body w-full rounded-md border-2 border-dashed px-4 py-3 text-sm">
          <Icon
            name="clock"
            size={16}
            className="mr-1 inline-block align-[-2px]"
          />
          Nothing to do here. This page updates by itself. Only the first order
          from your table waits like this.
        </p>

        <Card className="w-full overflow-hidden text-left">
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
      </main>
    </div>
  );
}
