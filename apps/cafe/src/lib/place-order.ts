/**
 * Placing an order.
 *
 * The customer phone is untrusted, so this re-prices the basket against the
 * live menu immediately before writing (issue #4: "total is computed from
 * server-side-authoritative prices at order time, not just the client copy"),
 * and refuses to send a basket containing a sold-out or deleted item.
 */

import { loadBundle, type DataBundle, type NewOrderInput } from "./data";
import { priceCart } from "./money";
import { orderCapProblems } from "./order-caps";
import {
  OrderThrottled,
  readLastOrderAt,
  recordOrderPlaced,
  secondsUntilNextOrder,
} from "./order-throttle";
import type { NewOrderStatus } from "./order-status";
import { chooseOrderStatus } from "./table-open";
import type { CartLine, MenuItem, Order } from "./types";

export interface PlaceOrderArgs {
  tableNumber: number;
  cartLines: CartLine[];
  menu: MenuItem[];
  notes?: string;
  paymentMethod?: Order["paymentMethod"];
  /** The table's QR code, from the scanned link or remembered from it. */
  tableKey?: string | null;
}

/**
 * The order was refused and the most likely reason is the table code: missing
 * (someone typed the address) or out of date (the owner printed a new card).
 */
export class TableCodeRefused extends Error {
  readonly hadCode: boolean;
  constructor(hadCode: boolean) {
    super(
      hadCode
        ? "This link has expired — please scan the QR code on your table."
        : "To order, please scan the QR code on your table.",
    );
    this.name = "TableCodeRefused";
    this.hadCode = hadCode;
  }
}

export class OrderRejected extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(problems.join(" "));
    this.name = "OrderRejected";
    this.problems = problems;
  }
}

export async function placeOrder({
  tableNumber,
  cartLines,
  menu,
  notes,
  paymentMethod = "counter",
  tableKey,
}: PlaceOrderArgs): Promise<Order> {
  if (!Number.isInteger(tableNumber) || tableNumber < 1) {
    throw new Error("We lost track of your table. Please scan again.");
  }
  if (cartLines.length === 0) {
    throw new Error("Your order is empty.");
  }

  // Re-price from the freshest menu we have. In demo mode `menu` is the live
  // subscription value, so this is the same data the staff board sees.
  // A price change is not fatal — the customer is charged the new price, which
  // the checkout button already displayed. A sold-out or deleted item is.
  const check = priceCart(cartLines, menu);
  if (check.blocking.length > 0) {
    throw new OrderRejected(check.blocking);
  }
  // The rules refuse these too, with nothing but "permission-denied".
  const tooBig = orderCapProblems(check.lines, check.total);
  if (tooBig.length > 0) throw new OrderRejected(tooBig);

  // One order per customer per ORDER_GAP_SECONDS (issue #32). The rules enforce
  // it; this just tells an honest customer how long to wait, instead of letting
  // the server's bare permission-denied become "we couldn't send that".
  const wait = secondsUntilNextOrder(readLastOrderAt(), Date.now());
  if (wait > 0) throw new OrderThrottled(wait);

  const bundle = await loadBundle();
  const input = {
    tableNumber,
    items: check.lines,
    total: check.total,
    notes: notes?.trim() || undefined,
    paymentMethod,
    ...(tableKey ? { tableKey } : {}),
  };

  try {
    const order = await createWithStatus(bundle, input);
    recordOrderPlaced(Date.now());
    return order;
  } catch (err) {
    if (err instanceof OrderThrottled) throw err;
    // By now the throttle has been ruled out (the repository checks the
    // customer's stamp on any refusal), and the basket's shape and size were
    // checked above against the same limits as the rules. What is left that a
    // customer's phone can get wrong is the table code, which the phone cannot
    // check for itself: codes are unreadable to customers by design.
    if (codeOf(err) === "permission-denied") {
      throw new TableCodeRefused(Boolean(tableKey));
    }
    throw new Error(friendlyError(err));
  }
}

