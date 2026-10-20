/**
 * Storage contracts. Two implementations satisfy these — Firestore and the
 * localStorage demo store — which is what lets the app run with zero config
 * while still being production-shaped (see docs/decisions.md).
 */

import type {
  MenuItem,
  Order,
  OrderLine,
  SpecialOffer,
  Unsubscribe,
} from "../types";
import type { TableKeys } from "../table-keys";
import type { Assigned } from "../day-number";
import type { NewOrderStatus } from "../order-status";
import type { OrderingSettings, TableSessions } from "../table-open";

export type Listener<T> = (value: T) => void;
export type ErrorListener = (error: Error) => void;

export interface NewOrderInput {
  tableNumber: number;
  items: OrderLine[];
  total: number;
  notes?: string;
  paymentMethod?: Order["paymentMethod"];
  /**
   * The table's QR code (src/lib/table-keys.ts), when the customer arrived with
   * one. Sent only when present, so a table with no code yet orders exactly as
   * before.
   */
  tableKey?: string;
  /**
   * `pending` unless the table is open (src/lib/table-open.ts). Defaults to
   * `pending`, the status the rules always accept.
   */
  status?: NewOrderStatus;
}

export interface MenuWriteInput {
  name: string;
  description?: string;
  price: number;
  category: string;
  available?: boolean;
  art?: string;
}

export interface MenuRepository {
  /** Live menu. Fires immediately with the current value. */
  subscribe(
    listener: Listener<MenuItem[]>,
    onError?: ErrorListener,
  ): Unsubscribe;
  list(): Promise<MenuItem[]>;
  create(input: MenuWriteInput): Promise<MenuItem>;
  update(id: string, patch: Partial<MenuWriteInput>): Promise<void>;
  remove(id: string): Promise<void>;
  /** Persist a whole new ordering (drag-to-reorder in /admin). */
  reorder(items: MenuItem[]): Promise<void>;
  /** Replace the menu wholesale (used by the seed button in demo mode). */
  replaceAll(items: MenuItem[]): Promise<void>;
}

export interface OrderRepository {
  /** Live active board: received/preparing/ready/served, oldest first. */
  subscribeActive(
    listener: Listener<Order[]>,
    onError?: ErrorListener,
  ): Unsubscribe;
  /** Live single order, for the customer's status screen. */
  subscribeOrder(
    id: string,
    listener: Listener<Order | null>,
    onError?: ErrorListener,
  ): Unsubscribe;
  create(input: NewOrderInput): Promise<Order>;
  /**
   * With `keepTableOpen`, the same commit pushes that table's open time
   * forward (src/lib/table-open.ts): staff working on an open table's order
   * keep it open.
   */
  setStatus(
    id: string,
    status: Order["status"],
    keepTableOpen?: { table: number; openUntil: number },
  ): Promise<void>;
  /**
   * Staff accept a new guest's order: pending -> preparing, and the table
   * opens until `openUntil`, in one commit. `ids` is every waiting order of
   * that table (two phones at one table both waiting), so none is left
   * behind saying it waits for a table that is already open.
   */
  accept(ids: string[], table: number, openUntil: number): Promise<void>;
  /** Staff turn an order away. `reason` is optional and shown to the customer. */
  reject(id: string, reason?: string): Promise<void>;
  /**
   * Staff only: give the order today's next number (#0001, #0002, …) in one
   * transaction with the day's counter. Resolves null when the order already
   * had one, e.g. because another board numbered it first. See
   * src/lib/day-number.ts.
   */
  assignDayNumber(id: string): Promise<Assigned | null>;
  /**
   * Bounded range query — keeps Firestore reads inside the free tier.
   * Always returned oldest first. With `limit`, only the newest `limit` orders
   * in the range are read, so one busy month can't cost a day's read quota.
   */
  listRange(fromMs: number, toMs: number, limit?: number): Promise<Order[]>;
}

/**
 * `unassigned` is a real, signed-in Firebase account with no `/staff/{uid}`
 * document. The rules treat it as a stranger, so the app must too: it gets a
 * "not set up yet" screen rather than an order board it cannot read.
 */
export type StaffRole = "staff" | "owner" | "unassigned";

export interface StaffUser {
  uid: string;
  email: string;
  role: StaffRole;
  displayName: string;
}

export interface AuthRepository {
  /** Real Firebase Auth. `pin` is demo-mode only. */
  signIn(email: string, password: string): Promise<void>;
  signInWithPin(pin: string): Promise<void>;
  signOut(): Promise<void>;
  subscribe(listener: Listener<StaffUser | null>): Unsubscribe;
  current(): StaffUser | null;
}

export interface ConfigRepository {
  subscribe(listener: Listener<SpecialOffer>): Unsubscribe;
  save(offer: SpecialOffer): Promise<void>;
  /**
   * The owner's saved table list, or `null` while nothing has been saved (the
   * app then falls back to NEXT_PUBLIC_TABLES). Live, so a change on /admin/qr
   * reaches the customer's table picker without a redeploy.
   */
  subscribeTables(listener: Listener<number[] | null>): Unsubscribe;
  /** Rejects a list with no usable table rather than saving an empty cafe. */
  saveTables(tables: number[]): Promise<void>;
  /**
   * Owner only: the per-table QR codes, live. Staff and customers are refused by
   * the rules, so only /admin/qr subscribes.
   */
  subscribeTableKeys(
    listener: Listener<TableKeys>,
    onError?: ErrorListener,
  ): Unsubscribe;
  /** Owner only: write codes for these tables, replacing any they had. */
  saveTableKeys(keys: TableKeys): Promise<void>;
}

/**
 * Open tables (src/lib/table-open.ts). Anyone may read — whether a table is
 * open is harmless, and the customer's phone needs it to pick the order's
 * status. Only staff (and the owner) write.
 */
export interface SessionRepository {
  /**
   * Every table's openUntil, live. For the staff board's "Open tables" only:
   * the rules refuse to list tableSessions to anyone but staff.
   */
  subscribe(
    listener: Listener<TableSessions>,
    onError?: ErrorListener,
  ): Unsubscribe;
  /**
   * One read of that table's own document (a `get`, which anyone may do),
   * when a customer places an order. Leans towards "open" by a few minutes
   * for the phone's clock (looksOpen in src/lib/table-open.ts).
   */
  isOpen(table: number): Promise<boolean>;
  /** Staff: the table closes now. */
  close(table: number): Promise<void>;
  /** The owner's switch, live. Missing = confirmation ON. */
  subscribeSettings(listener: Listener<OrderingSettings>): Unsubscribe;
  /** One read, when a customer places an order. */
  readSettings(): Promise<OrderingSettings>;
  /** Owner only. */
  saveSettings(settings: OrderingSettings): Promise<void>;
}

export interface DataBundle {
  menu: MenuRepository;
  orders: OrderRepository;
  auth: AuthRepository;
  config: ConfigRepository;
  sessions: SessionRepository;
  /** True when backed by the localStorage demo store. */
  isDemo: boolean;
}
