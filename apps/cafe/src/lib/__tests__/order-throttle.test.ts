import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CLOCK_SKEW_ALLOWANCE_MS,
  ORDER_GAP_SECONDS,
  OrderThrottled,
  forgetLastOrder,
  readLastOrderAt,
  recordOrderPlaced,
  secondsUntilNextOrder,
  throttleFromServerStamp,
  throttleMessage,
} from "../order-throttle";

const T0 = 1_790_000_000_000;

describe("secondsUntilNextOrder", () => {
  it("lets a customer who has never ordered go straight ahead", () => {
    expect(secondsUntilNextOrder(null, T0)).toBe(0);
  });

  it("counts down the rest of the gap, rounding up", () => {
    expect(secondsUntilNextOrder(T0, T0)).toBe(ORDER_GAP_SECONDS);
    expect(secondsUntilNextOrder(T0, T0 + 5_000)).toBe(ORDER_GAP_SECONDS - 5);
    // 0.2 s left is still "wait 1 second", never "wait 0 seconds".
    expect(secondsUntilNextOrder(T0, T0 + ORDER_GAP_SECONDS * 1000 - 200)).toBe(
      1,
    );
  });

  it("opens exactly at the gap, which is what the rule allows (>=)", () => {
    expect(secondsUntilNextOrder(T0, T0 + ORDER_GAP_SECONDS * 1000)).toBe(0);
    expect(secondsUntilNextOrder(T0, T0 + 60_000)).toBe(0);
  });

  it("ignores a note from the future instead of locking the phone out", () => {
    // The clock was hours ahead when the order went in and has been corrected
    // since. Waiting for real time to catch up would block every order and
    // never ask the server, which enforces the gap anyway.
    expect(secondsUntilNextOrder(T0, T0 - 10_000)).toBe(0);
    expect(secondsUntilNextOrder(T0, T0 - 3 * 3600_000)).toBe(0);
  });

  it("ignores a corrupt stored time rather than blocking forever", () => {
    expect(secondsUntilNextOrder(Number.NaN, T0)).toBe(0);
  });
});

describe("throttleFromServerStamp (after the server has refused)", () => {
  const GAP = ORDER_GAP_SECONDS * 1000;

  it("is not a throttle when the customer has no stamp", () => {
    expect(throttleFromServerStamp(null, T0)).toBeNull();
  });

  it("counts down accurately when the clocks agree", () => {
    // The old estimate subtracted 5 s of slack and said 29 with 24 left.
    expect(throttleFromServerStamp(T0, T0 + 6_000)).toEqual({ seconds: 24 });
    expect(throttleFromServerStamp(T0, T0 + GAP - 200)).toEqual({ seconds: 1 });
  });

  it("still says 'throttled' when the phone runs ahead of the server", () => {
    // The phone thinks 40 s have passed; the server, which refused, knows
    // fewer than 30 have. No local note, and the customer still gets the
    // friendly message, without an invented number.
    expect(throttleFromServerStamp(T0, T0 + GAP + 10_000)).toEqual({
      seconds: null,
    });
    expect(throttleFromServerStamp(T0, T0 + GAP)).toEqual({ seconds: null });
  });

  it("still says 'throttled' when the phone runs behind the server", () => {
    expect(throttleFromServerStamp(T0, T0 - 20_000)).toEqual({
      seconds: null,
    });
  });

  it("gives up on clocks further out than the allowance", () => {
    expect(
      throttleFromServerStamp(T0, T0 - CLOCK_SKEW_ALLOWANCE_MS - 1),
    ).toBeNull();
  });

  it("treats an old stamp as some other refusal, not a throttle", () => {
    expect(
      throttleFromServerStamp(T0, T0 + GAP + CLOCK_SKEW_ALLOWANCE_MS),
    ).toBeNull();
    expect(throttleFromServerStamp(T0, T0 + 3600_000)).toBeNull();
  });
});

describe("throttleMessage", () => {
  it("says 'under 30 seconds' when the phone cannot know the exact wait", () => {
    expect(throttleMessage(null)).toMatch(
      new RegExp(`another in under ${ORDER_GAP_SECONDS} seconds\\.$`),
    );
    expect(new OrderThrottled(null).seconds).toBeNull();
  });

  it("tells the customer what to do, in seconds", () => {
    expect(throttleMessage(25)).toMatch(/another in 25 seconds\.$/);
    expect(throttleMessage(1)).toMatch(/another in 1 second\.$/);
  });

  it("never says zero or a fraction", () => {
    expect(throttleMessage(0)).toMatch(/in 1 second\./);
    expect(throttleMessage(2.1)).toMatch(/in 3 seconds\./);
  });

  it("is what OrderThrottled carries", () => {
    const err = new OrderThrottled(12);
    expect(err).toBeInstanceOf(Error);
    expect(err.seconds).toBe(12);
    expect(err.message).toBe(throttleMessage(12));
  });
});

describe("the phone's note of its last order", () => {
  it("round-trips through storage and can be forgotten", () => {
    expect(readLastOrderAt()).toBeNull();
    recordOrderPlaced(T0);
    expect(readLastOrderAt()).toBe(T0);
    forgetLastOrder();
    expect(readLastOrderAt()).toBeNull();
  });

  it("reads junk as no note at all", () => {
    localStorage.setItem("toe.lastOrderAt", "not a number");
    expect(readLastOrderAt()).toBeNull();
  });
});

describe("the gap agrees with firestore.rules", () => {
  it("uses the same number of seconds the server enforces", () => {
    // The rules are the real limit. If the two drift, a customer is either told
    // to wait when the server would have let them through, or told nothing and
    // shown a bare refusal.
    // vitest runs from the repo root (jsdom makes import.meta.url non-file).
    const rules = readFileSync(
      resolve(process.cwd(), "firestore.rules"),
      "utf8",
    );
    const match = /lastOrderAt \+ duration\.value\((\d+), 's'\)/.exec(rules);
    expect(
      match,
      "throttle clause not found in firestore.rules",
    ).not.toBeNull();
    expect(Number(match?.[1])).toBe(ORDER_GAP_SECONDS);
  });
});
