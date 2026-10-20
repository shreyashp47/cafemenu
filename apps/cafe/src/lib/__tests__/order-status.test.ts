import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACTIVE_STATUSES,
  CUSTOMER_STEPS,
  ORDER_STATUSES,
  REJECT_REASONS,
  MAX_REJECT_REASON,
  actionsFor,
  canAdvance,
  PENDING_REJECT_REASON,
  canReject,
  isAwaitingCounter,
  isClosedStatus,
  isActiveStatus,
  isOrderStatus,
  nextStatus,
  stepIndex,
  transition,
} from "@/lib/order-status";

describe("order status machine", () => {
  it("declares the documented chain", () => {
    expect(ORDER_STATUSES).toEqual([
      "pending",
      "received",
      "preparing",
      "ready",
      "served",
      "completed",
      "rejected",
    ]);
  });

  it("walks forward one step at a time", () => {
    expect(nextStatus("received")).toBe("preparing");
    expect(nextStatus("preparing")).toBe("ready");
    expect(nextStatus("ready")).toBe("served");
    expect(nextStatus("served")).toBe("completed");
  });

  it("treats completed as terminal", () => {
    expect(nextStatus("completed")).toBeNull();
    expect(actionsFor("completed")).toEqual([]);
  });

  it("refuses to skip a step", () => {
    expect(canAdvance("preparing", "served")).toBe(false);
    expect(canAdvance("received", "ready")).toBe(false);
    expect(transition("preparing", "served")).toBeNull();
  });

  it("refuses to go backwards", () => {
    expect(canAdvance("ready", "preparing")).toBe(false);
    expect(transition("completed", "preparing")).toBeNull();
  });

  it("refuses to re-apply the same status", () => {
    expect(canAdvance("preparing", "preparing")).toBe(false);
  });

  it("accepts the legal transition", () => {
    expect(transition("preparing", "ready")).toBe("ready");
  });

  // This used to assert the opposite: Ready offered a "Complete" button, but
  // ready -> completed is not a legal hop here or in firestore.rules, so the
  // board's guard refused it and the tap silently did nothing.
  it("does not offer Complete from ready — serve it first", () => {
    expect(actionsFor("ready").map((a) => a.to)).toEqual(["served"]);
  });

  it("only ever offers a button the machine will accept", () => {
    for (const status of ORDER_STATUSES) {
      for (const action of actionsFor(status)) {
        expect(
          transition(status, action.to),
          `${status} offers "${action.label}" -> ${action.to}`,
        ).toBe(action.to);
      }
    }
  });

  it("always offers exactly one primary action, except when closed", () => {
    for (const status of ORDER_STATUSES) {
      const primaries = actionsFor(status).filter((a) => a.primary);
      if (isClosedStatus(status)) expect(primaries).toHaveLength(0);
      else expect(primaries).toHaveLength(1);
    }
  });

  it("only lists active statuses on the staff board", () => {
    for (const status of ACTIVE_STATUSES) {
      expect(status).not.toBe("completed");
    }
    expect(isActiveStatus("completed")).toBe(false);
    expect(isActiveStatus("preparing")).toBe(true);
  });

  it("validates unknown statuses", () => {
    expect(isOrderStatus("preparing")).toBe(true);
    expect(isOrderStatus("cancelled")).toBe(false);
    expect(isOrderStatus(null)).toBe(false);
    expect(isOrderStatus(3)).toBe(false);
  });

  it("maps a status onto the customer-visible timeline", () => {
    expect(stepIndex("received")).toBe(0);
    expect(stepIndex("preparing")).toBe(1);
    expect(stepIndex("ready")).toBe(2);
    expect(stepIndex("served")).toBe(3);
    // completed means every customer step happened
    expect(stepIndex("completed")).toBe(CUSTOMER_STEPS.length - 1);
  });
});

describe("rejecting an order", () => {
  it("is allowed from pending, preparing and ready, exactly as firestore.rules says", () => {
    expect(transition("pending", "rejected")).toBe("rejected");
    expect(transition("preparing", "rejected")).toBe("rejected");
    expect(transition("ready", "rejected")).toBe("rejected");
    for (const from of ORDER_STATUSES) {
      expect(canReject(from), from).toBe(
        from === "pending" || from === "preparing" || from === "ready",
      );
    }
  });

  it("is refused once the order is served, completed or already rejected", () => {
    expect(transition("served", "rejected")).toBeNull();
    expect(transition("completed", "rejected")).toBeNull();
    expect(transition("rejected", "rejected")).toBeNull();
  });

  it("is terminal: nothing leaves rejected", () => {
    expect(nextStatus("rejected")).toBeNull();
    expect(actionsFor("rejected")).toEqual([]);
    for (const to of ORDER_STATUSES) {
      expect(transition("rejected", to), to).toBeNull();
    }
  });

  it("takes the order off the staff board", () => {
    expect(isActiveStatus("rejected")).toBe(false);
    expect(ACTIVE_STATUSES).not.toContain("rejected");
    expect(isClosedStatus("rejected")).toBe(true);
  });

  it("is never offered as a forward step, only as its own action", () => {
    for (const status of ORDER_STATUSES) {
      expect(actionsFor(status).map((a) => a.to)).not.toContain("rejected");
    }
  });

  it("offers quick reasons that fit the rules' 80-character limit", () => {
    expect(REJECT_REASONS.length).toBeGreaterThan(0);
    for (const r of REJECT_REASONS) {
      expect(r.length).toBeLessThanOrEqual(MAX_REJECT_REASON);
    }
  });

  it("uses the same reason limit and reject states as firestore.rules", () => {
    const rules = readFileSync(
      resolve(process.cwd(), "firestore.rules"),
      "utf8",
    );
    expect(rules).toContain(
      `request.resource.data.rejectReason.size() <= ${MAX_REJECT_REASON}`,
    );
    expect(rules).toContain(
      'resource.data.status in ["pending", "preparing", "ready"]',
    );
  });
});

describe("waiting for the counter (pending)", () => {
  it("has exactly one way on: Accept, to preparing", () => {
    expect(nextStatus("pending")).toBe("preparing");
    expect(transition("pending", "preparing")).toBe("preparing");
    expect(actionsFor("pending")).toEqual([
      { to: "preparing", label: "Accept", variant: "primary", primary: true },
    ]);
  });

  it("cannot skip the kitchen", () => {
    for (const to of ["ready", "served", "completed"] as const) {
      expect(transition("pending", to), to).toBeNull();
    }
  });

  it("nothing goes back to pending", () => {
    for (const from of ORDER_STATUSES) {
      expect(transition(from, "pending"), from).toBeNull();
    }
  });

  it("is on the board, but not kitchen work", () => {
    expect(isActiveStatus("pending")).toBe(true);
    expect(isAwaitingCounter("pending")).toBe(true);
    expect(isAwaitingCounter("preparing")).toBe(false);
    expect(isClosedStatus("pending")).toBe(false);
    expect(CUSTOMER_STEPS).not.toContain("pending");
  });

  it("suggests 'No one at this table' first when turning a guest away", () => {
    expect(PENDING_REJECT_REASON).toBe("No one at this table");
    expect(REJECT_REASONS).toContain(PENDING_REJECT_REASON);
  });

  it("matches the transitions firestore.rules spells out", () => {
    const rules = readFileSync(
      resolve(process.cwd(), "firestore.rules"),
      "utf8",
    );
    expect(rules).toMatch(
      /resource\.data\.status == "pending"\s+&& request\.resource\.data\.status == "preparing"/,
    );
    expect(rules).toContain(
      'request.resource.data.status in ["pending", "preparing"]',
    );
  });
});
