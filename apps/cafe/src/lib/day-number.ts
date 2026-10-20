/**
 * Handing out today's order numbers, #0001 upwards (see ./order-number.ts for
 * the why).
 *
 * Two pieces, both independent of Firestore so they can be tested without it:
 *
 * - `assignInTransaction` is the body of one numbering transaction. The
 *   Firestore adapter runs it inside `runTransaction`; the demo store runs it
 *   against localStorage. It re-reads the order and stops if somebody else
 *   numbered it first, which is what makes two boards racing safe: Firestore
 *   retries the loser's transaction, the retry sees the number, and gives up.
 *   firestore.rules independently refuses any write that is not exactly
 *   `counter.next`, so even a buggy client cannot hand out a duplicate.
 *
 * - `createDayNumberAssigner` is what the staff board runs over its live list.
 *   One assignment in flight per device, oldest order first, backoff when a
 *   transaction fails, and a full stop after repeated permission errors so a
 *   board that the rules refuse does not loop on them.
 */

import { DAY_NUMBER_MAX, istDayKey, isDayNumber } from "./order-number";

/** What a numbering transaction needs from the store it runs against. */
export interface DayNumberTx {
  /**
   * The order as it stands inside the transaction, or null if it is gone.
   * `status` is optional only so a store that cannot say is not forced to;
   * both real stores pass it.
   */
  readOrder(id: string): Promise<{
    createdAt: number;
    dayNumber?: unknown;
    status?: string;
  } | null>;
  /** The counter's `next` for that day, or null if the day has no counter. */
  readCounter(dayKey: string): Promise<number | null>;
  /**
   * Puts the number on the order and sets the counter to `dayNumber + 1`,
   * creating it when `counterExisted` is false. Called at most once, after
   * every read (Firestore requires reads before writes in a transaction).
   */
  write(input: {
    id: string;
    dayKey: string;
    dayNumber: number;
    counterExisted: boolean;
  }): void;
}

export interface Assigned {
  dayNumber: number;
  dayKey: string;
}

/** The day already has 9,999 orders: the four digits have run out. */
export class DayNumbersExhausted extends Error {
  constructor(dayKey: string) {
    super(`Every number for ${dayKey} is used up (${DAY_NUMBER_MAX} orders).`);
    this.name = "DayNumbersExhausted";
  }
}

/**
 * An order waiting for the counter (`pending`, src/lib/table-open.ts) is not
 * numbered until staff accept it: most of the orders turned away at that step
 * come from people who are not in the cafe, and numbering them would leave a
 * gap in the day's list for each (and let a leaked link use the day's numbers
 * up). firestore.rules refuses to number a pending order too.
 */
export function awaitsNumbering(status: unknown): boolean {
  return status !== "pending";
}

/**
 * One numbering attempt. Returns what was assigned, or null when there was
 * nothing to do: the order is gone, it already has a number (another board
 * got there first), or it is still waiting for the counter.
 */
export async function assignInTransaction(
  tx: DayNumberTx,
  id: string,
): Promise<Assigned | null> {
  const order = await tx.readOrder(id);
  if (!order || order.dayNumber !== undefined) return null;
  if (!awaitsNumbering(order.status)) return null;
  // From when the order was placed, not from now: an order placed at 23:59:59
  // and numbered at 00:00:02 belongs to the day it was placed.
  const dayKey = istDayKey(order.createdAt);
  const next = await tx.readCounter(dayKey);
  const dayNumber = next ?? 1;
  if (!isDayNumber(dayNumber)) throw new DayNumbersExhausted(dayKey);
  tx.write({ id, dayKey, dayNumber, counterExisted: next !== null });
  return { dayNumber, dayKey };
}

/** Reads `next` off a counter document's data, refusing anything odd. */
export function counterNext(data: unknown): number | null {
  const next = (data as { next?: unknown } | undefined)?.next;
  return typeof next === "number" && Number.isInteger(next) && next >= 1
    ? next
    : null;
}

// --- the board's assigner ----------------------------------------------------

export interface NumberingOrder {
  id: string;
  createdAt: number;
  dayNumber?: number;
  /** A `pending` order is left alone until it is accepted. */
  status?: string;
}

