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
 * file to check.
 */

import { formatINR, MAX_QTY_PER_LINE } from "./money";

/** Distinct lines (menu items) in one order. */
export const MAX_ORDER_LINES = 20;
/** Whole rupees. */
export const MAX_ORDER_TOTAL = 10_000;

export { MAX_QTY_PER_LINE };

/** Everything that would make the rules refuse this basket, as sentences. */
export function orderCapProblems(
  lines: ReadonlyArray<{ qty: number }>,
  total: number,
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
  if (total > MAX_ORDER_TOTAL) {
    problems.push(
      `One order can be up to ${formatINR(MAX_ORDER_TOTAL)} — please split it, or order at the counter.`,
    );
  }
  return problems;
}
