/**
 * The per-customer order throttle (issue #32), from the phone's side.
 *
 * The real limit lives in firestore.rules: every order must be written in the
 * same batch as the customer's /orderThrottle/{uid} document, and that document
 * may only be rewritten once ORDER_GAP_SECONDS have passed since the last one.
 * A script that loops on order creation is refused by the server whatever this
 * file says.
 *
 * What this file is for is the honest customer who taps "Place order" twice, or
 * remembers the sugar ten seconds later. The server's answer to them is a bare
 * "permission-denied", which would surface as "We couldn't send that order". So
 * the phone keeps its own note of when it last ordered and says, in plain words,
 * how long to wait — before the request, not after it fails.
 *
 * It runs in demo mode too, so the demo behaves the way the real app does.
 */

/** Must match `duration.value(…, 's')` in firestore.rules. A test checks it. */
export const ORDER_GAP_SECONDS = 30;

const KEY = "toe.lastOrderAt";

/**
 * How far a phone's clock may disagree with the server's before a refusal is
 * no longer read as a throttle. See throttleFromServerStamp().
 */
export const CLOCK_SKEW_ALLOWANCE_MS = 2 * 60_000;

export class OrderThrottled extends Error {
  /** Seconds to wait, or null when the phone's clock is too far off to say. */
  readonly seconds: number | null;
  constructor(seconds: number | null) {
    super(throttleMessage(seconds));
    this.name = "OrderThrottled";
    this.seconds = seconds;
  }
}

/**
 * Whole seconds until another order is allowed, judged from the phone's own
 * note of its last order. 0 means go ahead.
 *
 * Both times come from the same phone clock, so skew against the server does
 * not matter here. What does: a note in the future. That happens when the clock
 * was ahead when the order was placed and has since been corrected, and waiting
 * for real time to catch up could lock the customer out for hours without ever
 * asking the server. So a future note is treated as no note at all. The server
 * enforces the gap regardless.
 */
export function secondsUntilNextOrder(
  lastOrderAt: number | null,
  now: number,
  gapSeconds: number = ORDER_GAP_SECONDS,
): number {
  if (lastOrderAt === null || !Number.isFinite(lastOrderAt)) return 0;
  const elapsed = now - lastOrderAt;
  if (elapsed < 0) return 0;
  const remainingMs = gapSeconds * 1000 - elapsed;
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}

/**
 * After the server has refused an order: was it the throttle, and how long is
 * left? `stampAt` is the server's time on the customer's /orderThrottle stamp;
 * `now` is the phone's clock, which may be off by any amount.
 *
 * - no stamp: this customer has never ordered, so it was not the throttle
 *   (returns null)
 * - the phone's clock says the gap is still running: trust it and count down
 * - the phone's clock says the gap is over (phone ahead of the server) or has
 *   not started (phone behind): the server refused, so it is still running,
 *   but the phone cannot know how much is left. Say so without a number
 *   rather than invent one
 * - the stamp is older than the gap plus a generous skew allowance: that is
 *   not a clock problem, it is a different refusal (returns null)
 */
export function throttleFromServerStamp(
  stampAt: number | null,
  now: number,
  gapSeconds: number = ORDER_GAP_SECONDS,
  skewMs: number = CLOCK_SKEW_ALLOWANCE_MS,
): { seconds: number | null } | null {
  if (stampAt === null || !Number.isFinite(stampAt)) return null;
  const elapsed = now - stampAt;
  const gapMs = gapSeconds * 1000;
  if (elapsed >= 0 && elapsed < gapMs) {
    return { seconds: Math.ceil((gapMs - elapsed) / 1000) };
  }
  if (elapsed < 0 ? -elapsed <= skewMs : elapsed < gapMs + skewMs) {
    return { seconds: null };
  }
  return null;
}

export function throttleMessage(seconds: number | null): string {
  const lead = "Your last order has only just gone through.";
  if (seconds === null) {
    return `${lead} You can send another in under ${ORDER_GAP_SECONDS} seconds.`;
  }
  const s = Math.max(1, Math.ceil(seconds));
  return `${lead} You can send another in ${s} second${s === 1 ? "" : "s"}.`;
}

export function readLastOrderAt(): number | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function recordOrderPlaced(at: number): void {
  try {
    globalThis.localStorage?.setItem(KEY, String(at));
  } catch {
    /* private mode: the server still enforces the gap */
  }
}

/** Used by tests. */
export function forgetLastOrder(): void {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* nothing to forget */
  }
}
