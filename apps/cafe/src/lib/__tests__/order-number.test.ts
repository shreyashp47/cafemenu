import { describe, expect, it } from "vitest";

import {
  DISPLAY_NUMBER_MAX,
  DISPLAY_NUMBER_MIN,
  displayNumberFromId,
  resolveOrderNumber,
} from "../order-number";
import { parseOrder } from "../types";

// Shaped like a Firestore auto id: 20 characters from [A-Za-z0-9].
const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function autoId(seed: number): string {
  let x = (seed * 2654435761) >>> 0;
  let out = "";
  for (let i = 0; i < 20; i += 1) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    out += ALPHABET[(x >>> 16) % ALPHABET.length];
  }
  return out;
}

describe("displayNumberFromId", () => {
  it("is always a three-digit number a person can read out", () => {
    for (let i = 0; i < 2000; i += 1) {
      const n = displayNumberFromId(autoId(i));
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(DISPLAY_NUMBER_MIN);
      expect(n).toBeLessThanOrEqual(DISPLAY_NUMBER_MAX);
      expect(String(n)).toHaveLength(3);
    }
  });

  it("pins known values, so the hash cannot drift under live orders", () => {
    // Every device derives the number independently. If this changes, the
    // counter phone and the customer's phone stop agreeing mid-service.
    expect(displayNumberFromId("")).toBe(161);
    expect(displayNumberFromId("Xb3kP9qLmN2vR7tY1wZa")).toBe(113);
    expect(displayNumberFromId("o-aaaa1")).toBe(680);
  });

  it("spreads ids across the range rather than bunching them", () => {
    const counts = new Map<number, number>();
    const N = 9000;
    for (let i = 0; i < N; i += 1) {
      const n = displayNumberFromId(autoId(i));
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    // 9000 ids over 900 buckets averages 10 each. A broken hash piles them up.
    expect(counts.size).toBeGreaterThan(850);
    expect(Math.max(...counts.values())).toBeLessThan(40);
  });

  it("differs for ids that differ by one character", () => {
    const seen = new Set(
      ["o-aaaa1", "o-aaaa2", "o-aaaa3", "o-aaaa4", "o-aaaa5"].map(
        displayNumberFromId,
      ),
    );
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("resolveOrderNumber", () => {
  it("keeps the stored number on orders placed under the old counter", () => {
    expect(resolveOrderNumber("anything", 104)).toBe(104);
    expect(resolveOrderNumber("anything", 123456)).toBe(123456);
  });

  it("derives the number when none was stored", () => {
    expect(resolveOrderNumber("abc", undefined)).toBe(
      displayNumberFromId("abc"),
    );
    expect(resolveOrderNumber("abc", null)).toBe(displayNumberFromId("abc"));
  });

  it("does not trust a zero, negative, fractional or non-numeric value", () => {
    for (const junk of [0, -3, 1.5, "104", Number.NaN]) {
      expect(resolveOrderNumber("abc", junk)).toBe(displayNumberFromId("abc"));
    }
  });

  it("is what parseOrder uses, for both old and new documents", () => {
    const base = {
      tableNumber: 4,
      items: [{ name: "Latte", qty: 1, price: 180 }],
      total: 180,
      status: "preparing",
      createdAt: 1,
    };
    expect(
      parseOrder({ ...base, id: "legacy", orderNumber: 187 }),
    ).toMatchObject({ orderNumber: 187 });
    expect(parseOrder({ ...base, id: "fresh" })).toMatchObject({
      orderNumber: displayNumberFromId("fresh"),
    });
  });
});
