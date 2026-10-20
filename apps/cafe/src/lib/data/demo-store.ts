/**
 * Demo storage backend.
 *
 * Zero-config, browser-local, and — importantly — still *live*: writes are
 * broadcast to every other tab on the same origin, so opening `/order?table=3`
 * and `/staff` side by side on one laptop behaves like the real thing. This is
 * how the app is demoed before a Firebase project exists.
 *
 * Everything lives under a single localStorage key so a write is atomic and the
 * two-tab sync can't interleave a half-written state.
 */

import {
  DEFAULT_STATUS,
  MAX_REJECT_REASON,
  canReject,
  isActiveStatus,
} from "../order-status";
import { orderTotal } from "../money";
import { orderCapProblems } from "../order-caps";
import { isTableKey, type TableKeys } from "../table-keys";
import { displayNumberFromId, istDayKey } from "../order-number";
import { assignInTransaction, type Assigned } from "../day-number";
import {
  MAX_OPEN_HOURS,
  isTableOpen,
  parseOrderingSettings,
  parseTableSessionsDoc,
  type OrderingSettings,
  type TableSessions,
} from "../table-open";
import {
  parseMenuList,
  parseOrder,
  parseOrderList,
  parseSpecialOffer,
  type MenuItem,
  type Order,
  type SpecialOffer,
  type Unsubscribe,
} from "../types";
import { normalizeTables } from "../tables";
import { SEED_MENU, SEED_OFFER } from "./seed";
import type { NewOrderInput } from "./types";

export const DEMO_STORAGE_KEY = "cafe-qr-order.demo.v1";
const SYNC_EVENT = "cafe-qr-order:sync";

interface DemoState {
  menu: MenuItem[];
  orders: Order[];
  offer: SpecialOffer;
  /** null until the owner saves a list: the env default applies meanwhile. */
  tables: number[] | null;
  /** The owner's per-table QR codes (tableKeys/{n} in Firestore). */
  tableKeys: Record<number, string>;
  /**
   * dayCounters/{YYYY-MM-DD}.next in Firestore: each day's next number. The
   * Firestore counter also records `last`, the order each bump was for, so the
   * rules can refuse one commit numbering two orders. The demo cannot be sent
   * such a commit — demoAssignDayNumber numbers exactly one order per write —
   * so it keeps just the number.
   */
  dayCounters: Record<string, number>;
  /** tableSessions/{n}.openUntil in Firestore: when each table closes. */
  tableSessions: TableSessions;
  /** config/ordering. Missing means confirmation OFF, as in Firestore. */
  ordering: OrderingSettings;
}

function emptyState(): DemoState {
  return {
    menu: [],
    orders: [],
    offer: { enabled: false, text: "" },
    tables: null,
    tableKeys: {},
    dayCounters: {},
    tableSessions: {},
    ordering: parseOrderingSettings(undefined),
  };
}

function seedState(): DemoState {
  return {
    menu: SEED_MENU.map((item) => ({ ...item })),
    orders: [],
    offer: { ...SEED_OFFER },
    tables: null,
    tableKeys: {},
    dayCounters: {},
    tableSessions: {},
    ordering: parseOrderingSettings(undefined),
  };
}

