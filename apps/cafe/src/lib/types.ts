/**
 * Shared domain types + narrow runtime validators.
 *
 * Both storage backends (Firestore and the localStorage demo store) produce
 * these shapes, which is what makes them interchangeable. The narrowing
 * functions are the contract: if a document drifts, `parse*` rejects it here
 * rather than exploding three components deep.
 */

import { isDayKey, isDayNumber, resolveOrderNumber } from "./order-number";
import {
  MAX_REJECT_REASON,
  isOrderStatus,
  type OrderStatus,
} from "./order-status";

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  /** Rupees. Stored as a whole number of rupees to avoid float drift. */
  price: number;
  category: string;
  available: boolean;
  /** Optional per-item art key; falls back to the category icon when absent. */
  art?: string;
  sortOrder: number;
}

export interface OrderLine {
  menuItemId: string;
  name: string;
  qty: number;
  /** Price is copied onto the line at order time so history never re-prices. */
  price: number;
}

export interface Order {
  id: string;
  /**
   * The FALLBACK number, for orders with no `dayNumber`: the stored number from
   * the original counter, else three digits derived from the document id (see
   * ./order-number.ts). Not unique. Show `orderLabel(order)` rather than this.
   */
  orderNumber: number;
  /**
   * Today's sequence number, 1–9999, shown as "#0007". Written by the staff
   * board shortly after the order arrives; absent until then, and on older
   * orders. See ./day-number.ts.
   */
  dayNumber?: number;
  /** The IST day `dayNumber` counts within, "YYYY-MM-DD". Set with it. */
  dayKey?: string;
  tableNumber: number;
  items: OrderLine[];
  total: number;
  status: OrderStatus;
  createdAt: number;
  completedAt?: number;
  notes?: string;
  paymentMethod: "counter" | "upi";
  /** Set by staff when they reject the order; shown to the customer. */
  rejectReason?: string;
}

export type SpecialOffer = { enabled: boolean; text: string };

export interface CartLine {
  menuItemId: string;
  name: string;
  price: number;
  qty: number;
  category: string;
}

export type Unsubscribe = () => void;

// --- narrowing helpers ------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function parseMenuItem(raw: unknown): MenuItem | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const name = str(raw.name);
  const price = num(raw.price);
  const category = str(raw.category);
  if (!id || !name || price === null || price < 0 || !category) return null;

  return {
    id,
    name,
    description: str(raw.description) ?? "",
    price,
    category,
    available: bool(raw.available) ?? true,
    art: str(raw.art) ?? undefined,
    sortOrder: num(raw.sortOrder) ?? 0,
  };
}

export function parseMenuList(raw: unknown): MenuItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(parseMenuItem)
    .filter((item): item is MenuItem => item !== null);
}

export function parseOrderLine(raw: unknown): OrderLine | null {
  if (!isRecord(raw)) return null;
  const name = str(raw.name);
  const qty = num(raw.qty);
  const price = num(raw.price);
  if (!name || qty === null || qty <= 0 || price === null || price < 0) {
    return null;
  }
  return {
    menuItemId: str(raw.menuItemId) ?? "",
    name,
    qty: Math.round(qty),
    price,
  };
}

export function parseOrder(raw: unknown): Order | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const tableNumber = num(raw.tableNumber);
  const total = num(raw.total);
  const createdAt = num(raw.createdAt);
  if (!id || tableNumber === null || total === null || createdAt === null) {
    return null;
  }
  if (!isOrderStatus(raw.status)) return null;

  const items = Array.isArray(raw.items)
    ? raw.items.map(parseOrderLine).filter((l): l is OrderLine => l !== null)
    : [];

  return {
    id,
    orderNumber: resolveOrderNumber(id, raw.orderNumber),
    tableNumber,
    items,
    total,
    status: raw.status,
    createdAt,
    completedAt: num(raw.completedAt) ?? undefined,
    notes: str(raw.notes) ?? undefined,
    paymentMethod: raw.paymentMethod === "upi" ? "upi" : "counter",
    // Both or neither: a number means nothing without the day it counts in.
    ...(isDayNumber(raw.dayNumber) && isDayKey(raw.dayKey)
      ? { dayNumber: raw.dayNumber, dayKey: raw.dayKey }
      : {}),
    // Deliberately not `tableKey`: the table's QR code travels on the order only
    // so the rules can check it, and nothing on screen has any use for it.
    ...(raw.status === "rejected" && str(raw.rejectReason)?.trim()
      ? {
          rejectReason: str(raw.rejectReason)!
            .trim()
            .slice(0, MAX_REJECT_REASON),
        }
      : {}),
  };
}

export function parseOrderList(raw: unknown): Order[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseOrder).filter((o): o is Order => o !== null);
}

export function parseSpecialOffer(raw: unknown): SpecialOffer {
  if (!isRecord(raw)) return { enabled: false, text: "" };
  return { enabled: bool(raw.enabled) ?? false, text: str(raw.text) ?? "" };
}