/**
 * Sends the order as `preparing` when the owner has not switched "Approve new
 * tables" on (the default) or the table is open, otherwise as `pending` for
 * staff to accept (src/lib/table-open.ts). The phone checks first so the
 * rules are not asked for something they will refuse. If it cannot check, it
 * sends `preparing`, the default: with approval on and the table closed the
 * rules refuse that, and the retry below sends `pending`. Sending `pending`
 * blind instead would make an order wait for Accept that the owner never
 * asked staff to approve.
 *
 * A refusal gets one retry with the other status:
 *   - `preparing` refused: approval is on and the table is closed (or closed
 *     in the moment between the check and the order). `pending` goes through.
 *   - `pending` refused: the rules may be the ones from before this change,
 *     which only knew `preparing` (a deploy puts new pages and new rules out
 *     a moment apart). With the current rules the retry is refused too, so it
 *     never lets an order skip the counter.
 * A second refusal is a real one (the table code, say) and is left to the
 * caller.
 */
async function createWithStatus(
  bundle: DataBundle,
  input: Omit<NewOrderInput, "status">,
): Promise<Order> {
  let status: NewOrderStatus = "preparing";
  try {
    const [settings, tableOpen] = await Promise.all([
      bundle.sessions.readSettings(),
      bundle.sessions.isOpen(input.tableNumber),
    ]);
    status = chooseOrderStatus({
      confirmNewGuests: settings.confirmNewGuests,
      tableOpen,
    });
  } catch {
    /* could not check: try the default; a refusal is retried as pending */
  }

  try {
    return await bundle.orders.create({ ...input, status });
  } catch (err) {
    if (err instanceof OrderThrottled || codeOf(err) !== "permission-denied") {
      throw err;
    }
    const other: NewOrderStatus =
      status === "preparing" ? "pending" : "preparing";
    return bundle.orders.create({ ...input, status: other });
  }
}

/**
 * Turns a backend failure into something a person at table 4 can act on.
 *
 * The alternative is what this did before: the raw Firebase string. "Firebase:
 * Error (auth/configuration-not-found)" in the middle of a checkout tells a
 * customer nothing and tells the cafe owner nothing except that the order was
 * lost. The one that matters most here is the not-configured case, because it
 * looks like a broken app rather than a half-finished setup step.
 */
function codeOf(err: unknown): string {
  const own = (err as { code?: unknown } | null)?.code;
  return typeof own === "string" ? own : "";
}

export function friendlyError(err: unknown): string {
  const raw =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  // Firestore puts the code on `err.code` and leaves it out of the message
  // ("Missing or insufficient permissions."), so read that first. Auth errors
  // carry it in both; a plain Error only in the "(code)" of its message.
  const own = (err as { code?: unknown } | null)?.code;
  const code =
    (typeof own === "string" && own) ||
    /\(([a-z0-9/-]+)\)/i.exec(raw)?.[1] ||
    "";

  if (code.startsWith("auth/")) {
    if (code.includes("configuration-not-found"))
      return "Ordering is not switched on yet. Please tell the counter.";
    if (code.includes("network"))
      return "No connection right now. Check the wifi and try again.";
    if (code.includes("blocked"))
      return "This device is not allowed to order. Please scan the code again.";
    if (code.includes("unauthorized-domain"))
      return "Ordering is not switched on for this address. Please tell the counter.";
    return "We couldn't confirm who you are. Please tell the counter.";
  }
  if (code.startsWith("permission-denied"))
    return "We couldn't send that order. Please tell the counter.";
  if (code.startsWith("unavailable"))
    return "The kitchen system is busy. Please try again in a moment.";
  if (code.startsWith("deadline-exceeded"))
    return "That took too long. Please try again.";
  if (raw.trim()) return raw;
  return "We couldn't send that. Please try again.";
}