/** Stable ids without pulling in a uuid dependency. */
export function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}${rand}`;
}

// --- storage plumbing -------------------------------------------------------

function safeStorage(): Storage | null {
  try {
    if (typeof globalThis === "undefined" || !("localStorage" in globalThis)) {
      return null;
    }
    const probe = "__cafe_probe__";
    globalThis.localStorage.setItem(probe, "1");
    globalThis.localStorage.removeItem(probe);
    return globalThis.localStorage;
  } catch {
    // Safari private mode / disabled storage: fall back to memory only.
    return null;
  }
}

let storage: Storage | null | undefined;
function getStorage(): Storage | null {
  if (storage === undefined) storage = safeStorage();
  return storage;
}

let memoryState: DemoState | null = null;

function load(): DemoState {
  const store = getStorage();
  if (!store) {
    memoryState ??= seedState();
    return memoryState;
  }
  const raw = store.getItem(DEMO_STORAGE_KEY);
  if (!raw) {
    const seeded = seedState();
    store.setItem(DEMO_STORAGE_KEY, JSON.stringify(seeded));
    return seeded;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return {
      menu: parseMenuList((parsed as DemoState)?.menu),
      orders: parseOrderList((parsed as DemoState)?.orders),
      offer: parseSpecialOffer((parsed as DemoState)?.offer),
      // Saved states from before editable tables have no such field, which
      // reads as "nothing saved", exactly like a fresh Firestore project.
      tables: normalizeTables((parsed as DemoState)?.tables),
      // States from before table codes have none: every table is open, which
      // is the same transition a live cafe goes through.
      tableKeys: parseTableKeys((parsed as DemoState)?.tableKeys),
      dayCounters: parseDayCounters((parsed as DemoState)?.dayCounters),
      // States from before open tables have neither: every table is closed
      // and confirmation is off, exactly like a fresh Firestore project.
      tableSessions: parseTableSessions((parsed as DemoState)?.tableSessions),
      ordering: parseOrderingSettings((parsed as DemoState)?.ordering),
      // Older saved states also carry a `seq` counter from the original public
      // counter. It is ignored, as /meta/counters is in Firestore.
    };
  } catch {
    return seedState();
  }
}

type Listener = (state: DemoState) => void;
const listeners = new Set<Listener>();
let channel: BroadcastChannel | null | undefined;

function getChannel(): BroadcastChannel | null {
  if (channel === undefined) {
    channel = null;
    try {
      if (typeof BroadcastChannel === "function") {
        channel = new BroadcastChannel(SYNC_EVENT);
        channel.onmessage = () => emit();
      }
    } catch {
      channel = null;
    }
  }
  return channel;
}

function emit() {
  const state = load();
  for (const listener of listeners) listener(state);
}

function commit(next: DemoState, broadcast = true) {
  const store = getStorage();
  if (store) {
    try {
      store.setItem(DEMO_STORAGE_KEY, JSON.stringify(next));
    } catch {
      memoryState = next;
    }
  } else {
    memoryState = next;
  }
  emit();
  if (broadcast) {
    try {
      getChannel()?.postMessage("changed");
    } catch {
      /* channel closed */
    }
  }
}

function mutate(fn: (state: DemoState) => DemoState) {
  commit(fn(load()));
}

function subscribeState(listener: Listener): Unsubscribe {
  getChannel();
  listeners.add(listener);
  listener(load());
  return () => {
    listeners.delete(listener);
  };
}

/** Used by tests: drop all state and listeners. */
export function resetDemoStore() {
  listeners.clear();
  memoryState = null;
  const store = getStorage();
  store?.removeItem(DEMO_STORAGE_KEY);
}

// --- selectors --------------------------------------------------------------

export function selectMenu(state: DemoState): MenuItem[] {
  return [...state.menu].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );
}

/** Active board ordering: oldest first, so the most urgent order is on top. */
export function selectActiveOrders(state: DemoState): Order[] {
  return state.orders
    .filter((o) => isActiveStatus(o.status))
    .sort((a, b) => a.createdAt - b.createdAt || a.orderNumber - b.orderNumber);
}

export function selectOrder(state: DemoState, id: string): Order | null {
  return state.orders.find((o) => o.id === id) ?? null;
}

export function selectOffer(state: DemoState): SpecialOffer {
  return state.offer;
}

export function selectTables(state: DemoState): number[] | null {
  return state.tables;
}

export function selectTableKeys(state: DemoState): TableKeys {
  return state.tableKeys;
}

function parseDayCounters(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [day, next] of Object.entries(raw)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isInteger(next) && next >= 1)
      out[day] = next as number;
  }
  return out;
}

function parseTableKeys(raw: unknown): Record<number, string> {
  const out: Record<number, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [table, key] of Object.entries(raw)) {
    const n = Number(table);
    if (Number.isInteger(n) && n >= 1 && n <= 50 && isTableKey(key))
      out[n] = key;
  }
  return out;
}

function parseTableSessions(raw: unknown): TableSessions {
  const out: TableSessions = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [table, openUntil] of Object.entries(raw)) {
    const entry = parseTableSessionsDoc(table, { openUntil });
    if (entry) out[entry[0]] = entry[1];
  }
  return out;
}

export function selectTableSessions(state: DemoState): TableSessions {
  return state.tableSessions;
}

export function selectOrdering(state: DemoState): OrderingSettings {
  return state.ordering;
}

/**
 * What firestore.rules says to an order, so the demo refuses the same orders the
 * live app does and the phone goes down the same error path. Firestore reports
 * every refusal as a bare "permission-denied", and so does this.
 */
export class DemoRulesRefusal extends Error {
  readonly code = "permission-denied";
  constructor(why: string) {
    super(`Missing or insufficient permissions. (demo: ${why})`);
    this.name = "DemoRulesRefusal";
  }
}

/** Inclusive of `from`, exclusive of `to` — matches the reports' month range. */
export function selectOrdersInRange(
  state: DemoState,
  fromMs: number,
  toMs: number,
): Order[] {
  return state.orders
    .filter((o) => o.createdAt >= fromMs && o.createdAt < toMs)
    .sort((a, b) => a.createdAt - b.createdAt);
}

// --- commands ---------------------------------------------------------------

/**
 * No number here, as in Firestore: the customer's phone never allocates one.
 * The demo staff board numbers the order afterwards (demoAssignDayNumber), so
 * the demo shows the same "number coming…" moment the real app does.
 */
export function demoCreateOrder(input: NewOrderInput): Order {
  const now = Date.now();
  const state = load();
  // Mirrors the order create rule: a table with a code needs that code.
  const expected = state.tableKeys[input.tableNumber];
  if (expected && input.tableKey !== expected) {
    throw new DemoRulesRefusal("wrong or missing table code");
  }
  if (orderCapProblems(input.items, orderTotal(input.items)).length > 0) {
    throw new DemoRulesRefusal("order over the size limits");
  }
  // Mirrors the status check: `pending` always, `preparing` unless approval
  // is switched on, and then only on an open table (src/lib/table-open.ts).
  const status = input.status ?? "pending";
  if (status !== "pending" && status !== DEFAULT_STATUS) {
    throw new DemoRulesRefusal("an order starts pending or preparing");
  }
  if (
    status === "preparing" &&
    state.ordering.confirmNewGuests &&
    !isTableOpen(state.tableSessions, input.tableNumber, now)
  ) {
    throw new DemoRulesRefusal("that table is not open");
  }
  const order = parseOrder({
    id: makeId("o"),
    tableNumber: input.tableNumber,
    items: input.items,
    total: orderTotal(input.items),
    status,
    createdAt: now,
    notes: input.notes,
    paymentMethod: input.paymentMethod ?? "counter",
  });
  if (!order) {
    throw new Error("Could not build the order from the cart.");
  }

  mutate((state) => ({ ...state, orders: [...state.orders, order] }));

  return order;
}

export function demoSetStatus(
  id: string,
  status: Order["status"],
  keepTableOpen?: { table: number; openUntil: number },
): void {
  if (keepTableOpen) checkOpenUntil(keepTableOpen.openUntil, Date.now());
  mutate((state) => ({
    ...state,
    ...(keepTableOpen
      ? {
          tableSessions: {
            ...state.tableSessions,
            [keepTableOpen.table]: keepTableOpen.openUntil,
          },
        }
      : {}),
    orders: state.orders.map((order) =>
      order.id === id
        ? {
            ...order,
            status,
            ...(status === "completed" ? { completedAt: Date.now() } : {}),
          }
        : order,
    ),
  }));
}

const MAX_OPEN_MS = MAX_OPEN_HOURS * 60 * 60_000;

/** Mirrors the tableSessions write rule: now .. now + MAX_OPEN_HOURS. */
function checkOpenUntil(openUntil: number, now: number) {
  if (
    !Number.isFinite(openUntil) ||
    openUntil < now ||
    openUntil > now + MAX_OPEN_MS
  ) {
    throw new DemoRulesRefusal("a table can open for at most 4 hours");
  }
}

/**
 * Accept: pending -> preparing for each order and their table opens, in one
 * commit. All or nothing, like a Firestore batch.
 */
export function demoAcceptOrders(ids: string[], openUntil: number): void {
  const now = Date.now();
  const orders = load().orders;
  const accepted = ids.map((id) => orders.find((o) => o.id === id));
  if (
    accepted.length === 0 ||
    accepted.some((o) => !o || o.status !== "pending")
  ) {
    throw new DemoRulesRefusal("that order is no longer waiting");
  }
  checkOpenUntil(openUntil, now);
  const idSet = new Set(ids);
  mutate((state) => ({
    ...state,
    orders: state.orders.map((o) =>
      idSet.has(o.id) ? { ...o, status: "preparing" as const } : o,
    ),
    tableSessions: {
      ...state.tableSessions,
      ...Object.fromEntries(accepted.map((o) => [o!.tableNumber, openUntil])),
    },
  }));
}

export function demoAcceptOrder(id: string, openUntil: number): void {
  demoAcceptOrders([id], openUntil);
}

/** Staff keep an open table open (or close one: openUntil = now). */
export function demoSetTableOpenUntil(table: number, openUntil: number): void {
  if (!Number.isInteger(table) || table < 1 || table > 50) {
    throw new DemoRulesRefusal("no such table");
  }
  checkOpenUntil(openUntil, Date.now());
  mutate((state) => ({
    ...state,
    tableSessions: { ...state.tableSessions, [table]: openUntil },
  }));
}

export function demoSaveOrdering(settings: OrderingSettings): void {
  mutate((state) => ({
    ...state,
    ordering: { confirmNewGuests: settings.confirmNewGuests },
  }));
}

/** Mirrors the `rejected` branch of the order update rule. */
export function demoRejectOrder(id: string, reason?: string): void {
  const order = load().orders.find((o) => o.id === id);
  if (!order || !canReject(order.status)) {
    throw new DemoRulesRefusal("that order can no longer be rejected");
  }
  const clean = reason?.trim().slice(0, MAX_REJECT_REASON);
  mutate((state) => ({
    ...state,
    orders: state.orders.map((o) =>
      o.id === id
        ? {
            ...o,
            status: "rejected" as const,
            ...(clean ? { rejectReason: clean } : {}),
          }
        : o,
    ),
  }));
}

let numberingQueue: Promise<unknown> = Promise.resolve();

/**
 * The demo's numbering transaction: the same body the Firestore adapter runs
 * (src/lib/day-number.ts), against localStorage, with Firestore's optimistic
 * check — if the order or the day's counter changed between the read and the
 * write, try again. Across tabs the whole thing also runs under a Web Lock
 * where the browser has them, because two tabs are two threads and
 * localStorage alone is not a transaction.
 */
export async function demoAssignDayNumber(
  id: string,
): Promise<Assigned | null> {
  const attempt = async (): Promise<Assigned | null> => {
    for (let tries = 0; tries < 5; tries += 1) {
      const seen = load();
      let write: { dayKey: string; dayNumber: number } | null = null;
      const result = await assignInTransaction(
        {
          async readOrder(orderId) {
            const o = seen.orders.find((x) => x.id === orderId);
            return o
              ? {
                  createdAt: o.createdAt,
                  dayNumber: o.dayNumber,
                  status: o.status,
                }
              : null;
          },
          async readCounter(dayKey) {
            return seen.dayCounters[dayKey] ?? null;
          },
          write(w) {
            write = w;
          },
        },
        id,
      );
      const w = write as { dayKey: string; dayNumber: number } | null;
      if (!w) return result;
      const fresh = load();
      const before = seen.orders.find((o) => o.id === id);
      const now = fresh.orders.find((o) => o.id === id);
      if (
        now?.dayNumber !== before?.dayNumber ||
        now?.status !== before?.status ||
        fresh.dayCounters[w.dayKey] !== seen.dayCounters[w.dayKey]
      ) {
        continue; // somebody else wrote in between: re-read and retry
      }
      commit({
        ...fresh,
        orders: fresh.orders.map((o) =>
          o.id === id ? { ...o, dayNumber: w.dayNumber, dayKey: w.dayKey } : o,
        ),
        dayCounters: { ...fresh.dayCounters, [w.dayKey]: w.dayNumber + 1 },
      });
      return result;
    }
    throw Object.assign(new Error("Too much contention numbering orders."), {
      code: "aborted",
    });
  };
  const locks = (
    globalThis.navigator as
      | {
          locks?: {
            request: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
          };
        }
      | undefined
  )?.locks;
  const run = () =>
    locks ? locks.request("cafe-qr-order:day-number", attempt) : attempt();
  // One at a time within this tab too, whether or not Web Locks exist.
  const turn = numberingQueue.then(run, run);
  numberingQueue = turn.catch(() => undefined);
  return turn;
}

export function demoSaveTableKeys(keys: TableKeys): void {
  for (const [table, key] of Object.entries(keys)) {
    const n = Number(table);
    if (!Number.isInteger(n) || n < 1 || n > 50 || !isTableKey(key)) {
      throw new DemoRulesRefusal("bad table code");
    }
  }
  mutate((state) => ({
    ...state,
    tableKeys: { ...state.tableKeys, ...keys },
  }));
}

export function demoWriteMenu(
  id: string,
  patch: Partial<Omit<MenuItem, "id">>,
): void {
  mutate((state) => ({
    ...state,
    menu: state.menu.map((item) =>
      item.id === id ? { ...item, ...patch } : item,
    ),
  }));
}

export function demoCreateMenu(
  input: Omit<MenuItem, "id" | "sortOrder"> & { sortOrder?: number },
): MenuItem {
  const item: MenuItem = {
    ...input,
    id: makeId("m"),
    description: input.description ?? "",
    available: input.available ?? true,
    sortOrder: input.sortOrder ?? 1000,
  };
  mutate((state) => ({ ...state, menu: [...state.menu, item] }));
  return item;
}

export function demoDeleteMenu(id: string): void {
  mutate((state) => ({
    ...state,
    menu: state.menu.filter((item) => item.id !== id),
  }));
}

export function demoReplaceMenu(items: MenuItem[]): void {
  mutate((state) => ({ ...state, menu: items }));
}

/**
 * Replaces the order history with a sample month (demo mode only). Used by the
 * "Add a sample month" button so the reports page can be evaluated before there
 * is real data to look at.
 */
export function demoSeedOrders(
  orders: Array<Omit<Order, "id" | "orderNumber">>,
): number {
  mutate((state) => {
    // Numbered the way the board would have numbered them: per IST day, in
    // the order they arrived. The counters are replaced with the sample's,
    // since the orders they counted are replaced too.
    const dayCounters: Record<string, number> = {};
    const withIds = [...orders]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((order) => {
        const id = makeId("o");
        const dayKey = istDayKey(order.createdAt);
        const dayNumber = dayCounters[dayKey] ?? 1;
        dayCounters[dayKey] = dayNumber + 1;
        return {
          ...order,
          id,
          orderNumber: displayNumberFromId(id),
          dayNumber,
          dayKey,
        };
      });
    return { ...state, orders: withIds, dayCounters };
  });
  return orders.length;
}

export function demoSaveOffer(offer: SpecialOffer): void {
  mutate((state) => ({ ...state, offer }));
}

export function demoSaveTables(tables: number[]): void {
  mutate((state) => ({ ...state, tables }));
}

export { subscribeState, load as loadDemoState, emptyState, seedState };
