/**
 * Size limits on a single order.
 *
 * firestore.rules is the enforcement; this is the same limits in words a
 * customer can act on, checked before the order is sent so an honest big order
 * gets "please split it" rather than a bare refusal. The numbers are chosen for
 * a small cafe: a real table rarely orders more than a handful of lines, and a
 * prank order is only useful to a prankster if it is big.
 *
 * Keep these equal to the numbers in firestore.rules — a unit test reads that
 * file to check. The total's cap is the cafe's own, `settings.maxOrderTotal`,
 * which the rules read from config/site (₹10,000 for TOE; see
 * defaultMaxOrderTotal in @cafemenu/shared for everyone else's).
 */

import { formatMoney, type CafeSettings } from "@cafemenu/shared";

import { MAX_QTY_PER_LINE } from "./money";

/** Distinct lines (menu items) in one order. */
export const MAX_ORDER_LINES = 20;

export { MAX_QTY_PER_LINE };

/** What the caps need from the settings: the cap, and how to show it. */
export type CapSettings = Pick<
  CafeSettings,
  "currency" | "locale" | "moneyUnit" | "maxOrderTotal"
>;

/** Everything that would make the rules refuse this basket, as sentences. */
export function orderCapProblems(
  lines: ReadonlyArray<{ qty: number }>,
  total: number,
  settings: CapSettings,
): string[] {
  const problems: string[] = [];
  if (lines.length > MAX_ORDER_LINES) {
    problems.push(
      `One order can have up to ${MAX_ORDER_LINES} different items — please split it into two orders.`,
    );
  }
  if (lines.some((l) => l.qty > MAX_QTY_PER_LINE)) {
    problems.push(`Up to ${MAX_QTY_PER_LINE} of each item per order.`);
  }
  if (total > settings.maxOrderTotal) {
    problems.push(
      `One order can be up to ${formatMoney(settings.maxOrderTotal, settings)} — please split it, or order at the counter.`,
    );
  }
  return problems;
}