/** On the board, without a number, and ready for one. */
function wantsNumber(o: NumberingOrder): boolean {
  return !isDayNumber(o.dayNumber) && awaitsNumbering(o.status);
}

export interface AssignerOptions {
  /** Runs one numbering transaction for the order. */
  assign(id: string): Promise<unknown>;
  /**
   * Told when numbering stops working (with why) and when it recovers (null).
   * The board shows a short note; it never blocks the board.
   */
  onStall?(error: Error | null): void;
  /** First retry delay; doubles per consecutive failure up to maxDelayMs. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Consecutive failures before the board is told. */
  stallAfter?: number;
  /** Consecutive permission refusals before numbering stops for good. */
  permissionTries?: number;
  /** Injectable for tests. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  random?: () => number;
}

export interface DayNumberAssigner {
  /** Hand it every new snapshot of the live board. */
  update(orders: readonly NumberingOrder[]): void;
  stop(): void;
}

function isPermissionError(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  return code === "permission-denied" || code === "unauthenticated";
}

export function createDayNumberAssigner(
  options: AssignerOptions,
): DayNumberAssigner {
  const {
    assign,
    onStall,
    baseDelayMs = 500,
    maxDelayMs = 30_000,
    stallAfter = 3,
    permissionTries = 3,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    random = Math.random,
  } = options;

  let orders: readonly NumberingOrder[] = [];
  let busy = false;
  let stopped = false;
  let timer: unknown = null;
  let failures = 0;
  let permissionFailures = 0;
  let stalled = false;
  // Orders this device has finished with, until the live list catches up.
  // Without it, the snapshot that still shows the order unnumbered would start
  // a second, pointless transaction for it.
  const settled = new Set<string>();
  // Orders that can never be numbered (the day ran out of numbers).
  const skipped = new Set<string>();

  const stall = (error: Error | null) => {
    if (error === null && !stalled) return;
    stalled = error !== null;
    onStall?.(error);
  };

  const pick = (): NumberingOrder | undefined => {
    let best: NumberingOrder | undefined;
    for (const o of orders) {
      if (!wantsNumber(o) || settled.has(o.id) || skipped.has(o.id)) continue;
      if (!best || o.createdAt < best.createdAt) best = o;
    }
    return best;
  };

  const kick = () => {
    if (busy || stopped || timer !== null) return;
    const target = pick();
    if (!target) return;
    busy = true;
    void assign(target.id)
      .then(() => {
        settled.add(target.id);
        if (stopped) return;
        failures = 0;
        permissionFailures = 0;
        stall(null);
      })
      .catch((err: unknown) => {
        // stop() while this was in flight: the board has gone (or signed
        // out). No retry, and nothing to tell it.
        if (stopped) return;
        const error = err instanceof Error ? err : new Error(String(err));
        if (isPermissionError(err)) {
          permissionFailures += 1;
          // A refusal is nearly always permanent — an account the rules do not
          // treat as staff, or rules older than this code — and retrying would
          // only burn reads, so after a couple of tries the board stops
          // numbering and keeps working without. The tries are for the rare
          // race the rules can report as a refusal (see assignDayNumber in
          // src/lib/data/firestore.ts).
          if (permissionFailures >= permissionTries) {
            stopped = true;
            stall(error);
            return;
          }
        } else {
          permissionFailures = 0;
        }
        if (err instanceof DayNumbersExhausted) {
          skipped.add(target.id);
          stall(error);
          return;
        }
        failures += 1;
        if (failures >= stallAfter) stall(error);
        const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (failures - 1));
        // Jitter, so two boards that collided do not collide again in step.
        timer = setTimer(
          () => {
            timer = null;
            kick();
          },
          delay * (0.75 + random() * 0.5),
        );
      })
      .finally(() => {
        busy = false;
        kick();
      });
  };

  return {
    update(next) {
      orders = next;
      // Forget ids the live list no longer has, now shows numbered, or shows
      // waiting for the counter (so it is numbered afresh once accepted).
      const live = new Set(next.filter(wantsNumber).map((o) => o.id));
      for (const id of settled) if (!live.has(id)) settled.delete(id);
      kick();
    },
    stop() {
      stopped = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
}
